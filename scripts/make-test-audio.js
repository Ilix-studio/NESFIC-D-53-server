// Builds the SYNTHETIC test clips in test-data/audio: the "spoken" sections of
// test-data/transcripts.as.json read aloud by a synthetic Assamese voice (AAII Xobdo Boroxa 1.0,
// FastSpeech2 + Multi-band MelGAN, ONNX, CC-BY-NC-4.0), over a quiet room-noise floor, saved as
// AAC .m4a like an Android recording. Used only by tests. Usage: npm run make-test-audio
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import ffmpegPath from 'ffmpeg-static';
import ort from 'onnxruntime-node';

import { env } from '../src/config/env.js';
import { fetchPinned } from './fetch-models.js';

const TTS = {
  repo: 'aaiiaxom/assamese-tts-aaii-xobdo-fs2-mb',
  revision: '9027cb27f4fc7104ec562815a5d303ea15d95007',
  files: {
    'encoder.onnx': 'efb0a537e97e4e4f77259b6fd5e9b55c14b4bfe7db21fa18a9642b394515e070',
    'variance_predictor.onnx': '8a4439c0d95093ceddbeee34daf3742ec315e4b5d21adf97555d8cd69f75ad57',
    'decoder.onnx': 'e32f95f353f02f0065d6b418fe627750f2511d83edc06054ebecd3fd85a99699',
    'vocoder.onnx': '9fa7f84c75aec246094aba8a92afd2b8c5ce279de89db5fc8bfd540882bfe33e',
    'token_list.json': 'ba7ba1825f4d217fa9a8f5a4fb1699b447ee2e551433337a66bf15a4d2b22097',
  },
};
const RATE = 16000;
const HIDDEN = 384;
const PAUSE_SECONDS = 0.35;
// About -60 dBFS of white noise: a quiet room, never digital silence.
const NOISE = 0.0015;

const root = path.resolve(import.meta.dirname, '..');
const ttsDir = path.join(env.MODELS_DIR, 'tts-as');
const outDir = path.join(root, 'test-data/audio');

async function loadTts() {
  mkdirSync(ttsDir, { recursive: true });
  for (const [file, sha] of Object.entries(TTS.files)) {
    await fetchPinned(`https://huggingface.co/${TTS.repo}/resolve/${TTS.revision}/${file}`, path.join(ttsDir, file), sha);
  }
  const tokens = JSON.parse(readFileSync(path.join(ttsDir, 'token_list.json'), 'utf8'));
  const s = {};
  for (const part of ['encoder', 'variance_predictor', 'decoder', 'vocoder']) {
    s[part] = await ort.InferenceSession.create(path.join(ttsDir, `${part}.onnx`));
  }
  // Longest match first: some tokens are two code points (য + ়).
  const pieces = Object.keys(tokens)
    .filter((k) => !k.startsWith('<'))
    .sort((a, b) => b.length - a.length);

  return async function speak(text) {
    const chars = text.normalize('NFC').trim().replace(/\s+/g, '|');
    const ids = [];
    for (let i = 0; i < chars.length; ) {
      const piece = pieces.find((p) => chars.startsWith(p, i));
      if (piece) ids.push(tokens[piece]);
      i += piece?.length ?? 1;
    }
    ids.push(tokens['<sos/eos>']);
    const n = ids.length;
    const { hidden_states } = await s.encoder.run({
      text: new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, n]),
      x_mask: new ort.Tensor('float32', new Float32Array(n).fill(1), [1, 1, n]),
    });
    const vp = await s.variance_predictor.run({ hidden_states, pad_mask: new ort.Tensor('float32', new Float32Array(n), [1, n, 1]) });
    // Durations are predicted in the log domain (ESPnet: round(exp(d) - 1)).
    const durations = Array.from(vp.duration_raw.data, (d) => Math.max(0, Math.round(Math.exp(d) - 1)));
    const frames = durations.reduce((a, b) => a + b, 0);
    const regulated = new Float32Array(frames * HIDDEN);
    let at = 0;
    durations.forEach((d, i) => {
      for (let r = 0; r < d; r++, at++) regulated.set(vp.hs_enriched.data.subarray(i * HIDDEN, (i + 1) * HIDDEN), at * HIDDEN);
    });
    const { mel } = await s.decoder.run({ hs_regulated: new ort.Tensor('float32', regulated, [1, frames, HIDDEN]) });
    return (await s.vocoder.run({ mel })).wav.data;
  };
}

function wavBytes(samples) {
  const b = Buffer.alloc(44 + samples.length * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + samples.length * 2, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(RATE, 24);
  b.writeUInt32LE(RATE * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((v, i) => b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), 44 + i * 2));
  return b;
}

const speak = await loadTts();
const { spoken } = JSON.parse(readFileSync(path.join(root, 'test-data/transcripts.as.json'), 'utf8'));
mkdirSync(outDir, { recursive: true });
let seed = 1;
const noise = () => {
  seed = (seed * 1103515245 + 12345) % 2 ** 31;
  return (seed / 2 ** 31 - 0.5) * 2 * NOISE;
};

for (const [section, text] of Object.entries(spoken.sections)) {
  // Phrase by phrase with a short pause, as an officer would speak.
  const parts = [new Float32Array(RATE * PAUSE_SECONDS)];
  for (const phrase of text.split(/(?<=[।,])\s*/).filter(Boolean)) parts.push(await speak(phrase), new Float32Array(RATE * PAUSE_SECONDS));
  const clip = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    clip.set(p, at);
    at += p.length;
  }
  for (let i = 0; i < clip.length; i++) clip[i] += noise();

  const wav = path.join(outDir, `as-${section}.wav`);
  const m4a = path.join(outDir, `as-${section}.m4a`);
  writeFileSync(wav, wavBytes(clip));
  const enc = spawnSync(ffmpegPath, ['-v', 'error', '-y', '-i', wav, '-c:a', 'aac', '-b:a', '48k', m4a]);
  rmSync(wav);
  if (enc.status !== 0) throw new Error(`ffmpeg failed: ${enc.stderr}`);
  console.log(`test-data/audio/as-${section}.m4a  ${(clip.length / RATE).toFixed(1)} s`);
}
