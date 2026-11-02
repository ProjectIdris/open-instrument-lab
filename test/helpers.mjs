// SPDX-License-Identifier: GPL-3.0-only
// Shared by the engine tests.

/** Strongest frequency near `expected`, found by scanning a Hann-windowed DFT in cents. */
export function measuredPitch(pcm, sampleRate, expected) {
  const start = Math.round(0.02 * sampleRate);
  const n = Math.min(pcm.length - start, Math.round(0.6 * sampleRate));
  let best = { power: -1, hz: 0 };
  for (let cents = -150; cents <= 150; cents += 2) {
    const hz = expected * 2 ** (cents / 1200);
    let re = 0;
    let im = 0;
    for (let i = 0; i < n; i++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
      const phase = (2 * Math.PI * hz * i) / sampleRate;
      re += pcm[start + i] * w * Math.cos(phase);
      im += pcm[start + i] * w * Math.sin(phase);
    }
    const power = re * re + im * im;
    if (power > best.power) best = { power, hz };
  }
  return 1200 * Math.log2(best.hz / expected);
}
