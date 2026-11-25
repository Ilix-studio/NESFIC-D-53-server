// eDAR-schema JSON export of a signed case. The layout follows the PLACEHOLDER schema;
// it must be re-checked against NIC's eDAR integration spec once that is shared.
import { fieldsInSection, getSchema } from '../schema/index.js';
import { ApiError } from '../utils/ApiError.js';
import { expectedKeys, getValue, instanceCount, isEmpty } from '../utils/caseFields.js';
import { fieldKey } from '../utils/fieldKey.js';
import * as audit from './audit.service.js';
import * as caseService from './case.service.js';

function sectionValues(caseDoc, sectionId, index) {
  const out = {};
  for (const field of fieldsInSection(sectionId)) {
    const value = getValue(caseDoc, fieldKey(field.id, index));
    out[field.id] = isEmpty(value) ? null : value;
  }
  return out;
}

export function buildEdarJson(caseDoc, officer) {
  const schema = getSchema();
  const sections = {};
  for (const section of schema.sections) {
    if (!section.repeatable) {
      sections[section.id] = sectionValues(caseDoc, section.id, null);
      continue;
    }
    const count = instanceCount(caseDoc, section.id);
    sections[section.id] = Array.from({ length: count }, (_, i) => ({ no: i + 1, ...sectionValues(caseDoc, section.id, i + 1) }));
  }
  const [lng, lat] = caseDoc.location?.coordinates ?? [];
  return {
    format: 'edar-json',
    schema: { id: schema.schemaId, version: schema.version, placeholder: Boolean(schema.placeholder) },
    case: {
      id: caseDoc._id,
      clientId: caseDoc.clientId,
      policeStation: caseDoc.policeStation,
      district: caseDoc.district,
      startedAt: caseDoc.startedAt,
      location: lat == null ? null : { lat, lng, accuracy: caseDoc.location.accuracy ?? null },
      signedAt: caseDoc.signedAt,
      signedBy: officer ? { name: officer.name, badgeNo: officer.badgeNo } : null,
    },
    ...sections,
    blankFields: expectedKeys(caseDoc).filter((k) => isEmpty(getValue(caseDoc, k))),
    skippedQuestions: caseDoc.followups
      .filter((f) => f.status === 'skipped')
      .map((f) => ({ fieldIds: f.fieldIds, question: f.questionEn, reason: f.skipReason })),
    completeness: caseDoc.completeness,
    exportedAt: new Date().toISOString(),
  };
}

export async function exportEdar(caseId, officer) {
  const caseDoc = await caseService.findAccessible(caseId, officer);
  if (!caseDoc.locked) throw ApiError.conflict('Sign the case before exporting');
  await caseDoc.populate('signedBy', 'name badgeNo');
  const json = buildEdarJson(caseDoc, caseDoc.signedBy);
  if (caseDoc.status === 'signed') {
    caseDoc.status = 'exported';
    await caseDoc.save();
  }
  await audit.log({ caseId: caseDoc._id, officerId: officer._id, type: 'case_exported', meta: { format: 'edar-json' } });
  return { filename: `edar-${caseDoc.clientId}.json`, json };
}
