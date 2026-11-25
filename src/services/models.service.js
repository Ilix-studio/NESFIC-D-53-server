// The speech models phones download for offline transcription, and the speaker model for the
// officer voice check. They are served from this
// server (India-hosted for the pilot) rather than a third-party host; the app pins each
// file's SHA-256, so a swapped file is rejected on the phone.
import { existsSync } from 'node:fs';

import { modelPath, SPEECH_MODELS } from './asr/indicconformer.asr.js';
import { SPEAKER_MODELS, speakerModelPath } from './speaker/wespeaker.speaker.js';
import { ApiError } from '../utils/ApiError.js';

const ALL = [...SPEECH_MODELS.map((m) => ({ ...m, kind: 'speech', localPath: modelPath(m) })), ...SPEAKER_MODELS.map((m) => ({ ...m, kind: 'speaker', localPath: speakerModelPath(m) }))];

export function listModels() {
  return ALL.map((m) => ({
    id: m.id,
    kind: m.kind,
    lang: m.lang,
    label: m.label,
    sizeBytes: m.sizeBytes,
    sha256: m.sha256,
    license: m.license,
    available: existsSync(m.localPath),
    path: `/api/v1/models/${m.id}/file`,
  }));
}

export function getModelFile(id) {
  const model = ALL.find((m) => m.id === id);
  if (!model) throw ApiError.notFound('Unknown model');
  const file = model.localPath;
  if (!existsSync(file)) throw ApiError.notFound('This model is not installed on the server (npm run fetch-models)');
  return file;
}
