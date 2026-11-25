// The speech models phones download for offline transcription. They are served from this
// server (India-hosted for the pilot) rather than a third-party host; the app pins each
// file's SHA-256, so a swapped file is rejected on the phone.
import { existsSync } from 'node:fs';

import { modelPath, SPEECH_MODELS } from './asr/indicconformer.asr.js';
import { ApiError } from '../utils/ApiError.js';

export function listModels() {
  return SPEECH_MODELS.map((m) => ({
    id: m.id,
    lang: m.lang,
    label: m.label,
    sizeBytes: m.sizeBytes,
    sha256: m.sha256,
    license: m.license,
    available: existsSync(modelPath(m)),
    path: `/api/v1/models/${m.id}/file`,
  }));
}

export function getModelFile(id) {
  const model = SPEECH_MODELS.find((m) => m.id === id);
  if (!model) throw ApiError.notFound('Unknown model');
  const file = modelPath(model);
  if (!existsSync(file)) throw ApiError.notFound('This model is not installed on the server (npm run fetch-models)');
  return file;
}
