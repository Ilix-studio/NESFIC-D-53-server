import { coerceValue, fieldForKey } from '../schema/index.js';
import { ApiError } from '../utils/ApiError.js';
import { findField, getValue, isEmpty } from '../utils/caseFields.js';
import * as audit from './audit.service.js';
import * as caseService from './case.service.js';
import { openFollowups, recheck, setFieldValue, unconfirmedFields } from './caseState.js';

function knownField(key) {
  const field = fieldForKey(key);
  if (!field) throw ApiError.notFound(`Unknown field "${key}"`);
  return field;
}

/** Officer edit from the review screen. value: null clears the field. Logged old -> new. */
export async function editField(caseId, officer, key, { value, reason }) {
  const caseDoc = await caseService.assertWritable(caseId, officer);
  const field = knownField(key);
  let newValue = null;
  if (value !== null) {
    const checked = coerceValue(field, value);
    if (!checked.ok) throw ApiError.badRequest(checked.error);
    newValue = checked.value;
  }
  const oldValue = getValue(caseDoc, key);
  // Typing a value in review is the officer's own statement, so it counts as confirmed.
  setFieldValue(caseDoc, key, newValue, { source: 'officer_edit', confirmed: true, force: true });
  if (caseDoc.status === 'draft') caseDoc.status = 'in_review';
  recheck(caseDoc);
  await caseDoc.save();
  await audit.log({
    caseId: caseDoc._id,
    officerId: officer._id,
    type: 'field_edited',
    fieldId: key,
    oldValue,
    newValue,
    meta: reason ? { reason } : undefined,
  });
  return { field: findField(caseDoc, key) ?? null, followups: openFollowups(caseDoc), completeness: caseDoc.completeness };
}

export async function confirmField(caseId, officer, key) {
  const caseDoc = await caseService.assertWritable(caseId, officer);
  knownField(key);
  const fv = findField(caseDoc, key);
  if (!fv || isEmpty(fv.value)) throw ApiError.badRequest('This field has no value to confirm');
  if (!fv.confirmedByOfficer) {
    fv.confirmedByOfficer = true;
    if (caseDoc.status === 'draft') caseDoc.status = 'in_review';
    await caseDoc.save();
    await audit.log({ caseId: caseDoc._id, officerId: officer._id, type: 'field_confirmed', fieldId: key, newValue: fv.value });
  }
  return { field: fv, completeness: caseDoc.completeness };
}

/** Signs and locks the case. Every filled field must be confirmed first. */
export async function sign(caseId, officer) {
  const caseDoc = await caseService.assertWritable(caseId, officer);
  const unconfirmed = unconfirmedFields(caseDoc);
  if (unconfirmed.length) throw ApiError.conflict('Confirm every filled field before signing', { unconfirmed });
  caseDoc.status = 'signed';
  caseDoc.signedAt = new Date();
  caseDoc.signedBy = officer._id;
  await caseDoc.save();
  await audit.log({ caseId: caseDoc._id, officerId: officer._id, type: 'case_signed', meta: { completeness: caseDoc.completeness } });
  return caseDoc;
}
