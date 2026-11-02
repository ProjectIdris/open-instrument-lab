// SPDX-License-Identifier: GPL-3.0-only
// The physics of one drum hit, for the drum engine: every mode of the head (and of a second head under it, with the
// air between them as a spring), a stick that is a mass on a Hertz contact, the sound as a close microphone's
// near-field integral of the head's acceleration, and the tension a big swing adds to the head (the pitch glide).
// Nothing here is fitted to a recording; every number is a size, a mass, a tension or a published property.
import {
  AIR_DENSITY, SOUND_SPEED, besselJ, besselZerosUpTo, addedMassFactor, modalMassFactor, radiationRate,
} from '../physics.mjs';

const COUPLED = 40; // axisymmetric modes of each head tied through the air between them
export const GAMMA_P0 = 1.42e5; // Pa: the air in a closed shell is a spring of this stiffness per volume (adiabatic, 1 atm)

// ---------------------------------------------------------------------------------------------------------------
// Modes of a circular membrane

const tables = new Map();
/** Every (m, n) with α up to maxAlpha, by rising α. Cached by the whole number above maxAlpha. */
export function modeTable(maxAlpha) {
  const key = Math.ceil(maxAlpha);
  if (tables.has(key)) return tables.get(key);
  const modes = [];
  for (let m = 0; m <= key; m++) {
    const zeros = besselZerosUpTo(m, key);
    if (!zeros.length && m > 4) break;
    zeros.forEach((alpha, i) => modes.push({ m, n: i + 1, alpha }));
  }
  modes.sort((a, b) => a.alpha - b.alpha);
  tables.set(key, modes);
  return modes;
}

const ratioCache = new Map();
/** Air mass over head mass for one face of the head and one mode: exact for the lowest, and for the rest the known fall as 1/α (Rayleigh, in the same integral). */
function airRatio(mode, radiusM, arealKgM2) {
  let ratio;
  if (mode.alpha < 12) {
    const key = `${mode.m},${mode.n}`;
    if (!ratioCache.has(key)) ratioCache.set(key, addedMassFactor(mode) / modalMassFactor(mode));
    ratio = ratioCache.get(key);
  } else {
    ratio = (1 + 1.1 / mode.alpha) / mode.alpha;
  }
  return ((AIR_DENSITY * radiusM) / arealKgM2) * ratio;
}

/**
 * The modes of one head: { m, n, alpha, hz, M (effective mass, air included), sigma (loss to heat and to radiated sound) }.
 * `faces` is 1 when the air on the far side is a closed cavity (handled elsewhere), 2 when both faces are in free air.
 * `loss` is { eta, rate, quad }: the film's loss factor (a fraction of the energy per cycle, so it grows with pitch), a
 * rate (per second) for what the rim, the lugs, a pillow or tape take whatever the pitch, and `quad`, a loss per second at 1 kHz
 * that grows as the pitch squared (a skin that holds its low modes and gives up its high ones; 0 for none).
 */
export function headModes({ radiusM, tensionNPerM, arealKgM2, faces, openDepthM = 0, loss, maxHz, maxModes }) {
  const a = radiusM;
  const c = Math.sqrt(tensionNPerM / arealKgM2);
  // there are about α²/4 modes below α, so the lowest `maxModes` of them end near 2·sqrt(maxModes)
  const alphaMax = Math.min((2 * Math.PI * a * maxHz * 1.02) / c, 2.1 * Math.sqrt(maxModes) + 8);
  const table = modeTable(Math.max(alphaMax, 6)).slice(0, maxModes);
  const out = [];
  for (const mode of table) {
    const ratio = airRatio(mode, a, arealKgM2) * faces;
    const hz = ((mode.alpha * c) / (2 * Math.PI * a)) / Math.sqrt(1 + ratio);
    if (hz > maxHz) continue;
    const M = arealKgM2 * a * a * modalMassFactor(mode) * (1 + ratio);
    // A head open at the back sends sound out of both faces, the rear one through the shell's open end a depth D behind
    // and opposite in sign: the two cancel where the wavelength is long against D (a dipole) and add where it is short.
    let radiated = radiationRate({ ...mode, hz, massKg: M }, { radiusM: a, sides: 1 });
    if (openDepthM > 0) {
      const kD = (2 * Math.PI * hz * openDepthM) / SOUND_SPEED;
      radiated *= 2 * (1 - Math.sin(kD) / kD);
    }
    out.push({ ...mode, hz, M, sigma: loss.rate + loss.eta * Math.PI * hz + (loss.quad ?? 0) * (hz / 1000) ** 2 + radiated, radiated });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// The close microphone: p = rho0/(2 pi) integral of the head's surface acceleration over R, no delay (valid while the
// path across the head is under a wavelength, an estimate above a few hundred hertz: said on the page).

// The integral over the head of (mode shape)/R is done in wavenumber space, where 1/R = ∫ J0(k s) e^(−k h) dk and the
// head's own Hankel transform is the closed form already used for the far field. For a mode (m, α) and a microphone
// at lateral distance x and height h:  ∫ shape/R dS = 2π a α J_{m+1}(α) ∫ J_m(κ) J_m(κ x/a) e^(−κ h/a) / (α² − κ²) dκ.
// The integrand is smooth and dies off as e^(−κ h/a) whatever the mode, so a coarse sum is exact; summing over the head
// instead would need ever finer steps as the modes rise and would get them wrong.

const grids = new Map();
const GRID_STEP = 0.08;
export function micGrid(radiusM, xM, hM) {
  const key = `${radiusM.toFixed(5)}|${xM.toFixed(5)}|${hM.toFixed(5)}`;
  if (grids.has(key)) return grids.get(key);
  const top = Math.min(900, (34 * radiusM) / Math.max(hM, 1e-4));
  const n = Math.ceil(top / GRID_STEP);
  const kappa = Float64Array.from({ length: n }, (_, i) => (i + 0.5) * GRID_STEP);
  const grid = { n, kappa, kappa2: Float64Array.from(kappa, (k) => k * k), byOrder: new Map(), radiusM, xM, hM };
  grids.set(key, grid);
  return grid;
}

function orderWeights(grid, m) {
  if (!grid.byOrder.has(m)) {
    const { n, kappa, radiusM, xM, hM } = grid;
    const w = new Float64Array(n);
    for (let i = 0; i < n; i++) w[i] = besselJ(m, kappa[i]) * besselJ(m, (kappa[i] * xM) / radiusM) * Math.exp((-kappa[i] * hM) / radiusM) * GRID_STEP;
    grid.byOrder.set(m, w);
  }
  return grid.byOrder.get(m);
}

/** ∫ shape/R dS for a mode, in metres: what one unit of its acceleration puts into the microphone (times ρ0/2π, left out; the host levels). */
export function micWeight(mode, radiusM, grid) {
  const w = orderWeights(grid, mode.m);
  const alpha2 = mode.alpha * mode.alpha;
  let sum = 0;
  for (let i = 0; i < grid.n; i++) sum += w[i] / (alpha2 - grid.kappa2[i]);
  return 2 * Math.PI * radiusM * mode.alpha * besselJ(mode.m + 1, mode.alpha) * sum;
}

// ---------------------------------------------------------------------------------------------------------------
// Symmetric eigenproblem, for the axisymmetric modes the air between two heads ties together

/** Cyclic Jacobi: A (n×n, symmetric, array of rows) to { values, vectors } with vectors[i][k] the i-th component of the k-th eigenvector. */
export function jacobiEigen(A) {
  const n = A.length;
  const a = A.map((row) => Float64Array.from(row));
  const v = Array.from({ length: n }, (_, i) => Float64Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += a[i][j] * a[i][j];
    if (off < 1e-26 * n * n) break;
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) < 1e-300) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const cs = 1 / Math.sqrt(t * t + 1);
        const sn = t * cs;
        for (let k = 0; k < n; k++) {
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = cs * akp - sn * akq;
          a[k][q] = sn * akp + cs * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p][k];
          const aqk = a[q][k];
          a[p][k] = cs * apk - sn * aqk;
          a[q][k] = sn * apk + cs * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k][p];
          const vkq = v[k][q];
          v[k][p] = cs * vkp - sn * vkq;
          v[k][q] = sn * vkp + cs * vkq;
        }
      }
    }
  }
  return { values: Array.from({ length: n }, (_, i) => a[i][i]), vectors: v };
}

// ---------------------------------------------------------------------------------------------------------------
// The stick

/** ∫₀¹ dx / √(1 − x^(p+1)): the shape factor of a contact of force κ δ^p, for the contact time. */
function contactShape(p) {
  const steps = 800;
  let sum = 0;
  for (let i = 0; i < steps; i++) {
    const s = (i + 0.5) / steps; // x = 1 − s², so the end point's inverse square root is smooth
    const x = 1 - s * s;
    sum += (2 * s) / Math.sqrt(Math.max(1e-300, 1 - x ** (p + 1)));
  }
  return sum / steps;
}

/** The stiffness κ (N/m^p) that gives a stick of this mass, speed and exponent a contact of this duration against a rigid wall. */
export function contactStiffness({ massKg, speed, p, timeS }) {
  const deepest = (timeS * speed) / (2 * contactShape(p));
  return ((p + 1) * massKg * speed * speed) / (2 * deepest ** (p + 1));
}

/** What a stick of this hardness (0 to 1) is: a soft felt mallet at 0, a hard nylon tip at 1. Round numbers of the kinds of stick, not a fit. */
export function stickOf(hardness) {
  const mix = (soft, hard) => soft * (hard / soft) ** hardness;
  return {
    massKg: mix(0.06, 0.02),
    tipRadiusM: mix(0.015, 0.003),
    p: 3 - 1.75 * hardness,
    contactTimeS: mix(0.006, 0.0015), // at the reference speed of 3 m/s
  };
}
export const REF_SPEED = 3;
export const stickSpeed = (velocity) => 0.3 + 2.7 * velocity;

// ---------------------------------------------------------------------------------------------------------------
// Building the whole drum: modes with their loss, how a unit force reaches them (G), and how their acceleration reaches the microphone (P)

/**
 * The drum's modes, with their loss and what they send to the microphone, independent of where it is struck (so a
 * drum is built once and struck many times).
 * @param d { radiusM, depthM, bottom: 'open' | 'closed' | 'head', batter: {tension, areal}, resonant: {tension, areal} | null,
 *            loss: { eta, rate } (the batter head's; `resonantRate` is the second head's rate, which has no pillow against it), mic: { heightM, offset }, maxHz, maxModes }
 * The second head is heard only through the batter head and the air between them: the shell shields the sound it
 * sends out of its own face, so it adds the coupled modes (and their pitches) but no pickup of its own.
 */
export function buildDrum(d) {
  const a = d.radiusM;
  const cavity = d.bottom !== 'open';
  const faces = cavity ? 1 : 2;
  const batter = headModes({ radiusM: a, tensionNPerM: d.batter.tension, arealKgM2: d.batter.areal, faces, openDepthM: cavity ? 0 : d.depthM, loss: d.loss, maxHz: d.maxHz, maxModes: d.maxModes });
  const resonant = d.bottom === 'head'
    ? headModes({ radiusM: a, tensionNPerM: d.resonant.tension, arealKgM2: d.resonant.areal, faces: 1, loss: { eta: d.loss.eta, rate: d.resonantRate ?? d.loss.rate }, maxHz: Math.min(d.maxHz, 4000), maxModes: 120 }).filter((m) => m.m === 0).slice(0, COUPLED)
    : [];
  const front = micGrid(a, a * d.mic.offset, d.mic.heightM);
  const shadow = d.mic.shadow ?? 0;
  const back = shadow > 0 && d.bottom === 'head' ? micGrid(a, a * d.mic.offset, d.mic.heightM + d.depthM) : null;
  // Components, in mass-normalised coordinates z = sqrt(M) q: the sweep of volume v (zero unless the mode moves the whole head), the pickup P (the surface acceleration toward the microphone is minus that of a head pushed in)
  const comps = [];
  for (const mode of batter) {
    comps.push({ head: 'batter', mode, omega2: (2 * Math.PI * mode.hz) ** 2, sigma: mode.sigma, P: -micWeight(mode, a, front) / Math.sqrt(mode.M), v: mode.m === 0 ? (2 * Math.PI * a * a * besselJ(1, mode.alpha)) / mode.alpha / Math.sqrt(mode.M) : 0 });
  }
  for (const mode of resonant) {
    comps.push({ head: 'resonant', mode, omega2: (2 * Math.PI * mode.hz) ** 2, sigma: mode.sigma, P: back ? (-shadow * micWeight(mode, a, back)) / Math.sqrt(mode.M) : 0, v: (2 * Math.PI * a * a * besselJ(1, mode.alpha)) / mode.alpha / Math.sqrt(mode.M) });
  }
  const entries = [];
  const single = (c, i) => ({ omega2: c.omega2, sigma: c.sigma, P: c.P, parts: [{ comp: i, w: 1 }], label: `(${c.mode.m},${c.mode.n})` });
  if (cavity) {
    // The air in a closed shell is a spring on the volume the heads sweep, so it ties all the axisymmetric modes together.
    // Only the lowest axisymmetric modes of each head are tied: a high one sweeps almost no volume, so the air's spring
    // barely moves it, and the tie is a matrix problem that grows with the cube of how many it holds.
    const taken = { batter: 0, resonant: 0 };
    const group = [];
    comps.forEach((c, i) => {
      if (c.mode.m === 0 && taken[c.head] < COUPLED) { taken[c.head]++; group.push(i); } else entries.push(single(c, i));
    });
    const kc = GAMMA_P0 / (Math.PI * a * a * d.depthM);
    const n = group.length;
    const A = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? comps[group[i]].omega2 : 0) + kc * comps[group[i]].v * comps[group[j]].v));
    const { values, vectors } = jacobiEigen(A);
    values.forEach((lambda, k) => {
      const parts = [];
      let P = 0;
      let sigma = 0;
      for (let i = 0; i < n; i++) {
        const w = vectors[i][k];
        P += w * comps[group[i]].P;
        sigma += w * w * comps[group[i]].sigma;
        if (Math.abs(w) > 1e-4) parts.push({ comp: group[i], w });
      }
      entries.push({ omega2: lambda, sigma, P, parts, label: `coupled ${k + 1}` });
    });
  } else {
    comps.forEach((c, i) => entries.push(single(c, i)));
  }
  const list = entries.filter((e) => e.omega2 > 0);
  return { comps, entries: list, radiusM: a, batterModes: batter, resonantModes: resonant, wire: d.wires && d.bottom === 'head' ? wireCoupling(d.wires.count, a, comps, list) : null };
}

/**
 * Where the snare wires touch the second head and how that head's displacement there, and a force on it there, reach
 * each coupled mode: S[j][i] is the displacement at wire j of unit z of the i-th mode that moves the second head, and
 * the same number is the force on that mode for unit force at the wire. The wires lie across the head, spread over
 * the middle nine tenths of a diameter (the head's whole-head modes are all that is kept of it).
 */
function wireCoupling(count, a, comps, entries) {
  const idx = [];
  entries.forEach((e, i) => { if (e.parts.some((p) => comps[p.comp].head === 'resonant')) idx.push(i); });
  const S = Array.from({ length: count }, (_, j) => {
    const rho = Math.abs(count === 1 ? 0 : (2 * j) / (count - 1) - 1) * 0.9;
    return Float64Array.from(idx, (i) => entries[i].parts.reduce((sum, p) => (comps[p.comp].head === 'resonant' ? sum + (p.w * besselJ(0, comps[p.comp].mode.alpha * rho)) / Math.sqrt(comps[p.comp].mode.M) : sum), 0));
  });
  return { idx: Int32Array.from(idx), S };
}

/** The drum struck at `strikeR` (fraction of the radius) and `strikeAngleRad` by a tip of radius `tipRadiusM`: each mode's weight G for a unit force. */
export function strikeDrum(drum, { strikeR, strikeAngleRad, tipRadiusM }) {
  const a = drum.radiusM;
  const shapeAt = drum.comps.map((c) => {
    if (c.head !== 'batter') return 0;
    const u = (c.mode.alpha * tipRadiusM) / a;
    const patch = u < 1e-6 ? 1 : (2 * besselJ(1, u)) / u;
    return (besselJ(c.mode.m, c.mode.alpha * strikeR) * (c.mode.m === 0 ? 1 : Math.cos(c.mode.m * strikeAngleRad)) * patch) / Math.sqrt(c.mode.M);
  });
  const modes = drum.entries.map((e) => {
    let G = 0;
    for (const { comp, w } of e.parts) G += w * shapeAt[comp];
    return { omega2: e.omega2, sigma: e.sigma, G, P: e.P, label: e.label };
  });
  return { modes, wire: drum.wire };
}

// ---------------------------------------------------------------------------------------------------------------
// One hit

/**
 * Render a hit. `drum` from strikeDrum; `stick` { massKg, p, kappa, speed }; `glideBeta` = E h / (2 T² A) for the film (0 for none);
 * `wires` { massKg, preloadN, pullEnds, stiffness, damping, gain } puts the snare wires on the second head, if the drum was built with them.
 * Returns the microphone's pressure (arbitrary scale) at `fs`.
 */
export function hit({ drum, stick, glideBeta, fs, seconds, report = null, wires = null }) {
  const modes = drum.modes;
  const K = modes.length;
  const dt = 1 / fs;
  const total = Math.round(seconds * fs);
  const out = new Float64Array(total);
  const om = Float64Array.from(modes, (m) => Math.sqrt(m.omega2));
  const sg = Float64Array.from(modes, (m) => m.sigma);
  const G = Float64Array.from(modes, (m) => m.G);
  const P = Float64Array.from(modes, (m) => m.P);
  const z = new Float64Array(K);
  const zd = new Float64Array(K);
  // propagator of one step for each mode (damped, exact), at a frequency scale `scale`
  const e = new Float64Array(K);
  const a11 = new Float64Array(K);
  const a12 = new Float64Array(K);
  const a21 = new Float64Array(K);
  const a22 = new Float64Array(K);
  const staticGain = new Float64Array(K); // 1/ω² for a force held over the step
  const setStep = (k, scale) => {
    const w = om[k] * scale;
    const wd = Math.sqrt(Math.max(w * w - sg[k] * sg[k], 1e-12));
    const ex = Math.exp(-sg[k] * dt);
    const c = Math.cos(wd * dt);
    const s = Math.sin(wd * dt);
    e[k] = ex;
    a11[k] = ex * (c + (sg[k] / wd) * s);
    a12[k] = (ex * s) / wd;
    a21[k] = (-ex * (w * w) / wd) * s;
    a22[k] = ex * (c - (sg[k] / wd) * s);
    staticGain[k] = 1 / (w * w);
  };
  for (let k = 0; k < K; k++) setStep(k, 1);

  // ---- the snare wires: each a mass pressed on the second head by its preload, held off it by the head when the head
  // moves away faster than the preload can follow, and landing on it again. Where the contact holds, the force on the
  // head is the wire's weight in the head's own motion; where it breaks and remakes, it is a click.
  const W = wires && drum.wire ? drum.wire : null;
  const nWire = W ? W.S.length : 0;
  const nCoupled = W ? W.idx.length : 0;
  const fk = new Float64Array(K); // force on each mode from the wires this step
  let wiresLive = Boolean(W);
  // A strainer holds its wires harder at the ends than in the middle: `pullEnds` is how many times harder the outermost
  // wire is held than the middle one (`preloadN`), so the tight ones land again at once and the loose ones keep rattling.
  const pullOf = Float64Array.from({ length: nWire }, (_, j) => (W ? wires.preloadN * (1 + ((wires.pullEnds ?? 1) - 1) * (nWire > 1 ? (2 * j / (nWire - 1) - 1) ** 2 : 0)) : 0));
  const wPos = Float64Array.from(pullOf, (f) => (W ? f / wires.stiffness : 0));
  const wVel = new Float64Array(nWire);
  const wPen = Float64Array.from(pullOf, (f) => (W ? f / wires.stiffness : 0));
  const wF = Float64Array.from(pullOf);
  const wFprev = Float64Array.from(pullOf);
  const uFree = new Float64Array(nWire);
  const p0 = new Float64Array(nWire);
  let Cs = null;
  // each wire is a coil: it rings at a few of its own pitches after every touch, and what the wires add to the sound is those rings
  // With `coilCount`, every wire has its own coilCount pitches, spread over coilLowHz..coilHighHz on a golden-ratio
  // sequence so that no two wires share one, and each dies in a few milliseconds: together a noise, not a chord.
  // Without it, every wire rings at the same few pitches of `coilHz`.
  const nRes = W ? (wires.coilCount ?? wires.coilHz.length) : 0;
  const frac = (x) => x - Math.floor(x);
  const ringOf = (j, r) => {
    const spread = wires.coilCount != null;
    const hz = spread ? wires.coilLowHz * (wires.coilHighHz / wires.coilLowHz) ** frac((j * nRes + r + 0.5) * 0.6180339887498949) : wires.coilHz[r];
    const wd = 2 * Math.PI * hz;
    const decay = Math.exp(-wires.coilSigma * dt);
    return { a1: 2 * decay * Math.cos(wd * dt), a2: -decay * decay, w: spread ? (hz / 4000) ** (wires.coilTilt ?? 0) : 1 - 0.15 * r };
  };
  const rings = Array.from({ length: nWire }, (_, j) => Array.from({ length: nRes }, (__, r) => ringOf(j, r)));
  const ringState = Array.from({ length: nWire }, () => new Float64Array(2 * nRes));
  let calm = 0;
  let resting = false;
  let tNow = 0;
  if (W) {
    Cs = Array.from({ length: nWire }, () => new Float64Array(nWire));
    for (let a1 = 0; a1 < nWire; a1++) {
      for (let b1 = 0; b1 < nWire; b1++) {
        let sum = 0;
        for (let q = 0; q < nCoupled; q++) { const k = W.idx[q]; sum += W.S[a1][q] * W.S[b1][q] * (1 - a11[k]) * staticGain[k]; }
        Cs[a1][b1] = sum;
      }
    }
  }
  /** One step of the wires against the head's present state. Fills fk, returns the sound the wires' own clicks give. */
  const stepWires = () => {
    const { massKg, stiffness, damping, gain } = wires;
    if (resting) {
      // the wires lie quiet on the head and only their rings are left
      let rest = 0;
      for (let j = 0; j < nWire; j++) {
        const st = ringState[j];
        for (let r = 0; r < nRes; r++) {
          const y0 = rings[j][r].a1 * st[2 * r] + rings[j][r].a2 * st[2 * r + 1];
          st[2 * r + 1] = st[2 * r];
          st[2 * r] = y0;
          rest += y0;
        }
      }
      if (rest * rest < 1e-14) wiresLive = false;
      return gain * rest;
    }
    const kEff = stiffness + damping / dt;
    for (let j = 0; j < nWire; j++) {
      let u = 0;
      for (let q = 0; q < nCoupled; q++) { const k = W.idx[q]; u += W.S[j][q] * (a11[k] * z[k] + a12[k] * zd[k]); }
      uFree[j] = u;
      p0[j] = wPos[j] + dt * wVel[j] + (dt * dt * pullOf[j]) / massKg - u;
    }
    for (let sweep = 0; sweep < 3; sweep++) {
      for (let j = 0; j < nWire; j++) {
        let rhs = p0[j];
        for (let l = 0; l < nWire; l++) if (l !== j) rhs -= Cs[j][l] * wF[l];
        const own = Cs[j][j] + (dt * dt) / massKg;
        const F = (kEff * rhs - (damping / dt) * wPen[j]) / (1 + kEff * own);
        wF[j] = F > 0 ? F : 0;
      }
    }
    let sound = 0;
    let touching = true;
    for (let j = 0; j < nWire; j++) {
      let uNew = uFree[j];
      for (let l = 0; l < nWire; l++) uNew += Cs[j][l] * wF[l];
      wVel[j] += (dt * (pullOf[j] - wF[j])) / massKg;
      wPos[j] += dt * wVel[j];
      wPen[j] = wPos[j] - uNew;
      const impulse = wF[j] - wFprev[j];
      const st = ringState[j];
      for (let r = 0; r < nRes; r++) {
        const y1 = st[2 * r];
        const y0 = rings[j][r].a1 * y1 + rings[j][r].a2 * st[2 * r + 1] + impulse * rings[j][r].w;
        st[2 * r + 1] = y1;
        st[2 * r] = y0;
        sound += y0;
      }
      wFprev[j] = wF[j];
      if (wF[j] === 0) touching = false;
    }
    for (let q = 0; q < nCoupled; q++) {
      let f = 0;
      for (let j = 0; j < nWire; j++) f += W.S[j][q] * wF[j];
      fk[W.idx[q]] = f;
    }
    if (report) {
      const bin = Math.floor((tNow * 1000) / fs);
      report.wireFlight ??= [];
      report.wireFlight[bin] = (report.wireFlight[bin] ?? 0) + wF.reduce((c, f) => c + (f === 0 ? 1 : 0), 0) / (fs / 1000);
    }
    calm = touching ? calm + 1 : 0;
    if (calm > 1500) { resting = true; fk.fill(0); }
    return gain * sound;
  };

  // ---- contact: the stick and the head move together until the stick has gone
  let s = 0;
  let sd = stick.speed;
  const contactSamples = Math.min(total, Math.round(0.03 * fs));
  let n = 0;
  let separated = 0;
  // The force of the step is found together with where the head and the stick end it (implicit), because a stiff contact
  // against the head's thousands of quick modes goes unstable if the force is read from where they started: the head
  // moves under a force F by F·compliance in this step, the stick by −F·dt²/m, and F must be the contact's force for
  // the gap left. One scalar equation, solved by halving.
  let compliance = 0;
  for (let k = 0; k < K; k++) compliance += G[k] * G[k] * (1 - a11[k]) * staticGain[k];
  const together = compliance + (dt * dt) / stick.massKg;
  for (; n < contactSamples; n++) {
    let usFree = 0;
    for (let k = 0; k < K; k++) usFree += G[k] * (a11[k] * z[k] + a12[k] * zd[k]);
    const gap0 = s + dt * sd - usFree;
    let F = 0;
    if (gap0 > 0) {
      let lo = 0;
      let hi = gap0 / together;
      for (let it = 0; it < 60; it++) {
        const mid = 0.5 * (lo + hi);
        const gap = gap0 - mid * together;
        if (mid - stick.kappa * gap ** stick.p > 0) hi = mid; else lo = mid;
      }
      F = 0.5 * (lo + hi);
    }
    tNow = n;
    let y = wiresLive ? stepWires() : 0;
    // The force is held over the step, so the acceleration is read at the step's end with that same force: a mode the
    // stick drives slowly then has no acceleration (its force and its spring cancel) instead of a step's worth of error.
    for (let k = 0; k < K; k++) {
      const f = G[k] * F + fk[k];
      const zt = z[k] - f * staticGain[k];
      z[k] = a11[k] * zt + a12[k] * zd[k] + f * staticGain[k];
      zd[k] = a21[k] * zt + a22[k] * zd[k];
      y += P[k] * (f - modes[k].omega2 * z[k] - 2 * sg[k] * zd[k]);
    }
    out[n] = y;
    sd -= (F / stick.massKg) * dt;
    s += sd * dt;
    // the stick has left the head for good once it is clear of it and still going away
    if (F === 0 && gap0 < -2e-3 && sd < 0) { separated++; if (separated > 20) { n++; break; } } else separated = 0;
  }

  if (report) {
    let energy = 0;
    for (let k = 0; k < K; k++) energy += 0.5 * (zd[k] * zd[k] + modes[k].omega2 * z[k] * z[k]);
    Object.assign(report, { contactMs: (n * 1000) / fs, headEnergyJ: energy, stickEnergyJ: 0.5 * stick.massKg * stick.speed * stick.speed, stickExitSpeed: sd });
  }

  // ---- free ringing, with the tension the head's own swing adds
  let amp = new Float64Array(K);
  let top = 0;
  for (let k = 0; k < K; k++) {
    amp[k] = Math.hypot(z[k], zd[k] / om[k]);
    top = Math.max(top, Math.abs(P[k]) * om[k] * om[k] * amp[k]);
  }
  const floor = top * 1e-6;
  // when each mode has faded below the floor, and the modes ordered so the longest-lived come first
  const endAt = new Int32Array(K);
  for (let k = 0; k < K; k++) {
    const loud = Math.abs(P[k]) * om[k] * om[k] * amp[k];
    endAt[k] = loud <= floor ? n : Math.min(total, n + Math.ceil(Math.log(loud / floor) / sg[k] / dt));
  }
  // the modes the wires push on keep going for as long as the wires might rattle
  if (W) for (let q = 0; q < nCoupled; q++) endAt[W.idx[q]] = total;
  const order = Array.from({ length: K }, (_, k) => k).sort((x, y) => endAt[y] - endAt[x]);
  let alive = order.length;
  const BLOCK = 32;
  let scale = 1;
  for (let b = n; b < total; b += BLOCK) {
    while (alive > 0 && endAt[order[alive - 1]] <= b) alive--;
    if (alive === 0) break;
    if (glideBeta > 0) {
      let energy = 0;
      for (let i = 0; i < alive; i++) { const k = order[i]; energy += 0.5 * (zd[k] * zd[k] + modes[k].omega2 * z[k] * z[k]); }
      const next = Math.sqrt(1 + glideBeta * energy);
      if (Math.abs(next - scale) > 1e-5 || b === n) { scale = next; for (let i = 0; i < alive; i++) setStep(order[i], scale); }
    }
    const stop = Math.min(total, b + BLOCK);
    for (let t = b; t < stop; t++) {
      tNow = t;
      let y = wiresLive ? stepWires() : 0;
      for (let i = 0; i < alive; i++) {
        const k = order[i];
        const w = om[k] * scale;
        const f = fk[k];
        y += P[k] * (f - w * w * z[k] - 2 * sg[k] * zd[k]);
        const zk = z[k];
        z[k] = a11[k] * zk + a12[k] * zd[k];
        zd[k] = a21[k] * zk + a22[k] * zd[k];
        if (f !== 0) { z[k] += f * (1 - a11[k]) * staticGain[k]; zd[k] -= f * a21[k] * staticGain[k]; }
      }
      out[t] = y;
    }
  }
  return out;
}
