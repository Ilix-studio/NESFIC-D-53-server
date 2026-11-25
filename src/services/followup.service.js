import mongoose from 'mongoose';

import { Clip } from '../models/Clip.js';
import { coerceValue, fieldForKey, getSchema } from '../schema/index.js';
import { ApiError } from '../utils/ApiError.js';
import { findField, getValue, isEmpty } from '../utils/caseFields.js';
import { getAsr } from './asr/index.js';
import * as audit from './audit.service.js';
import * as caseService from './case.service.js';
import { openFollowups, recheck, sameValue, setFieldValue, sortFollowups } from './caseState.js';
import { getMapper } from './mapper/index.js';

export async function list(caseId, officer, status) {
  const caseDoc = await caseService.findAccessible(caseId, officer);
  const items = status === 'all' ? caseDoc.followups : caseDoc.followups.filter((f) => f.status === status);
  return { items: sortFollowups(items), completeness: caseDoc.completeness };
}

function openFollowup(caseDoc, followupId) {
  const followup = mongoose.isObjectIdOrHexString(followupId) ? caseDoc.followups.id(followupId) : null;
  if (!followup) throw ApiError.notFound('Question not found');
  if (followup.status !== 'open') throw ApiError.conflict(`Question was already ${followup.status}`);
  return followup;
}

/** Turns a voice answer into a value for the asked field. Returns null if not understood. */
async function valueFromVoice(caseDoc, officer, targetKey, file) {
  const clip = await Clip.create({
    case: caseDoc._id,
    section: 'followup',
    filePath: file.path,
    mimeType: file.mimetype,
    sizeBytes: file.size,
  });
  await audit.log({ caseId: caseDoc._id, officerId: officer._id, type: 'clip_saved', meta: { clipId: clip._id, section: 'followup' } });
  try {
    const transcript = await getAsr().transcribe(clip.filePath, caseDoc.langPack, { section: 'followup', targetKeys: [targetKey] });
    clip.transcript = transcript;
    const proposals = await getMapper().map({
      transcript,
      section: 'followup',
      schema: getSchema(),
      currentFields: caseDoc.fields,
      context: { startedAt: caseDoc.startedAt },
      targetKeys: [targetKey],
    });
    clip.processingStatus = 'done';
    await clip.save();
    const hit = proposals.find((p) => p.fieldId === targetKey);
    return { clip, transcript, value: hit?.value, transcriptSpan: hit?.transcriptSpan };
  } catch (err) {
    clip.processingStatus = 'failed';
    clip.error = String(err.message).slice(0, 500);
    await clip.save();
    return { clip, value: undefined };
  }
}

/** Answer by option code, typed value, or a short voice clip. */
export async function answer(caseId, officer, followupId, { code, value }, file) {
  const caseDoc = await caseService.assertWritable(caseId, officer);
  const followup = openFollowup(caseDoc, followupId);
  const targetKey = followup.fieldIds[0];
  const field = fieldForKey(targetKey);

  let raw = code ?? value;
  let source = 'tap';
  let voice;
  if (file) {
    voice = await valueFromVoice(caseDoc, officer, targetKey, file);
    if (voice.value === undefined) {
      return {
        understood: false,
        transcript: voice.transcript,
        followup,
        followups: openFollowups(caseDoc),
        completeness: caseDoc.completeness,
      };
    }
    raw = voice.value;
    source = 'speech';
  }
  if (raw === undefined) throw ApiError.badRequest('Send an option code, a value, or an audio answer');

  const checked = coerceValue(field, raw);
  if (!checked.ok) throw ApiError.badRequest(checked.error);

  const oldValue = getValue(caseDoc, targetKey);
  // Correcting an existing value is an officer edit (it shows as "Edited by IO" in review).
  const correcting = !isEmpty(oldValue) && !sameValue(oldValue, checked.value);
  setFieldValue(caseDoc, targetKey, checked.value, {
    source: correcting ? 'officer_edit' : source,
    clipId: voice?.clip._id,
    transcriptSpan: voice?.transcriptSpan,
    force: true,
  });
  followup.status = 'answered';
  followup.answer = checked.value;
  followup.answeredAt = new Date();
  recheck(caseDoc);
  await caseDoc.save();

  await audit.log({
    caseId: caseDoc._id,
    officerId: officer._id,
    type: 'followup_answered',
    fieldId: targetKey,
    oldValue,
    newValue: checked.value,
    meta: { followupId: followup._id, ruleId: followup.ruleId, via: file ? 'voice' : 'tap' },
  });
  return {
    understood: true,
    followup,
    field: findField(caseDoc, targetKey),
    followups: openFollowups(caseDoc),
    completeness: caseDoc.completeness,
  };
}

export async function skip(caseId, officer, followupId, reason) {
  const caseDoc = await caseService.assertWritable(caseId, officer);
  const followup = openFollowup(caseDoc, followupId);
  followup.status = 'skipped';
  followup.skipReason = reason;
  await caseDoc.save();
  await audit.log({
    caseId: caseDoc._id,
    officerId: officer._id,
    type: 'followup_skipped',
    fieldId: followup.fieldIds[0],
    meta: { followupId: followup._id, ruleId: followup.ruleId, reason },
  });
  return { followup, followups: openFollowups(caseDoc), completeness: caseDoc.completeness };
}
