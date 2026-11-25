// Loads the eDAR schema (data, not code) and offers lookups and value checks.
// Field values for repeatable sections (vehicles, persons) are stored under keys like
// "vehicle_type@2" (field id + 1-based instance number). See utils/fieldKey.js.
import { readFileSync } from 'node:fs';

import { parseFieldKey } from '../utils/fieldKey.js';

const schema = JSON.parse(readFileSync(new URL('./edar.schema.json', import.meta.url), 'utf8'));
const fieldsById = new Map(schema.fields.map((f) => [f.id, f]));
const sectionsById = new Map(schema.sections.map((s) => [s.id, s]));

export const SECTION_IDS = schema.sections.map((s) => s.id);

export function getSchema() {
  return schema;
}

export function getField(fieldId) {
  return fieldsById.get(fieldId);
}

export function getSection(sectionId) {
  return sectionsById.get(sectionId);
}

export function isRepeatable(sectionId) {
  return Boolean(sectionsById.get(sectionId)?.repeatable);
}

export function fieldsInSection(sectionId) {
  return schema.fields.filter((f) => f.section === sectionId);
}

/** Field definition for a stored key, or undefined if the key is not valid for the schema. */
export function fieldForKey(key) {
  const { fieldId, index } = parseFieldKey(key);
  const field = fieldsById.get(fieldId);
  if (!field) return undefined;
  const repeatable = isRepeatable(field.section);
  if (repeatable && !(index >= 1)) return undefined;
  if (!repeatable && index !== null) return undefined;
  return field;
}

export function optionLabel(field, code, lang = 'en') {
  const option = field?.options?.find((o) => o.code === code);
  if (!option) return code == null ? '' : String(code);
  return option[`label_${lang}`] ?? option.label_en;
}

const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/**
 * Checks a raw value against the field type and returns the normalised value.
 * Only option codes and field ids that exist in the schema are accepted.
 */
export function coerceValue(field, raw) {
  if (raw === null || raw === undefined || raw === '') return { ok: false, error: 'Value is empty' };
  switch (field.type) {
    case 'enum': {
      const code = String(raw);
      return field.options.some((o) => o.code === code)
        ? { ok: true, value: code }
        : { ok: false, error: `"${code}" is not an option for ${field.id}` };
    }
    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
      return Number.isFinite(n) && n >= 0 ? { ok: true, value: n } : { ok: false, error: `${field.id} must be a number` };
    }
    case 'datetime': {
      const s = String(raw);
      return DATETIME_RE.test(s) ? { ok: true, value: s } : { ok: false, error: `${field.id} must be YYYY-MM-DDTHH:mm` };
    }
    case 'geo': {
      const { lat, lng, accuracy } = raw ?? {};
      const valid = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
      return valid
        ? { ok: true, value: accuracy == null ? { lat, lng } : { lat, lng, accuracy } }
        : { ok: false, error: `${field.id} must be { lat, lng }` };
    }
    case 'text':
    default: {
      const s = String(raw).trim();
      return s ? { ok: true, value: s.slice(0, 500) } : { ok: false, error: 'Value is empty' };
    }
  }
}
