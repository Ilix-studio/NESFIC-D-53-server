// Sarvam speech-to-text (India-hosted) for the server's re-check of clips the phone already
// transcribed offline. Returns { text, lang, engine: 'sarvam', detectedLang } like every engine.
// NOT yet tested against the live API: check SARVAM_ASR_URL and SARVAM_ASR_MODEL against
// Sarvam's current docs when the key arrives. Keys stay in server/.env, never in the app.
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { env } from '../../config/env.js';

// Bodo has no Sarvam language code yet: let Sarvam detect the language.
const LANGUAGE_CODES = { as: 'as-IN', bn: 'bn-IN' };

export const sarvamAsr = {
  name: 'sarvam',
  async transcribe(filePath, lang, { mimeType } = {}) {
    if (!env.SARVAM_API_KEY) throw new Error('Sarvam ASR is not configured: set SARVAM_API_KEY in server/.env');
    const form = new FormData();
    form.append('file', new Blob([await readFile(filePath)], { type: mimeType ?? 'audio/mp4' }), path.basename(filePath));
    form.append('language_code', LANGUAGE_CODES[lang] ?? 'unknown');
    if (env.SARVAM_ASR_MODEL) form.append('model', env.SARVAM_ASR_MODEL);

    const res = await fetch(env.SARVAM_ASR_URL, {
      method: 'POST',
      headers: { 'api-subscription-key': env.SARVAM_API_KEY },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`Sarvam ASR failed (${res.status})`);
    const data = await res.json();
    if (typeof data.transcript !== 'string') throw new Error('Sarvam ASR returned no transcript');
    return { text: data.transcript, lang, engine: 'sarvam', detectedLang: data.language_code };
  },
};
