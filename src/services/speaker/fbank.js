// Kaldi-compatible 80-band log-mel filterbank, as WeSpeaker computes it for its models
// (torchaudio.compliance.kaldi.fbank: 25 ms Hamming frames every 10 ms, DC removed,
// pre-emphasis 0.97, no dither, 512-point power spectrum, mel bins from 20 Hz to Nyquist,
// natural log), then the utterance mean removed from every band (CMN).
// Keep in step with client/src/speaker/fbank.ts.

const SAMPLE_RATE = 16000;
const FRAME = 400; // 25 ms
const SHIFT = 160; // 10 ms
const FFT = 512;
const PREEMPHASIS = 0.97;
const LOW_HZ = 20;
const EPSILON = 1.1920928955078125e-7; // float32 machine epsilon, Kaldi's log floor

const melScale = (hz) => 1127 * Math.log(1 + hz / 700);

const WINDOW = Float64Array.from({ length: FRAME }, (_, i) => 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (FRAME - 1)));

// Bit-reversal order and twiddles for an in-place radix-2 FFT of size 512.
const BITS = Math.log2(FFT);
const REVERSED = Uint16Array.from({ length: FFT }, (_, i) => {
  let r = 0;
  for (let b = 0; b < BITS; b++) r = (r << 1) | ((i >> b) & 1);
  return r;
});
const COS = Float64Array.from({ length: FFT / 2 }, (_, i) => Math.cos((-2 * Math.PI * i) / FFT));
const SIN = Float64Array.from({ length: FFT / 2 }, (_, i) => Math.sin((-2 * Math.PI * i) / FFT));

/** Triangular mel weights over FFT bins 0..255 (the Nyquist bin gets none), as in Kaldi. */
function melBanks(numBins) {
  const lowMel = melScale(LOW_HZ);
  const delta = (melScale(SAMPLE_RATE / 2) - lowMel) / (numBins + 1);
  return Array.from({ length: numBins }, (_, b) => {
    const left = lowMel + b * delta;
    const center = left + delta;
    const right = center + delta;
    const weights = new Float64Array(FFT / 2);
    for (let k = 0; k < FFT / 2; k++) {
      const m = melScale((SAMPLE_RATE / FFT) * k);
      weights[k] = Math.max(0, Math.min((m - left) / (center - left), (right - m) / (right - center)));
    }
    return weights;
  });
}

const banksCache = new Map();

/**
 * @param {Float32Array} samples 16 kHz mono in [-1, 1]
 * @returns {{ feats: Float32Array, frames: number }} frames x numBins, row-major
 */
export function fbank(samples, numBins = 80) {
  if (!banksCache.has(numBins)) banksCache.set(numBins, melBanks(numBins));
  const banks = banksCache.get(numBins);
  const frames = samples.length < FRAME ? 0 : 1 + Math.floor((samples.length - FRAME) / SHIFT);
  const feats = new Float32Array(frames * numBins);
  const re = new Float64Array(FFT);
  const im = new Float64Array(FFT);
  const frame = new Float64Array(FRAME);

  for (let f = 0; f < frames; f++) {
    const start = f * SHIFT;
    let mean = 0;
    for (let i = 0; i < FRAME; i++) {
      frame[i] = samples[start + i] * 32768; // WeSpeaker reads 16-bit PCM without normalising
      mean += frame[i];
    }
    mean /= FRAME;
    for (let i = 0; i < FRAME; i++) frame[i] -= mean;
    for (let i = FRAME - 1; i > 0; i--) frame[i] -= PREEMPHASIS * frame[i - 1];
    frame[0] -= PREEMPHASIS * frame[0];

    re.fill(0);
    im.fill(0);
    for (let i = 0; i < FRAME; i++) re[REVERSED[i]] = frame[i] * WINDOW[i];
    for (let size = 2; size <= FFT; size *= 2) {
      const half = size / 2;
      const step = FFT / size;
      for (let i = 0; i < FFT; i += size) {
        for (let j = 0; j < half; j++) {
          const c = COS[j * step];
          const s = SIN[j * step];
          const a = i + j;
          const b = a + half;
          const tr = re[b] * c - im[b] * s;
          const ti = re[b] * s + im[b] * c;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }

    for (let b = 0; b < numBins; b++) {
      const weights = banks[b];
      let energy = 0;
      for (let k = 0; k < FFT / 2; k++) if (weights[k]) energy += weights[k] * (re[k] * re[k] + im[k] * im[k]);
      feats[f * numBins + b] = Math.log(Math.max(energy, EPSILON));
    }
  }

  for (let b = 0; b < numBins; b++) {
    let sum = 0;
    for (let f = 0; f < frames; f++) sum += feats[f * numBins + b];
    const mean = sum / frames;
    for (let f = 0; f < frames; f++) feats[f * numBins + b] -= mean;
  }
  return { feats, frames };
}
