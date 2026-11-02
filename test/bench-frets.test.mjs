// SPDX-License-Identifier: GPL-3.0-only
// Frets and the pickup: what the bench keeps, draws and plays when they are moved, added or taken away.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { loadEngines, publicDescription, checkEngine } from '../engines/registry.mjs';
import { normalizeInstrument, normalizeNote } from '../engines/schema.mjs';

register('./shared-loader.mjs', import.meta.url);
const { Bench } = await import('../web/js/bench/model.js');
const { layout, fretSlotNear, pickupAtPoint } = await import('../web/js/bench/geometry.js');

const { engines } = await loadEngines({ env: { STUDIO_ENGINE_DIRS: '' } });
const guitar = engines.get('guitar-bench');
const description = publicDescription(guitar);
const materials = JSON.parse(readFileSync(new URL('../engines/materials.json', import.meta.url), 'utf8')).materials;

function steelGuitar(edit = (parts) => parts) {
  const bench = new Bench(description, materials);
  const entry = description.gallery[0];
  bench.load({ name: entry.name, params: entry.params, parts: edit({ ...entry.parts }) });
  return bench;
}

test('the starting guitars come with their frets, and a file that lists none gets the ordinary neck, not one wire', () => {
  assert.deepEqual(steelGuitar().fretNumbers, Array.from({ length: 19 }, (_, k) => k + 1));
  const bare = steelGuitar((parts) => { delete parts.fret; return parts; });
  assert.deepEqual(bare.fretNumbers, Array.from({ length: 19 }, (_, k) => k + 1), 'no fret part listed');
  const one = steelGuitar((parts) => ({ ...parts, fret: [{ fretNumber: 1 }] }));
  assert.deepEqual(one.fretNumbers, [1], 'one fret that was asked for stays one fret');
});

test('frets are kept sorted and without doubles, and go out in the document', () => {
  const bench = steelGuitar((parts) => ({ ...parts, fret: [{ fretNumber: 12 }, { fretNumber: 5 }, { fretNumber: 5 }, { fretNumber: 3 }] }));
  assert.deepEqual(bench.fretNumbers, [3, 5, 12]);
  const doc = bench.toDocument();
  assert.deepEqual(doc.parts.fret, [{ fretNumber: 3 }, { fretNumber: 5 }, { fretNumber: 12 }]);
  // the document is a valid instrument for the engine, and opens to the same frets
  assert.doesNotThrow(() => normalizeInstrument(guitar.schema, { params: doc.params, parts: doc.parts }));
  const again = new Bench(description, materials);
  again.load(doc);
  assert.deepEqual(again.fretNumbers, [3, 5, 12]);
});

test('a fret can be added where there is none, moved only to a free place, and taken out down to the part\'s minimum', () => {
  const bench = steelGuitar((parts) => ({ ...parts, fret: [{ fretNumber: 3 }, { fretNumber: 5 }, { fretNumber: 12 }] }));
  assert.equal(bench.freeFretNear(5), 4, 'the nearest free place to an occupied one (ties go to the lower)');
  assert.equal(bench.freeFretNear(12, 12), 12, 'a wire being moved may stay where it is');
  assert.equal(bench.freeFretNear(5, 3), 4, 'while moving the wire at 3, 5 is still taken');
  bench.addFret(7);
  assert.deepEqual(bench.fretNumbers, [3, 5, 7, 12]);
  const index = bench.fretItems.findIndex((f) => f.fretNumber === 12);
  bench.moveFret(index, 15);
  assert.deepEqual(bench.fretNumbers, [3, 5, 7, 15]);
  bench.removeFret(bench.fretItems.findIndex((f) => f.fretNumber === 7));
  assert.deepEqual(bench.fretNumbers, [3, 5, 15]);
  const only = steelGuitar((parts) => ({ ...parts, fret: [{ fretNumber: 2 }] }));
  assert.equal(only.canRemoveFret(), false, 'the neck keeps at least one fret');
  const full = steelGuitar((parts) => ({ ...parts, fret: Array.from({ length: 24 }, (_, k) => ({ fretNumber: k + 1 })) }));
  assert.equal(full.canAddFret(), false);
  assert.equal(full.freeFretNear(3), null, 'no free place on a full neck');
});

test('a string can only be stopped where there is a wire, and the range follows the highest one', () => {
  const bench = steelGuitar();
  assert.deepEqual(bench.stringForMidi(44), { string: 0, fret: 4 }, 'G sharp 2 is the fourth fret of the low string');
  assert.deepEqual(bench.playableRange(), { lowMidi: 40, highMidi: 64 + 19 });
  bench.removeFret(bench.fretItems.findIndex((f) => f.fretNumber === 4));
  assert.equal(bench.stringForMidi(44), null, 'with that wire out nothing sounds that note');
  assert.deepEqual(bench.stringForMidi(40), { string: 0, fret: 0 }, 'an open string needs no wire');
  assert.deepEqual(bench.stringForMidi(45), { string: 1, fret: 0 });
  bench.removeFret(bench.fretItems.findIndex((f) => f.fretNumber === 19));
  assert.equal(bench.playableRange().highMidi, 64 + 18);
  bench.addFret(24);
  assert.equal(bench.playableRange().highMidi, 64 + 24);
});

test('undo puts frets back, and a pickup too', () => {
  const bench = steelGuitar();
  bench.removeFret(0);
  bench.fitPickup(120);
  assert.equal(bench.commit(), true);
  assert.equal(bench.fretNumbers.includes(1), false);
  assert.deepEqual(bench.pickup, { atMm: 120 });
  assert.equal(bench.undo(), true);
  assert.equal(bench.fretNumbers.includes(1), true);
  assert.equal(bench.pickup, null);
});

test('the neck is drawn with the wires it has, and a new wire can land in any of the 24 places', () => {
  const bench = steelGuitar((parts) => ({ ...parts, fret: [{ fretNumber: 2 }, { fretNumber: 7 }, { fretNumber: 12 }] }));
  const lay = layout(bench);
  assert.deepEqual(lay.fretNumbers, [2, 7, 12]);
  assert.equal(lay.fretX.length, 24);
  assert.ok(Math.abs(lay.fretX[11] - (lay.nutX + lay.scale / 2)) < 1e-6, 'twelve is half way along the string');
  assert.ok(lay.boardEnd < lay.fretX[12], 'the board stops a little past the last wire');
  const all = layout(steelGuitar());
  assert.ok(all.boardEnd > lay.boardEnd);
  // the slot a point is nearest to, by distance along the neck
  assert.equal(fretSlotNear(lay, lay.fretX[4] + 0.2), 5);
  assert.equal(fretSlotNear(lay, lay.nutX + 1), 1);
  assert.equal(fretSlotNear(lay, lay.bridgeX), 24);
});

test('a pickup is placed by its distance from the bridge, only over the strings, and is drawn there', () => {
  const bench = steelGuitar();
  assert.equal(layout(bench).pickup, null);
  assert.equal(bench.pickup, null);
  const lay = layout(bench);
  assert.equal(pickupAtPoint(lay, bench, lay.bridgeX - 110, 0), 110);
  assert.equal(pickupAtPoint(lay, bench, lay.bridgeX - 110, 8), 110, 'between the strings or on one');
  assert.equal(pickupAtPoint(lay, bench, lay.bridgeX - 110, 200), null, 'off to the side it is not over the strings');
  assert.equal(pickupAtPoint(lay, bench, lay.bridgeX + 30, 0), null, 'past the bridge');
  assert.equal(pickupAtPoint(lay, bench, lay.nutX - 30, 0), null, 'behind the nut');
  assert.equal(pickupAtPoint(lay, bench, lay.bridgeX - 2, 0), null, 'on the bridge itself');
  assert.equal(pickupAtPoint(lay, bench, lay.bridgeX - 3000, 0), null);
  bench.fitPickup(110);
  assert.deepEqual(bench.pickup, { atMm: 110 });
  assert.ok(Math.abs(layout(bench).pickup.x - (lay.bridgeX - 110)) < 1e-9);
  bench.fitPickup(9999);
  assert.equal(bench.pickup.atMm, bench.pickupDef.max, 'clamped to the engine\'s range');
  assert.equal(bench.toDocument().params.pickupFit, 'magnetic');
  bench.removePickup();
  assert.equal(bench.pickup, null);
  assert.equal(bench.toDocument().params.pickupFit, 'none');
});

// ---------------------------------------------------------------- the sound

const first = () => {
  const { params, parts } = normalizeInstrument(guitar.schema, guitar.gallery[0]);
  return { ...params, ...parts.string[0] };
};
const render = (extra) => {
  const flat = { ...first(), ...extra };
  const { lowMidi } = guitar.describe(flat);
  return guitar.render(flat, normalizeNote({ midi: lowMidi + 5, velocity: 0.7, durationS: 1.2 }, guitar.limits)).pcm;
};
const rms = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
const relDiff = (a, b) => Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0) / a.length) / rms(a);

test('a fitted pickup takes the sound from the strings, not the body, and where it sits changes the tone', () => {
  const acoustic = render({});
  const bridge = render({ pickupFit: 'magnetic', pickupAtMm: 40 });
  const middle = render({ pickupFit: 'magnetic', pickupAtMm: 110 });
  const neck = render({ pickupFit: 'magnetic', pickupAtMm: 300 });
  for (const pcm of [acoustic, bridge, middle, neck]) assert.ok(pcm.every(Number.isFinite) && rms(pcm) > 0);
  assert.ok(relDiff(middle, acoustic) > 0.3 && rms(middle) !== rms(acoustic), 'not the body\'s sound');
  assert.ok(relDiff(bridge, neck) > 0.3, 'bridge and neck positions are not the same tone');
  assert.ok(relDiff(bridge, middle) > 0.1 && relDiff(middle, neck) > 0.1, 'moving it along changes it');
  // no pickup is the acoustic sound exactly: "none" is the same call as before
  assert.deepEqual(Array.from(render({ pickupFit: 'none', pickupAtMm: 300 })), Array.from(acoustic), 'the position does nothing without a pickup');
});

test('a pickup placed past the end of a fretted note still lets every note sound', () => {
  const flat = { ...first(), pickupFit: 'magnetic', pickupAtMm: 450 };
  const { lowMidi } = guitar.describe(flat);
  for (const fret of [0, 12, 24]) {
    const pcm = guitar.render(flat, normalizeNote({ midi: lowMidi + fret, velocity: 0.7, durationS: 0.6 }, guitar.limits)).pcm;
    assert.ok(pcm.every(Number.isFinite) && rms(pcm) > 0, `fret ${fret}`);
  }
});

test('levelling measures the pickup sound too, so a pickup does not change how loud the instrument is', () => {
  const flat = { ...first(), pickupFit: 'magnetic', pickupAtMm: 110 };
  const lv = guitar.levelling(flat);
  assert.equal(lv.params.pickupFit, 'magnetic');
  assert.equal(lv.params.pickupAtMm, 110);
  const { pcm } = guitar.render(lv.params, normalizeNote({ midi: lv.note.midi, velocity: 0.7, durationS: 1.2 }, guitar.limits));
  assert.ok(pcm.reduce((m, v) => Math.max(m, Math.abs(v)), 0) > 0);
});

test('a pickup past the end of a fretted note is over the dead string: that note is thin and very quiet, and the sound follows the drawing', () => {
  const flat = { ...first(), pickupFit: 'magnetic' };
  const { lowMidi } = guitar.describe(flat);
  const soundingMm = flat.scaleLengthMm / 2; // twelve semitones up, measured from the bridge
  const fret12 = (pickupAtMm) => guitar.render({ ...flat, pickupAtMm }, normalizeNote({ midi: lowMidi + 12, velocity: 0.7, durationS: 1 }, guitar.limits)).pcm;
  const live = fret12(120);
  const near = fret12(soundingMm + 25);
  const far = fret12(soundingMm + 125);
  for (const pcm of [live, near, far]) assert.ok(pcm.every(Number.isFinite) && rms(pcm) > 0);
  assert.ok(rms(near) < 0.1 * rms(live), `just past the finger: ${rms(near)} against ${rms(live)}`);
  assert.ok(rms(far) < 0.6 * rms(near), 'the further along the dead string, the quieter');
  assert.notDeepEqual(Array.from(near), Array.from(far), 'where it sits is not thrown away');
  // thin: what is left is the top of the sound (the energy of its first difference against its own)
  const brightness = (a) => a.reduce((t, v, i) => t + (i ? (v - a[i - 1]) ** 2 : 0), 0) / a.reduce((t, v) => t + v * v, 0);
  assert.ok(brightness(near) > 3 * brightness(live), 'what is heard is the high partials');
  // just inside the live string it is a pickup on a sounding string, not dead
  assert.ok(rms(fret12(soundingMm - 30)) > 0.3 * rms(live));
});

test('a plug-in whose frets may not be below the third still gets a valid default neck, and a short range is not run over', () => {
  const withMin = (min, standard) => {
    const schema = structuredClone(guitar.schema);
    schema.params.find((p) => p.role === 'fretNumber').min = min;
    schema.params.find((p) => p.role === 'fretNumber').default = min;
    schema.parts.find((p) => p.role === 'fret').standard = standard;
    const engine = { ...guitar, schema };
    const bench = new Bench(publicDescription(engine), materials);
    const entry = guitar.gallery[0];
    bench.load({ name: entry.name, params: entry.params, parts: { string: entry.parts.string } });
    return { bench, schema };
  };
  const { bench, schema } = withMin(3, 19);
  assert.deepEqual(bench.fretNumbers, Array.from({ length: 19 }, (_, k) => k + 3));
  const doc = bench.toDocument();
  assert.doesNotThrow(() => normalizeInstrument(schema, { params: doc.params, parts: doc.parts }), 'the default neck is a valid one for the engine');
  const short = withMin(10, 24).bench;
  assert.deepEqual(short.fretNumbers, Array.from({ length: 15 }, (_, k) => k + 10), 'from the tenth to the twenty-fourth, no more than there are places');
});

test('a fret role that is not a whole-number parameter is refused when the engine loads, so no wire can sit between two places', () => {
  const schema = structuredClone(guitar.schema);
  delete schema.params.find((p) => p.role === 'fretNumber').integer;
  const gallery = guitar.gallery.map((g, i) => (i ? g : { ...g, parts: { ...g.parts, fret: [{ fretNumber: 1 }, { fretNumber: 1.5 }] } }));
  assert.throws(() => checkEngine({ ...guitar, schema, gallery }), /fretNumber.*whole number/);
});

test('a neck that may have only a few wires and says no ordinary count gets no more than it may have, and one that cannot reach its minimum is refused', () => {
  const edit = (change) => {
    const schema = structuredClone(guitar.schema);
    change(schema.parts.find((p) => p.role === 'fret'), schema.params.find((p) => p.role === 'fretNumber'));
    return schema;
  };
  const few = edit((part) => { part.max = 3; delete part.standard; });
  const gallery = guitar.gallery.map((g) => ({ ...g, parts: { ...g.parts, fret: [{ fretNumber: 2 }, { fretNumber: 5 }, { fretNumber: 7 }] } }));
  const engine = { ...guitar, schema: few, gallery };
  assert.doesNotThrow(() => checkEngine(engine));
  const bench = new Bench(publicDescription(engine), materials);
  const entry = guitar.gallery[0];
  bench.load({ name: entry.name, params: entry.params, parts: { string: entry.parts.string } });
  assert.deepEqual(bench.fretNumbers, [1, 2, 3], 'three wires, as many as the part allows');
  const doc = bench.toDocument();
  assert.doesNotThrow(() => normalizeInstrument(few, { params: doc.params, parts: doc.parts }), 'and the document it makes is a valid one');
  // two places to put wires, but at least three wanted: nothing could ever be a valid neck
  const cramped = edit((part, fret) => { part.min = 3; part.max = 5; part.standard = 3; fret.min = 1; fret.max = 2; fret.default = 1; });
  assert.throws(() => checkEngine({ ...guitar, schema: cramped, gallery }), /2 places for a wire, but the part "fret" must have at least 3/);
});
