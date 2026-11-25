// Measures a speech engine on a folder of clips with reference transcripts.
// Usage: npm run asr:benchmark -- <folder> [lang] [engine]
//   <folder>/refs.json = [{ "file": "clip1.wav", "text": "reference transcript" }, ...]
// Prints character and word error rates (CER, WER) and the real-time factor (RTF: processing
// time / audio length; below 1 is faster than real time). Transcripts are not printed.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { decodeAudio } from '../src/services/asr/audio.js';
import { getAsr } from '../src/services/asr/index.js';

const [dir, lang = 'as', engineName] = process.argv.slice(2);
if (!dir) {
  console.error('Usage: npm run asr:benchmark -- <folder with refs.json> [lang] [engine]');
  process.exit(1);
}

// Punctuation and transcription marks ("~" = cut-off word) are not counted.
const normalise = (s) =>
  s
    .toLowerCase()
    .replace(/[~.,!?;:"'‘’“”()[\]।॥-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function distance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length];
}

const engine = getAsr(engineName);
const refs = JSON.parse(readFileSync(path.join(dir, 'refs.json'), 'utf8'));
const total = { charErr: 0, chars: 0, wordErr: 0, words: 0, seconds: 0, ms: 0 };

console.log(`engine ${engine.name}, lang ${lang}, ${refs.length} clips\n`);
console.log('clip                              secs    CER    WER    RTF');
for (const { file, text } of refs) {
  const filePath = path.join(dir, file);
  const seconds = (await decodeAudio(filePath)).length / 16000;
  const started = performance.now();
  const result = await engine.transcribe(filePath, lang, { section: 'crash' });
  const ms = performance.now() - started;

  const ref = normalise(text);
  const hyp = normalise(result.text);
  const charErr = distance([...ref.replaceAll(' ', '')], [...hyp.replaceAll(' ', '')]);
  const wordErr = distance(ref.split(' '), hyp.split(' '));
  const chars = [...ref.replaceAll(' ', '')].length;
  const words = ref.split(' ').length;
  Object.assign(total, {
    charErr: total.charErr + charErr,
    chars: total.chars + chars,
    wordErr: total.wordErr + wordErr,
    words: total.words + words,
    seconds: total.seconds + seconds,
    ms: total.ms + ms,
  });
  const pct = (n, d) => `${((100 * n) / d).toFixed(1)}%`.padStart(6);
  console.log(`${file.padEnd(32)} ${seconds.toFixed(1).padStart(5)} ${pct(charErr, chars)} ${pct(wordErr, words)} ${(ms / 1000 / seconds).toFixed(2).padStart(6)}`);
}
console.log(
  `\nall ${refs.length} clips, ${total.seconds.toFixed(0)} s of audio: CER ${((100 * total.charErr) / total.chars).toFixed(1)}%, ` +
    `WER ${((100 * total.wordErr) / total.words).toFixed(1)}%, RTF ${(total.ms / 1000 / total.seconds).toFixed(2)}`,
);
