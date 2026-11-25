import { greedyCtc, idsToText, planChunks, tokenTable } from '../src/services/asr/ctc.js';

const table = tokenTable({ 0: '<unk>', 1: '▁ক', 2: 'াৰ', 3: '▁গ', 4: '<blank>' });
const BLANK = 4;
const VOCAB = 6; // id 5 belongs to another language in the multilingual vocabulary

/** One log-prob row per frame, with the given token clearly most likely. */
function frames(best, { other = 5, otherLp = -9 } = {}) {
  const data = new Float32Array(best.length * VOCAB).fill(-20);
  best.forEach((id, t) => {
    data[t * VOCAB + id] = Math.log(0.9);
    data[t * VOCAB + other] = otherLp;
  });
  return data;
}

describe('greedy CTC decoding', () => {
  const slice = { offset: 0, size: 4, blank: BLANK };

  test('merges repeats and drops blanks; a blank separates a real double token', () => {
    const { ids } = greedyCtc(frames([1, 1, BLANK, 2, 2, BLANK, 1, BLANK, 1]), 9, VOCAB, slice);
    expect(ids).toEqual([1, 2, 1, 1]);
  });

  test('only the model language tokens and the blank compete', () => {
    // Token 5 scores best in every frame but is outside [offset, offset + size).
    const { ids } = greedyCtc(frames([1, BLANK, 2], { otherLp: 0 }), 3, VOCAB, slice);
    expect(ids).toEqual([1, 2]);
  });

  test('confidence is the mean probability of the emitted tokens, 0 for silence', () => {
    expect(greedyCtc(frames([1, BLANK, 2]), 3, VOCAB, slice).confidence).toBeCloseTo(0.9);
    expect(greedyCtc(frames([BLANK, BLANK]), 2, VOCAB, slice)).toEqual({ ids: [], confidence: 0 });
  });

  test('only the frames the encoder marks as valid are read', () => {
    expect(greedyCtc(frames([1, BLANK, 2]), 1, VOCAB, slice).ids).toEqual([1]);
  });
});

test('pieces become text: "▁" starts a word, special tokens are dropped', () => {
  expect(idsToText([1, 2, 3, 0, 4], table)).toBe('কাৰ গ');
  expect(idsToText([], table)).toBe('');
});

describe('splitting long audio', () => {
  const rate = 1000;
  const loud = (seconds) => Float32Array.from({ length: seconds * rate }, (_, i) => (i % 2 ? 0.5 : -0.5));

  test('a clip within the limit is one piece', () => {
    expect(planChunks(loud(10), rate, { minSeconds: 4, maxSeconds: 12 })).toEqual([[0, 10 * rate]]);
  });

  test('cuts at the quietest 100 ms, covers every sample, and keeps pieces within the limit', () => {
    const audio = loud(30);
    audio.fill(0, 7.0 * rate, 7.1 * rate); // a pause at 7 s
    const chunks = planChunks(audio, rate, { minSeconds: 4, maxSeconds: 12 });
    expect(chunks[0]).toEqual([0, 7.05 * rate]);
    expect(chunks[0][0]).toBe(0);
    expect(chunks.at(-1)[1]).toBe(audio.length);
    chunks.slice(1).forEach(([start], i) => expect(start).toBe(chunks[i][1]));
    for (const [start, end] of chunks) expect(end - start).toBeLessThanOrEqual(12 * rate);
  });
});
