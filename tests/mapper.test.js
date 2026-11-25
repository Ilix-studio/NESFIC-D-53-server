import { readFileSync } from 'node:fs';

import { ruleMapper } from '../src/services/mapper/rule.mapper.js';
import { applyProposals } from '../src/services/caseState.js';

const samples = JSON.parse(readFileSync(new URL('../test-data/transcripts.as.json', import.meta.url), 'utf8'));
// 23 Nov 2026, 21:14 IST
const context = { startedAt: new Date('2026-11-23T15:44:00Z') };

const mapSection = async (section) => {
  const proposals = await ruleMapper.map({ transcript: { text: samples.sections[section], lang: 'as' }, section, context });
  return Object.fromEntries(proposals.map((p) => [p.fieldId, p.value]));
};

describe('rule mapper on synthetic Assamese transcripts', () => {
  test.each(['road', 'vehicles', 'persons'])('%s section gives the expected fields', async (section) => {
    expect(await mapSection(section)).toEqual(samples.expected[section]);
  });

  test('crash section: "ৰাতি প্ৰায় ন বজাত" becomes 21:00 on the day the case was opened', async () => {
    const { crash_datetime, ...rest } = await mapSection('crash');
    expect(crash_datetime).toBe('2026-11-23T21:00');
    const { crash_datetime: _, ...expectedRest } = samples.expected.crash;
    expect(rest).toEqual(expectedRest);
  });

  test('a crash time later than the case opening time is the previous day', async () => {
    const proposals = await ruleMapper.map({
      transcript: { text: 'ৰাতি এঘাৰ বজাত দুৰ্ঘটনা হয়', lang: 'as' },
      section: 'crash',
      context: { startedAt: new Date('2026-11-23T19:00:00Z') }, // 00:30 IST on 24 Nov
    });
    expect(proposals.find((p) => p.fieldId === 'crash_datetime').value).toBe('2026-11-23T23:00');
  });

  test('every proposal carries its transcript span as evidence', async () => {
    const text = samples.sections.road;
    const proposals = await ruleMapper.map({ transcript: { text, lang: 'as' }, section: 'road', context });
    for (const p of proposals) expect(text.slice(p.transcriptSpan.start, p.transcriptSpan.end)).toBe(p.transcriptSpan.text);
    expect(proposals.find((p) => p.fieldId === 'road_surface_condition').transcriptSpan.text).toBe('পথটো তিতা');
  });

  test('follow-up answers map only the asked field', async () => {
    const reg = await ruleMapper.map({
      transcript: { text: samples.followupAnswers.registration_number, lang: 'as' },
      section: 'followup',
      targetKeys: ['registration_number@1'],
    });
    expect(reg).toEqual([expect.objectContaining({ fieldId: 'registration_number@1', value: 'AS01 AB 1234' })]);
  });
});

test('proposals for unknown fields or options are dropped', () => {
  const caseDoc = { fields: [], followups: [] };
  const applied = applyProposals(
    caseDoc,
    [
      { fieldId: 'weather', value: 'rain' },
      { fieldId: 'weather_made_up', value: 'rain' },
      { fieldId: 'lighting', value: 'moonlight' },
      { fieldId: 'vehicle_type', value: 'truck' }, // repeatable field without an instance number
    ],
    { source: 'speech' },
  );
  expect(applied.map((a) => a.fieldId)).toEqual(['weather']);
});

test('speech never overwrites a value the officer edited or confirmed', () => {
  const caseDoc = {
    followups: [],
    fields: [
      { fieldId: 'lighting', value: 'night_no_lights', source: 'officer_edit', confirmedByOfficer: true },
      { fieldId: 'weather', value: 'clear', source: 'speech', confirmedByOfficer: true },
    ],
  };
  const applied = applyProposals(caseDoc, [{ fieldId: 'lighting', value: 'daylight' }, { fieldId: 'weather', value: 'rain' }], { source: 'speech' });
  expect(applied).toEqual([]);
  expect(caseDoc.fields.map((f) => f.value)).toEqual(['night_no_lights', 'clear']);
});

describe('negation', () => {
  const map = async (text, section = 'road', lang = 'as') =>
    Object.fromEntries((await ruleMapper.map({ transcript: { text, lang }, section, context })).map((p) => [p.fieldId, p.value]));

  test('a negation word after a phrase in the same clause cancels it', async () => {
    expect(await map('বৰষুণ দিয়া নাছিল। বতৰ পৰিষ্কাৰ।')).toEqual({ weather: 'clear' });
    expect((await map('কোনো গুৰুতৰ আহত নাই', 'crash')).severity).toBeUndefined();
  });

  test('a phrase that is itself negative still counts, and a later clause does not negate an earlier one', async () => {
    expect(await map('হেলমেট পিন্ধা নাছিল', 'persons')).toMatchObject({ 'safety_device@1': 'helmet_not_worn' });
    expect(await map('বৰষুণ দিছিল, কোনো পথ চিহ্ন নাছিল')).toEqual({ weather: 'rain', road_signs_present: 'no' });
  });
});

describe('other language packs (PLACEHOLDER)', () => {
  const bn = JSON.parse(readFileSync(new URL('../test-data/transcripts.bn.json', import.meta.url), 'utf8'));

  test.each(['crash', 'road'])('Bengali %s transcript gives the expected fields', async (section) => {
    const proposals = await ruleMapper.map({ transcript: { text: bn.sections[section], lang: 'bn' }, section, context });
    const got = Object.fromEntries(proposals.map((p) => [p.fieldId, p.value]));
    if (got.crash_datetime) got.crash_datetime = got.crash_datetime.slice(11);
    expect(got).toEqual(bn.expected[section]);
  });

  test('the empty Bodo pack still reads number plates and digits in Devanagari', async () => {
    const proposals = await ruleMapper.map({ transcript: { text: 'गाड़ी AS01 CD 5678', lang: 'brx' }, section: 'vehicles', context });
    expect(proposals).toEqual([expect.objectContaining({ fieldId: 'registration_number@1', value: 'AS01 CD 5678' })]);
  });
});

test('the simulated on-device transcripts miss the road number, the plate, and mishear the skid marks', async () => {
  const onDevice = {};
  for (const section of ['crash', 'road', 'vehicles']) {
    const proposals = await ruleMapper.map({ transcript: { text: samples.onDevice.sections[section], lang: 'as' }, section, context });
    for (const p of proposals) onDevice[p.fieldId] = p.value;
  }
  expect(onDevice.road_name_number).toBeUndefined();
  expect(onDevice['registration_number@2']).toBeUndefined();
  expect(onDevice.skid_marks_m).toBe(2);
  expect(onDevice['vehicle_type@2']).toBe('two_wheeler');
});
