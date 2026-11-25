/**
 * @jest-environment ./tests/onnx-environment.cjs
 */
// Officer voice check: the fbank matches Kaldi, and the real model (when installed, npm run
// fetch-models) gives clips from one synthetic voice a matching score.
import { readFileSync } from 'node:fs';

import { MATCH_THRESHOLD } from '../src/services/speaker/index.js';
import { fbank } from '../src/services/speaker/fbank.js';
import { cosine } from '../src/services/speaker/vector.js';
import { wespeakerInstalled, wespeakerSpeaker } from '../src/services/speaker/wespeaker.speaker.js';

const reference = JSON.parse(readFileSync(new URL('../test-data/fbank-reference.json', import.meta.url), 'utf8'));

/** The synthetic signal described in fbank-reference.json. */
function referenceSignal(count) {
  const x = new Float32Array(count);
  let seed = 7;
  for (let n = 0; n < count; n++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = (seed / 2 ** 32) * 2 - 1;
    x[n] = 0.3 * Math.sin((2 * Math.PI * 220 * n) / 16000) + 0.2 * Math.sin((2 * Math.PI * 1375 * n) / 16000 + 0.5) + 0.05 * noise;
  }
  return x;
}

test('fbank matches kaldi-native-fbank (80 bands, mean removed)', () => {
  const { feats, frames } = fbank(referenceSignal(reference.sampleCount));
  expect(frames).toBe(reference.frames);
  let maxDiff = 0;
  reference.feats.forEach((row, f) => row.forEach((v, b) => (maxDiff = Math.max(maxDiff, Math.abs(feats[f * 80 + b] - v)))));
  expect(maxDiff).toBeLessThan(2e-3);
});

test('fbank of less than one 25 ms frame is empty', () => {
  expect(fbank(new Float32Array(399)).frames).toBe(0);
});

const clip = (section) => new URL(`../test-data/audio/as-${section}.m4a`, import.meta.url).pathname;
const withModel = wespeakerInstalled() ? test : test.skip;

withModel('real model: two clips from the same voice match', async () => {
  const [a, b] = await Promise.all([wespeakerSpeaker.embed(clip('crash')), wespeakerSpeaker.embed(clip('road'))]);
  expect(a.embedding).toHaveLength(256);
  expect(cosine(a.embedding, b.embedding)).toBeGreaterThan(MATCH_THRESHOLD);
});
