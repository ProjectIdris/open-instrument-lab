// SPDX-License-Identifier: GPL-3.0-only
// The drum workbench engine: its rack and gallery, what a strike excites, what the head and shell do to the
// sound, and the refusals. The membrane physics under it is tested in drum-engine.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { besselJ, headTensionForHz, membraneModes, midiToHz, radiationRate, AIR_DENSITY } from '../engines/physics.mjs';
import { loadEngines } from '../engines/registry.mjs';
import { normalizeInstrument, normalizeNote, normalizeParams } from '../engines/schema.mjs';

const { engines } = await loadEngines({ env: { STUDIO_ENGINE_DIRS: '' } });
const drums = engines.get('drum-bench');

test('the sound a head sends out takes energy: both faces twice one, a monopole far more than a quadrupole, and the small-head limit is the textbook one', () => {
  const head = { tensionNPerM: 1700, arealKgM2: 0.264, radiusM: 0.152 };
  const modes = membraneModes(head);
  const rate = (m, n, sides = 1) => radiationRate(modes.find((x) => x.m === m && x.n === n), { radiusM: head.radiusM, sides });
  assert.ok(Math.abs(rate(0, 1, 2) / rate(0, 1, 1) - 2) < 1e-9, 'two faces, twice the rate');
  assert.ok(rate(0, 1, 2) > 10 && rate(0, 1, 2) < 100, `${rate(0, 1, 2)} per second`);
  assert.ok(rate(2, 1) < rate(0, 1) / 10, 'the (2,1) mode is a quadrupole, the (0,1) a monopole');
  // a small head radiates its whole-head mode as a monopole in a baffle: P = ρω²Q²/(4πc), Q the volume velocity
  const tiny = { tensionNPerM: 30, arealKgM2: 0.264, radiusM: 0.02 };
  const m01 = membraneModes(tiny)[0];
  const k = (2 * Math.PI * m01.hz) / 343;
  assert.ok(k * 0.02 < 0.1);
  const omega = 2 * Math.PI * m01.hz;
  const volume = (2 * Math.PI * 0.02 ** 2 * besselJ(1, m01.alpha)) / m01.alpha; // volume per unit speed of the mode's centre
  const power = (omega * omega * AIR_DENSITY * volume * volume) / (4 * Math.PI * 343); // per unit speed²
  const closedForm = power / (m01.massKg); // σ = P / (2E) with E = ½ M v²
  assert.ok(Math.abs(radiationRate(m01, { radiusM: 0.02 }) / closedForm - 1) < 0.05, `${radiationRate(m01, { radiusM: 0.02 })} against ${closedForm}`);
});

test('tuning a head to a note puts its lowest mode on that note, open or closed, thick or thin', () => {
  for (const options of [
    { arealKgM2: 0.264, radiusM: 0.152 },
    { arealKgM2: 0.09, radiusM: 0.09, depthM: 0.18 },
    { arealKgM2: 0.264, radiusM: 0.33, depthM: 0.4, closed: true },
  ]) {
    for (const midi of [36, 50, 64]) {
      const T = headTensionForHz(midiToHz(midi), options);
      const got = membraneModes({ tensionNPerM: T, ...options })[0].hz;
      assert.ok(Math.abs(got / midiToHz(midi) - 1) < 1e-6, `${midi}: ${got}`);
    }
  }
});

test('the drum engine is loaded, on the membrane bench, with a rack of drums and sticks', () => {
  assert.ok(drums, 'the engine loaded');
  assert.equal(drums.bench.kind, 'struck-membranes');
  assert.ok(drums.schema.parts[0].rack.length >= 5);
  assert.ok(drums.bench.hands.length >= 4);
  assert.ok(drums.gallery.length >= 4);
  for (const hand of drums.bench.hands) assert.ok(hand.params.stickHardness >= 0 && hand.params.stickHardness <= 1);
});

const flat = (entry, i, patch = {}) => normalizeParams(drums.schema, { ...entry.params, ...entry.parts.drum[i], ...patch });
const tom = () => flat(drums.gallery.find((g) => g.id === 'single-tom'), 0);
const strikeOf = (p, patch = {}, note = {}) => drums.render({ ...p, ...patch }, normalizeNote({ midi: drums.describe(p).lowMidi, velocity: 0.7, durationS: 1.2, ...note }, drums.limits));
const modesOf = (p) => membraneModes({ tensionNPerM: p.headTension, arealKgM2: 1390 * p.headThicknessUm * 1e-6, radiusM: p.headDiameterMm / 2000, depthM: p.shellDepthMm / 1000, closed: p.shellClosed || p.bottomHead });
const toneOf = (p) => modesOf(p).find((m) => m.m === 1 && m.n === 1).hz;
const rms = (pcm) => Math.sqrt(pcm.reduce((a, x) => a + x * x, 0) / Math.max(1, pcm.length));
function energyAt(pcm, sampleRate, hz) {
  const w = (2 * Math.PI * hz) / sampleRate;
  let re = 0;
  let im = 0;
  for (let i = 0; i < pcm.length; i++) { re += pcm[i] * Math.cos(w * i); im -= pcm[i] * Math.sin(w * i); }
  return Math.hypot(re, im) / pcm.length;
}

test('every gallery instrument is valid, and each drum is audible, finite and its main tone (the (1,1) mode) is within half a semitone of its note', () => {
  for (const entry of drums.gallery) {
    assert.doesNotThrow(() => normalizeInstrument(drums.schema, entry), entry.id);
    entry.parts.drum.forEach((_, i) => {
      const p = flat(entry, i);
      const { lowMidi } = drums.describe(p);
      const out = drums.render(p, normalizeNote({ midi: lowMidi, velocity: 0.7, durationS: 0.8 }, drums.limits));
      assert.ok(out.pcm.every(Number.isFinite), `${entry.id} drum ${i}`);
      assert.ok(rms(out.pcm) > 1e-9, `${entry.id} drum ${i} is audible`);
      assert.ok(Math.abs(1200 * Math.log2(toneOf(p) / midiToHz(lowMidi))) < 50, `${entry.id} drum ${i}`);
    });
  }
  const trio = drums.gallery.find((g) => g.id === 'tom-trio');
  assert.deepEqual(trio.parts.drum.map((_, i) => drums.describe(flat(trio, i)).lowMidi), [57, 52, 47], 'the toms are a fourth apart, widest lowest');
});

test('where the head is struck decides what is heard: the middle excites the round mode only, the rim side brings in the others, a nodal line silences one', () => {
  const p = { ...tom(), bottomHead: false };
  const modes = modesOf(p);
  const f01 = modes.find((x) => x.m === 0 && x.n === 1).hz;
  const f11 = modes.find((x) => x.m === 1 && x.n === 1).hz;
  // The (0,1) mode is damped hard by the sound it sends out, so its spectrum spreads and a little of it lies under
  // the (1,1) pitch whatever is struck. What is compared is how much more (1,1) there is against the (0,1).
  const ratio = (patch) => {
    const out = strikeOf(p, { stickHardness: 0.9, ...patch });
    return energyAt(out.pcm, out.sampleRate, f11) / energyAt(out.pcm, out.sampleRate, f01);
  };
  const edge = ratio({ strikeAt: 0.8, strikeAngle: 0 });
  assert.ok(ratio({ strikeAt: 0 }) < 0.15 * edge, 'a blow at the centre does not move the (1,1) mode');
  assert.ok(ratio({ strikeAt: 0.8, strikeAngle: 90 }) < 0.15 * edge, 'struck across the line that separates it from the listener');
  assert.ok(ratio({ strikeAt: 0.8, strikeAngle: 0, micOffset: 0 }) < 0.3 * edge, 'a microphone over the middle does not hear the modes with a nodal diameter');
});

test('a harder stick is brighter, a tighter head is higher, a closed shell lifts the pitch, a thicker head is lower, and the rigid shell is silent on material', () => {
  const p = tom();
  const bright = (out) => {
    const n = Math.min(out.pcm.length, 8000);
    let diff = 0;
    let all = 0;
    for (let i = 1; i < n; i++) { diff += (out.pcm[i] - out.pcm[i - 1]) ** 2; all += out.pcm[i] ** 2; }
    return diff / all;
  };
  assert.ok(bright(strikeOf(p, { stickHardness: 0.95 })) > 2 * bright(strikeOf(p, { stickHardness: 0.05 })));
  const midi = (patch) => drums.describe({ ...p, ...patch }).lowMidi;
  assert.equal(midi({ headTension: p.headTension * 4 }) - midi({}), 12, 'four times the tension is an octave');
  assert.ok(midi({ bottomHead: false, shellClosed: true, shellDepthMm: 60 }) > midi({ bottomHead: false }), 'a shut bottom takes the air off the back of the head, so its main tone rises');
  assert.ok(midi({ headThicknessUm: 380 }) < midi({}));
  assert.deepEqual(strikeOf(p, {}, { durationS: 0.3 }).pcm, strikeOf(p, { shellMaterial: 'brass' }, { durationS: 0.3 }).pcm);
});

test('a drum too slack or too tight to sound is unplayable in plain words, by describe and by render', () => {
  const slack = flat({ params: {}, parts: { drum: [{ headTension: 50, headDiameterMm: 1100, headThicknessUm: 800 }] } }, 0);
  const note = normalizeNote({ midi: 40, durationS: 0.3 }, drums.limits);
  for (const call of [() => drums.describe(slack), () => drums.render(slack, note)]) {
    assert.throws(call, (error) => error.unplayable === true && /too slack and heavy/.test(error.message));
  }
  const tight = flat({ params: {}, parts: { drum: [{ headMaterial: 'custom', headCustomDensity: 200, shellClosed: true, shellDepthMm: 10, headTension: 40000, headDiameterMm: 60, headThicknessUm: 20 }] } }, 0);
  assert.throws(() => drums.describe(tight), (error) => error.unplayable === true && /too tight and small/.test(error.message));
});

test('the host levels a drum and its stick once, whatever the place struck', () => {
  const p = flat(drums.gallery.find((g) => g.id === 'single-tom'), 0, { strikeAt: 0.9, stickHardness: 1, strikeAngle: 200 });
  const { params } = drums.levelling(p);
  assert.equal(params.strikeAt, 0.5);
  assert.equal(params.strikeAngle, 0);
  assert.equal(params.stickHardness, 1, 'the stick is kept: it changes how loud the same blow peaks');
  assert.equal(params.headTension, p.headTension);
});

test('the fitted microphone low cut takes out the lowest octaves and leaves the body alone, and the toms carry it while the bass drum and snare do not', () => {
  const p = tom();
  const bare = strikeOf(p, { micLowCutHz: 0 });
  const cut = strikeOf(p, { micLowCutHz: 70 });
  const at = (r, hz) => energyAt(r.pcm, r.sampleRate, hz);
  assert.ok(at(cut, 31) < at(bare, 31) / 10, 'a fourth-order cut at 70 Hz takes more than 20 dB off 31 Hz');
  assert.ok(Math.abs(20 * Math.log10(at(cut, 500) / at(bare, 500))) < 0.5, '500 Hz is left as it was');
  const rack = drums.schema.parts[0].rack;
  for (const id of ['tom-12', 'floor-tom-16']) assert.equal(rack.find((r) => r.id === id).params.micLowCutHz, 70, id);
  for (const id of ['kick-22', 'snare-14']) assert.equal(rack.find((r) => r.id === id).params.micLowCutHz, 0, id);
});

// The loudest narrow line in 30 to 150 ms after the onset, 600 Hz to 14 kHz, in decibels over the median of the spectrum 360 Hz either side.
function lineProminence(pcm, sampleRate) {
  let on = 0;
  while (on < pcm.length && Math.abs(pcm[on]) < 1e-3 * 0.01) on++;
  const seg = pcm.subarray(on + Math.round(0.03 * sampleRate), on + Math.round(0.15 * sampleRate));
  const n = 1 << Math.ceil(Math.log2(seg.length * 4));
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < seg.length; i++) re[i] = seg[i] * Math.sin((Math.PI * i) / seg.length) ** 2;
  for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let l = 2; l <= n; l <<= 1) { const a = -2 * Math.PI / l; for (let i = 0; i < n; i += l) for (let k = 0; k < l / 2; k++) { const c = Math.cos(a * k); const s = Math.sin(a * k); const u = i + k; const v = u + l / 2; const tr = re[v] * c - im[v] * s; const ti = re[v] * s + im[v] * c; re[v] = re[u] - tr; im[v] = im[u] - ti; re[u] += tr; im[u] += ti; } }
  const pw = new Float64Array(n / 2).map((_, i) => 10 * Math.log10(re[i] ** 2 + im[i] ** 2 + 1e-20));
  const w = Math.round((120 * n) / sampleRate);
  let best = -Infinity;
  for (let i = Math.round((600 * n) / sampleRate); i < Math.round((14000 * n) / sampleRate); i++) {
    let top = true;
    for (let j = i - w; j <= i + w && top; j++) if (pw[j] > pw[i]) top = false;
    if (!top) continue;
    const near = Array.from(pw.subarray(i - 3 * w, i + 3 * w)).sort((a, b) => a - b);
    best = Math.max(best, pw[i] - near[near.length >> 1]);
  }
  return best;
}

test('the snare wires are a noise and not a chord: no narrow line stands far out of the spectrum after the attack, and every wire has its own pitches', () => {
  const rack = drums.schema.parts[0].rack.find((r) => r.id === 'snare-14');
  const p = normalizeParams(drums.schema, { ...rack.params, stickHardness: 0.8 });
  const out = strikeOf(p);
  const prominence = lineProminence(out.pcm, out.sampleRate);
  assert.ok(prominence < 25, `${prominence.toFixed(0)} dB: the old wires rang a few lines 39 to 45 dB out`);
});

test('the snare has a crack: a good share of its first 30 ms is above 2 kHz, because the wires are thrown off at once and are not late', () => {
  const rack = drums.schema.parts[0].rack.find((r) => r.id === 'snare-14');
  const out = strikeOf(normalizeParams(drums.schema, { ...rack.params, stickHardness: 0.8 }));
  let on = 0;
  while (on < out.pcm.length && Math.abs(out.pcm[on]) < 1e-5) on++;
  const seg = out.pcm.subarray(on, on + Math.round(0.03 * out.sampleRate));
  const n = 4096;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < seg.length; i++) re[i] = seg[i] * Math.sin((Math.PI * i) / seg.length) ** 2;
  for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let l = 2; l <= n; l <<= 1) { const a = -2 * Math.PI / l; for (let i = 0; i < n; i += l) for (let k = 0; k < l / 2; k++) { const c = Math.cos(a * k); const s = Math.sin(a * k); const u = i + k; const v = u + l / 2; const tr = re[v] * c - im[v] * s; const ti = re[v] * s + im[v] * c; re[v] = re[u] - tr; im[v] = im[u] - ti; re[u] += tr; im[u] += ti; } }
  const energy = (lo, hi) => { let e = 0; for (let k = Math.round((lo * n) / out.sampleRate); k < (hi * n) / out.sampleRate; k++) e += re[k] ** 2 + im[k] ** 2; return e; };
  const share = 10 * Math.log10(energy(2000, 6000) / energy(60, 20000));
  assert.ok(share > -17, `${share.toFixed(0)} dB of the first 30 ms is 2 to 6 kHz; the recording's is -14 and the late wires' was -24`);
});

test('a drum\'s Level moves its loudness and nothing else, and the host measures it without the Level so that it is not undone', () => {
  const p = tom();
  const peak = (r) => r.pcm.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
  const quiet = peak(strikeOf(p, { levelDb: 0 }));
  const loud = peak(strikeOf(p, { levelDb: 6 }));
  assert.ok(Math.abs(20 * Math.log10(loud / quiet) - 6) < 0.01, 'six decibels of Level is six decibels of peak');
  assert.equal(drums.levelling({ ...p, levelDb: 6 }).params.levelDb, 0);
});

test('a bongo skin gives up its high modes at once and has no ping: its clean high modes die before 30 ms, and a hand on a frame drum stops the tone', () => {
  const rack = (id) => drums.schema.parts[0].rack.find((r) => r.id === id);
  const bongo = normalizeParams(drums.schema, { ...rack('bongo-7').params, strikeAt: 0.7, stickHardness: 0.95 });
  const out = strikeOf(bongo);
  const prominence = lineProminence(out.pcm, out.sampleRate);
  assert.ok(prominence < 35, `${prominence.toFixed(0)} dB: with a bare film head the bongo rang its high modes as lines near 59 dB out`);
  // the time for the hit to fall 40 dB, from a 10 ms rms envelope
  const falls = (r) => {
    const w = Math.round(0.01 * r.sampleRate);
    const env = [];
    for (let i = 0; i + w <= r.pcm.length; i += w) { let s = 0; for (let k = 0; k < w; k++) s += r.pcm[i + k] ** 2; env.push(Math.sqrt(s / w)); }
    const peak = Math.max(...env);
    const k = env.findIndex((v, i) => i > env.indexOf(peak) && v < peak * 0.01);
    return k < 0 ? Infinity : k * 0.01;
  };
  const open = falls(strikeOf(normalizeParams(drums.schema, rack('frame-16').params), {}, { durationS: 3 }));
  const muted = falls(strikeOf(normalizeParams(drums.schema, rack('frame-16-muted').params), {}, { durationS: 3 }));
  assert.ok(muted < 0.6 * open, `muted ${muted}s against open ${open}s to fall 40 dB`);
});
