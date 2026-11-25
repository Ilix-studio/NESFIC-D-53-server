import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ quiet: true });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  MONGO_URI: z.string().min(1, 'is required, e.g. mongodb://127.0.0.1:27017/voicedar'),
  JWT_SECRET: z.string().min(32, 'must be at least 32 characters (use: openssl rand -hex 32)'),
  JWT_EXPIRES_IN: z.string().default('12h'),
  // indicconformer: self-hosted IndicConformer models (npm run fetch-models); falls back to the
  // synthetic mock while no model file is installed.
  ASR_ENGINE: z.enum(['indicconformer', 'mock', 'bhashini', 'sarvam']).default('indicconformer'),
  MAPPER_ENGINE: z.enum(['rule', 'llm']).default('rule'),
  UPLOAD_DIR: z.string().default('./uploads'),
  // Scene photos: local (UPLOAD_DIR/photos) | cloudinary (needs the three CLOUDINARY_* values).
  PHOTO_STORAGE: z.enum(['local', 'cloudinary']).default('local'),
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
  CLOUDINARY_FOLDER: z.string().default('voicedar/photos'),
  // Officer voice check: wespeaker (model from npm run fetch-models; checks are skipped until it
  // is installed) | mock (tests only) | off. SPEAKER_THRESHOLD overrides the model's match score.
  SPEAKER_ENGINE: z.enum(['wespeaker', 'mock', 'off']).default('wespeaker'),
  SPEAKER_THRESHOLD: z.coerce.number().min(-1).max(1).optional(),
  // Speech model files (.onnx), also served to phones from GET /api/v1/models/:id/file.
  MODELS_DIR: z.string().default('./models'),
  // Comma-separated browser origins allowed by CORS. Native apps send no Origin header.
  CORS_ORIGINS: z.string().default('http://localhost:8081'),
  BHASHINI_API_KEY: z.string().optional(),
  // Sarvam speech-to-text for the server's re-check of phone-first clips. Without a key the
  // synthetic mock is used instead, so the offline flow still runs in development.
  SARVAM_API_KEY: z.string().optional(),
  SARVAM_ASR_URL: z.string().url().default('https://api.sarvam.ai/speech-to-text'),
  SARVAM_ASR_MODEL: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.PHOTO_STORAGE !== 'cloudinary') return;
  for (const key of ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']) {
    if (!data[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'is required when PHOTO_STORAGE=cloudinary' });
  }
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
  throw new Error(`Invalid environment (check server/.env):\n${lines.join('\n')}`);
}

export const env = {
  ...parsed.data,
  UPLOAD_DIR: path.resolve(parsed.data.UPLOAD_DIR),
  MODELS_DIR: path.resolve(parsed.data.MODELS_DIR),
  corsOrigins: parsed.data.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
};
