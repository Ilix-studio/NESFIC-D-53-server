// In-memory changes to a case document: set field values with evidence, re-run the rules,
// refresh follow-up questions and completeness. No database access; callers save.
import { coerceValue, fieldForKey } from '../schema/index.js';
import { computeCompleteness, findField, isEmpty } from '../utils/caseFields.js';
import { runRules } from './rules/index.js';

export const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const isProtected = (fv) => fv.source === 'officer_edit' || Boolean(fv.confirmedByOfficer);

/**
 * Sync conflict rule for one field: an officer_edit or officer-confirmed value beats any other
 * value; between two values of the same kind the newer updatedAt wins.
 * Returns true if the incoming value should replace the existing one.
 */
export function incomingWins(existing, incoming) {
  if (!existing) return true;
  const mine = isProtected(existing);
  const theirs = isProtected(incoming);
  if (mine !== theirs) return theirs;
  return new Date(incoming.updatedAt) > new Date(existing.updatedAt);
}

/**
 * Sets one field value. Values the officer edited or confirmed are never overwritten
 * unless force is set (an explicit officer action). A null value removes the field.
 */
export function setFieldValue(caseDoc, key, value, opts) {
  const { source, clipId, clipClientId, transcriptSpan, confirmed = false, updatedAt = new Date(), force = false } = opts;
  const existing = findField(caseDoc, key);
  const oldValue = existing?.value;
  const oldSource = existing?.source;
  if (existing && !force && isProtected(existing)) return { changed: false, oldValue };

  if (isEmpty(value)) {
    if (!existing) return { changed: false, oldValue };
    caseDoc.fields = caseDoc.fields.filter((f) => f.fieldId !== key);
    return { changed: true, oldValue };
  }

  const data = {
    fieldId: key,
    value,
    source,
    clip: clipId,
    clipClientId,
    transcriptSpan,
    confirmedByOfficer: confirmed,
    updatedAt,
  };
  if (existing) Object.assign(existing, data);
  else caseDoc.fields.push(data);
  return { changed: !existing || !sameValue(oldValue, value) || oldSource !== source, oldValue };
}

/** Applies mapper proposals, dropping any field id or value the schema does not allow. */
export function applyProposals(caseDoc, proposals, { source, clipId }) {
  const applied = [];
  for (const p of proposals) {
    const field = fieldForKey(p.fieldId);
    if (!field) continue;
    const checked = coerceValue(field, p.value);
    if (!checked.ok) continue;
    const result = setFieldValue(caseDoc, p.fieldId, checked.value, { source, clipId, transcriptSpan: p.transcriptSpan });
    if (result.changed) {
      applied.push({ fieldId: p.fieldId, value: checked.value, oldValue: result.oldValue, transcriptSpan: p.transcriptSpan });
    }
  }
  return applied;
}

export const followupKey = (f) => `${f.ruleId}|${f.fieldIds.join(',')}`;

/**
 * Keeps answered and skipped questions, replaces open ones with the current findings.
 * An open question that is still valid keeps its id so the phone can keep answering it.
 */
export function mergeFollowups(caseDoc, findings) {
  const closed = caseDoc.followups.filter((f) => f.status !== 'open');
  const closedKeys = new Set(closed.map(followupKey));
  const openByKey = new Map(caseDoc.followups.filter((f) => f.status === 'open').map((f) => [followupKey(f), f]));
  const next = [...closed];
  for (const finding of findings) {
    const key = followupKey(finding);
    if (closedKeys.has(key)) continue;
    const existing = openByKey.get(key);
    if (existing) {
      const { kind, answerType, questionEn, questionAs, options, priority } = finding;
      Object.assign(existing, { kind, answerType, questionEn, questionAs, options, priority });
      next.push(existing);
    } else {
      next.push({ ...finding, status: 'open' });
    }
  }
  caseDoc.followups = next;
}

/** Contradictions first, then by priority (1 = ask first), then oldest first. */
export function sortFollowups(list) {
  return [...list].sort(
    (a, b) =>
      (a.kind === 'inconsistent' ? 0 : 1) - (b.kind === 'inconsistent' ? 0 : 1) ||
      a.priority - b.priority ||
      new Date(a.createdAt ?? 0) - new Date(b.createdAt ?? 0),
  );
}

export function openFollowups(caseDoc) {
  return sortFollowups(caseDoc.followups.filter((f) => f.status === 'open'));
}

export function unconfirmedFields(caseDoc) {
  return caseDoc.fields.filter((f) => !isEmpty(f.value) && !f.confirmedByOfficer).map((f) => f.fieldId);
}

/** Re-runs every rule, refreshes the follow-ups and recomputes completeness. */
export function recheck(caseDoc) {
  mergeFollowups(caseDoc, runRules(caseDoc));
  caseDoc.completeness = computeCompleteness(caseDoc);
  return caseDoc;
}
