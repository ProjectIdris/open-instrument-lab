// SPDX-License-Identifier: GPL-3.0-only
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { loadEngines, checkEngine } from '../engines/registry.mjs';
import { normalizeInstrument, normalizeNote, normalizeParams, validateSchema } from '../engines/schema.mjs';
import { bodyOutline, stringPhysics, tensionForHz, midiToHz, hzToMidi, nearestNote, fretPositionM } from '../engines/physics.mjs';
import { stringFacts, bodyModes } from '../engines/guitar-bench/engine.mjs';
import { createApp } from '../server/app.mjs';
import { measuredPitch } from './helpers.mjs';

const { engines } = await loadEngines({ env: { STUDIO_ENGINE_DIRS: '' } });
const guitar = engines.get('guitar-bench');
const defaultsFlat = () => ({ ...normalizeInstrument(guitar.schema, {}).params, ...normalizeInstrument(guitar.schema, {}).parts.string[0] });

/** Render one string at its open note (or a fret) and report how far its pitch is from what the physics says. */
function centsOff(flat, fret = 0) {
  const { lowMidi } = guitar.describe(flat);
  const { pcm, sampleRate } = guitar.render(flat, normalizeNote({ midi: lowMidi + fret, velocity: 0.7, durationS: 1.2 }, guitar.limits));
  const expected = stringFacts(flat).hz * 2 ** (fret / 12);
  return measuredPitch(pcm, sampleRate, expected);
}

test('the bench physics: tension and pitch are each other\'s inverse, and frets halve the length at twelve', () => {
  const base = { densityKgM3: 7750, youngModulusPa: 206.84e9, diameterMm: 0.33, wound: false, tensionN: 100, scaleLengthMm: 645, stiffness: 1 };
  const p = stringPhysics(base);
  const back = tensionForHz({ lengthM: p.lengthM, hz: p.hz, linearDensityKgM: p.mu, bendingNm2: p.bending });
  assert.ok(Math.abs(back - 100) < 1e-6, `tension came back as ${back}`);
  // A plain 0.33 mm steel string at 100 N over 645 mm is a high string: roughly an E4 to a B4.
  assert.ok(p.hz > 300 && p.hz < 520, `${p.hz} Hz`);
  assert.ok(Math.abs(fretPositionM(0.645, 12) - 0.3225) < 1e-9);
  assert.deepEqual(nearestNote(hzToMidi(midiToHz(40) * 2 ** (13 / 1200))), { midi: 40, name: 'E2', cents: 13 });
  // Longer string at the same tension sounds lower, in proportion; more tension sounds higher.
  const longer = stringPhysics({ ...base, scaleLengthMm: 800 });
  assert.ok(Math.abs(longer.hz / p.hz - 645 / 800) < 0.01);
  assert.ok(stringPhysics({ ...base, tensionN: 200 }).hz / p.hz > 1.4);
});

test('the starting instruments are tuned to the notes they are meant for, with believable tensions', () => {
  const want = { 'steel-guitar': [40, 45, 50, 55, 59, 64], 'parlour-guitar': [40, 45, 50, 55, 59, 64], 'acoustic-bass': [28, 33, 38, 43], 'nylon-guitar': [40, 45, 50, 55, 59, 64] };
  for (const entry of guitar.gallery) {
    const { params, parts } = normalizeInstrument(guitar.schema, entry);
    parts.string.forEach((s, i) => {
      const f = stringFacts({ ...params, ...s });
      assert.ok(Math.abs(f.midi - want[entry.id][i]) < 0.03, `${entry.id} string ${i + 1} is at ${f.midi.toFixed(2)}`);
      assert.ok(s.tensionN > 40 && s.tensionN < 260, `${entry.id} string ${i + 1} carries ${s.tensionN} N`);
    });
  }
  // The steel guitar's tensions are within 15% of a published-typical steel-string set.
  const lab = [106, 125, 133, 132, 104, 104];
  const steel = normalizeInstrument(guitar.schema, guitar.gallery[0]).parts.string;
  steel.forEach((s, i) => assert.ok(Math.abs(s.tensionN / lab[i] - 1) < 0.15, `string ${i + 1}: ${s.tensionN} N`));
});

test('what is drawn is what is heard: the rendered pitch follows length, tension, thickness and material', () => {
  const base = defaultsFlat();
  const strings = normalizeInstrument(guitar.schema, guitar.gallery[0]).parts.string;
  const steelBody = normalizeInstrument(guitar.schema, guitar.gallery[0]).params;
  for (const i of [0, 3, 5]) assert.ok(Math.abs(centsOff({ ...steelBody, ...strings[i] })) < 8, `string ${i + 1} open`);
  assert.ok(Math.abs(centsOff({ ...steelBody, ...strings[1] }, 7)) < 8, 'a fifth fret above the open A');
  // Lengthen the string and the sounding pitch falls by the ratio of lengths; it is still where the physics put it.
  const flat = { ...steelBody, ...strings[2] };
  const long = { ...flat, scaleLengthMm: 760 };
  assert.ok(Math.abs(centsOff(long)) < 8);
  assert.ok(Math.abs(1200 * Math.log2(stringFacts(long).hz / stringFacts(flat).hz) - 1200 * Math.log2(645 / 760)) < 25);
  // Thicker at the same tension is lower; tighter is higher; nylon is much lighter than steel, so at the same thickness and tension it sounds much higher.
  const f = stringFacts(base);
  assert.ok(stringFacts({ ...base, stringDiameterMm: 0.45 }).hz < f.hz);
  assert.ok(stringFacts({ ...base, tensionN: 140 }).hz > f.hz);
  assert.ok(Math.abs(stringFacts({ ...base, stringMaterial: 'nylon-66' }).hz / f.hz / Math.sqrt(7750 / 1140) - 1) < 0.03);
});

test('a string pushed outside what can be played says so in plain words', () => {
  const flat = { ...defaultsFlat(), scaleLengthMm: 250, tensionN: 300, stringDiameterMm: 0.1 };
  assert.throws(() => guitar.describe(flat), (error) => error.unplayable === true && /outside what can be played/.test(error.message));
});

test('the body is worked out from the drawing: size, depth, hole and wood move the resonances the way a maker would expect', () => {
  const d = defaultsFlat();
  const ref = bodyModes(d).map((m) => m.frequencyHz);
  assert.deepEqual(ref.map(Math.round), [105, 205, 395, 710], 'the default body is the typical steel-string body');
  const air = (p) => bodyModes({ ...d, ...p })[0].frequencyHz;
  const plate = (p) => bodyModes({ ...d, ...p })[1].frequencyHz;
  assert.ok(air({ holeDiameterMm: 120 }) > air({}), 'a bigger hole raises the air resonance');
  assert.ok(air({ bodyDepthMm: 140 }) < air({}), 'a deeper body lowers it');
  assert.ok(air({ lowerBoutMm: 460 }) < air({}), 'a bigger body lowers it');
  assert.ok(plate({ topThicknessMm: 3.6 }) > plate({}), 'a thicker top raises the top resonances');
  assert.ok(plate({ topWood: 'western-redcedar' }) < plate({}), 'a softer, lighter top is lower than spruce here');
  assert.ok(plate({ lowerBoutMm: 460, bodyLengthMm: 600 }) < plate({}), 'a bigger top is lower');
  assert.equal(air({ topWood: 'sugar-maple' }) > 0, true);
  // The outline is a real closed shape with a believable area for a full-size guitar.
  const area = bodyOutline({ lengthM: 0.5, upperM: 0.29, waistM: 0.245, lowerM: 0.39, waistAt: 0.5 }).areaM2;
  assert.ok(area > 0.1 && area < 0.17, `${area} m²`);
});

test('a different body sounds different, and a bare string and a bodied one are not the same', () => {
  const flat = { ...defaultsFlat() };
  const { lowMidi } = guitar.describe(flat);
  const note = normalizeNote({ midi: lowMidi + 3, velocity: 0.7, durationS: 0.8 }, guitar.limits);
  const a = guitar.render(flat, note).pcm;
  const b = guitar.render({ ...flat, bodyDepthMm: 150, holeDiameterMm: 50 }, note).pcm;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff += Math.abs(a[i] - b[i]);
  assert.ok(diff > 0.01, 'changing the body must change the sound');
});

test('an instrument made of parts is checked as a whole', () => {
  const ok = normalizeInstrument(guitar.schema, { params: { scaleLengthMm: 700 }, parts: { string: [{ tensionN: 90 }, { tensionN: 80 }] } });
  assert.equal(ok.parts.string.length, 2);
  assert.equal(ok.params.scaleLengthMm, 700);
  assert.equal(ok.parts.string[0].stringMaterial, 'steel-music-wire', 'defaults are filled in');
  assert.throws(() => normalizeInstrument(guitar.schema, { parts: { string: [] } }), /count must be from 1 to 8/);
  assert.throws(() => normalizeInstrument(guitar.schema, { parts: { string: Array.from({ length: 9 }, () => ({})) } }), /count must be from 1 to 8/);
  assert.throws(() => normalizeInstrument(guitar.schema, { parts: { string: [{ tensionN: 9000 }] } }), /tensionN must be between/);
  assert.throws(() => normalizeInstrument(guitar.schema, { parts: { string: [{ scaleLengthMm: 600 }] } }), /unknown String parameter/);
  assert.throws(() => normalizeInstrument(guitar.schema, { params: { tensionN: 90 } }), /unknown parameter tensionN/);
  assert.throws(() => normalizeInstrument(guitar.schema, { parts: { frets: [] } }), /unknown part frets/);
  // A saved instrument comes back the same after a round trip through JSON.
  const again = normalizeInstrument(guitar.schema, JSON.parse(JSON.stringify(ok)));
  assert.deepEqual(again, ok);
  // An engine without parts is unchanged.
  const bars = engines.get('modal-bar');
  assert.deepEqual(normalizeInstrument(bars.schema, { params: { ringTime: 2 } }).parts, {});
});

test('the schema rules for parts and for what a number is', () => {
  const group = { id: 'g', label: 'G' };
  const param = { id: 'a', type: 'number', layer: 'plain', group: 'g', label: 'A', help: 'a', min: 0, max: 1, default: 0.5 };
  assert.ok(validateSchema({ groups: [group], parts: [{ id: 'p', label: 'P', min: 1, max: 3 }], params: [{ ...param, part: 'p', physical: 'tension' }] }));
  assert.throws(() => validateSchema({ groups: [group], params: [{ ...param, part: 'nope' }] }), /unknown part nope/);
  assert.throws(() => validateSchema({ groups: [group], params: [{ ...param, physical: 'mood' }] }), /physical must be one of/);
  assert.throws(() => validateSchema({ groups: [group], parts: [{ id: 'p', label: 'P', min: 4, max: 3 }], params: [param] }), /min and max/);
  assert.throws(() => validateSchema({ groups: [group], params: [{ ...param, affectsSound: 'no' }] }), /affectsSound/);
});

test('an engine that asks for a workbench must say what kind it is, and which roles its hands set', () => {
  const broken = (bench) => ({ ...guitar, bench });
  assert.doesNotThrow(() => checkEngine(guitar));
  assert.throws(() => checkEngine(broken({ ...guitar.bench, kind: 'harp' })), /bench.kind/);
  assert.throws(() => checkEngine(broken({ ...guitar.bench, hands: [{ id: 'x', name: 'X', params: { nope: 1 } }] })), /"nope" is not a shared role/);
});

test('the materials the bench shows have a look and a source, and nylon is among them', async () => {
  const { materials } = await import('../engines/materials.mjs');
  for (const m of materials) assert.match(m.look?.base ?? '', /^#[0-9a-f]{6}$/i, `${m.id} needs a look`);
  const nylon = materials.find((m) => m.id === 'nylon-66');
  assert.equal(nylon.densityKgM3, 1140);
  assert.ok(nylon.source.locator.includes('ASTM D638'));
  // Every wood the engine offers is in the library, and the neck's wood is not a custom one.
  const neck = guitar.schema.params.find((p) => p.id === 'neckWood');
  assert.ok(neck.options.every((o) => o.value !== 'custom'));
  assert.equal(neck.affectsSound, false);
});

let app;
let base;
before(async () => {
  app = await createApp({ poolSize: 2, cacheMb: 16 });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${app.server.address().port}`;
});
after(async () => { await app.close(); });

test('the page gets the shared physics and materials, and where a string is plucked does not change its levelling', async () => {
  for (const path of ['/shared/physics.mjs', '/shared/materials.json', '/shared/schema.mjs']) assert.equal((await fetch(base + path)).status, 200, path);
  const flat = defaultsFlat();
  const { lowMidi } = guitar.describe(flat);
  const render = (params) => fetch(`${base}/api/render`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ engine: 'guitar-bench', params, note: { midi: lowMidi + 2, velocity: 0.7, durationS: 0.6 } }) });
  const near = await render({ ...flat, pluckDistanceMm: 40 });
  const far = await render({ ...flat, pluckDistanceMm: 220, pickHardness: 0.9 });
  assert.equal(near.status, 200);
  assert.equal(far.status, 200);
  assert.equal(near.headers.get('x-gain'), far.headers.get('x-gain'), 'the same string and body keep one gain');
  // A different string is levelled on its own.
  const other = await render({ ...flat, stringDiameterMm: 0.5, tensionN: 60 });
  assert.notEqual(other.headers.get('x-gain'), near.headers.get('x-gain'));
  const refused = await render({ ...flat, scaleLengthMm: 250, tensionN: 300, stringDiameterMm: 0.1 });
  assert.equal(refused.status, 400);
  assert.match((await refused.json()).error, /outside what can be played/);
  void normalizeParams;
});

test('the open strings of a guitar sit at one level, and no note, however it is plucked, clips', async () => {
  const gallery = guitar.gallery[0];
  const instrument = normalizeInstrument(guitar.schema, gallery);
  const post = (params, note) => fetch(`${base}/api/render`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ engine: 'guitar-bench', params, note }) });
  const peakOf = async (response) => {
    const wav = Buffer.from(await response.arrayBuffer());
    let peak = 0;
    for (let i = 44; i < wav.length - 3000; i += 2) peak = Math.max(peak, Math.abs(wav.readInt16LE(i)) / 32768);
    return peak;
  };
  const levels = [];
  for (const [k, string] of instrument.parts.string.entries()) {
    const flat = { ...instrument.params, ...string };
    const { lowMidi } = guitar.describe(flat);
    const open = await post({ ...flat, pluckDistanceMm: Math.round(flat.scaleLengthMm * 0.17) }, { midi: lowMidi, velocity: 0.7, durationS: 1 });
    assert.equal(open.status, 200);
    levels.push(await peakOf(open));
    // The hardest touch at the middle of the string, where the string is at its loudest.
    const hard = await post({ ...flat, pluckDistanceMm: Math.round(flat.scaleLengthMm * 0.5) }, { midi: lowMidi, velocity: 0.95, durationS: 1 });
    assert.ok(await peakOf(hard) <= 0.985, `string ${k + 1} is kept under full scale`);
    // Some fretted notes ring far louder than the open string the level was set from (the body resonates with them).
    for (const fret of [3, 5, 7, 12]) {
      const sounding = flat.scaleLengthMm * 2 ** (-fret / 12);
      const note = await post({ ...flat, pluckDistanceMm: Math.round(sounding * 0.5) }, { midi: lowMidi + fret, velocity: 0.95, durationS: 1 });
      assert.equal(note.status, 200);
      assert.ok(await peakOf(note) <= 0.985, `string ${k + 1}, fret ${fret} is kept under full scale`);
    }
  }
  const loudest = Math.max(...levels);
  const quietest = Math.min(...levels);
  assert.ok(20 * Math.log10(loudest / quietest) < 4, `open strings differ by ${(20 * Math.log10(loudest / quietest)).toFixed(1)} dB: ${levels.map((v) => v.toFixed(2)).join(' ')}`);
});

test('the gain the server reports is the gain it applied, also when a loud note is held under full scale', async () => {
  const instrument = normalizeInstrument(guitar.schema, guitar.gallery[0]);
  const post = (params, note) => fetch(`${base}/api/render`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ engine: 'guitar-bench', params, note }) });
  let held = 0;
  for (const [k, string] of instrument.parts.string.entries()) {
    const flat = { ...instrument.params, ...string };
    const { lowMidi } = guitar.describe(flat);
    const openGain = Number((await post({ ...flat, pluckDistanceMm: Math.round(flat.scaleLengthMm * 0.17) }, { midi: lowMidi, velocity: 0.7, durationS: 1 })).headers.get('x-gain'));
    for (const fret of [0, 3, 5, 7, 12]) {
      const sounding = flat.scaleLengthMm * 2 ** (-fret / 12);
      const params = { ...flat, pluckDistanceMm: Math.round(sounding * 0.5) };
      const note = { midi: lowMidi + fret, velocity: 0.95, durationS: 1 };
      const response = await post(params, note);
      const gain = Number(response.headers.get('x-gain'));
      const wav = Buffer.from(await response.arrayBuffer());
      let heard = 0;
      for (let i = 44; i < wav.length - 3000; i += 2) heard = Math.max(heard, Math.abs(wav.readInt16LE(i)) / 32768);
      const raw = guitar.render(normalizeParams(guitar.schema, params), normalizeNote(note, guitar.limits)).pcm;
      let rawPeak = 0;
      for (const v of raw) rawPeak = Math.max(rawPeak, Math.abs(v));
      assert.ok(Math.abs(heard - rawPeak * gain) < 0.002, `string ${k + 1} fret ${fret}: reported gain ${gain} gives ${(rawPeak * gain).toFixed(3)}, the file peaks at ${heard.toFixed(3)}`);
      if (gain < openGain * 0.999) held++;
    }
  }
  assert.ok(held >= 1, 'at least one of these notes is loud enough to be held under full scale, so this tests the capped case');
});
