// Self-hosted speech-to-text: AI4Bharat IndicConformer (int8 ONNX, CTC) run with
// onnxruntime-node. These are the same model files the phone downloads, so there is no
// third-party API, no key, and audio never leaves our server. Model list:
// models/speech-models.json (a copy of shared/models); files in MODELS_DIR (npm run fetch-models).
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import ort from 'onnxruntime-node';

import { env } from '../../config/env.js';
import { decodeAudio } from './audio.js';
import { greedyCtc, idsToText, planChunks, tokenTable } from './ctc.js';

const readJson = (file) => JSON.parse(readFileSync(new URL(`./models/${file}`, import.meta.url), 'utf8'));

export const SPEECH_MODELS = readJson('speech-models.json').models;

// The int8 export starts losing words once one pass holds more than about 14 s of speech
// (measured 25 Nov 2026), so clips are cut at pauses into pieces of at most 12 s.
// Padding the pieces with digital silence made it worse, so they are passed as recorded.
export const CHUNKING = { minSeconds: 4, maxSeconds: 12 };

const modelFor = (lang) => SPEECH_MODELS.find((m) => m.lang === lang);
export const modelPath = (model) => path.join(env.MODELS_DIR, model.file);

// One session per model, loaded on first use and kept (about 200 MB each).
const loaded = new Map();
function load(model) {
  if (!loaded.has(model.id)) {
    const session = ort.InferenceSession.create(modelPath(model), { graphOptimizationLevel: 'all' });
    session.catch(() => loaded.delete(model.id));
    loaded.set(model.id, session.then((s) => ({ session: s, table: tokenTable(readJson(model.tokens)) })));
  }
  return loaded.get(model.id);
}

/** Languages whose model file is present on this server. */
export function installedLangs() {
  return SPEECH_MODELS.filter((m) => existsSync(modelPath(m))).map((m) => m.lang);
}

export const indicConformerAsr = {
  name: 'indicconformer',
  async transcribe(filePath, lang) {
    const model = modelFor(lang);
    if (!model) throw new Error(`No IndicConformer model for language "${lang}"`);
    if (!existsSync(modelPath(model))) throw new Error(`Speech model ${model.id} is not installed: run npm run fetch-models`);
    const { session, table } = await load(model);
    const samples = await decodeAudio(filePath, model.sampleRate);

    const texts = [];
    let weighted = 0;
    let tokens = 0;
    for (const [start, end] of planChunks(samples, model.sampleRate, CHUNKING)) {
      // Under 0.3 s there is nothing to recognise (and the encoder needs a few frames).
      if (end - start < model.sampleRate * 0.3) continue;
      const input = samples.subarray(start, end);
      const out = await session.run({
        audio_signal: new ort.Tensor('float32', input, [1, input.length]),
        audio_length: new ort.Tensor('int64', BigInt64Array.from([BigInt(input.length)]), [1]),
      });
      const [, frames, vocab] = out.log_probs.dims;
      const used = Number(out.encoded_length.data[0]);
      const { ids, confidence } = greedyCtc(out.log_probs.data, Math.min(used, frames), vocab, {
        offset: model.tokenOffset,
        size: model.langVocabSize,
        blank: model.blankId,
      });
      texts.push(idsToText(ids, table));
      weighted += confidence * ids.length;
      tokens += ids.length;
    }
    return { text: texts.filter(Boolean).join(' '), lang, engine: 'indicconformer', confidence: tokens ? weighted / tokens : 0 };
  },
};
