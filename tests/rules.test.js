import { getSchema } from '../src/schema/index.js';
import deathsButNotFatal from '../src/services/rules/deathsButNotFatal.rule.js';
import fatalButNoDeaths from '../src/services/rules/fatalButNoDeaths.rule.js';
import { runRules } from '../src/services/rules/index.js';
import nightButDaylight from '../src/services/rules/nightButDaylight.rule.js';
import requiredMissing from '../src/services/rules/requiredMissing.rule.js';
import vehicleCountMismatch from '../src/services/rules/vehicleCountMismatch.rule.js';

const makeCase = (values) => ({
  langPack: 'as',
  followups: [],
  fields: Object.entries(values).map(([fieldId, value]) => ({ fieldId, value, source: 'speech' })),
});

describe('nightButDaylight', () => {
  test('flags a 21:00 crash with lighting = daylight, in English and Assamese', () => {
    const [finding] = nightButDaylight.run(makeCase({ crash_datetime: '2026-11-23T21:00', lighting: 'daylight' }));
    expect(finding).toMatchObject({ ruleId: 'nightButDaylight', kind: 'inconsistent', fieldIds: ['lighting', 'crash_datetime'] });
    expect(finding.questionEn).toContain('21:00');
    expect(finding.questionAs).toContain('২১:০০');
    expect(finding.options.map((o) => o.code)).toEqual(['night_street_lights', 'night_lights_not_working', 'night_no_lights']);
  });

  test('passes a daytime crash with daylight, and a night crash with night lighting', () => {
    expect(nightButDaylight.run(makeCase({ crash_datetime: '2026-11-23T14:00', lighting: 'daylight' }))).toEqual([]);
    expect(nightButDaylight.run(makeCase({ crash_datetime: '2026-11-23T21:00', lighting: 'night_no_lights' }))).toEqual([]);
  });

  test('treats 05:59 as night and 06:00 as day', () => {
    expect(nightButDaylight.run(makeCase({ crash_datetime: '2026-11-23T05:59', lighting: 'daylight' }))).toHaveLength(1);
    expect(nightButDaylight.run(makeCase({ crash_datetime: '2026-11-23T06:00', lighting: 'daylight' }))).toHaveLength(0);
  });
});

describe('fatalButNoDeaths', () => {
  test('flags severity = fatal with 0 or no persons killed', () => {
    expect(fatalButNoDeaths.run(makeCase({ severity: 'fatal', persons_killed: 0 }))).toHaveLength(1);
    expect(fatalButNoDeaths.run(makeCase({ severity: 'fatal' }))[0]).toMatchObject({ fieldIds: ['persons_killed', 'severity'] });
  });

  test('passes fatal with at least one death', () => {
    expect(fatalButNoDeaths.run(makeCase({ severity: 'fatal', persons_killed: 1 }))).toEqual([]);
  });
});

describe('deathsButNotFatal', () => {
  test('flags persons killed with a non-fatal severity', () => {
    const [finding] = deathsButNotFatal.run(makeCase({ severity: 'grievous', persons_killed: 2 }));
    expect(finding).toMatchObject({ ruleId: 'deathsButNotFatal', fieldIds: ['severity', 'persons_killed'] });
    expect(finding.questionEn).toContain('2 killed');
  });

  test('passes when severity is fatal, or nobody died', () => {
    expect(deathsButNotFatal.run(makeCase({ severity: 'fatal', persons_killed: 2 }))).toEqual([]);
    expect(deathsButNotFatal.run(makeCase({ severity: 'minor', persons_killed: 0 }))).toEqual([]);
  });
});

describe('vehicleCountMismatch', () => {
  test('flags 2 vehicles declared but only 1 described', () => {
    const [finding] = vehicleCountMismatch.run(makeCase({ vehicles_count: 2, 'vehicle_type@1': 'truck' }));
    expect(finding).toMatchObject({ ruleId: 'vehicleCountMismatch', fieldIds: ['vehicles_count'] });
    expect(finding.options.map((o) => o.code)).toEqual(['1', '2']);
  });

  test('passes when the counts match, and waits until a vehicle is described', () => {
    expect(vehicleCountMismatch.run(makeCase({ vehicles_count: 2, 'vehicle_type@1': 'truck', 'vehicle_type@2': 'bus' }))).toEqual([]);
    expect(vehicleCountMismatch.run(makeCase({ vehicles_count: 2 }))).toEqual([]);
  });
});

describe('requiredMissing', () => {
  const sampleValue = (field) =>
    ({ enum: field.options?.[0]?.code, number: 1, datetime: '2026-11-23T21:00', geo: { lat: 26.1, lng: 91.7 }, text: 'x' })[field.type];

  test('asks for every empty required field, per vehicle', () => {
    const findings = requiredMissing.run(makeCase({ vehicles_count: 2 }));
    const keys = findings.map((f) => f.fieldIds[0]);
    expect(keys).toEqual(expect.arrayContaining(['severity', 'lighting', 'vehicle_type@1', 'vehicle_type@2', 'person_role@1']));
    expect(findings.find((f) => f.fieldIds[0] === 'weather').questionAs).toBe('বতৰ কেনেকুৱা আছিল?');
  });

  test('names the vehicle in the question once its type is known', () => {
    const findings = requiredMissing.run(makeCase({ 'vehicle_type@1': 'truck' }));
    expect(findings.find((f) => f.fieldIds[0] === 'registration_number@1').questionEn).toMatch(/^Vehicle 1 \(Truck\): /);
  });

  test('passes when every required field is filled', () => {
    const values = {};
    for (const field of getSchema().fields.filter((f) => f.required)) {
      const repeatable = ['vehicles', 'persons'].includes(field.section);
      values[repeatable ? `${field.id}@1` : field.id] = sampleValue(field);
    }
    expect(requiredMissing.run(makeCase(values))).toEqual([]);
  });
});

test('runRules lists every finding from every rule', () => {
  const findings = runRules(makeCase({ crash_datetime: '2026-11-23T22:00', lighting: 'daylight', severity: 'fatal' }));
  const ruleIds = new Set(findings.map((f) => f.ruleId));
  expect(ruleIds).toEqual(new Set(['nightButDaylight', 'fatalButNoDeaths', 'requiredMissing']));
});
