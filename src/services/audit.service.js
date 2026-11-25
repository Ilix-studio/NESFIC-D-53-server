// Append-only audit trail. Rows are only ever inserted (the model blocks updates and deletes).
import { AuditEvent } from '../models/AuditEvent.js';

export function log({ caseId, officerId, type, fieldId, oldValue, newValue, meta }) {
  return AuditEvent.create({ case: caseId, officer: officerId, type, fieldId, oldValue, newValue, meta });
}

export function listForCase(caseId) {
  return AuditEvent.find({ case: caseId }).sort({ at: 1, _id: 1 }).populate('officer', 'name badgeNo').lean();
}
