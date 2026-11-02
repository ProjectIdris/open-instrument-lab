// SPDX-License-Identifier: GPL-3.0-only
// What a struck bar sounds like, checked against a recorded marimba (University of Iowa Musical Instrument Samples,
// a rosewood marimba struck with yarn, cord and rubber mallets) and the Versilian vibraphone. The numbers below are
// the ones those recordings gave, with the room a recording leaves in them allowed for; the recordings are not in this repository.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngines } from '../engines/registry.mjs';
import { normalizeNote, normalizeParams } from '../engines/schema.mjs';
import { barFrequencies } from '../engines/physics.mjs';
import { resolveMaterial } from '../engines/materials.mjs';

const { engines } = await loadEngines({ env: { STUDIO_ENGINE_DIRS: '' } });
const bars = engines.get('bars-bench');
const modal = engines.get('modal-bar');

const barParams = (patch) => normalizeParams(bars.schema, patch);
const renderBar = (patch, { velocity = 0.7, durationS = 3 } = {}) => {
  const p = barParams(patch);
  const note = normalizeNote({ midi: bars.describe(p).lowMidi, velocity, durationS }, bars.limits);
  return { ...bars.render(p, note), p };
};
const modes = (p) => barFrequencies({ ...resolveMaterial(p.barMaterial), lengthM: p.barLengthMm / 1000, thicknessM: p.barThicknessMm / 1000, undercut: p.barUndercut });

/** Amplitude of x at frequency hz over the window [t0, t1) seconds (a Hann-weighted single-bin transform). */
function amplitude(out, hz, t0, t1) {
  const a = Math.round(t0 * out.sampleRate);
  const b = Math.round(t1 * out.sampleRate);
  let re = 0; let im = 0;
  for (let i = a; i < b; i++) {
    const h = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i - a + 0.5)) / (b - a));
    const w = (2 * Math.PI * hz * i) / out.sampleRate;
    re += out.pcm[i] * h * Math.cos(w);
    im -= out.pcm[i] * h * Math.sin(w);
  }
  return (2 * Math.hypot(re, im)) / (b - a) * 2;
}
const dB = (v) => 20 * Math.log10(v);

/** Time (s) for the amplitude at hz to fall by `drop` dB from its first 60 ms, read in windows of 80 ms. */
function fallTime(out, hz, drop = 20) {
  const first = amplitude(out, hz, 0.02, 0.1);
  for (let t = 0.1; t < out.pcm.length / out.sampleRate - 0.1; t += 0.04) {
    if (dB(amplitude(out, hz, t, t + 0.08) / first) < -drop) return t + 0.04 - 0.06;
  }
  return Infinity;
}

const MAPLE_C3 = { barMaterial: 'sugar-maple', barLengthMm: 574, barThicknessMm: 22, barUndercut: 1, strikeAt: 0.44, malletHardness: 0.15 };
const MAPLE_C4_PLAIN = { barMaterial: 'sugar-maple', barLengthMm: 590, barThicknessMm: 20, barUndercut: 0, strikeAt: 0.38, malletHardness: 0.45 };

test('a low wooden bar rings on for seconds, as the marimba does (its note fell 20 dB in about a second in the recording, 60 dB in three)', () => {
  const out = renderBar({ ...MAPLE_C3, tubeFit: true, tubeLengthMm: 645 });
  const f1 = modes(out.p)[0];
  // the recording: the note of the C3 bar fell 20 dB in 1.1 s (yarn), 1.0 s (cord), 0.8 s (rubber)
  const t20 = fallTime(out, f1, 20);
  assert.ok(t20 > 0.8 && t20 < 1.5, `the note falls 20 dB in ${t20.toFixed(2)} s`);
});

test('wood loses the same share of its energy each cycle, so a bar an octave higher dies away twice as fast, and a metal bar rings far longer than a wooden one', () => {
  const low = renderBar(MAPLE_C4_PLAIN, { durationS: 4 });
  const high = renderBar({ ...MAPLE_C4_PLAIN, barThicknessMm: 40 }, { durationS: 4 }); // twice as thick: an octave up
  const fLow = modes(low.p)[0];
  const fHigh = modes(high.p)[0];
  assert.ok(Math.abs(fHigh / fLow - 2) < 0.01, `the second bar is an octave up (${(fHigh / fLow).toFixed(3)})`);
  const ratio = fallTime(low, fLow, 20) / fallTime(high, fHigh, 20);
  assert.ok(ratio > 1.6 && ratio < 2.5, `the lower bar rings ${ratio.toFixed(2)} times as long (recorded marimba C3 to C4: 2.0)`);
  const steel = renderBar({ barMaterial: 'steel-music-wire', barLengthMm: 250, barThicknessMm: 9, barUndercut: 0, strikeAt: 0.42, malletHardness: 0.5 }, { durationS: 4 });
  const wood = renderBar({ ...MAPLE_C4_PLAIN, barLengthMm: 590 });
  assert.ok(fallTime(steel, modes(steel.p)[0], 20) > 4 * fallTime(wood, modes(wood.p)[0], 20), 'steel rings at least four times as long');
});

// The shape of the n-th mode of a free bar along it (the engine's own formula), to find where two modes are taken and heard alike.
function shapeAt(x, u) {
  const s = (Math.cosh(x) - Math.cos(x)) / (Math.sinh(x) - Math.sin(x));
  return Math.cosh(x * u) + Math.cos(x * u) - s * (Math.sinh(x * u) + Math.sin(x * u));
}

test('what a bar radiates is its surface acceleration: two modes that take the blow and are heard alike differ by their pitch, not by nothing', async () => {
  const { BAR_ROOTS } = await import('../engines/physics.mjs');
  let at = 0.1;
  for (let u = 0.05; u <= 0.2; u += 0.0005) if (Math.abs(Math.abs(shapeAt(BAR_ROOTS[0], u)) - Math.abs(shapeAt(BAR_ROOTS[1], u))) < Math.abs(Math.abs(shapeAt(BAR_ROOTS[0], at)) - Math.abs(shapeAt(BAR_ROOTS[1], at)))) at = u;
  const p = { ...MAPLE_C4_PLAIN, malletHardness: 1, strikeAt: at, listenPosition: at };
  const out = renderBar(p, { velocity: 0.8, durationS: 0.5 });
  const f = modes(out.p);
  const first = amplitude(out, f[0], 0.003, 0.05);
  const second = amplitude(out, f[1], 0.003, 0.05);
  // as motion they would sound alike (less the faster fade of the second); as acceleration the second is f2/f1 = 8.8 dB louder, less about 1.4 dB of fade
  assert.ok(dB(second / first) > 5.5 && dB(second / first) < 10, `the second mode is ${dB(second / first).toFixed(1)} dB above the first (acceleration: ${dB(f[1] / f[0]).toFixed(1)} dB less the fade)`);
});

test('a soft yarn blow still carries the upper partials of a marimba bar, and a softer blow carries fewer', () => {
  const centroid = (out, t1 = 0.03) => {
    // spectral centroid of the first 30 ms, from a crude sweep over 100 Hz steps up to 8 kHz
    let num = 0; let den = 0;
    for (let hz = 100; hz <= 8000; hz += 100) { const a = amplitude(out, hz, 0, t1) ** 2; num += hz * a; den += a; }
    return num / den;
  };
  const loud = renderBar({ ...MAPLE_C3, tubeFit: true, tubeLengthMm: 645 }, { velocity: 0.95, durationS: 0.5 });
  const quiet = renderBar({ ...MAPLE_C3, tubeFit: true, tubeLengthMm: 645 }, { velocity: 0.4, durationS: 0.5 });
  // the recorded C3 yarn blow has its centroid near 1200 Hz in the first 30 ms; a sine at the note would have 131 Hz
  assert.ok(centroid(loud) > 600, `the first 30 ms of the blow have their centre at ${centroid(loud).toFixed(0)} Hz`);
  assert.ok(centroid(quiet) < 0.9 * centroid(loud), 'a softer blow is darker (it lasts longer on the bar)');
});

test('a tube under the plain-panel bar lifts its note over its overtones, as the marimba\'s does (4x partial 15 to 25 dB under the note in the recordings)', () => {
  const render = (resonator) => {
    const p = normalizeParams(modal.schema, { material: 'sugar-maple', undercut: 1, resonator, strikePosition: 0.44, malletHardness: 0.15, ringTime: 1.7 });
    return modal.render(p, normalizeNote({ midi: 48, velocity: 0.8, durationS: 1 }, modal.limits));
  };
  const f1 = 440 * 2 ** (-21 / 12);
  const level = (out) => dB(amplitude(out, 4 * f1, 0.01, 0.21) / amplitude(out, f1, 0.01, 0.21));
  const bare = level(render(false)); const tubed = level(render(true));
  assert.ok(bare - tubed > 20, `the 4x partial is ${bare.toFixed(0)} dB re the note bare and ${tubed.toFixed(0)} dB with the tube`);
  assert.ok(tubed < -10 && tubed > -30, `with the tube it sits where the recording has it (${tubed.toFixed(0)} dB)`);
});

test('the plain-panel bar rings for the time asked at middle C, longer lower down and shorter higher up', () => {
  const run = (midi) => {
    const p = normalizeParams(modal.schema, { material: 'sugar-maple', undercut: 0, ringTime: 1.7, malletHardness: 0.45 });
    const out = { ...modal.render(p, normalizeNote({ midi, velocity: 0.7, durationS: 5 }, modal.limits)) };
    const hz = 440 * 2 ** ((midi - 69) / 12);
    return fallTime(out, hz, 20);
  };
  const c3 = run(48); const c4 = run(60); const c5 = run(72);
  // 20 dB is a third of the time to fall 60 dB: 1.7 s at middle C is 0.57 s
  assert.ok(c4 > 0.45 && c4 < 0.7, `middle C falls 20 dB in ${c4.toFixed(2)} s`);
  assert.ok(c3 / c4 > 1.6 && c4 / c5 > 1.6, `an octave down rings about twice as long (${(c3 / c4).toFixed(2)}, ${(c4 / c5).toFixed(2)})`);
});
