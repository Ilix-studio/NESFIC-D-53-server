// Decodes any recording (m4a/AAC from Android, WAV, webm from the browser, ...) to mono
// float32 PCM at the model's sample rate, using the ffmpeg binary from ffmpeg-static.
import { spawn } from 'node:child_process';

import ffmpegPath from 'ffmpeg-static';

export function decodeAudio(filePath, sampleRate = 16000) {
  return new Promise((resolve, reject) => {
    const args = ['-nostdin', '-v', 'error', '-i', filePath, '-ac', '1', '-ar', String(sampleRate), '-f', 'f32le', 'pipe:1'];
    const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const out = [];
    let err = '';
    proc.stdout.on('data', (chunk) => out.push(chunk));
    proc.stderr.on('data', (chunk) => {
      err = (err + chunk).slice(-500);
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`Could not decode the audio (${err.trim() || `ffmpeg exit ${code}`})`));
      const buf = Buffer.concat(out);
      // Copy into a fresh, 4-byte aligned buffer for the Float32Array view.
      resolve(new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)));
    });
  });
}
