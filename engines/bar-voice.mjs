// SPDX-License-Identifier: GPL-3.0-only
// What the two bar engines share: the mallet's blow, how a bar loses energy, and the sound a ringing mode sends out.
//
// Three things here were set from recordings of a real marimba (University of Iowa Musical Instrument Samples, a
// rosewood marimba struck with yarn, cord and rubber mallets), and from the Versilian vibraphone and chimes:
//   * the sound a bar makes follows how fast its surface is accelerating, not how fast it moves: each mode is sent out as
//     an acceleration, so a mode at four times the pitch comes out about 12 dB louder than the same motion at the note;
//   * wood loses a fixed share of its energy each cycle (a loss factor of about 0.0045), so each mode dies at a rate
//     proportional to its pitch; metal loses little at low pitch and much more at high pitch (a rate that grows as the pitch squared);
//   * the mallet's blow lasts about a millisecond for yarn, a little less for rubber, and a small fraction of that for a hard mallet.

export const SAMPLE_RATE = 44100;
// Accelerations come out in units of 1000 Hz (a mode at 1 kHz has an acceleration as big as its velocity), so the sound is
// of the size the host expects of an engine (a peak not far from 1) whatever the pitch.
export const ACCELERATION_UNIT = 1 / (2 * Math.PI * 1000);

// Contact time of the mallet, by hardness (0 soft … 1 hard), read off by interpolating the logarithm between anchors.
// Measured on the Iowa marimba: the yarn mallet (0.12) at 0.78 ms, from how fast the tenth partial falls away across the
// notes C3 to C4 (the loss of the tenth partial against the fourth), and the cord mallet at 0.69 ms the same way. The rubber
// mallet (0.4) is set at 0.53 ms from the ratio of rubber to yarn in the earlier fit of these recordings (0.68); its own
// partials could not fix it, as which partial a blow brings out depends on where it landed. Estimated, not measured: hard
// plastic (0.75) and brass (1) from the contact of a small hard sphere on wood and on steel (Hertz): a few tenths of a
// millisecond and about a tenth. The anchors are for a blow of speed 0.8.
const CONTACT = [[0, 0.85e-3], [0.12, 0.78e-3], [0.4, 0.53e-3], [0.75, 0.3e-3], [1, 0.1e-3]];
const REFERENCE_SPEED = 0.8;
/**
 * The contact law of the mallet: a force that grows as the squeeze to a power p. Over the contact the force has the shape
 * sin^p, and the contact time falls as the speed to the power (p-1)/(p+1). A hard mallet is the Hertz contact of two curved
 * surfaces, p = 1.5 (a speed power of 0.2); a covering of yarn is stiffer the harder it is pressed, p = 2.2 (0.375), which
 * puts the 14 dB the tenth partial of C4 loses in a blow 0.44 times as loud on the Iowa marimba (yarn, forte to mezzo-forte).
 * Between, p is taken to fall in a line.
 */
export const contactPower = (hardness) => {
  const h = Math.min(1, Math.max(0, hardness));
  return h <= 0.12 ? 2.2 : 2.2 - (0.7 * (h - 0.12)) / 0.88;
};
const speedPower = (h) => { const p = contactPower(h); return (p - 1) / (p + 1); };
export function contactTimeS(hardness, speed = REFERENCE_SPEED) {
  const h = Math.min(1, Math.max(0, hardness));
  let t = CONTACT.at(-1)[1];
  for (let i = 1; i < CONTACT.length; i++) {
    if (h <= CONTACT[i][0]) {
      const [h0, t0] = CONTACT[i - 1];
      const [h1, t1] = CONTACT[i];
      t = t0 * (t1 / t0) ** ((h - h0) / (h1 - h0));
      break;
    }
  }
  return t * (Math.max(speed, 0.05) / REFERENCE_SPEED) ** -speedPower(h);
}

/** The force of a mallet on a bar over its contact, sin^p (p = 1.5 for the Hertz contact of two curved surfaces), unit area. */
export function malletPulse(durationS, power = 1.5, rate = SAMPLE_RATE) {
  const n = Math.max(3, Math.round(durationS * rate));
  const pulse = new Float64Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) { pulse[i] = Math.sin((Math.PI * (i + 0.5)) / n) ** power; sum += pulse[i]; }
  for (let i = 0; i < n; i++) pulse[i] /= sum;
  return pulse;
}

// How a mode of frequency f loses amplitude, in 1/s (the amplitude falls as e^(-sigma t)):
//   sigma = support + pi * eta * f + squared * f^2
// `eta` is a loss factor (the share of energy lost per radian of a cycle), the one number for wood. Marimba: 0.0045 for
// the note, the fourth partial and the tenth, to within a quarter (Iowa, with the tube on the note adding to the note's). Metal bars measured only
// as aluminium (vibraphone) and steel tube (chimes): a small constant (the supports and the air) plus a part growing
// as the pitch squared, 0.5e-6 to 1.8e-6; the middle is taken. Polymer is a guess for a lossy plastic.
const LOSS = {
  wood: { support: 0, eta: 0.0045, squared: 0 },
  // Light, soft woods lose more than dense, hard ones: an estimate (the earlier engine took a bar of light wood to ring
  // about half as long as a dense one), not measured here.
  lightWood: { support: 0, eta: 0.009, squared: 0 },
  metal: { support: 0.3, eta: 0, squared: 1.0e-6 },
  polymer: { support: 0, eta: 0.03, squared: 0 },
};
/** The loss law of a bar: its family of material, and for wood whether it is light (under 550 kg/m3) or dense. */
export function lossModel(family, densityKgM3 = 700) {
  if (family === 'wood' && densityKgM3 < 550) return LOSS.lightWood;
  return LOSS[family] ?? LOSS.wood;
}
export const sigmaAt = (f, model) => model.support + Math.PI * model.eta * f + model.squared * f * f;

/**
 * The decay rates (1/s) of a bar's modes. The physical law above sets the rates; `ringTimeS` (60 dB fall of the
 * lowest mode, or 0 for the law's own) moves them all together by one factor, and `overtoneDamping` (0 to 1, 0.6
 * the real thing) scales how much faster than the note the overtones die: 0 for none, 1 for a third more than real.
 */
export function modeSigmas(frequencies, family, { ringTimeS = 0, overtoneDamping = 0.6, densityKgM3 = 700 } = {}) {
  const model = lossModel(family, densityKgM3);
  const f1 = frequencies[0];
  const own = sigmaAt(f1, model);
  const sigma1 = ringTimeS > 0 ? Math.log(1000) / ringTimeS : own;
  const scale = sigma1 / own;
  return frequencies.map((f) => (f === f1 ? sigma1 : sigma1 + (overtoneDamping / 0.6) * scale * (sigmaAt(f, model) - own)));
}

// ---------------------------------------------------------------------------------------------------------------
// The tube under a bar. The column of air in a closed tube is a second resonator at its own pitch. The bar pushes air in
// at the mouth and the air pushes back, so the two are coupled: a bar tuned to its tube shares its motion with the air,
// the pair rings as two lines a little apart, the air radiates through the open mouth, and the bar loses energy to the
// air sooner. The coupling is the dimensionless share K of the geometric mean of the two stiffnesses; Q is the tube's
// quality factor. All three numbers were set on the Iowa marimba: K 0.006 and Q 25 (the walls of a 35 mm pipe alone
// give a Q of 60 to 120, so the tube loses more than its walls) so that the note of a tubed bar falls away in the time
// recorded; the radiation so that the level of the overtones against the note comes out as recorded.
export const TUBE_COUPLING = 0.006;
export const TUBE_Q = 25;
// How much louder the air at the mouth is than the face of the bar, per unit of acceleration.
export const TUBE_RADIATION = 65;

function expm4(A, dt) {
  const n = 4;
  const M = A.map((row) => row.map((v) => v * dt));
  let term = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (__, j) => (i === j ? 1 : 0)));
  const sum = term.map((row) => row.slice());
  for (let k = 1; k <= 14; k++) {
    const next = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { let s = 0; for (let l = 0; l < n; l++) s += term[i][l] * M[l][j]; next[i][j] = s / k; }
    term = next;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) sum[i][j] += term[i][j];
  }
  return sum;
}

/**
 * Add the lowest mode of a bar over a tube: the bar mode (frequency f, decay sigma) coupled to the air column (frequency
 * `tubeHzValue`), the force pulse driving the bar, the sound being the bar's acceleration plus the air's, the air
 * counted `radiation` times as strongly.
 */
export function addTubedMode(out, { f, sigma, tubeHzValue, drive, listen, mouth, pulse, rate = SAMPLE_RATE, coupling = TUBE_COUPLING, q = TUBE_Q, radiation = TUBE_RADIATION }) {
  const wb = 2 * Math.PI * f;
  const wt = 2 * Math.PI * tubeHzValue;
  const st = wt / (2 * q);
  const o2 = coupling * wb * wt;
  const dt = 1 / rate;
  const A = [
    [0, 1, 0, 0],
    [-wb * wb, -2 * sigma, o2, 0],
    [0, 0, 0, 1],
    [o2, 0, -wt * wt, -2 * st],
  ];
  const E = expm4(A, dt);
  let s0 = 0; let s1 = 0; let s2 = 0; let s3 = 0;
  for (let i = 0; i < out.length; i++) {
    const kick = i < pulse.length ? pulse[i] : 0;
    s1 += kick;
    const n0 = E[0][0] * s0 + E[0][1] * s1 + E[0][2] * s2 + E[0][3] * s3;
    const n1 = E[1][0] * s0 + E[1][1] * s1 + E[1][2] * s2 + E[1][3] * s3;
    const n2 = E[2][0] * s0 + E[2][1] * s1 + E[2][2] * s2 + E[2][3] * s3;
    const n3 = E[3][0] * s0 + E[3][1] * s1 + E[3][2] * s2 + E[3][3] * s3;
    s0 = n0; s1 = n1; s2 = n2; s3 = n3;
    const aBar = -wb * wb * s0 - 2 * sigma * s1 + o2 * s2;
    const aAir = o2 * s0 - wt * wt * s2 - 2 * st * s3;
    out[i] += ACCELERATION_UNIT * drive * (listen * aBar + mouth * radiation * aAir);
  }
}

/**
 * Add one mode's acceleration to `out`. The mode rings at frequency `f` with amplitude decay `sigma`, driven by the
 * unit-area force `pulse` (scaled by `drive`) and heard through `listen`. A mode's response to a unit impulse is
 * e^(-sigma t) sin(wd t)/wd in displacement; its acceleration is the second derivative of that, which a one-pole
 * complex resonator gives exactly, a sample at a time.
 */
export function addModeAcceleration(out, { f, sigma, gain, pulse, rate = SAMPLE_RATE }) {
  gain *= ACCELERATION_UNIT;
  const w = 2 * Math.PI * f;
  const wd = Math.sqrt(Math.max(w * w - sigma * sigma, 1e-6));
  const dt = 1 / rate;
  const zr = Math.exp(-sigma * dt) * Math.cos(wd * dt);
  const zi = Math.exp(-sigma * dt) * Math.sin(wd * dt);
  // s^2 / wd, with s = -sigma + j wd
  const kr = (sigma * sigma - wd * wd) / wd;
  const ki = (-2 * sigma * wd) / wd;
  let ur = 0;
  let ui = 0;
  for (let i = 0; i < out.length; i++) {
    const nr = zr * ur - zi * ui + (i < pulse.length ? pulse[i] : 0);
    ui = zr * ui + zi * ur;
    ur = nr;
    out[i] += gain * (kr * ui + ki * ur);
  }
}
