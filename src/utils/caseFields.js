// Pure helpers over a case's field values. Used by services and rules; no database access.
import { fieldsInSection, getSchema, isRepeatable } from '../schema/index.js';
import { fieldKey, parseFieldKey } from './fieldKey.js';

const MAX_INSTANCES = 20;

export function isEmpty(value) {
  return value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
}

export function findField(caseDoc, key) {
  return (caseDoc.fields ?? []).find((f) => f.fieldId === key);
}

export function getValue(caseDoc, key) {
  return findField(caseDoc, key)?.value;
}

/** Highest instance number that has at least one value in a repeatable section. */
export function describedInstances(caseDoc, sectionId) {
  const ids = new Set(fieldsInSection(sectionId).map((f) => f.id));
  let max = 0;
  for (const f of caseDoc.fields ?? []) {
    const { fieldId, index } = parseFieldKey(f.fieldId);
    if (ids.has(fieldId) && index && !isEmpty(f.value)) max = Math.max(max, index);
  }
  return max;
}

/** How many vehicles / persons the report should describe. */
export function instanceCount(caseDoc, sectionId) {
  if (!isRepeatable(sectionId)) return 1;
  let n = Math.max(1, describedInstances(caseDoc, sectionId));
  if (sectionId === 'vehicles') {
    const declared = Number(getValue(caseDoc, 'vehicles_count'));
    if (Number.isFinite(declared)) n = Math.max(n, declared);
  }
  return Math.min(n, MAX_INSTANCES);
}

/** Every field key the report is expected to contain, in schema order. */
export function expectedKeys(caseDoc) {
  const keys = [];
  for (const section of getSchema().sections) {
    const fields = fieldsInSection(section.id);
    if (!section.repeatable) {
      keys.push(...fields.map((f) => f.id));
      continue;
    }
    const count = instanceCount(caseDoc, section.id);
    for (let i = 1; i <= count; i++) keys.push(...fields.map((f) => fieldKey(f.id, i)));
  }
  return keys;
}

export function computeCompleteness(caseDoc) {
  const keys = expectedKeys(caseDoc);
  const filled = keys.filter((k) => !isEmpty(getValue(caseDoc, k))).length;
  const total = keys.length;
  return { filled, total, percent: total ? Math.round((filled / total) * 100) : 0 };
}

/** Hour (0-23) from a stored "YYYY-MM-DDTHH:mm" value, or null. */
export function hourOf(datetime) {
  const m = /T(\d{2}):(\d{2})/.exec(String(datetime ?? ''));
  return m ? Number(m[1]) : null;
}

export function timeOf(datetime) {
  const m = /T(\d{2}:\d{2})/.exec(String(datetime ?? ''));
  return m ? m[1] : '';
}
