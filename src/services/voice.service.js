// Officer voiceprints: the passages to read, enrolment, and the check on each case clip.
import { unlink } from 'node:fs/promises';

import { Officer } from '../models/Officer.js';
import { ApiError } from '../utils/ApiError.js';
import * as audit from './audit.service.js';
import { checkSpeaker, getSpeaker, MIN_ENROL_SECONDS, PASSAGES } from './speaker/index.js';

export function listPassages() {
  return { minSeconds: MIN_ENROL_SECONDS, passages: PASSAGES };
}

/**
 * Turns the officer's reading of a passage into their voiceprint. Only the 256-number
 * voiceprint is kept: the recording is deleted once it has been measured.
 */
export async function enrol(officer, file, { lang, passageId }) {
  try {
    if (!PASSAGES.some((p) => p.id === passageId && p.lang === lang)) throw ApiError.badRequest('Unknown passage for this language');
    const engine = getSpeaker();
    if (!engine) throw new ApiError(503, 'Voice check is not set up on the server (npm run fetch-models)');
    let result;
    try {
      result = await engine.embed(file.path);
    } catch {
      throw new ApiError(422, 'Could not read the recording, please record again');
    }
    if (!result.embedding || result.seconds < MIN_ENROL_SECONDS) {
      throw ApiError.badRequest(`The recording is too short: read the whole passage (at least ${MIN_ENROL_SECONDS} seconds)`);
    }
    officer.voice = {
      lang,
      passageId,
      model: engine.name,
      embedding: result.embedding,
      seconds: Math.round(result.seconds * 10) / 10,
      enrolledAt: new Date(),
    };
    await officer.save();
    return officer;
  } finally {
    await unlink(file.path).catch(() => {});
  }
}

/**
 * Compares a case clip with the case officer's voiceprint and stores the result on the clip
 * (not saved here). A mismatch is logged. Never throws: a failed check leaves the clip unchecked.
 */
export async function checkClip(clip, caseDoc) {
  try {
    const owner = await Officer.findById(caseDoc.officer).select('voice');
    const speaker = await checkSpeaker(clip.filePath, owner?.voice);
    if (!speaker) return;
    clip.speaker = speaker;
    if (!speaker.match) {
      await audit.log({
        caseId: caseDoc._id,
        officerId: caseDoc.officer,
        type: 'speaker_mismatch',
        meta: { clipId: clip._id, section: clip.section, score: speaker.score, threshold: speaker.threshold },
      });
    }
  } catch (err) {
    console.error(`Voice check failed: ${err.name}`);
  }
}
