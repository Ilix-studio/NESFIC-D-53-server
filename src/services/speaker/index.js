// SpeakerEngine: embed(filePath) -> { embedding: number[] (length 1) | null, seconds }
// Checks that a clip was spoken by the case's investigating officer, against the voiceprint
// recorded at enrolment. A mismatch is flagged for review and in the audit trail; it never
// blocks the officer.
import { readFileSync } from 'node:fs';

import { env } from '../../config/env.js';
import { mockSpeaker } from './mock.speaker.js';
import { cosine } from './vector.js';
import { SPEAKER_MODEL, wespeakerInstalled, wespeakerSpeaker } from './wespeaker.speaker.js';

export const MATCH_THRESHOLD = env.SPEAKER_THRESHOLD ?? SPEAKER_MODEL.matchThreshold;
// Shorter clips do not carry enough voice to judge.
const MIN_CLIP_SECONDS = 1.5;

// passages.json is a copy of shared/voice (npm run sync-shared).
const voiceData = JSON.parse(readFileSync(new URL('./data/passages.json', import.meta.url), 'utf8'));
export const PASSAGES = voiceData.passages;
export const MIN_ENROL_SECONDS = voiceData.minSeconds;

/** The engine in use, or null when voice checks are off or the model is not installed. */
export function getSpeaker() {
  if (env.SPEAKER_ENGINE === 'mock') return mockSpeaker;
  if (env.SPEAKER_ENGINE === 'wespeaker' && wespeakerInstalled()) return wespeakerSpeaker;
  return null;
}

/** { score, match, engine, threshold } for a clip, or null when it cannot be checked. */
export async function checkSpeaker(filePath, voice) {
  const engine = getSpeaker();
  // Voiceprints from different models cannot be compared.
  if (!engine || !voice?.embedding?.length || voice.model !== engine.name) return null;
  const { embedding, seconds } = await engine.embed(filePath);
  if (!embedding || seconds < MIN_CLIP_SECONDS) return null;
  const score = Math.round(cosine(embedding, voice.embedding) * 1000) / 1000;
  return { score, match: score >= MATCH_THRESHOLD, engine: engine.name, threshold: MATCH_THRESHOLD };
}
