// SPDX-License-Identifier: GPL-3.0-only
// Host-side loudness: every engine renders in its own natural units, so the
// host scales a whole parameter set (never a single note) to a common level
// and fades the end of each note.
export const TARGET_PEAK = 0.3;
export const REFERENCE_VELOCITY = 0.7;
export const REFERENCE_DURATION_S = 1;

/** The note used to measure a parameter set: low-middle of the instrument's range. */
export function referenceNote(range) {
  return { midi: Math.round(range.lowMidi + 0.35 * (range.highMidi - range.lowMidi)), velocity: REFERENCE_VELOCITY, durationS: REFERENCE_DURATION_S };
}

export function gainFromPeak(peak) {
  if (!(peak > 0)) return 1;
  return Math.min(1000, Math.max(0.001, TARGET_PEAK / peak));
}

export function peakOf(pcm) {
  let peak = 0;
  for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i]));
  return peak;
}

/** Apply gain and a short cosine fade-out so a note never ends in a click. */
export function finish(pcm, gain, sampleRate, fadeS = 0.04) {
  const out = new Float32Array(pcm.length);
  const fade = Math.min(pcm.length, Math.round(fadeS * sampleRate));
  for (let i = 0; i < pcm.length; i++) {
    const tail = pcm.length - i;
    const f = tail >= fade ? 1 : 0.5 - 0.5 * Math.cos((Math.PI * tail) / fade);
    out[i] = pcm[i] * gain * f;
  }
  return out;
}
