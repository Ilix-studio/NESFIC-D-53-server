// Real Assamese ASR via Bhashini. Stub until the API key and pipeline details arrive.
// When implemented it must return { text, lang, engine: 'bhashini', confidence } so that
// nothing outside this file changes. Keys stay in server/.env, never in the app.
import { env } from '../../config/env.js';

export const bhashiniAsr = {
  name: 'bhashini',
  async transcribe() {
    if (!env.BHASHINI_API_KEY) {
      throw new Error('Bhashini ASR is not configured: set BHASHINI_API_KEY in server/.env');
    }
    throw new Error('Bhashini ASR adapter is not implemented yet');
  },
};
