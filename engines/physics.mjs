// SPDX-License-Identifier: GPL-3.0-only
// Plain physics shared by the engines (on the server) and the workbench (in the
// browser, where it is served as /shared/physics.mjs). Keeping it in one place
// means the pitch the bench shows while a hand is on a peg is the pitch the
// engine then renders.

export const A4_HZ = 440;
export const midiToHz = (midi) => A4_HZ * 2 ** ((midi - 69) / 12);
export const hzToMidi = (hz) => 69 + 12 * Math.log2(hz / A4_HZ);

const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
export const noteName = (midi) => `${NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;

/** The nearest note to a pitch (as a MIDI number with fractions) and how far off it is in cents. */
export function nearestNote(midiFloat) {
  const midi = Math.round(midiFloat);
  return { midi, name: noteName(midi), cents: Math.round((midiFloat - midi) * 100) };
}

// Wound strings are a thin core wrapped in wire. Two estimates, not measurements:
// the core carries the stiffness (about 44% of the outside diameter) and the
// wrap fills about 85% of the outer circle's mass.
export const WOUND_CORE_RATIO = 0.44;
export const WOUND_FILL = 0.85;

/** Mass per metre of a string, kg/m. */
export function linearDensity({ densityKgM3, diameterM, wound }) {
  return (wound ? WOUND_FILL : 1) * densityKgM3 * Math.PI * diameterM ** 2 / 4;
}

/** Resistance to stretching (N) and to bending (N·m²) of a string's stiff core. */
export function stringStiffness({ youngModulusPa, diameterM, wound }) {
  const core = wound ? diameterM * WOUND_CORE_RATIO : diameterM;
  return { axialN: youngModulusPa * Math.PI * core ** 2 / 4, bendingNm2: youngModulusPa * Math.PI * core ** 4 / 64 };
}

/** Frequency of a string of this length, tension, mass and bending stiffness. */
export function stringFrequencyHz({ lengthM, tensionN, linearDensityKgM, bendingNm2 = 0 }) {
  return Math.sqrt((tensionN + Math.PI ** 2 * bendingNm2 / lengthM ** 2) / linearDensityKgM) / (2 * lengthM);
}

/** The tension (N) that gives a wanted frequency. The inverse of stringFrequencyHz. */
export function tensionForHz({ lengthM, hz, linearDensityKgM, bendingNm2 = 0 }) {
  return linearDensityKgM * (2 * lengthM * hz) ** 2 - Math.PI ** 2 * bendingNm2 / lengthM ** 2;
}

/**
 * Everything the pitch of one string depends on, from its real measurements:
 * { densityKgM3, youngModulusPa, diameterMm, wound, tensionN, scaleLengthMm, stiffness }.
 */
export function stringPhysics({ densityKgM3, youngModulusPa, diameterMm, wound, tensionN, scaleLengthMm, stiffness = 1 }) {
  const diameterM = diameterMm / 1000;
  const lengthM = scaleLengthMm / 1000;
  const mu = linearDensity({ densityKgM3, diameterM, wound });
  const { axialN, bendingNm2 } = stringStiffness({ youngModulusPa, diameterM, wound });
  const bending = bendingNm2 * stiffness;
  const hz = stringFrequencyHz({ lengthM, tensionN, linearDensityKgM: mu, bendingNm2: bending });
  return { mu, axialN, bending, lengthM, hz, midi: hzToMidi(hz) };
}

/** Length of string that sounds when it is stopped at a fret (equal temperament). */
export const frettedLengthM = (scaleLengthM, fret) => scaleLengthM * 2 ** (-fret / 12);

/** Distance of fret number n from the nut. */
export const fretPositionM = (scaleLengthM, fret) => scaleLengthM - frettedLengthM(scaleLengthM, fret);

// ------------------------------------------------------------------ body outline

/**
 * The outline of a guitar-like body seen from the front, in metres. x runs from
 * the neck joint (0) to the tail end (lengthM); y is across, centred on 0.
 * Returns a closed polygon (points around the edge) and its area.
 */
export function bodyOutline({ lengthM, upperM, waistM, lowerM, waistAt }) {
  const shoulder = Math.min(0.075, upperM * 0.3);
  const pts = [
    [0, shoulder],
    [lengthM * 0.12, upperM * 0.4],
    [lengthM * 0.25, upperM / 2],
    [lengthM * waistAt, waistM / 2],
    [lengthM * (waistAt + (1 - waistAt) * 0.55), lowerM / 2],
    [lengthM * 0.95, lowerM * 0.34],
    [lengthM, 0],
  ];
  const half = pts.map(([x, y]) => [x, y]);
  const loop = [...half, ...half.slice(1, -1).reverse().map(([x, y]) => [x, -y]), [0, -shoulder]];
  // A closed Catmull-Rom spline through the points, so the edge is smooth.
  const out = [];
  const n = loop.length;
  for (let i = 0; i < n; i++) {
    const p0 = loop[(i - 1 + n) % n];
    const p1 = loop[i];
    const p2 = loop[(i + 1) % n];
    const p3 = loop[(i + 2) % n];
    for (let k = 0; k < 8; k++) {
      const t = k / 8;
      const t2 = t * t;
      const t3 = t2 * t;
      const c = (a, b, cc, d) => 0.5 * (2 * b + (-a + cc) * t + (2 * a - 5 * b + 4 * cc - d) * t2 + (-a + 3 * b - 3 * cc + d) * t3);
      out.push([c(p0[0], p1[0], p2[0], p3[0]), c(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  return { points: out, areaM2: polygonArea(out), anchors: half };
}

export function polygonArea(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

// ------------------------------------------------------------------ struck bars

// A bar lying free on two cords, hit by a mallet. Thin-beam (Euler–Bernoulli) theory: for a free-free bar
//   f_n = (λ_n / 2π) · (h / L²) · sqrt(E / (12 ρ))        λ_n = x_n² for a uniform bar (x_1 = 4.7300, 7.8532, 10.9956…)
// A bar carved on its underside (an arch) is worked out by Rayleigh–Ritz: the uniform bar's own modes are the
// trial shapes, and the carved bar's stiffness and mass are summed along its length. The mode ratios depend
// only on the arch, not on the bar's size or material, so they are worked out once per undercut and kept.
// It is thin-beam theory: it leaves out shear and rotary inertia (which matter for thick, short bars) and the
// small shift of the mode shapes the arch causes.

export const SOUND_SPEED = 343; // m/s, air at about 20 °C
/** Where a bar rests: the nodes of its first mode, as a fraction of its length from each end. */
export const BAR_NODE = 0.2242;
const BAR_BASIS = 10;
const BAR_GRID = 500;
const BAR_MODES = 6;

/** Roots of cos(x)cosh(x) = 1: x_n is the n-th bending mode of a free-free bar. */
function freeBarRoots(count) {
  const roots = [];
  for (let n = 1; n <= count; n++) {
    let x = ((2 * n + 1) * Math.PI) / 2;
    for (let i = 0; i < 60; i++) {
      const f = Math.cos(x) * Math.cosh(x) - 1;
      const df = -Math.sin(x) * Math.cosh(x) + Math.cos(x) * Math.sinh(x);
      const step = f / df;
      x -= step;
      if (Math.abs(step) < 1e-13 * x) break;
    }
    roots.push(x);
  }
  return roots;
}
export const BAR_ROOTS = freeBarRoots(BAR_BASIS);

// The trial shapes and their second derivatives on a grid across the bar (u = 0..1), unit mean square.
const basis = BAR_ROOTS.map((x) => {
  const s = (Math.cosh(x) - Math.cos(x)) / (Math.sinh(x) - Math.sin(x));
  const shape = new Float64Array(BAR_GRID);
  const curve = new Float64Array(BAR_GRID);
  let sum = 0;
  for (let g = 0; g < BAR_GRID; g++) {
    const u = (g + 0.5) / BAR_GRID;
    shape[g] = Math.cosh(x * u) + Math.cos(x * u) - s * (Math.sinh(x * u) + Math.sin(x * u));
    curve[g] = x * x * (Math.cosh(x * u) - Math.cos(x * u) - s * (Math.sinh(x * u) - Math.sin(x * u)));
    sum += shape[g] * shape[g];
  }
  const k = 1 / Math.sqrt(sum / BAR_GRID);
  for (let g = 0; g < BAR_GRID; g++) { shape[g] *= k; curve[g] *= k; }
  return { shape, curve };
});

/** Eigenvalues of K v = λ M v for symmetric K and positive-definite M (Cholesky, then Jacobi rotations), ascending. */
function generalisedEigenvalues(K, M) {
  const n = K.length;
  const L = Array.from({ length: n }, () => new Float64Array(n));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = M[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      L[i][j] = i === j ? Math.sqrt(s) : s / L[j][j];
    }
  }
  const solve = (B) => { // L X = B
    const X = Array.from({ length: n }, () => new Float64Array(n));
    for (let c = 0; c < n; c++) {
      for (let i = 0; i < n; i++) {
        let s = B[i][c];
        for (let k = 0; k < i; k++) s -= L[i][k] * X[k][c];
        X[i][c] = s / L[i][i];
      }
    }
    return X;
  };
  const transpose = (B) => Array.from(B[0], (_, j) => Float64Array.from(B, (row) => row[j]));
  const A = solve(transpose(solve(K))); // L⁻¹ K L⁻ᵀ
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += A[p][q] ** 2;
    if (off < 1e-24) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(A[p][q]) < 1e-300) continue;
        const theta = (A[q][q] - A[p][p]) / (2 * A[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) { const a = A[k][p]; const b = A[k][q]; A[k][p] = c * a - s * b; A[k][q] = s * a + c * b; }
        for (let k = 0; k < n; k++) { const a = A[p][k]; const b = A[q][k]; A[p][k] = c * a - s * b; A[q][k] = s * a + c * b; }
      }
    }
  }
  return A.map((row, i) => row[i]).sort((a, b) => a - b);
}

/** λ_n (n = 1…6) of a bar whose thickness along it is `profile(u)` times its full thickness. A uniform bar gives x_n². */
function barEigenvalues(profile) {
  const n = BAR_BASIS;
  const K = Array.from({ length: n }, () => new Float64Array(n));
  const M = Array.from({ length: n }, () => new Float64Array(n));
  for (let g = 0; g < BAR_GRID; g++) {
    const h = profile((g + 0.5) / BAR_GRID);
    const stiff = h ** 3 / BAR_GRID;
    const mass = h / BAR_GRID;
    for (let i = 0; i < n; i++) {
      for (let j = i; j < n; j++) {
        K[i][j] += stiff * basis[i].curve[g] * basis[j].curve[g];
        M[i][j] += mass * basis[i].shape[g] * basis[j].shape[g];
      }
    }
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) { K[i][j] = K[j][i]; M[i][j] = M[j][i]; }
  return generalisedEigenvalues(K, M).slice(0, BAR_MODES).map((l) => Math.sqrt(Math.max(l, 0)));
}

/**
 * The carved arch. A bar's underside is cut away in a parabola across the middle (its width on each side of
 * the centre is ARCH_HALF_WIDTH of the bar's length, about out to the cords). `undercut` is 0 for a plain bar
 * and 1 for the depth that tunes the first overtone to two octaves above the note (4 × the note): the marimba maker's
 * aim. Between, the depth is in proportion. The thickness there is a fraction of the bar's full thickness.
 */
export const ARCH_HALF_WIDTH = 0.3;
export function archThickness(undercut, u, fullDepth = ARCH_FULL_DEPTH) {
  const t = Math.abs(u - 0.5) / ARCH_HALF_WIDTH;
  return 1 - undercut * fullDepth * (t < 1 ? 1 - t * t : 0);
}
const archEigen = (depth) => barEigenvalues((u) => archThickness(1, u, depth));

/** The arch depth (a fraction of the thickness, at the middle) that puts the first overtone at 4 × the note. */
function findFullDepth() {
  let lo = 0;
  let hi = 0.95;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const l = archEigen(mid);
    if (l[1] / l[0] < 4) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}
export const ARCH_FULL_DEPTH = findFullDepth();

const eigenCache = new Map();
/** λ_1…λ_6 for a bar with this undercut (0…1); the same for every bar size and material. */
export function barLambdas(undercut) {
  const key = Math.round(Math.min(1, Math.max(0, undercut)) * 1000);
  let found = eigenCache.get(key);
  if (!found) {
    found = barEigenvalues((u) => archThickness(key / 1000, u));
    eigenCache.set(key, found);
    if (eigenCache.size > 2000) eigenCache.delete(eigenCache.keys().next().value);
  }
  return found;
}

/** The modes of a bar, Hz, lowest first (six of them): { densityKgM3, youngModulusPa, lengthM, thicknessM, undercut }. */
export function barFrequencies({ densityKgM3, youngModulusPa, lengthM, thicknessM, undercut = 0 }) {
  const scale = (thicknessM / lengthM ** 2) * Math.sqrt(youngModulusPa / (12 * densityKgM3)) / (2 * Math.PI);
  return barLambdas(undercut).map((l) => l * scale);
}

/** The length (m) a bar of this thickness, material and undercut must be for its first mode to sound at `hz`. */
export function barLengthForHz({ hz, densityKgM3, youngModulusPa, thicknessM, undercut = 0 }) {
  const scale = thicknessM * Math.sqrt(youngModulusPa / (12 * densityKgM3)) / (2 * Math.PI);
  return Math.sqrt((barLambdas(undercut)[0] * scale) / hz);
}

// A resonator tube is a pipe closed at the far end, hanging under the bar: a quarter-wave resonance.
export const TUBE_RADIUS_M = 0.0175;
export const tubeHz = (lengthM, radiusM = TUBE_RADIUS_M) => SOUND_SPEED / (4 * (lengthM + 0.6 * radiusM));
export const tubeLengthForHz = (hz, radiusM = TUBE_RADIUS_M) => SOUND_SPEED / (4 * hz) - 0.6 * radiusM;

// ---------------------------------------------------------------------------------------------------------------
// Circular drum heads (membranes). A head of mass per area σ under tension T per length has modes (m, n) with m
// nodal diameters and n−1 nodal circles, at f = α_mn/(2πa)·√(T/σ), where α_mn is the n-th zero of the Bessel
// function J_m. Air changes this a lot for a light head: the air that has to move with it adds mass, and a closed
// shell adds an air spring. Both are worked out here from the mode shapes (see addedMassFactor), not fitted.

export const AIR_DENSITY = 1.2; // kg/m³, air at about 20 °C

/**
 * Bessel function of the first kind, whole order m ≥ 0. Miller's downward recurrence from far above the order and the
 * argument, fixed by J₀ + 2(J₂ + J₄ + …) = 1; good to rounding for any argument, and cheap enough to call by the million.
 */
export function besselJ(m, x) {
  const ax = Math.abs(x);
  if (ax < 1e-14) return m === 0 ? 1 : 0;
  const reach = Math.max(m, ax);
  const start = 2 * Math.ceil((reach + 14 + 2 * Math.sqrt(reach + 10)) / 2);
  let above = 0;
  let here = 1;
  let sum = 0;
  let found = 0;
  for (let k = start; k >= 1; k--) {
    const below = ((2 * k) / ax) * here - above;
    above = here;
    here = below;
    if (Math.abs(here) > 1e100) { here *= 1e-100; above *= 1e-100; sum *= 1e-100; found *= 1e-100; }
    const order = k - 1;
    if (order === m) found = here;
    if (order % 2 === 0) sum += order === 0 ? here : 2 * here;
  }
  const value = found / sum;
  return x < 0 && m % 2 === 1 ? -value : value;
}

/** Every positive zero of J_m up to maxAlpha, in order. */
export function besselZerosUpTo(m, maxAlpha) {
  const zeros = [];
  const step = 0.1;
  let x = Math.max(0.1, m * 0.8);
  let f0 = besselJ(m, x);
  while (x < maxAlpha) {
    const x1 = Math.min(x + step, maxAlpha + step);
    const f1 = besselJ(m, x1);
    if (f0 * f1 < 0) {
      let lo = x;
      let hi = x1;
      let flo = f0;
      for (let k = 0; k < 50; k++) {
        const mid = 0.5 * (lo + hi);
        const fm = besselJ(m, mid);
        if (flo * fm <= 0) hi = mid; else { lo = mid; flo = fm; }
      }
      const zero = 0.5 * (lo + hi);
      if (zero <= maxAlpha) zeros.push(zero);
    }
    x = x1;
    f0 = f1;
  }
  return zeros;
}

/** The n-th positive zero of J_m (n from 1). */
export function besselZero(m, n) {
  let x = 0.5 + 0.25 * m;
  let f0 = besselJ(m, x);
  let found = 0;
  const step = 0.05;
  for (let guard = 0; guard < 4000; guard++) {
    const x1 = x + step;
    const f1 = besselJ(m, x1);
    if (f0 * f1 < 0) {
      found++;
      if (found === n) {
        let lo = x;
        let hi = x1;
        for (let k = 0; k < 60; k++) {
          const mid = 0.5 * (lo + hi);
          if (besselJ(m, lo) * besselJ(m, mid) <= 0) hi = mid; else lo = mid;
        }
        return 0.5 * (lo + hi);
      }
    }
    x = x1;
    f0 = f1;
  }
  throw new Error(`no zero ${n} of J_${m}`);
}

/** The lowest modes of a circular membrane: [{ m, n, alpha }] by rising α. m up to 5, n up to 4, `count` of them. */
export const MEMBRANE_MODES = (() => {
  const all = [];
  for (let m = 0; m <= 5; m++) for (let n = 1; n <= 4; n++) all.push({ m, n, alpha: besselZero(m, n) });
  return all.sort((a, b) => a.alpha - b.alpha).slice(0, 18);
})();

// Shape of a mode far away and just in front of it: the same integral serves the added mass of the air and the sound
// that leaves. I(κ) = ∫₀¹ x J_m(αx) J_m(κx) dx, in closed form because J_m(α) = 0.
function hankelI(m, alpha, jNext, kappa) {
  if (Math.abs(kappa - alpha) < 1e-7) return 0.5 * jNext * jNext;
  return (alpha * jNext * besselJ(m, kappa)) / (alpha * alpha - kappa * kappa);
}

/** The mode's far-field factor at kappa = k·a·sin(elevation): ∫ of the shape over the head, by Hankel transform. */
export function farFieldFactor(mode, kappa) {
  return hankelI(mode.m, mode.alpha, besselJ(mode.m + 1, mode.alpha), kappa);
}

const addedCache = new Map();

/**
 * The mass of air one side of the head carries along with a mode, as a multiple of ρ·a³ (Rayleigh's incompressible
 * limit, the head in a flat baffle). For a piston of the same radius this gives the known 8/3. Worked out by a
 * Hankel-transform integral over the mode shape.
 */
export function addedMassFactor({ m, n, alpha }) {
  const key = `${m},${n}`;
  if (addedCache.has(key)) return addedCache.get(key);
  const jNext = besselJ(m + 1, alpha);
  const top = 80;
  const steps = 6000;
  const h = top / steps;
  let sum = 0;
  for (let i = 0; i < steps; i++) {
    const kappa = (i + 0.5) * h;
    const v = hankelI(m, alpha, jNext, kappa);
    sum += v * v;
  }
  const value = (m === 0 ? 2 * Math.PI : Math.PI) * sum * h;
  addedCache.set(key, value);
  return value;
}

/** The mass of the head that moves with a mode, as a multiple of σ·a². */
export const modalMassFactor = ({ m, alpha }) => (m === 0 ? Math.PI : Math.PI / 2) * besselJ(m + 1, alpha) ** 2;

/**
 * The modes of a head. `closed` puts an air spring behind it (a shell closed by a second head or a bowl, `depthM`
 * deep), where an open shell leaves both faces to the air. Returns [{ m, n, alpha, hz, vacuumHz, loading }] by rising pitch.
 */
export function membraneModes({ tensionNPerM, arealKgM2, radiusM, depthM = 0.15, closed = false, airDensity = AIR_DENSITY }) {
  const a = radiusM;
  const modes = MEMBRANE_MODES.map((mode) => {
    const { m, alpha } = mode;
    const omega0Sq = (alpha / a) ** 2 * (tensionNPerM / arealKgM2);
    const massHead = arealKgM2 * a * a * modalMassFactor(mode);
    const massAir = airDensity * a ** 3 * addedMassFactor(mode) * (closed ? 1 : 2);
    let stiffness = massHead * omega0Sq;
    if (closed && m === 0) {
      const volumeFlow = 2 * Math.PI * a * a * besselJ(1, alpha) / alpha; // ∫ of the shape over the head
      stiffness += airDensity * SOUND_SPEED * SOUND_SPEED * volumeFlow * volumeFlow / (Math.PI * a * a * depthM);
    }
    const hz = Math.sqrt(stiffness / (massHead + massAir)) / (2 * Math.PI);
    return { ...mode, hz, vacuumHz: Math.sqrt(omega0Sq) / (2 * Math.PI), loading: massAir / massHead, massKg: massHead + massAir };
  });
  return modes.sort((x, y) => x.hz - y.hz);
}

/**
 * How fast a mode loses amplitude to the sound it sends out of the front of the head (per second), for a head of
 * this radius in a baffle: the radiated power over twice the energy. Worked from the same far-field factor that
 * gives the sound, summed over the half-space in front. `sides` is 2 for a head open at the back (both faces radiate).
 */
export function radiationRate(mode, { radiusM, sides = 1, airDensity = AIR_DENSITY }) {
  const k = (2 * Math.PI * mode.hz) / SOUND_SPEED;
  const jNext = besselJ(mode.m + 1, mode.alpha);
  const steps = 90;
  let sum = 0;
  for (let i = 0; i < steps; i++) {
    const theta = ((i + 0.5) * Math.PI) / (2 * steps);
    const v = hankelI(mode.m, mode.alpha, jNext, k * radiusM * Math.sin(theta));
    sum += v * v * Math.sin(theta);
  }
  const integral = (sum * Math.PI) / (2 * steps);
  const azimuth = mode.m === 0 ? 2 * Math.PI : Math.PI;
  const omega = 2 * Math.PI * mode.hz;
  return (sides * omega * omega * airDensity * radiusM ** 4 * azimuth * integral) / (2 * SOUND_SPEED * mode.massKg);
}

/** The tension per length (N/m) at which the lowest mode of this head (or `mode`, {m, n}) sounds at `hz`, found by halving. */
export function headTensionForHz(hz, { arealKgM2, radiusM, depthM = 0.15, closed = false, mode = null }) {
  let lo = 1;
  let hi = 1e6;
  for (let i = 0; i < 60; i++) {
    const mid = Math.sqrt(lo * hi);
    const modes = membraneModes({ tensionNPerM: mid, arealKgM2, radiusM, depthM, closed });
    const f = (mode ? modes.find((x) => x.m === mode.m && x.n === mode.n) : modes[0]).hz;
    if (f < hz) lo = mid; else hi = mid;
  }
  return Math.sqrt(lo * hi);
}
