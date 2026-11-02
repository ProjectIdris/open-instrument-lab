// SPDX-License-Identifier: GPL-3.0-only
// The string loss law, the pluck width, and the plucked-string presets that rest on them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LOSS_LAWS, NYLON_LAW, partialT60s, lossRate } from '../engines/string-loss.mjs';
import { pluckWidthM } from '../engines/pluck.mjs';
import { normalizeParams, normalizeNote } from '../engines/schema.mjs';
import * as guitar from '../engines/guitar-bench/engine.mjs';
import * as strings from '../engines/string-waveguide/engine.mjs';
import { measuredPitch } from './helpers.mjs';

/** Amplitude (dB) of one frequency in pcm[from, from + len) seconds, by a Hann-windowed single-bin DFT. */
function level(pcm, rate, hz, from, len) {
  const a = Math.round(from * rate);
  const n = Math.round(len * rate);
  let re = 0;
  let im = 0;
  for (let i = 0; i < n; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
    re += pcm[a + i] * w * Math.cos((2 * Math.PI * hz * i) / rate);
    im += pcm[a + i] * w * Math.sin((2 * Math.PI * hz * i) / rate);
  }
  return 20 * Math.log10(Math.hypot(re, im) / n + 1e-30);
}

test('the loss law: higher partials die faster, steadily, and a longer ring time stretches every partial', () => {
  for (const law of [...Object.values(LOSS_LAWS), NYLON_LAW]) {
    const t = partialT60s(law, 110, 44100);
    assert.equal(t.length, 24);
    for (let i = 1; i < t.length; i++) assert.ok(t[i] < t[i - 1]);
    const slow = partialT60s(law, 110, 44100, { ringTime: 2 });
    t.forEach((v, i) => assert.ok(Math.abs(slow[i] / v - 2) < 1e-9));
  }
  // measured on the Meta steel guitar: about 0.9 per second near 300 Hz, 2.3 near 1.5 kHz and 4.5 near 3 kHz
  assert.ok(Math.abs(lossRate(LOSS_LAWS.acoustic, 300) - 0.9) < 0.15);
  assert.ok(Math.abs(lossRate(LOSS_LAWS.acoustic, 1500) - 2.3) < 0.4);
  assert.ok(Math.abs(lossRate(LOSS_LAWS.acoustic, 3000) - 4.4) < 0.7);
});

test('the pluck is a width in metres, from a thumb down to the edge of a pick, and does not depend on the note', () => {
  assert.ok(Math.abs(pluckWidthM(0) - 0.014) < 1e-9);
  assert.ok(Math.abs(pluckWidthM(1) - 0.0005) < 1e-9);
  assert.ok(pluckWidthM(0.4) < pluckWidthM(0.15) && pluckWidthM(0.85) < pluckWidthM(0.4));
});

test('the overtones of a steel string still ring after two seconds (the 6th partial of the low E fell 34 dB in 2 s before the law, 20 after)', () => {
  const entry = guitar.gallery.find((g) => g.id === 'steel-guitar');
  const flat = normalizeParams(guitar.schema, { ...entry.params, ...entry.parts.string[0] });
  const { lowMidi } = guitar.describe(flat);
  const { pcm, sampleRate } = guitar.render(flat, normalizeNote({ midi: lowMidi, velocity: 0.7, durationS: 3 }, guitar.limits));
  const f0 = 440 * 2 ** ((lowMidi - 69) / 12);
  // partial 6 of the low E, 0.2 s in and 2 s later; the law says a fall rate near 1.1 per second, so about 19 dB in 2 s
  const early = level(pcm, sampleRate, 6 * f0, 0.2, 0.25);
  const late = level(pcm, sampleRate, 6 * f0, 2.2, 0.25);
  assert.ok(early - late < 28, `the 6th partial fell ${(early - late).toFixed(0)} dB in 2 s`); // 34 dB before the law, 20 after
  assert.ok(early - late > 8);
});

test('the nylon guitar is a real classical set: tuned, wound where wound strings are used, and about 7 kg of pull', () => {
  const entry = guitar.gallery.find((g) => g.id === 'nylon-guitar');
  const want = [40, 45, 50, 55, 59, 64];
  entry.parts.string.forEach((s, i) => {
    const flat = normalizeParams(guitar.schema, { ...entry.params, ...s });
    const facts = guitar.stringFacts(flat);
    assert.ok(Math.abs(facts.midi - want[i]) < 0.02);
    assert.ok(flat.tensionN > 50 && flat.tensionN < 90, `string ${i + 1} carries ${flat.tensionN} N`);
    assert.equal(flat.stringWound, i < 3);
    // how far the overtones are stretched sharp by the string's stiffness: tiny for the wound ones
    const B = Math.PI ** 2 * facts.bending / (flat.tensionN * facts.lengthM ** 2);
    assert.ok(B < 1e-3, `string ${i + 1} stiffness ${B}`);
  });
  const { pcm, sampleRate } = guitar.render(normalizeParams(guitar.schema, { ...entry.params, ...entry.parts.string[0] }), normalizeNote({ midi: 40, velocity: 0.7, durationS: 1 }, guitar.limits));
  assert.ok(Math.abs(measuredPitch(pcm, sampleRate, 440 * 2 ** ((40 - 69) / 12))) < 15);
});

test('every plucked-string preset renders finite sound across its range', () => {
  for (const g of strings.gallery) {
    const p = normalizeParams(strings.schema, g.params);
    const { lowMidi, highMidi } = strings.describe(p);
    for (const midi of [lowMidi, Math.round((lowMidi + highMidi) / 2), highMidi]) {
      const { pcm } = strings.render(p, normalizeNote({ midi, velocity: 0.7, durationS: 2 }, strings.limits));
      assert.ok(pcm.every(Number.isFinite), `${g.id} ${midi}`);
      assert.ok(pcm.some((v) => Math.abs(v) > 0), `${g.id} ${midi}`);
    }
  }
});

test('every string of the classical set rings by nylon\'s law, the wound ones by the wound-nylon law, and a steel string by the steel law', async () => {
  const { gallery, schema, lossLawFor } = await import('../engines/guitar-bench/engine.mjs');
  const { normalizeParams } = await import('../engines/schema.mjs');
  const { NYLON_WOUND_LAW } = await import('../engines/string-loss.mjs');
  const flat = (entry, i) => normalizeParams(schema, { ...entry.params, ...entry.parts.string[i] });
  const nylon = gallery.find((g) => g.id === 'nylon-guitar');
  const laws = nylon.parts.string.map((_, i) => lossLawFor(flat(nylon, i)));
  assert.deepEqual(laws.slice(0, 3), [NYLON_WOUND_LAW, NYLON_WOUND_LAW, NYLON_WOUND_LAW], 'the wound strings are not the steel law');
  assert.deepEqual(laws.slice(3), [NYLON_LAW, NYLON_LAW, NYLON_LAW]);
  const steel = gallery.find((g) => g.id === 'steel-guitar');
  assert.deepEqual(lossLawFor(flat(steel, 0)), LOSS_LAWS.acoustic);
  assert.deepEqual(lossLawFor({ ...flat(steel, 0), pickupFit: 'magnetic' }), LOSS_LAWS.electric);
});
