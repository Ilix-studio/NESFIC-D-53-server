// AsrEngine: transcribe(filePath, lang, { section, targetKeys, mimeType }) -> { text, lang, engine, confidence }
import { env } from '../../config/env.js';
import { bhashiniAsr } from './bhashini.asr.js';
import { indicConformerAsr, installedLangs } from './indicconformer.asr.js';
import { mockAsr } from './mock.asr.js';
import { sarvamAsr } from './sarvam.asr.js';

const engines = { indicconformer: indicConformerAsr, mock: mockAsr, bhashini: bhashiniAsr, sarvam: sarvamAsr };

export function getAsr(name = env.ASR_ENGINE) {
  // Without a key or a model file, fall back to the synthetic mock so development still works.
  if (name === 'sarvam' && !env.SARVAM_API_KEY) return mockAsr;
  if (name === 'indicconformer' && installedLangs().length === 0) return mockAsr;
  const engine = engines[name];
  if (!engine) throw new Error(`Unknown ASR engine "${name}"`);
  return engine;
}
