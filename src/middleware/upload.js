// Audio goes to UPLOAD_DIR (never served statically) with random file names. Photos stay in
// memory: the photo service stores them (disk or Cloudinary) only after the case checks pass.
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import multer from 'multer';

import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';

const AUDIO_TYPES = {
  'audio/m4a': '.m4a',
  'audio/x-m4a': '.m4a',
  'audio/mp4': '.m4a',
  'audio/aac': '.aac',
  'audio/x-aac': '.aac',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/wave': '.wav',
  'audio/webm': '.webm', // Expo web (browser) recordings, for development
};
const PHOTO_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png' };

function diskStorage(folder, types) {
  const dir = path.join(env.UPLOAD_DIR, folder);
  mkdirSync(dir, { recursive: true });
  return multer.diskStorage({
    destination: dir,
    filename: (req, file, cb) => cb(null, `${randomUUID()}${types[file.mimetype]}`),
  });
}

function uploader({ storage, field, types, maxBytes }) {
  return multer({
    storage,
    limits: { fileSize: maxBytes, files: 1 },
    fileFilter: (req, file, cb) =>
      types[file.mimetype]
        ? cb(null, true)
        : cb(ApiError.badRequest(`Unsupported file type ${file.mimetype}. Allowed: ${Object.keys(types).join(', ')}`)),
  }).single(field);
}

export const uploadAudio = uploader({
  storage: diskStorage('audio', AUDIO_TYPES),
  field: 'audio',
  types: AUDIO_TYPES,
  maxBytes: 25 * 1024 * 1024,
});
export const uploadPhoto = uploader({ storage: multer.memoryStorage(), field: 'photo', types: PHOTO_TYPES, maxBytes: 10 * 1024 * 1024 });

/** Requires the file that multer parsed. */
export const requireFile = (field) => (req, res, next) =>
  req.file ? next() : next(ApiError.badRequest(`Missing "${field}" file (multipart/form-data)`));
