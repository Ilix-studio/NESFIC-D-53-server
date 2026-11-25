// The server's second pass over a clip the phone already processed offline: re-transcribe it
// with the server ASR, map it, and turn every value that differs from the case into a
// proposal. It never writes case field values; the officer accepts or rejects on the phone.
import { Case } from '../models/Case.js';
import { Clip } from '../models/Clip.js';
import { Proposal } from '../models/Proposal.js';
import { coerceValue, fieldForKey, getSchema } from '../schema/index.js';
import { findField } from '../utils/caseFields.js';
import { getAsr } from './asr/index.js';
import * as audit from './audit.service.js';
import { sameValue } from './caseState.js';
import { getMapper } from './mapper/index.js';
import { checkClip } from './voice.service.js';

async function proposeDifferences(caseDoc, clip, mapped, { source, engine }) {
  const created = [];
  for (const p of mapped) {
    const field = fieldForKey(p.fieldId);
    if (!field) continue;
    const checked = coerceValue(field, p.value);
    if (!checked.ok) continue;
    const current = findField(caseDoc, p.fieldId);
    if (current && sameValue(current.value, checked.value)) continue;

    const earlier = await Proposal.find({ case: caseDoc._id, fieldId: p.fieldId, status: { $in: ['open', 'rejected'] } });
    // The same suggestion is not made twice, and one the officer rejected is not repeated.
    if (earlier.some((e) => sameValue(e.value, checked.value))) continue;
    for (const old of earlier.filter((e) => e.status === 'open')) {
      old.status = 'superseded';
      await old.save();
    }
    created.push(
      await Proposal.create({
        case: caseDoc._id,
        officer: caseDoc.officer,
        fieldId: p.fieldId,
        value: checked.value,
        currentValue: current?.value,
        currentConfirmed: Boolean(current?.confirmedByOfficer || current?.source === 'officer_edit'),
        source,
        evidence: { clip: clip._id, clipClientId: clip.clientId, engine, transcriptSpan: p.transcriptSpan },
        confidence: p.confidence,
      }),
    );
  }
  return created;
}

export async function runServerPass(clipId) {
  const clip = await Clip.findById(clipId);
  if (!clip || clip.serverPass?.status !== 'queued') return;
  const finish = async (status, extra = {}) => {
    clip.serverPass = { status, at: new Date(), ...extra };
    await clip.save();
  };

  const caseDoc = await Case.findById(clip.case);
  // Signed cases are read-only; follow-up answers are checked on the phone only.
  if (!caseDoc || caseDoc.locked || clip.section === 'followup') return finish('skipped');

  try {
    const transcript = await getAsr().transcribe(clip.filePath, caseDoc.langPack, { section: clip.section, mimeType: clip.mimeType });
    clip.transcript = transcript;
    clip.processingStatus = 'done';
    await checkClip(clip, caseDoc);
    const mapper = getMapper();
    const mapped = await mapper.map({
      transcript,
      section: clip.section,
      schema: getSchema(),
      currentFields: caseDoc.fields,
      context: { startedAt: caseDoc.startedAt },
    });
    const source = mapper.name === 'llm' ? 'server_llm' : 'server_asr';
    const created = await proposeDifferences(caseDoc, clip, mapped, { source, engine: transcript.engine });
    await finish('done', { proposals: created.length });
    if (created.length) {
      await audit.log({
        caseId: caseDoc._id,
        officerId: caseDoc.officer,
        type: 'proposal_created',
        meta: { clipId: clip._id, engine: transcript.engine, count: created.length, fieldIds: created.map((p) => p.fieldId) },
      });
    }
  } catch (err) {
    clip.processingStatus = 'failed';
    await finish('failed', { error: String(err.message).slice(0, 500) });
  }
}
