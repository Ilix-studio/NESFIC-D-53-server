/**
 * @jest-environment ./tests/onnx-environment.cjs
 */
// Real speech recognition end to end on SYNTHETIC speech: test-data/audio holds the "spoken"
// sections of transcripts.as.json read by a synthetic voice (npm run make-test-audio).
// Needs the Assamese model (npm run fetch-models); skipped without it, e.g. in CI.
import { readFileSync } from 'node:fs';

import request from 'supertest';

import { createApp } from '../src/app.js';
import { decodeAudio } from '../src/services/asr/audio.js';
import { indicConformerAsr, installedLangs } from '../src/services/asr/indicconformer.asr.js';
import { ruleMapper } from '../src/services/mapper/rule.mapper.js';

const samples = JSON.parse(readFileSync(new URL('../test-data/transcripts.as.json', import.meta.url), 'utf8'));
const clip = (section) => new URL(`../test-data/audio/as-${section}.m4a`, import.meta.url).pathname;
const SECTIONS = ['crash', 'road', 'vehicles', 'persons'];

const chars = (s) => [...s.replace(/[।,.\s]/g, '')];
function charErrorRate(ref, hyp) {
  const [a, b] = [chars(ref), chars(hyp)];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length] / a.length;
}

test('an Android-style m4a clip decodes to 16 kHz mono samples', async () => {
  const samplesOut = await decodeAudio(clip('crash'));
  expect(samplesOut.length / 16000).toBeGreaterThan(13);
  expect(samplesOut.length / 16000).toBeLessThan(17);
  expect(Math.max(...samplesOut.subarray(0, 16000 * 5).map(Math.abs))).toBeLessThanOrEqual(1);
});

const withModel = installedLangs().includes('as') ? describe : describe.skip;

withModel('IndicConformer (Assamese) on synthetic speech', () => {
  const results = {};
  beforeAll(async () => {
    for (const section of SECTIONS) results[section] = await indicConformerAsr.transcribe(clip(section), 'as');
  }, 120_000);

  test.each(SECTIONS)('%s: transcript close to what was said', (section) => {
    expect(results[section].engine).toBe('indicconformer');
    expect(results[section].confidence).toBeGreaterThan(0.7);
    expect(charErrorRate(samples.spoken.sections[section], results[section].text)).toBeLessThan(0.2);
  });

  test('average character error rate under 10%', () => {
    const rates = SECTIONS.map((s) => charErrorRate(samples.spoken.sections[s], results[s].text));
    expect(rates.reduce((a, b) => a + b) / rates.length).toBeLessThan(0.1);
  });

  // A floor, not a target: 19 of 33 on 25 Nov 2026. Misses come from the rule mapper
  // (number words above twelve, "সাতাইশ নং", spacing variants) and from recognition slips.
  test('the rule mapper fills at least 18 of the 33 expected fields from recognised speech', async () => {
    const context = { startedAt: new Date('2026-11-23T15:44:00Z') };
    let right = 0;
    for (const section of SECTIONS) {
      const proposals = await ruleMapper.map({ transcript: results[section], section, context });
      const got = Object.fromEntries(proposals.map((p) => [p.fieldId, p.value]));
      for (const [key, value] of Object.entries(samples.expected[section])) {
        const ok = key === 'crash_datetime' ? got[key] === `2026-11-23T${value}` : JSON.stringify(got[key]) === JSON.stringify(value);
        if (ok) right++;
      }
    }
    expect(right).toBeGreaterThanOrEqual(18);
  });
});

describe('GET /api/v1/models (phones download speech models from here)', () => {
  const app = createApp();

  test('lists every model with its size and SHA-256, without login', async () => {
    const res = await request(app).get('/api/v1/models').expect(200);
    expect(res.body.items.map((m) => m.lang)).toEqual(['as', 'brx']);
    for (const m of res.body.items) {
      expect(m.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(m.path).toBe(`/api/v1/models/${m.id}/file`);
    }
  });

  test('an unknown model is 404', async () => {
    await request(app).get('/api/v1/models/nope/file').expect(404);
  });

  (installedLangs().includes('as') ? test : test.skip)('serves byte ranges, so a download can resume', async () => {
    const res = await request(app).get('/api/v1/models/indicconformer-as-int8/file').set('Range', 'bytes=0-15').expect(206);
    expect(res.headers['content-range']).toBe('bytes 0-15/198777538');
  });
});
