// SPDX-License-Identifier: GPL-3.0-only
// The physics of one drum hit (engines/drum-bench/modes.mjs): the microphone's integral over the head, the eigen-solver
// that ties two heads through the air between them, the stick's contact, and a hit as a whole.
import test from 'node:test';
import assert from 'node:assert/strict';
import { besselJ, headTensionForHz, midiToHz } from '../engines/physics.mjs';
import {
  buildDrum, contactStiffness, headModes, hit, jacobiEigen, micGrid, micWeight, stickOf, stickSpeed, strikeDrum,
} from '../engines/drum-bench/modes.mjs';

const AREAL = 1390 * 190e-6;
const loss = { eta: 0.002, rate: 5 };

test('the microphone integral, done in wavenumber space, is the integral of the mode shape over 1/R done head-on', () => {
  const a = 0.15;
  const x = 0.1;
  const h = 0.12;
  const grid = micGrid(a, x, h);
  // modes of a clamped head: α is a zero of J_m
  const cases = [[0, 2.404825557695773], [1, 3.8317059702075123], [2, 5.135622301840683], [0, 5.520078110286311]];
  for (const [m, alpha] of cases) {
    const nr = 400;
    const nt = 512;
    let direct = 0;
    for (let i = 0; i < nr; i++) {
      const r = ((i + 0.5) / nr) * a;
      for (let k = 0; k < nt; k++) {
        const phi = (2 * Math.PI * (k + 0.5)) / nt;
        const dx = r * Math.cos(phi) - x;
        const dy = r * Math.sin(phi);
        direct += (besselJ(m, (alpha * r) / a) * Math.cos(m * phi) * r * (a / nr) * (2 * Math.PI / nt)) / Math.sqrt(dx * dx + dy * dy + h * h);
      }
    }
    const fast = micWeight({ m, alpha }, a, grid);
    assert.ok(Math.abs(fast / direct - 1) < 0.01, `mode (${m}, ${alpha.toFixed(2)}): ${fast} against ${direct}`);
  }
});

test('the Jacobi eigen-solver returns orthonormal vectors that satisfy A v = λ v', () => {
  const n = 14;
  let seed = 7;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  const A = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) for (let j = i; j < n; j++) { A[i][j] = rand(); A[j][i] = A[i][j]; }
  const { values, vectors } = jacobiEigen(A);
  for (let k = 0; k < n; k++) {
    let norm = 0;
    for (let i = 0; i < n; i++) {
      let av = 0;
      for (let j = 0; j < n; j++) av += A[i][j] * vectors[j][k];
      assert.ok(Math.abs(av - values[k] * vectors[i][k]) < 1e-9, `row ${i} of vector ${k}`);
      norm += vectors[i][k] ** 2;
    }
    assert.ok(Math.abs(norm - 1) < 1e-9);
    for (let l = 0; l < k; l++) {
      let dot = 0;
      for (let i = 0; i < n; i++) dot += vectors[i][k] * vectors[i][l];
      assert.ok(Math.abs(dot) < 1e-9);
    }
  }
});

test('a stick of the stiffness contactStiffness gives touches a rigid wall for the time asked, and a harder stick is lighter, smaller and quicker', () => {
  for (const hardness of [0.05, 0.5, 0.95]) {
    const stick = stickOf(hardness);
    const speed = 2.2;
    const timeS = 0.002 * (1 + hardness);
    const kappa = contactStiffness({ massKg: stick.massKg, speed, p: stick.p, timeS });
    // a mass on the contact spring against a wall, stepped finely
    const dt = timeS / 20000;
    let delta = 0;
    let v = speed;
    let t = 0;
    while (delta >= 0 && t < 10 * timeS) { v -= ((kappa * Math.max(delta, 0) ** stick.p) / stick.massKg) * dt; delta += v * dt; t += dt; }
    assert.ok(Math.abs(t / timeS - 1) < 0.02, `hardness ${hardness}: ${(t * 1000).toFixed(3)} ms for ${(timeS * 1000).toFixed(3)}`);
  }
  assert.ok(stickOf(0.95).massKg < stickOf(0.05).massKg && stickOf(0.95).tipRadiusM < stickOf(0.05).tipRadiusM && stickOf(0.95).contactTimeS < stickOf(0.05).contactTimeS);
});

function tomDrum(bottom, extra = {}) {
  const a = 0.1525;
  const depth = 0.23;
  const T = headTensionForHz(midiToHz(50), { arealKgM2: AREAL, radiusM: a, depthM: depth, closed: bottom !== 'open', mode: { m: 1, n: 1 } });
  return buildDrum({
    radiusM: a, depthM: depth, bottom, batter: { tension: T, areal: AREAL }, resonant: bottom === 'head' ? { tension: T, areal: AREAL } : null,
    loss, mic: { heightM: 0.12, offset: 0.65 }, maxHz: 6000, maxModes: 600, ...extra,
  });
}

test('a blow rings out: it is finite, it fades, the head keeps no more than the stick brought, and nothing but the stick\'s own speed rings the highest modes', () => {
  const drum = strikeDrum(tomDrum('open'), { strikeR: 0.5, strikeAngleRad: 0, tipRadiusM: 0.004 });
  const stick = stickOf(0.8);
  const speed = stickSpeed(0.7);
  const report = {};
  const pcm = hit({ drum, stick: { massKg: stick.massKg, p: stick.p, kappa: contactStiffness({ massKg: stick.massKg, speed, p: stick.p, timeS: stick.contactTimeS }), speed }, glideBeta: 0, fs: 44100, seconds: 1.5, report });
  assert.ok(pcm.every(Number.isFinite));
  assert.ok(report.headEnergyJ > 0 && report.headEnergyJ < report.stickEnergyJ, `${report.headEnergyJ} J kept of ${report.stickEnergyJ} J`);
  const rms = (a, b) => Math.sqrt(pcm.slice(a, b).reduce((s, v) => s + v * v, 0) / (b - a));
  assert.ok(rms(44100, 66150) < 0.5 * rms(2000, 22050), 'the second half-second is quieter than the first');
  // A blow read from the head's displacement at the old instant leaks the slow modes' force into the sound as a click
  // of unlimited brightness; read at the end of the step, the sound has almost nothing at the sampling rate's top.
  let top = 0;
  let all = 0;
  for (let i = 2; i < 6000; i++) { const d = pcm[i] - 2 * pcm[i - 1] + pcm[i - 2]; top += d * d; all += pcm[i] * pcm[i]; }
  assert.ok(top / all < 1e-3, `second-difference energy ${top / all}`);
});

test('a second head under the shell splits the whole-head mode in two: one that keeps the air\'s volume, at the pitch of a head alone, and one that squeezes it, higher', () => {
  const T = headTensionForHz(midiToHz(50), { arealKgM2: AREAL, radiusM: 0.1525, depthM: 0.23, closed: true, mode: { m: 1, n: 1 } });
  const one = headModes({ radiusM: 0.1525, tensionNPerM: T, arealKgM2: AREAL, faces: 1, loss, maxHz: 6000, maxModes: 200 }).find((m) => m.m === 0 && m.n === 1).hz;
  const two = tomDrum('head');
  const coupled = two.entries.filter((e) => e.label.startsWith('coupled')).map((e) => Math.sqrt(e.omega2) / (2 * Math.PI)).sort((x, y) => x - y);
  assert.ok(Math.abs(coupled[0] / one - 1) < 0.02, `${coupled[0]} Hz against a head alone at ${one} Hz`);
  assert.ok(coupled[1] > 1.1 * one, `${coupled[1]} Hz: the squeezing mode`);
  // the modes with a nodal diameter do not move the air's volume, so a second head leaves them where they were
  const open = tomDrum('closed').entries.filter((e) => e.label === '(1,1)')[0];
  const withHead = two.entries.filter((e) => e.label === '(1,1)')[0];
  assert.ok(Math.abs(Math.sqrt(open.omega2 / withHead.omega2) - 1) < 1e-9);
});

test('snare wires lift off the second head only where its motion beats their pull, and the rattle adds high sound', () => {
  const a = 0.178;
  const depth = 0.14;
  const areal2 = 1390 * 75e-6;
  const T = headTensionForHz(midiToHz(62), { arealKgM2: AREAL, radiusM: a, depthM: depth, closed: true, mode: { m: 1, n: 1 } });
  const built = buildDrum({
    radiusM: a, depthM: depth, bottom: 'head', batter: { tension: T, areal: AREAL }, resonant: { tension: T * 1.15, areal: areal2 },
    loss, mic: { heightM: 0.12, offset: 0.65 }, maxHz: 8000, maxModes: 800, wires: { count: 20 },
  });
  const struck = strikeDrum(built, { strikeR: 0.5, strikeAngleRad: 0, tipRadiusM: 0.004 });
  const stick = stickOf(0.8);
  const speed = stickSpeed(0.7);
  const hitStick = { massKg: stick.massKg, p: stick.p, kappa: contactStiffness({ massKg: stick.massKg, speed, p: stick.p, timeS: stick.contactTimeS }), speed };
  const wire = (preloadN) => ({ massKg: 3e-4, preloadN, stiffness: 2e6, damping: 2 * 0.3 * Math.sqrt(2e6 * 3e-4), gain: 0.35, coilHz: [2500, 4500, 7500, 11000], coilSigma: 25 });
  const play = (wires) => {
    const report = {};
    const pcm = hit({ drum: struck, stick: hitStick, glideBeta: 0, fs: 44100, seconds: 0.6, report, wires });
    return { pcm, flight: (report.wireFlight ?? []).reduce((s, v) => s + (v ?? 0), 0) };
  };
  const light = play(wire(0.008));
  const tight = play(wire(0.5));
  const bare = play(null);
  assert.ok(light.pcm.every(Number.isFinite) && tight.pcm.every(Number.isFinite));
  assert.ok(light.flight > 5, `a light pull lets the wires leave the head: ${light.flight.toFixed(1)} wire-ms in flight a ms`);
  assert.ok(tight.flight < 0.2 * light.flight, `a hard pull holds them down: ${tight.flight.toFixed(2)}`);
  const high = (pcm) => { let e = 0; for (let i = 2; i < pcm.length; i++) { const d = pcm[i] - 2 * pcm[i - 1] + pcm[i - 2]; e += d * d; } return e; };
  assert.ok(high(light.pcm) > 3 * high(bare.pcm), 'the rattle brings in high sound a bare drum does not have');
  assert.ok(high(light.pcm) > 3 * high(tight.pcm));
});

test('the second head is heard through the shell with the batter head\'s sign, so the pair moving against each other (the volume-conserving mode) is quieter at the microphone than with the second head ignored', () => {
  const lowest = (shadow) => {
    const built = tomDrum('head', { mic: { heightM: 0.12, offset: 0.65, shadow } });
    const struck = strikeDrum(built, { strikeR: 0.5, strikeAngleRad: 0, tipRadiusM: 0.004 });
    const first = struck.modes.filter((m) => m.label.startsWith('coupled')).sort((x, y) => x.omega2 - y.omega2)[0];
    return Math.abs(first.G * first.P);
  };
  assert.ok(lowest(1) < 0.7 * lowest(0), `${lowest(1)} against ${lowest(0)}`);
});
