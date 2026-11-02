// SPDX-License-Identifier: GPL-3.0-only
// How fast the partials of a plucked string die away.
//
// Measured on the recordings the presets are compared with (the Meta steel
// guitar, the Guitar-TECHS DI electric and the Karoryfer picked bass), the rate
// at which a partial's amplitude falls, in nepers per second, grows in
// proportion to its frequency: a small steady loss that every partial has
// (air drag, the end of the string) plus a loss that is the same fraction of
// each cycle at every frequency (friction in the wire and wrap, the bridge and
// the body). On the steel guitar it did not depend on which string was
// plucked: at 250 to 500 Hz the median rate was 0.9 per second on every
// string from 1.35 mm to 0.3 mm thick.
//
//     rate(f) = steady + perCycle * f           (nepers per second, f in kHz)
//     T60(f)  = ln(1000) / rate(f)               (seconds for the partial to fall 60 dB)
//
// The coefficients below are those fits.

/** Loss laws by instrument kind: { steady (1/s), perKHz (1/s per kHz) }. */
export const LOSS_LAWS = {
  // Meta steel guitar, mf layer, partial decay of 18 notes on all six strings: 0.9/s near 300 Hz, 1.4 near 750 Hz, 2.3 near 1.5 kHz, 4.5 near 3 kHz.
  acoustic: { steady: 0.45, perKHz: 1.3 },
  // Guitar-TECHS DI electric, player 1, six strings: about 1.5/s near 400 Hz and 3/s near 1 to 4 kHz, so a higher steady loss and a gentler slope.
  electric: { steady: 1.1, perKHz: 1.0 },
  // Karoryfer picked bass: 0.5/s near 100 Hz, 0.9/s near 200 Hz, 2.6/s near 500 Hz, 3.3/s near 1 kHz.
  bass: { steady: 0.2, perKHz: 3.0 },
};

/**
 * Nylon, measured on the Meta nylon guitar, fingertip layer, 28 notes on all six strings (CC0): the partials of the three plain
 * nylon strings fall at about 1.7 nepers/s near 400 Hz, 2.9 near 750, 4.9 near 1.5 kHz and 7.1 near 3 kHz; the three wound strings
 * (silver over a nylon floss core) at 1.1, 1.6, 2.7 and 4.7, about the same as the steel guitar's. Above 3 kHz both flatten,
 * where the recordings' floor stops the measurement, so the fit is to 3 kHz.
 */
export const NYLON_LAW = { steady: 0.7, perKHz: 2.8 };
export const NYLON_WOUND_LAW = { steady: 0.5, perKHz: 1.4 };

const LN1000 = Math.log(1000);

/** The fall rate (1/s) of a partial at `hz` for a law, with the player-facing scalers applied. */
export function lossRate(law, hz, { ringTime = 1, brightnessFactor = 1 } = {}) {
  return (law.steady + law.perKHz * brightnessFactor * (hz / 1000)) / ringTime;
}

/**
 * The T60 (seconds) of partials 1 to 24 of a string whose fundamental is `f0`,
 * in the form the string model takes (`loss.partialT60S`). Partials above
 * 0.42 of the sample rate are left to the model's own roll-off.
 */
export function partialT60s(law, f0, sampleRate, scalers = {}) {
  const count = Math.max(1, Math.min(24, Math.floor((0.42 * sampleRate) / f0)));
  return Array.from({ length: count }, (_, i) => LN1000 / lossRate(law, (i + 1) * f0, scalers));
}
