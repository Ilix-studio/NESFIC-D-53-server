// Test engine, never a real voice check: the "voiceprint" is made from the file's bytes, so a
// file always matches itself and different files do not. 1 KB counts as 1 second of audio.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { unit } from './vector.js';

export const mockSpeaker = {
  name: 'mock',
  async embed(filePath) {
    const bytes = await readFile(filePath);
    const values = [];
    for (let i = 0; values.length < 256; i++) {
      for (const b of createHash('sha256').update(bytes).update(String(i)).digest()) values.push(b / 127.5 - 1);
    }
    return { embedding: unit(values.slice(0, 256)), seconds: bytes.length / 1024 };
  },
};
