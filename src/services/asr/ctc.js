// CTC decoding for the IndicConformer engines. Pure functions, no I/O. The phone has a typed
// port in client/src/asr/ctc.ts: keep the two in step.

/** Turns a token map ({ "0": "<unk>", "1": "▁ক", ... }) into an array indexed by id. */
export function tokenTable(tokens) {
  const table = [];
  for (const [id, piece] of Object.entries(tokens)) table[Number(id)] = piece;
  return table;
}

/**
 * Greedy CTC decoding of one utterance. logProbs holds frames x vocab values (row-major).
 * Only the model's own language tokens [offset, offset + size) and the blank compete: the
 * Assamese export keeps the 22-language vocabulary of the multilingual model.
 * confidence = mean probability of the emitted tokens (0 when nothing was said).
 */
export function greedyCtc(logProbs, frames, vocab, { offset, size, blank }) {
  const ids = [];
  let prev = -1;
  let probSum = 0;
  for (let t = 0; t < frames; t++) {
    const row = t * vocab;
    let best = blank;
    let bestLp = logProbs[row + blank];
    for (let k = offset; k < offset + size; k++) {
      if (logProbs[row + k] > bestLp) {
        bestLp = logProbs[row + k];
        best = k;
      }
    }
    if (best !== blank && best !== prev) {
      ids.push(best);
      probSum += Math.exp(bestLp);
    }
    prev = best;
  }
  return { ids, confidence: ids.length ? probSum / ids.length : 0 };
}

/** SentencePiece pieces to text: "▁" starts a word. Unknown and special tokens are dropped. */
export function idsToText(ids, table) {
  let text = '';
  for (const id of ids) {
    const piece = table[id];
    if (!piece || piece.startsWith('<')) continue;
    text += piece.replaceAll('▁', ' ');
  }
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Splits long audio into pieces of at most maxSeconds so memory stays bounded on a phone.
 * Each cut is placed at the quietest 100 ms between minSeconds and maxSeconds, so words are
 * rarely split. Returns [start, end) sample ranges covering the whole clip.
 */
export function planChunks(samples, sampleRate, { minSeconds = 20, maxSeconds = 30 } = {}) {
  const total = samples.length;
  const max = Math.round(maxSeconds * sampleRate);
  const min = Math.round(minSeconds * sampleRate);
  const step = Math.round(sampleRate / 10);
  const chunks = [];
  let start = 0;
  while (total - start > max) {
    let cut = start + max;
    let quietest = Infinity;
    for (let at = start + min; at + step <= start + max; at += step) {
      let energy = 0;
      for (let i = at; i < at + step; i++) energy += samples[i] * samples[i];
      if (energy < quietest) {
        quietest = energy;
        cut = at + Math.round(step / 2);
      }
    }
    chunks.push([start, cut]);
    start = cut;
  }
  if (total > start) chunks.push([start, total]);
  return chunks;
}
