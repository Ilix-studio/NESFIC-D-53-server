import { z } from 'zod';

import { AUDIT_TYPES } from '../models/AuditEvent.js';
import { CHECKLIST_ITEMS } from '../models/Photo.js';

const clientId = z.string().trim().regex(/^[A-Za-z0-9_-]{6,64}$/, '6-64 letters, digits, _ or -');
const latLng = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().nonnegative().optional(),
});
const fieldValue = z.union([z.string().max(500), z.number(), latLng, z.null()]);
const langCode = z.enum(['as', 'bn', 'brx']);
const fieldSource = z.enum(['speech', 'tap', 'auto', 'officer_edit']);
const transcriptSpan = z.object({ start: z.number(), end: z.number(), text: z.string().max(1000) });
// multipart/form-data sends strings; empty strings mean "not sent"
const blank = (v) => v === '' || v == null;
const formNumber = (schema) => z.preprocess((v) => (blank(v) ? undefined : Number(v)), schema.optional());
const formDate = z.preprocess((v) => (blank(v) ? undefined : new Date(v)), z.date().optional());

export const loginBody = z.object({
  badgeNo: z.string().trim().min(1).max(32),
  password: z.string().min(1).max(128),
});

export const createOfficerBody = z.object({
  badgeNo: z.string().trim().min(1).max(32),
  password: z.string().min(8, 'at least 8 characters').max(128),
  name: z.string().trim().min(1).max(100),
  policeStation: z.string().trim().min(1).max(100),
  district: z.string().trim().min(1).max(100).optional(),
  role: z.enum(['io', 'supervisor', 'admin']).default('io'),
});

export const voiceEnrolBody = z.object({
  lang: langCode,
  passageId: z.string().trim().min(1).max(40),
});

export const createCaseBody = z.object({
  clientId,
  startedAt: z.coerce.date(),
  location: latLng.optional(),
});

export const listCasesQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const clipBody = z.object({
  section: z.enum(['crash', 'road', 'vehicles', 'persons']),
  clientId: clientId.optional(),
  recordedAt: formDate,
  durationMs: formNumber(z.number().int().nonnegative()),
});

// Phone-first clip (?firstPass=phone): the phone's own transcript comes along as evidence.
export const phoneClipBody = z.object({
  section: z.enum(['crash', 'road', 'vehicles', 'persons', 'followup']),
  clientId,
  recordedAt: formDate,
  durationMs: formNumber(z.number().int().nonnegative()),
  transcriptText: z.string().max(5000).optional(),
  transcriptLang: langCode.optional(),
  transcriptEngine: z.string().max(40).optional(),
});

export const photoBody = z.object({
  checklistItem: z.enum(CHECKLIST_ITEMS),
  clientId: clientId.optional(),
  takenAt: z.coerce.date(),
  lat: formNumber(z.number().min(-90).max(90)),
  lng: formNumber(z.number().min(-180).max(180)),
  accuracy: formNumber(z.number().nonnegative()),
  note: z.string().max(500).optional(),
});

export const followupsQuery = z.object({
  status: z.enum(['open', 'answered', 'skipped', 'all']).default('open'),
});

// Either JSON { code } / { value }, or multipart with an "audio" file (checked in the service).
export const answerBody = z.object({
  code: z.string().max(64).optional(),
  value: fieldValue.optional(),
});

export const skipBody = z.object({
  reason: z.string().trim().min(3, 'Give a short reason').max(300),
});

export const editFieldBody = z.object({
  value: fieldValue,
  reason: z.string().trim().max(300).optional(),
});

const wholeCases = z
  .array(
    z.object({
      clientId,
      startedAt: z.coerce.date(),
      location: latLng.optional(),
      status: z.enum(['draft', 'in_review', 'signed']).default('draft'),
      signedAt: z.coerce.date().optional(),
      fields: z
        .array(
          z.object({
            fieldId: z.string().max(64),
            value: fieldValue,
            source: fieldSource,
            confirmedByOfficer: z.boolean().default(false),
            updatedAt: z.coerce.date(),
            transcriptSpan: transcriptSpan.optional(),
          }),
        )
        .max(500)
        .default([]),
    }),
  )
  .min(1)
  .max(50);

// One outbox operation from the phone. opId (UUID v7 made on the phone) makes retries safe.
const op = (entity, name, payload) =>
  z.object({
    opId: clientId,
    caseId: clientId,
    entity: z.literal(entity),
    op: z.literal(name),
    createdAt: z.coerce.date(),
    payload,
  });
const followupRef = {
  ruleId: z.string().max(64),
  kind: z.enum(['missing', 'inconsistent']),
  fieldIds: z.array(z.string().max(64)).min(1).max(5),
  questionEn: z.string().max(500).optional(),
  questionAs: z.string().max(500).optional(),
  at: z.coerce.date(),
};
const syncOp = z.union([
  op('case', 'create', z.object({ startedAt: z.coerce.date(), location: latLng.optional(), lang: langCode.default('as') })),
  op('case', 'lang', z.object({ lang: langCode })),
  op('case', 'sign', z.object({ signedAt: z.coerce.date() })),
  op(
    'field',
    'set',
    z.object({
      key: z.string().max(64),
      value: fieldValue,
      source: fieldSource,
      confirmedByOfficer: z.boolean().default(false),
      transcriptSpan: transcriptSpan.optional(),
      clipId: clientId.optional(),
      updatedAt: z.coerce.date(),
    }),
  ),
  op('followup', 'answer', z.object({ ...followupRef, answer: fieldValue })),
  op('followup', 'skip', z.object({ ...followupRef, reason: z.string().trim().min(3).max(300) })),
  op('proposal', 'decide', z.object({ proposalId: z.string().max(64), status: z.enum(['accepted', 'rejected']), at: z.coerce.date() })),
  op(
    'audit',
    'append',
    z.object({
      type: z.enum(AUDIT_TYPES),
      fieldId: z.string().max(64).optional(),
      oldValue: z.unknown().optional(),
      newValue: z.unknown().optional(),
      meta: z.record(z.string(), z.unknown()).optional(),
      at: z.coerce.date(),
    }),
  ),
]);

// Either whole cases ({ cases }) or the phone's outbox ({ ops }), not both.
export const syncBody = z
  .object({ cases: wholeCases.optional(), ops: z.array(syncOp).min(1).max(200).optional() })
  .refine((b) => Boolean(b.cases) !== Boolean(b.ops), { message: 'Send either "cases" or "ops"' });

export const pullQuery = z.object({
  since: z.coerce.date().optional(),
});
