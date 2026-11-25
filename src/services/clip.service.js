import { unlink } from 'node:fs/promises';

import mongoose from 'mongoose';

import { Clip } from '../models/Clip.js';
import { getSchema } from '../schema/index.js';
import { ApiError } from '../utils/ApiError.js';
import { getAsr } from './asr/index.js';
import * as audit from './audit.service.js';
import * as caseService from './case.service.js';
import { applyProposals, openFollowups, recheck } from './caseState.js';
import { getMapper } from './mapper/index.js';
import { enqueue } from './serverPassQueue.js';
import { checkClip } from './voice.service.js';

/**
 * Upload -> ASR -> mapper -> rules -> follow-ups. If ASR or mapping fails the clip is kept
 * with processingStatus "failed" and the call still succeeds, so the phone can retry by
 * uploading again with the same clientId. Audio is never thrown away.
 */
export async function processClip(caseId, officer, file, body, { firstPass = 'server' } = {}) {
  if (firstPass === 'phone') return storePhoneClip(caseId, officer, file, body);
  const caseDoc = await caseService.assertWritable(caseId, officer);

  if (body.clientId) {
    const existing = await Clip.findOne({ case: caseDoc._id, clientId: body.clientId });
    if (existing) {
      await unlink(file.path).catch(() => {});
      if (existing.processingStatus === 'failed') return runPipeline(caseDoc, existing, officer);
      return { clip: existing, duplicate: true, filledFields: [], followups: openFollowups(caseDoc), completeness: caseDoc.completeness };
    }
  }

  const clip = await Clip.create({
    case: caseDoc._id,
    clientId: body.clientId,
    section: body.section,
    filePath: file.path,
    mimeType: file.mimetype,
    sizeBytes: file.size,
    durationMs: body.durationMs,
    recordedAt: body.recordedAt ?? new Date(),
  });
  await audit.log({
    caseId: caseDoc._id,
    officerId: officer._id,
    type: 'clip_saved',
    meta: { clipId: clip._id, section: clip.section, durationMs: clip.durationMs },
  });
  return runPipeline(caseDoc, clip, officer);
}

/**
 * Phone-first clip: the phone already transcribed and mapped it offline. Store it as evidence
 * and queue the server's re-check, which only produces proposals. A clip recorded before the
 * case was signed is still accepted afterwards, but is not re-checked.
 */
async function storePhoneClip(caseId, officer, file, body) {
  const caseDoc = await caseService.findForEvidence(caseId, officer, body.recordedAt);
  const existing = await Clip.findOne({ case: caseDoc._id, clientId: body.clientId });
  if (existing) {
    await unlink(file.path).catch(() => {});
    return { clip: existing, duplicate: true };
  }

  const queued = !caseDoc.locked;
  const clip = await Clip.create({
    case: caseDoc._id,
    clientId: body.clientId,
    section: body.section,
    filePath: file.path,
    mimeType: file.mimetype,
    sizeBytes: file.size,
    durationMs: body.durationMs,
    recordedAt: body.recordedAt ?? new Date(),
    firstPass: 'phone',
    phoneTranscript: body.transcriptText
      ? { text: body.transcriptText, lang: body.transcriptLang, engine: body.transcriptEngine }
      : undefined,
    serverPass: { status: queued ? 'queued' : 'skipped' },
  });
  await audit.log({
    caseId: caseDoc._id,
    officerId: officer._id,
    type: 'clip_saved',
    meta: { clipId: clip._id, section: clip.section, durationMs: clip.durationMs, firstPass: 'phone' },
  });
  if (queued) enqueue(clip._id);
  return { clip, queued };
}

async function runPipeline(caseDoc, clip, officer) {
  const base = { caseId: caseDoc._id, officerId: officer._id };
  try {
    const transcript = await getAsr().transcribe(clip.filePath, caseDoc.langPack, { section: clip.section });
    clip.transcript = transcript;
    await checkClip(clip, caseDoc);
    const proposals = await getMapper().map({
      transcript,
      section: clip.section,
      schema: getSchema(),
      currentFields: caseDoc.fields,
      context: { startedAt: caseDoc.startedAt },
    });
    const filledFields = applyProposals(caseDoc, proposals, { source: 'speech', clipId: clip._id });
    recheck(caseDoc);
    await caseDoc.save();

    clip.processingStatus = 'done';
    clip.error = undefined;
    await clip.save();
    await audit.log({ ...base, type: 'clip_processed', meta: { clipId: clip._id, engine: transcript.engine, status: 'done' } });
    if (filledFields.length) {
      await audit.log({
        ...base,
        type: 'fields_filled',
        meta: { clipId: clip._id, count: filledFields.length, fieldIds: filledFields.map((f) => f.fieldId) },
      });
    }
    return { clip, filledFields, followups: openFollowups(caseDoc), completeness: caseDoc.completeness };
  } catch (err) {
    clip.processingStatus = 'failed';
    clip.error = String(err.message).slice(0, 500);
    await clip.save();
    await audit.log({ ...base, type: 'clip_processed', meta: { clipId: clip._id, status: 'failed' } });
    return { clip, filledFields: [], followups: openFollowups(caseDoc), completeness: caseDoc.completeness };
  }
}

export async function listClips(caseId, officer) {
  const caseDoc = await caseService.findAccessible(caseId, officer);
  return Clip.find({ case: caseDoc._id }).sort({ recordedAt: 1 });
}

export async function getClipAudio(caseId, officer, clipId) {
  const caseDoc = await caseService.findAccessible(caseId, officer);
  const clip = mongoose.isObjectIdOrHexString(clipId) ? await Clip.findOne({ _id: clipId, case: caseDoc._id }) : null;
  if (!clip) throw ApiError.notFound('Clip not found');
  return { filePath: clip.filePath, mimeType: clip.mimeType };
}
