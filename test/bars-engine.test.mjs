// SPDX-License-Identifier: GPL-3.0-only
// The bars workbench engine and the bar physics under it: pitch from geometry, the carved arch, the tube.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngines } from '../engines/registry.mjs';
import { normalizeInstrument, normalizeNote, normalizeParams } from '../engines/schema.mjs';
import {
  BAR_ROOTS, ARCH_FULL_DEPTH, barFrequencies, barLambdas, barLengthForHz, tubeHz, tubeLengthForHz, hzToMidi, midiToHz,
} from '../engines/physics.mjs';
import { resolveMaterial } from '../engines/materials.mjs';

const { engines } = await loadEngines({ env: { STUDIO_ENGINE_DIRS: '' } });
const bars = engines.get('bars-bench');

const MAPLE = { densityKgM3: 705.6, youngModulusPa: 13.9e9 };

test('a plain bar sounds at the thin-beam frequencies, whatever its size', () => {
  const lambda = barLambdas(0);
  BAR_ROOTS.slice(0, 5).forEach((x, i) => assert.ok(Math.abs(lambda[i] / (x * x) - 1) < 1e-3, `mode ${i + 1}: ${lambda[i]} against ${x * x}`));
  // the closed form for the note, as the older single-bar engine has it
  const { densityKgM3: rho, youngModulusPa: young } = MAPLE;
  const f1 = (BAR_ROOTS[0] ** 2 / (2 * Math.PI)) * (0.019 / 0.4 ** 2) * Math.sqrt(young / (12 * rho));
  const got = barFrequencies({ ...MAPLE, lengthM: 0.4, thicknessM: 0.019, undercut: 0 });
  assert.ok(Math.abs(got[0] / f1 - 1) < 1e-3);
  // twice as thick is an octave up; half as long is two octaves up
  const thick = barFrequencies({ ...MAPLE, lengthM: 0.4, thicknessM: 0.038, undercut: 0 });
  const short = barFrequencies({ ...MAPLE, lengthM: 0.2, thicknessM: 0.019, undercut: 0 });
  assert.ok(Math.abs(thick[0] / got[0] - 2) < 1e-9);
  assert.ok(Math.abs(short[0] / got[0] - 4) < 1e-9);
});

test('the full arch puts the first overtone at two octaves above the note, and carving lowers the note', () => {
  const plain = barLambdas(0);
  const full = barLambdas(1);
  assert.ok(Math.abs(full[1] / full[0] - 4) < 0.002, `first overtone at ${full[1] / full[0]} × the note`);
  assert.ok(full[2] / full[0] > 8.8 && full[2] / full[0] < 9.6, `second overtone at ${full[2] / full[0]} × the note, near a marimba's 10`);
  assert.ok(full[0] < 0.6 * plain[0], 'a full arch takes the note well down');
  assert.ok(ARCH_FULL_DEPTH > 0.4 && ARCH_FULL_DEPTH < 0.7);
  // between the two, each step moves the first overtone closer to 4
  let last = plain[1] / plain[0];
  for (let u = 0.1; u <= 1.001; u += 0.1) {
    const l = barLambdas(u);
    assert.ok(l[1] / l[0] > last - 1e-9, `undercut ${u.toFixed(1)}`);
    last = l[1] / l[0];
  }
});

test('cutting a bar to a note gives that note, for any material, thickness and arch', () => {
  const steel = { densityKgM3: 7750, youngModulusPa: 206.8e9 };
  for (const [mat, h, cut] of [[MAPLE, 0.019, 0], [MAPLE, 0.022, 0.6], [steel, 0.006, 0], [steel, 0.012, 1]]) {
    const hz = midiToHz(72);
    const lengthM = barLengthForHz({ hz, ...mat, thicknessM: h, undercut: cut });
    const got = barFrequencies({ ...mat, lengthM, thicknessM: h, undercut: cut })[0];
    assert.ok(Math.abs(got / hz - 1) < 1e-9);
  }
  // a stiffer, lighter material for the same note is a longer bar
  const lm = barLengthForHz({ hz: 523, ...MAPLE, thicknessM: 0.02 });
  const ls = barLengthForHz({ hz: 523, densityKgM3: 7750, youngModulusPa: 206.8e9, thicknessM: 0.02 });
  assert.ok(ls > lm);
});

test('a tube rings at a quarter wave, and its length is worked out from the pitch it should have', () => {
  assert.ok(Math.abs(tubeHz(tubeLengthForHz(440)) - 440) < 1e-9);
  assert.ok(Math.abs(tubeLengthForHz(440) - 0.1844) < 0.001, 'about 18 cm for the A above middle C');
  assert.ok(tubeHz(0.5) < tubeHz(0.25));
});

const gallery = bars.gallery;
const flat = (entry, i, patch = {}) => normalizeParams(bars.schema, { ...entry.params, ...entry.parts.bar[i], ...patch });
const render = (params, patch = {}, note = {}) => {
  const p = flat({ params: {}, parts: { bar: [params] } }, 0, patch);
  return bars.render(p, normalizeNote({ midi: bars.describe(p).lowMidi, velocity: 0.7, durationS: 1.2, ...note }, bars.limits));
};

/** Energy of a sound at one frequency (Goertzel). */
function energyAt(pcm, sampleRate, hz) {
  const w = (2 * Math.PI * hz) / sampleRate;
  let re = 0;
  let im = 0;
  for (let i = 0; i < pcm.length; i++) { re += pcm[i] * Math.cos(w * i); im -= pcm[i] * Math.sin(w * i); }
  return Math.hypot(re, im) / pcm.length;
}
const rms = (pcm, from = 0, to = pcm.length) => Math.sqrt(pcm.slice(from, to).reduce((a, x) => a + x * x, 0) / Math.max(1, to - from));

test('every gallery instrument is a valid instrument with audible, finite sound, and each bar sounds at its note', () => {
  assert.ok(gallery.length >= 4);
  for (const entry of gallery) {
    assert.doesNotThrow(() => normalizeInstrument(bars.schema, entry), entry.id);
    entry.parts.bar.forEach((bar, i) => {
      const p = flat(entry, i);
      const { lowMidi } = bars.describe(p);
      const out = bars.render(p, normalizeNote({ midi: lowMidi, velocity: 0.7, durationS: 0.6 }, bars.limits));
      assert.ok(out.pcm.every(Number.isFinite), `${entry.id} bar ${i}`);
      assert.ok(rms(out.pcm) > 1e-6, `${entry.id} bar ${i} is audible`);
      // the loudest of the note and its neighbours is the note
      const hz = (() => { const m = bars.describe(p).lowMidi; return midiToHz(m); })();
      const here = energyAt(out.pcm, out.sampleRate, hz);
      assert.ok(here > energyAt(out.pcm, out.sampleRate, hz * 1.06) && here > energyAt(out.pcm, out.sampleRate, hz / 1.06), `${entry.id} bar ${i} rings at ${hz.toFixed(1)} Hz`);
    });
  }
});

test('the bars of a scale in the gallery are cut to within a few cents of their notes', () => {
  const entry = gallery.find((g) => g.id === 'maple-xylophone');
  const wanted = [72, 74, 76, 77, 79, 81, 83, 84];
  entry.parts.bar.forEach((bar, i) => {
    const { densityKgM3, youngModulusPa } = resolveMaterial(bar.barMaterial);
    const hz = barFrequencies({ densityKgM3, youngModulusPa, lengthM: bar.barLengthMm / 1000, thicknessM: bar.barThicknessMm / 1000, undercut: bar.barUndercut })[0];
    const cents = 1200 * Math.log2(hz / midiToHz(wanted[i]));
    assert.ok(Math.abs(cents) < 3, `bar ${i}: ${cents.toFixed(1)} cents`);
  });
});

test('a tube tuned to the bar makes it louder and shorter, a far-off tube changes it far less, and no tube is the plain bar', () => {
  const bar = { barMaterial: 'sugar-maple', barLengthMm: 570, barThicknessMm: 22, barUndercut: 1 };
  const f1 = bars.describe(flat({ params: {}, parts: { bar: [bar] } }, 0)).lowMidi;
  const hz = midiToHz(f1);
  const tunedMm = tubeLengthForHz(hz) * 1000;
  const plain = render(bar);
  const tuned = render(bar, { tubeFit: true, tubeLengthMm: tunedMm });
  const far = render(bar, { tubeFit: true, tubeLengthMm: tunedMm * 0.4 });
  const sr = plain.sampleRate;
  const early = (o) => energyAt(o.pcm.slice(0, Math.round(0.1 * sr)), sr, hz) * 10;
  const late = (o) => energyAt(o.pcm.slice(Math.round(0.8 * sr), Math.round(1.1 * sr)), sr, hz) * 3.33;
  assert.ok(early(tuned) > 1.6 * early(plain), `tuned tube: ${early(tuned)} against ${early(plain)}`);
  const mid = (o) => energyAt(o.pcm.slice(Math.round(0.3 * sr), Math.round(0.6 * sr)), sr, hz) * 3.33;
  assert.ok(late(tuned) / mid(tuned) < late(plain) / mid(plain), 'a tuned tube drains the bar sooner');
  const dB = (a, b) => Math.abs(20 * Math.log10(a / b));
  assert.ok(dB(early(far), early(plain)) < 0.5 * dB(early(tuned), early(plain)), 'a tube far from the note does less than half as much, in decibels');
});

test('the carved arch really moves the first overtone in the sound', () => {
  const base = { barMaterial: 'sugar-maple', barLengthMm: 380, barThicknessMm: 20 };
  const plain = flat({ params: {}, parts: { bar: [{ ...base, barUndercut: 0 }] } }, 0);
  const carved = flat({ params: {}, parts: { bar: [{ ...base, barUndercut: 1 }] } }, 0);
  const strike = { strikeAt: 0.2, malletHardness: 0.9 };
  const a = bars.render({ ...plain, ...strike }, normalizeNote({ midi: bars.describe(plain).lowMidi, durationS: 0.8 }, bars.limits));
  const b = bars.render({ ...carved, ...strike }, normalizeNote({ midi: bars.describe(carved).lowMidi, durationS: 0.8 }, bars.limits));
  const f = (p) => resolveMaterial(p.barMaterial) && barFrequencies({ ...resolveMaterial(p.barMaterial), lengthM: p.barLengthMm / 1000, thicknessM: p.barThicknessMm / 1000, undercut: p.barUndercut });
  const fa = f(plain);
  const fb = f(carved);
  assert.ok(Math.abs(fa[1] / fa[0] - 2.757) < 0.01 && Math.abs(fb[1] / fb[0] - 4) < 0.01);
  const peak = (out, hz) => energyAt(out.pcm, out.sampleRate, hz);
  assert.ok(peak(b, fb[1]) > 3 * peak(b, fb[0] * 2.757), 'the carved bar has its overtone at 4×');
  assert.ok(peak(a, fa[1]) > 3 * peak(a, fa[0] * 4), 'the plain bar has it at 2.76×');
});

test('a bar too small or too large to sound is called unplayable in plain words, by describe and by render', () => {
  const tiny = flat({ params: {}, parts: { bar: [{ barMaterial: 'steel-music-wire', barLengthMm: 40, barThicknessMm: 60 }] } }, 0);
  const note = normalizeNote({ midi: 72, durationS: 0.3 }, bars.limits);
  for (const call of [() => bars.describe(tiny), () => bars.render(tiny, note)]) {
    assert.throws(call, (error) => error.unplayable === true && /too short and thick/.test(error.message));
  }
  const long = flat({ params: {}, parts: { bar: [{ barMaterial: 'nylon-66', barLengthMm: 1500, barThicknessMm: 2 }] } }, 0);
  assert.throws(() => bars.describe(long), (error) => error.unplayable === true && /too long and thin/.test(error.message));
});

test('hz and midi agree with the bench\'s notes', () => {
  assert.equal(Math.round(hzToMidi(261.6256)), 60);
});
