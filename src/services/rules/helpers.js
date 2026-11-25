// Shared wording helpers for rules. Pure: no database access.
import { fill, getLang } from '../../lang/index.js';
import { getField, optionLabel } from '../../schema/index.js';
import { getValue } from '../../utils/caseFields.js';
import { parseFieldKey } from '../../utils/fieldKey.js';

export const localLang = (caseDoc) => caseDoc.langPack ?? 'as';

/** Writes ASCII digits in the language pack's own digits (e.g. 21:00 -> ২১:০০). */
function localDigits(text, lang) {
  const digits = getLang(lang).digits;
  return digits ? text.replace(/[0-9]/g, (d) => digits[Number(d)]) : text;
}

export function optionsOf(field, codes) {
  return field.options
    .filter((o) => !codes || codes.includes(o.code))
    .map(({ code, label_en, label_as }) => ({ code, label_en, label_as }));
}

export function numberOptions(...numbers) {
  return [...new Set(numbers)].map((n) => ({ code: String(n), label_en: String(n), label_as: String(n) }));
}

// " (Truck)" after "Vehicle 1", so the officer knows which vehicle or person is meant.
function instanceDetail(caseDoc, section, index, lang) {
  const detailField = { vehicles: 'vehicle_type', persons: 'person_role' }[section];
  const code = detailField && getValue(caseDoc, `${detailField}@${index}`);
  return code ? ` (${optionLabel(getField(detailField), code, lang)})` : '';
}

/** Question for a missing field in English and the case's local language. */
export function fieldQuestion(caseDoc, key) {
  const { fieldId, index } = parseFieldKey(key);
  const field = getField(fieldId);
  const make = (lang) => {
    const pack = getLang(lang);
    const base = pack.questions?.[fieldId] ?? field[`label_${lang}`] ?? field.label_en;
    if (!index) return base;
    const prefix = pack.instancePrefix?.[field.section] ?? '{n}{detail}: ';
    return fill(prefix, { n: index, detail: instanceDetail(caseDoc, field.section, index, lang) }) + base;
  };
  const local = localLang(caseDoc);
  return { questionEn: make('en'), questionAs: localDigits(make(local), local) };
}

/** Question for an inconsistency; vars(lang) supplies the values in that language. */
export function ruleQuestion(caseDoc, ruleId, vars) {
  const local = localLang(caseDoc);
  return {
    questionEn: fill(getLang('en').ruleQuestions[ruleId], vars('en')),
    questionAs: localDigits(
      fill(getLang(local).ruleQuestions?.[ruleId] ?? getLang('en').ruleQuestions[ruleId], vars(local)),
      local,
    ),
  };
}
