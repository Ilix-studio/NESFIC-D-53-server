// Downloads the speech models listed in src/services/asr/models/speech-models.json into
// MODELS_DIR, from the pinned Hugging Face revision, and checks each file's SHA-256.
// Usage: npm run fetch-models [-- as brx]   (no languages = all)
// The server then transcribes with them and serves them to phones (GET /api/v1/models).
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { env } from '../src/config/env.js';
import { SPEECH_MODELS } from '../src/services/asr/indicconformer.asr.js';

export async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

/** Downloads url to dest unless a file with the right checksum is already there. */
export async function fetchPinned(url, dest, expectedSha) {
  if (existsSync(dest) && (await sha256(dest)) === expectedSha) return 'present';
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`);
  const partial = `${dest}.part`;
  await writeFile(partial, res.body);
  const got = await sha256(partial);
  if (got !== expectedSha) {
    rmSync(partial);
    throw new Error(`SHA-256 mismatch for ${path.basename(dest)}: expected ${expectedSha}, got ${got}`);
  }
  renameSync(partial, dest);
  return 'downloaded';
}

const hfUrl = ({ repo, revision, path: file }) => `https://huggingface.co/${repo}/resolve/${revision}/${file}`;

if (import.meta.url === `file://${process.argv[1]}`) {
  const langs = process.argv.slice(2);
  mkdirSync(env.MODELS_DIR, { recursive: true });
  for (const model of SPEECH_MODELS.filter((m) => !langs.length || langs.includes(m.lang))) {
    process.stdout.write(`${model.id} (${(model.sizeBytes / 1e6).toFixed(0)} MB) ... `);
    console.log(await fetchPinned(hfUrl(model.source), path.join(env.MODELS_DIR, model.file), model.sha256));
  }
}
