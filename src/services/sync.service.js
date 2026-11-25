// Sync with phones that work offline first.
// - syncCases: idempotent upload of whole cases (upsert by clientId; the newer updatedAt wins).
// - applyOps: the phone's outbox, one operation per change, applied once each (opId).
// - pull: proposals and follow-ups that changed since the phone's cursor.
import mongoose from 'mongoose';

import { AuditEvent } from '../models/AuditEvent.js';
import { Case } from '../models/Case.js';
import { toPoint } from '../models/geo.js';
import { Proposal } from '../models/Proposal.js';
import { SyncOp } from '../models/SyncOp.js';
import { coerceValue, fieldForKey, getSchema } from '../schema/index.js';
import { findField } from '../utils/caseFields.js';
import * as audit from './audit.service.js';
import { followupKey, incomingWins, recheck, setFieldValue, sortFollowups, unconfirmedFields } from './caseState.js';

async function syncOne(officer, incoming) {
  let caseDoc = await Case.findOne({ clientId: incoming.clientId });
  const created = !caseDoc;
  if (caseDoc && !caseDoc.officer.equals(officer._id)) return { clientId: incoming.clientId, status: 'forbidden' };
  if (caseDoc?.locked) return { clientId: incoming.clientId, id: caseDoc._id, status: 'locked' };
  if (!caseDoc) {
    caseDoc = new Case({
      clientId: incoming.clientId,
      officer: officer._id,
      policeStation: officer.policeStation,
      district: officer.district,
      startedAt: incoming.startedAt,
      location: toPoint(incoming.location),
      schemaVersion: getSchema().version,
      langPack: 'as',
    });
  }

  const rejected = [];
  let applied = 0;
  for (const f of incoming.fields) {
    const field = fieldForKey(f.fieldId);
    if (!field) {
      rejected.push({ fieldId: f.fieldId, reason: 'unknown field' });
      continue;
    }
    let value = null;
    if (f.value !== null) {
      const checked = coerceValue(field, f.value);
      if (!checked.ok) {
        rejected.push({ fieldId: f.fieldId, reason: checked.error });
        continue;
      }
      value = checked.value;
    }
    const existing = findField(caseDoc, f.fieldId);
    if (existing && existing.updatedAt >= f.updatedAt) continue;
    setFieldValue(caseDoc, f.fieldId, value, {
      source: f.source,
      confirmed: f.confirmedByOfficer,
      transcriptSpan: f.transcriptSpan,
      updatedAt: f.updatedAt,
      force: true,
    });
    applied++;
  }
  recheck(caseDoc);

  let signed = false;
  let unconfirmed = [];
  if (incoming.status === 'signed') {
    unconfirmed = unconfirmedFields(caseDoc);
    if (!unconfirmed.length) {
      caseDoc.status = 'signed';
      caseDoc.signedAt = incoming.signedAt ?? new Date();
      caseDoc.signedBy = officer._id;
      signed = true;
    }
  } else if (incoming.status === 'in_review' && caseDoc.status === 'draft') {
    caseDoc.status = 'in_review';
  }
  await caseDoc.save();

  const base = { caseId: caseDoc._id, officerId: officer._id };
  await audit.log({ ...base, type: 'case_synced', meta: { created, fieldsApplied: applied, fieldsRejected: rejected.length } });
  if (signed) await audit.log({ ...base, type: 'case_signed', meta: { via: 'sync' } });

  return {
    clientId: caseDoc.clientId,
    id: caseDoc._id,
    status: created ? 'created' : 'updated',
    caseStatus: caseDoc.status,
    fieldsApplied: applied,
    rejected,
    ...(unconfirmed.length ? { notSigned: 'Some fields are not confirmed', unconfirmed } : {}),
    completeness: caseDoc.completeness,
  };
}

export async function syncCases(officer, cases) {
  const results = [];
  for (const incoming of cases) {
    try {
      results.push(await syncOne(officer, incoming));
    } catch (err) {
      console.error(`sync failed for one case: ${err.name}`);
      results.push({ clientId: incoming.clientId, status: 'error' });
    }
  }
  return { results };
}

// ---------------------------------------------------------------------------------------------
// Outbox batches

const DUPLICATE_KEY = 11000;
// Pull windows overlap by a few seconds so a write that lands while a pull runs is not missed.
// The phone stores proposals by id, so seeing one twice is harmless.
const PULL_OVERLAP_MS = 5_000;

function newCaseFromOp(officer, clientId, payload) {
  return new Case({
    clientId,
    officer: officer._id,
    policeStation: officer.policeStation,
    district: officer.district,
    startedAt: payload.startedAt,
    location: toPoint(payload.location),
    schemaVersion: getSchema().version,
    langPack: payload.lang ?? 'as',
  });
}

function applyFieldOp(caseDoc, p) {
  const field = fieldForKey(p.key);
  if (!field) return `unknown field "${p.key}"`;
  let value = null;
  if (p.value !== null) {
    const checked = coerceValue(field, p.value);
    if (!checked.ok) return checked.error;
    value = checked.value;
  }
  // Older or weaker data is skipped, but the op still counts as handled.
  if (!incomingWins(findField(caseDoc, p.key), p)) return null;
  setFieldValue(caseDoc, p.key, value, {
    source: p.source,
    confirmed: p.confirmedByOfficer,
    transcriptSpan: p.transcriptSpan,
    clipClientId: p.clipId,
    updatedAt: p.updatedAt,
    force: true,
  });
  return null;
}

/** Marks a follow-up answered or skipped. Unknown questions are stored closed so they are never asked. */
function closeFollowup(caseDoc, op) {
  const p = op.payload;
  const key = followupKey(p);
  let followup = caseDoc.followups.find((f) => followupKey(f) === key);
  if (!followup) {
    caseDoc.followups.push({ ruleId: p.ruleId, kind: p.kind, fieldIds: p.fieldIds, questionEn: p.questionEn, questionAs: p.questionAs });
    followup = caseDoc.followups[caseDoc.followups.length - 1];
  }
  if (followup.status !== 'open') return;
  followup.status = op.op === 'answer' ? 'answered' : 'skipped';
  followup.answeredAt = p.at;
  if (op.op === 'answer') followup.answer = p.answer;
  else followup.skipReason = p.reason;
}

async function decideProposal(caseDoc, p) {
  const proposal = mongoose.isObjectIdOrHexString(p.proposalId)
    ? await Proposal.findOne({ _id: p.proposalId, case: caseDoc._id })
    : null;
  if (!proposal) return 'unknown proposal';
  if (proposal.status === 'open') {
    proposal.status = p.status;
    proposal.decidedAt = p.at;
    await proposal.save();
  }
  return null;
}

async function insertIgnoringDuplicates(Model, docs) {
  if (!docs.length) return;
  try {
    await Model.insertMany(docs, { ordered: false });
  } catch (err) {
    const writeErrors = err.writeErrors ?? [];
    if (!writeErrors.length || writeErrors.some((e) => (e.code ?? e.err?.code) !== DUPLICATE_KEY)) throw err;
  }
}

/** Applies one case's ops in order. Returns the case summary; fills `results` per op. */
async function applyCaseOps(officer, clientId, ops, results) {
  let caseDoc = await Case.findOne({ clientId });
  if (caseDoc && !caseDoc.officer.equals(officer._id)) {
    for (const op of ops) results.set(op.opId, { opId: op.opId, status: 'rejected', reason: 'case belongs to another officer' });
    return { caseId: clientId, status: 'forbidden' };
  }

  const outcome = [];
  const phoneAudit = [];
  let created = false;
  let changed = false;
  for (const op of ops) {
    const done = (reason) => outcome.push({ op, status: reason ? 'rejected' : 'applied', reason: reason ?? undefined });
    if (!caseDoc) {
      if (op.entity === 'case' && op.op === 'create') {
        caseDoc = newCaseFromOp(officer, clientId, op.payload);
        created = changed = true;
        done();
      } else {
        done('unknown case: case/create must come first');
      }
      continue;
    }
    // The audit trail is append-only, so phone events are accepted even after signing.
    if (op.entity === 'audit') {
      phoneAudit.push(op);
      done();
      continue;
    }
    if (caseDoc.locked) {
      done('case is signed and locked');
      continue;
    }
    switch (`${op.entity}/${op.op}`) {
      case 'case/create':
        done();
        break;
      case 'case/lang':
        caseDoc.langPack = op.payload.lang;
        changed = true;
        done();
        break;
      case 'field/set':
        done(applyFieldOp(caseDoc, op.payload));
        changed = true;
        break;
      case 'followup/answer':
      case 'followup/skip':
        closeFollowup(caseDoc, op);
        changed = true;
        done();
        break;
      case 'proposal/decide':
        done(await decideProposal(caseDoc, op.payload));
        break;
      case 'case/sign': {
        recheck(caseDoc);
        const unconfirmed = unconfirmedFields(caseDoc);
        if (unconfirmed.length) {
          done(`${unconfirmed.length} field(s) not confirmed: ${unconfirmed.slice(0, 5).join(', ')}`);
          break;
        }
        caseDoc.status = 'signed';
        caseDoc.signedAt = op.payload.signedAt;
        caseDoc.signedBy = officer._id;
        changed = true;
        done();
        break;
      }
      default:
        done(`unknown op ${op.entity}/${op.op}`);
    }
  }

  if (caseDoc && changed) {
    recheck(caseDoc);
    if (caseDoc.status === 'draft' && caseDoc.fields.some((f) => f.confirmedByOfficer)) caseDoc.status = 'in_review';
    await caseDoc.save();
  }

  const caseRef = caseDoc?._id;
  if (caseRef) {
    await insertIgnoringDuplicates(
      AuditEvent,
      phoneAudit.map((op) => ({
        case: caseRef,
        officer: officer._id,
        type: op.payload.type,
        fieldId: op.payload.fieldId,
        oldValue: op.payload.oldValue,
        newValue: op.payload.newValue,
        meta: op.payload.meta,
        at: op.payload.at,
        origin: 'phone',
        opId: op.opId,
      })),
    );
  }
  await insertIgnoringDuplicates(
    SyncOp,
    outcome.map(({ op, status, reason }) => ({ opId: op.opId, officer: officer._id, case: caseRef, entity: op.entity, op: op.op, status, reason })),
  );
  for (const { op, status, reason } of outcome) results.set(op.opId, { opId: op.opId, status, ...(reason ? { reason } : {}) });

  if (!caseDoc) return { caseId: clientId, status: 'unknown' };
  const applied = outcome.filter((o) => o.status === 'applied').length;
  await audit.log({
    caseId: caseDoc._id,
    officerId: officer._id,
    type: 'case_synced',
    meta: { created, ops: ops.length, applied, rejected: ops.length - applied },
  });
  return { caseId: clientId, id: caseDoc._id, status: caseDoc.status, completeness: caseDoc.completeness };
}

/**
 * Applies a batch of outbox ops. Ops already handled (same opId) are answered from the record
 * of the first time, so retrying a batch is always safe. Ops are applied in order per case.
 */
export async function applyOps(officer, ops) {
  const results = new Map();
  const seen = await SyncOp.find({ opId: { $in: ops.map((o) => o.opId) } }).lean();
  for (const s of seen) {
    results.set(s.opId, { opId: s.opId, status: s.status === 'rejected' ? 'rejected' : 'duplicate', ...(s.reason ? { reason: s.reason } : {}) });
  }

  const byCase = new Map();
  for (const op of ops) {
    if (results.has(op.opId)) continue;
    if (!byCase.has(op.caseId)) byCase.set(op.caseId, []);
    byCase.get(op.caseId).push(op);
  }

  const cases = [];
  for (const [clientId, caseOps] of byCase) {
    try {
      cases.push(await applyCaseOps(officer, clientId, caseOps, results));
    } catch (err) {
      console.error(`sync ops failed for one case: ${err.name}`);
      for (const op of caseOps) if (!results.has(op.opId)) results.set(op.opId, { opId: op.opId, status: 'error' });
    }
  }
  return { results: ops.map((o) => results.get(o.opId)), cases };
}

// ---------------------------------------------------------------------------------------------
// Pull

const publicProposal = (p) => ({
  id: p._id,
  caseId: p.case.clientId,
  fieldId: p.fieldId,
  value: p.value,
  currentValue: p.currentValue,
  currentConfirmed: p.currentConfirmed,
  source: p.source,
  evidence: { clipClientId: p.evidence?.clipClientId, engine: p.evidence?.engine, transcriptSpan: p.evidence?.transcriptSpan },
  confidence: p.confidence,
  status: p.status,
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
});

/** Proposals and open follow-ups that changed after `since` for this officer's cases. */
export async function pull(officer, since) {
  const now = new Date();
  const range = { $gt: since ?? new Date(0), $lte: now };
  const [proposals, cases] = await Promise.all([
    Proposal.find({ officer: officer._id, updatedAt: range }).sort({ updatedAt: 1 }).populate('case', 'clientId').lean(),
    Case.find({ officer: officer._id, updatedAt: range }).select('clientId status completeness followups').lean(),
  ]);
  return {
    cursor: new Date(now.getTime() - PULL_OVERLAP_MS).toISOString(),
    proposals: proposals.filter((p) => p.case).map(publicProposal),
    cases: cases.map((c) => ({
      caseId: c.clientId,
      status: c.status,
      completeness: c.completeness,
      followups: sortFollowups(c.followups.filter((f) => f.status === 'open')).map(
        ({ ruleId, kind, fieldIds, answerType, questionEn, questionAs, options, priority }) => ({
          ruleId,
          kind,
          fieldIds,
          answerType,
          questionEn,
          questionAs,
          options,
          priority,
        }),
      ),
    })),
  };
}
