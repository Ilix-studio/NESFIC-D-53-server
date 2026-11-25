# VoiceDAR backend: Claude Code brief

> Save this file as `server/CLAUDE.md` inside your project. Claude Code reads it whenever it works in the `server/` folder, on top of the main `CLAUDE.md`.

## What the backend does

The Expo app works offline and keeps everything on the phone first. The backend:

1. Receives cases, audio clips and photos when the phone has network (sync).
2. Turns an Assamese audio clip into a transcript (ASR) and maps it to eDAR field values.
3. Runs the missing and inconsistent checks and creates follow-up questions.
4. Stores officer edits, confirmations and signatures, and keeps an append-only audit trail.
5. Exports a signed case as eDAR-schema JSON.

## Stack

- **Node.js (LTS) + Express**, JavaScript with ES modules (`"type": "module"`).
- **MongoDB with Mongoose.**
- Packages: `express`, `mongoose`, `dotenv`, `cors`, `helmet`, `morgan`, `multer` (audio/photo upload), `zod` (request validation), `jsonwebtoken` + `bcryptjs` (officer login), `express-rate-limit`.
- Dev: `nodemon`, `jest`, `supertest`, `mongodb-memory-server` (tests run without a real database).

## Folder structure (MVC + services)

```
server/
  src/
    app.js                  express app: middleware, routes, error handler
    server.js               connects to MongoDB, starts listening
    config/
      env.js                reads and validates .env (PORT, MONGO_URI, JWT_SECRET, ASR_ENGINE, MAPPER_ENGINE, UPLOAD_DIR)
      db.js                 mongoose connection
    models/
      Officer.js
      Case.js
      Clip.js
      Photo.js
      AuditEvent.js
    services/
      auth.service.js
      case.service.js
      clip.service.js
      asr/
        index.js            picks engine from ASR_ENGINE
        mock.asr.js         returns sample Assamese transcripts from test-data/
        bhashini.asr.js     real Assamese ASR (stub until API key arrives)
      mapper/
        index.js            picks engine from MAPPER_ENGINE
        rule.mapper.js      keyword + number mapping using the schema's Assamese keywords
        llm.mapper.js       stub for later (LLM with strict JSON output)
      rules/
        index.js            runs every rule, returns findings
        requiredMissing.rule.js
        nightButDaylight.rule.js
        fatalButNoDeaths.rule.js
        deathsButNotFatal.rule.js
        vehicleCountMismatch.rule.js
      followup.service.js   turns rule findings into follow-up questions
      review.service.js     edit / confirm / sign
      audit.service.js      append-only logging
      export.service.js     eDAR-schema JSON export
      sync.service.js       idempotent upsert of cases from the phone
    controllers/
      auth.controller.js
      case.controller.js
      clip.controller.js
      photo.controller.js
      followup.controller.js
      review.controller.js
      export.controller.js
      sync.controller.js
    routes/
      index.js              mounts everything under /api/v1
      auth.routes.js
      case.routes.js
      clip.routes.js
      photo.routes.js
      followup.routes.js
      review.routes.js
      export.routes.js
      sync.routes.js
    middleware/
      auth.js               verifies JWT, sets req.officer
      validate.js           zod schema -> 400 with clear messages
      upload.js             multer config (audio: m4a/aac/wav, photos: jpg/png; size limits)
      caseNotLocked.js      rejects changes to signed cases with 409
      errorHandler.js
    validators/             zod schemas for each request body
    utils/
      ApiError.js
      asyncHandler.js
    schema/
      edar.schema.json      PLACEHOLDER eDAR schema (same file the app uses)
  test-data/                synthetic Assamese transcripts (no real people)
  scripts/seed.js           creates a demo officer and one demo case
  tests/
  .env.example
```

**Layer rules:** routes only wire URL + middleware + controller. Controllers only read `req`, call one service, and send the response. All business logic and database access lives in services. Models only define schemas, indexes and hooks.

## Models

**Officer**: `name`, `badgeNo` (unique), `passwordHash`, `policeStation`, `district`, `role` (`io | supervisor | admin`), timestamps.

**Case**
- `clientId` (unique, generated on the phone, used for idempotent sync), `officer` (ref Officer), `policeStation`, `district`
- `startedAt`, `location` (GeoJSON Point + accuracy), `status` (`draft | in_review | signed | exported`)
- `fields`: array of field values, each `{ fieldId, value, source: 'speech'|'tap'|'auto'|'officer_edit', clip (ref Clip), transcriptSpan: { start, end, text }, confirmedByOfficer, updatedAt }`
- `followups`: array of `{ ruleId, kind: 'missing'|'inconsistent', fieldIds, questionEn, questionAs, options, priority, status: 'open'|'answered'|'skipped', skipReason, answeredAt }`
- `completeness`: `{ filled, total, percent }` (recomputed by case.service)
- `signedAt`, `signedBy`, `schemaVersion`, `langPack` (default `as`), timestamps
- Indexes: `clientId` unique, `officer + createdAt`, `location` 2dsphere

**Clip**: `case`, `section` (`crash|road|vehicles|persons|followup`), `filePath`, `mimeType`, `durationMs`, `recordedAt`, `transcript` (`{ text, lang, engine, confidence }`), `processingStatus` (`pending|done|failed`), `error`.

**Photo**: `case`, `checklistItem` (`road_surface|vehicle_positions|skid_marks|lighting|signs|number_plates|other`), `filePath`, `takenAt`, `location`, `note`.

**AuditEvent** (append-only): `case`, `officer`, `type` (`case_opened|clip_saved|clip_processed|fields_filled|followup_answered|followup_skipped|field_edited|field_confirmed|case_signed|case_exported|case_synced`), `fieldId`, `oldValue`, `newValue`, `meta`, `at`. Add Mongoose pre-hooks that **throw** on `updateOne`, `updateMany`, `findOneAndUpdate`, `deleteOne`, `deleteMany`, `findOneAndDelete`, so audit rows can never be changed.

## API (all under `/api/v1`, all except login need a JWT)

| Method | Route | Controller → Service | What it does |
|---|---|---|---|
| POST | `/auth/login` | auth → auth | badgeNo + password → JWT |
| GET | `/auth/me` | auth → auth | current officer |
| POST | `/cases` | case → case | create case (clientId, startedAt, location); logs `case_opened` |
| GET | `/cases` | case → case | officer's cases, newest first, paginated |
| GET | `/cases/:id` | case → case | full case with fields, followups, completeness |
| POST | `/cases/:id/clips` | clip → clip | upload audio (multipart `audio`, `section`) → ASR → mapper → rules → followups; returns filled fields + new questions |
| GET | `/cases/:id/clips/:clipId/audio` | clip → clip | stream the audio (for "play source" in review) |
| POST | `/cases/:id/photos` | photo → case | upload photo with checklistItem, takenAt, location |
| GET | `/cases/:id/followups` | followup → followup | open questions, contradictions first, then by priority |
| POST | `/cases/:id/followups/:fid/answer` | followup → followup | answer by option code or text; or multipart audio to answer by voice |
| POST | `/cases/:id/followups/:fid/skip` | followup → followup | skip with required reason |
| PATCH | `/cases/:id/fields/:fieldId` | review → review | officer edit; logs old → new |
| POST | `/cases/:id/fields/:fieldId/confirm` | review → review | mark confirmed |
| POST | `/cases/:id/sign` | review → review | only if every filled field is confirmed; locks the case |
| GET | `/cases/:id/export/edar` | export → export | eDAR-schema JSON (signed cases only) |
| GET | `/cases/:id/audit` | case → audit | audit trail in time order |
| POST | `/sync/cases` | sync → sync | phone sends cases it created offline; upsert by clientId, never overwrite officer-confirmed values with older data |

`caseNotLocked` middleware goes on every route that changes a case. A signed case returns **409**.

## Core flow: what happens when a clip is uploaded (`clip.service.processClip`)

1. Save the file (multer) and a `Clip` row with `processingStatus: 'pending'`. Log `clip_saved`.
2. `asr.transcribe(filePath, 'as')` → store transcript on the clip.
3. `mapper.map({ transcript, section, schema, currentFields })` → list of `{ fieldId, value, transcriptSpan, confidence }`. Only field ids and enum codes that exist in the schema are allowed; drop anything else.
4. Apply proposals to `case.fields` with `source: 'speech'`. **Never overwrite a value that is `officer_edit` or `confirmedByOfficer: true`.** Log `fields_filled`.
5. Run `rules` → `followup.service.refresh(case)`: keep answered/skipped questions, replace open ones with the new findings.
6. Recompute completeness, save, return `{ clip, filledFields, followups, completeness }`.

If ASR or mapping fails, mark the clip `failed` with the error and return 200 with the clip, so the phone can retry. Never lose the audio.

## Rules engine

Each rule file exports `{ id, kind, run(caseDoc, schema) => Finding[] }`, where a finding is `{ ruleId, kind, fieldIds, questionEn, questionAs, options?, priority }`. Pure functions, no database calls. Start with:

- `requiredMissing`: a required field is empty.
- `nightButDaylight`: crash time 18:00–05:59 but lighting = `daylight`.
- `fatalButNoDeaths`: severity = `fatal` but persons_killed is 0 or empty.
- `deathsButNotFatal`: persons_killed > 0 but severity is not `fatal`.
- `vehicleCountMismatch`: vehicles_count says N but fewer vehicles are described.

Every rule gets a unit test with a passing and a failing case.

## Security and privacy (DPDP Act 2023)

- Secrets only in `.env`; commit `.env.example`, never `.env`.
- `helmet`, CORS limited to the app, rate-limit `/auth/login`.
- Passwords hashed with bcrypt; JWT expires in 12 hours.
- Officers can only read and change their own cases (supervisors can read their district).
- Never log request bodies, transcripts or personal data. Use `morgan('tiny')`.
- Uploads go to `UPLOAD_DIR` outside the web root, with random file names. Validate mime type and size.
- MongoDB and file storage must be hosted in India for the pilot.
- Test data is synthetic only.

## Commands

- `npm run dev` (nodemon), `npm start`, `npm test`, `npm run seed`
- Local MongoDB: `docker run -d -p 27017:27017 --name voicedar-mongo mongo:7`, or a MongoDB Atlas cluster in the Mumbai region.

## Working rules for Claude Code

- Build one phase at a time, run `npm test` after each, and show me curl or Postman examples to try the new endpoints.
- Keep the layer rules: no database calls in controllers, no `req`/`res` in services.
- Don't present placeholder eDAR fields as official.

## Repo notes (set up 24 Nov 2026; see /SETUP.md)

Everything in this brief is implemented and covered by `npm test` (rules, mapper, full API flow on mongodb-memory-server). Additions and decisions:

- Field keys: values for repeatable sections are stored as `fieldId@n` (e.g. `registration_number@1`). `src/utils/fieldKey.js`, `src/schema/index.js` (`fieldForKey`, `coerceValue`).
- Pure helpers (no DB): `src/utils/caseFields.js` (values, instance counts, completeness) and `src/services/caseState.js` (`setFieldValue`, `applyProposals`, `recheck` = rules + follow-ups + completeness). Rules wording helpers: `src/services/rules/helpers.js`.
- `:id` in routes accepts the Mongo id or the phone's `clientId`.
- Clips and photos accept an optional `clientId`; re-uploading the same one is idempotent, and re-uploading a `failed` clip re-runs the pipeline (the retry path).
- Extra read endpoints: `GET /cases/:id/clips`, `GET /cases/:id/photos`, `GET /cases/:id/photos/:photoId/file`. Extra audit type: `photo_added`.
- Follow-up answers that change an existing value are stored as `officer_edit` (shown as "Edited by IO"); edits in review (`PATCH /fields`) count as confirmed.
- `vehicleCountMismatch` only fires once at least one vehicle is described. Answered/skipped questions are never re-asked.
- `audio/webm` is accepted too (Expo web recordings in development).
- `src/schema/*.json`, `src/lang/*.json` and `test-data/*.json` are copies of `/shared`; edit there and run `npm run sync-shared` from the repo root.
- jest runs ESM with `--experimental-vm-modules`, `watchman: false` (watchman is broken on this Mac).

### Offline-first sync (25 Nov 2026, `docs/OFFLINE-PLAN.md` phase O2)

- `POST /sync/cases` takes either `{ cases }` (whole cases, as before) or `{ ops }`: the phone's outbox, one op per change (`case/create|lang|sign`, `field/set`, `followup/answer|skip`, `proposal/decide`, `audit/append`). `sync.service.applyOps` applies ops in order per case; `SyncOp` records each `opId`, so a retried batch returns `duplicate`. Conflict rule: `caseState.incomingWins` (officer_edit / confirmed beats anything, else newer `updatedAt`). Signed cases reject everything except audit ops. Phone audit events are stored with `origin: 'phone'` and a unique `opId`.
- `GET /sync/pull?since=` returns `{ cursor, proposals, cases: [{ caseId, status, followups }] }` for the officer's cases. The cursor overlaps by 5 s; the phone upserts by id.
- Uploads with `?firstPass=phone` (clips and photos): the phone already processed the clip offline. The clip is stored, `202` is returned, and `serverPassQueue` runs `serverPass.service.runServerPass`: server ASR → mapper → every value that differs from the case becomes a `Proposal` (never written to the case; an identical open or rejected proposal is not repeated). Evidence captured before signing still uploads to a signed case, and is not re-checked.
- ASR: `ASR_ENGINE=sarvam` uses `sarvam.asr.js` when `SARVAM_API_KEY` is set, else the mock. The Sarvam adapter is untested against the live API. `llm.mapper.js` is still a stub (needs a provider decision; must be India-hosted).
- Mapper: negation words from the language pack (`negations`) cancel a phrase in the same clause; `letters` sets the script range (Bodo is Devanagari). `bn.json` and `brx.json` are PLACEHOLDER packs.

### Real speech recognition (25 Nov 2026)

- Default `ASR_ENGINE=indicconformer`: AI4Bharat IndicConformer (int8 ONNX, CTC, audio front end inside the graph) run with `onnxruntime-node`; Assamese and Bodo, no Bengali export yet. No key, no third-party call. Falls back to the mock while `MODELS_DIR` has no model (`npm run fetch-models`: pinned Hugging Face revision + SHA-256 from `shared/models/speech-models.json`).
- `services/asr/audio.js` decodes any clip with `ffmpeg-static` to 16 kHz mono float32; `ctc.js` = greedy CTC over the model language's token slice, ids → text, and `planChunks` (cut at the quietest 100 ms). Pieces are at most 12 s: the int8 export loses words past ~14 s of speech in one pass. Do not pad pieces with digital silence (measured: it drops first words).
- `GET /api/v1/models` (+ `/:id/file`, Range-capable) serves the same files to phones; public, the app pins SHA-256.
- Tests: `ctc.test.js` (pure) and `speech.test.js` (synthetic-voice clips in `test-data/audio`, needs the model, skipped without it; uses `tests/onnx-environment.cjs` so onnxruntime's typed arrays pass jest's realm check). `npm run asr:benchmark -- <folder> [lang] [engine]` gives CER/WER/RTF for a folder with `refs.json`. `npm run make-test-audio` rebuilds the synthetic clips (CC-BY-NC voice, tests only).

### Photo storage on Cloudinary (25 Nov 2026)

- `PHOTO_STORAGE=local|cloudinary` (default `local`). Cloudinary needs `CLOUDINARY_CLOUD_NAME`, `_API_KEY`, `_API_SECRET` (startup fails without them); `CLOUDINARY_FOLDER` defaults to `voicedar/photos`.
- Multer keeps photos in memory (`multer.memoryStorage()`, 10 MB, jpg/png). `case.service.addPhoto` stores the file only after the case, validation and duplicate-`clientId` checks pass, through `services/photoStorage` (`local.storage.js`, `cloudinary.storage.js`); if the `Photo` row then fails to save, the stored file is removed. Audio still uses disk storage.
- Cloudinary assets are `type: 'authenticated'` with a random UUID name (no case data). `GET /cases/:id/photos/:photoId/file` redirects (302, `no-store`) to `private_download_url` valid 5 minutes. An upload failure returns 502 so the phone retries.
- `Photo` has `storage` (`local` default, so older rows still work), `filePath` (local) or `cloudinary: { publicId, format }`; neither appears in API responses.
- Tests: `tests/photos.cloudinary.test.js` mocks the SDK (`jest.unstable_mockModule`); `api.test.js` covers local photos.
- Open: Cloudinary hosting is outside India by default; check the account's region against the India-hosting rule above before real case photos are stored there.

### Accounts and officer voice check (25 Nov 2026)

- No public sign-up. `POST /officers` (`officer.service.createOfficer`): admin creates any role; supervisor creates `io` in their own district only; `createdBy` is stored. `npm run seed` adds `SUP-1001` / `demo1234` (supervisor) beside `IO-1001`.
- Passages: `shared/voice/passages.json` (as / bn / brx, DRAFT; Bodo is a placeholder; `minSeconds` 20) → `src/services/speaker/data/`. `GET /voice/passages`.
- `POST /voice/enrol` (multipart `audio`, `lang`, `passageId`): speaker engine → `Officer.voice = { lang, passageId, model, embedding[256], seconds, enrolledAt }`. The recording is deleted; only the voiceprint is kept. 503 when no speaker engine. `voice` is in `/auth/login` and `/auth/me` (the officer's own profile) so the phone can check offline.
- `services/speaker`: `SPEAKER_ENGINE=wespeaker|mock|off` (default wespeaker; skipped while the model file is missing). WeSpeaker ResNet34 (Apache-2.0, `shared/models/speaker-models.json`, fetched by `npm run fetch-models`, served by `/models`). `fbank.js` = Kaldi fbank + mean removal, checked against `test-data/fbank-reference.json` (kaldi-native-fbank); keep in step with the app's `modules/voicedar-asr/.../Fbank.kt`. Match = cosine ≥ 0.5 (`matchThreshold`, `SPEAKER_THRESHOLD`); measured on synthetic voices: same voice 0.89-0.95, different 0.11-0.32. Calibrate on pilot recordings.
- `voice.service.checkClip` runs after ASR in `clip.service.runPipeline` and the server pass: `Clip.speaker = { score, match, engine, threshold }`; a mismatch logs `speaker_mismatch` (audit). It never fails or blocks a clip; clips under 1.5 s are not checked.
- Tests: `voice.test.js` (accounts, enrolment, clip check; mock engine from `tests/setup-env.cjs`), `speaker.test.js` (fbank vs Kaldi; real model when installed).

