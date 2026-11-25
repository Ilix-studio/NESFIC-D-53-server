/** Scales a voiceprint to length 1, so the dot product of two is their cosine similarity. */
export function unit(values) {
  let norm = 0;
  for (const v of values) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  return Array.from(values, (v) => v / norm);
}

export function cosine(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}
