// WeSpeaker ResNet34 (Apache-2.0) run with onnxruntime-node: fbank features in, a 256-value
// voiceprint out. The model file comes from `npm run fetch-models` (pinned SHA-256) and is
// served to phones as well, so the phone's check matches the server's.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import ort from 'onnxruntime-node';

import { env } from '../../config/env.js';
import { decodeAudio } from '../asr/audio.js';
import { fbank } from './fbank.js';
import { unit } from './vector.js';

// speaker-models.json is a copy of shared/models (npm run sync-shared), next to the speech models.
export const SPEAKER_MODELS = JSON.parse(readFileSync(new URL('../asr/models/speaker-models.json', import.meta.url), 'utf8')).models;
export const SPEAKER_MODEL = SPEAKER_MODELS[0];

export const speakerModelPath = (model = SPEAKER_MODEL) => path.join(env.MODELS_DIR, model.file);
export const wespeakerInstalled = () => existsSync(speakerModelPath());

let session;

export const wespeakerSpeaker = {
  name: SPEAKER_MODEL.id,
  async embed(filePath) {
    session ??= ort.InferenceSession.create(speakerModelPath()).catch((err) => {
      session = undefined;
      throw err;
    });
    const samples = await decodeAudio(filePath, SPEAKER_MODEL.sampleRate);
    const { feats, frames } = fbank(samples, SPEAKER_MODEL.melBins);
    const seconds = samples.length / SPEAKER_MODEL.sampleRate;
    if (!frames) return { embedding: null, seconds };
    const out = await (await session).run({ feats: new ort.Tensor('float32', feats, [1, frames, SPEAKER_MODEL.melBins]) });
    return { embedding: unit(out.embs.data), seconds };
  },
};
