// SPDX-License-Identifier: GPL-3.0-only
// What an engine must provide to be put on the drums bench (parts and parameters found by role, never by id), and
// what the page's drum model does with them: tuning, the notes the keys reach, what is sent to be rendered.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { loadEngines, checkEngine, publicDescription } from '../engines/registry.mjs';
import { normalizeParams, normalizeNote } from '../engines/schema.mjs';

register('./shared-loader.mjs', import.meta.url);
const { DrumsBench, lugCount } = await import('../web/js/bench/drums/model.js');
const { DrumsSound, angleKey } = await import('../web/js/bench/drums/sound.js');
const { layout, drumAt, slotAt, strikePlace } = await import('../web/js/bench/drums/geometry.js');

const { engines } = await loadEngines({ env: { STUDIO_ENGINE_DIRS: '' } });
const drums = engines.get('drum-bench');
const materials = JSON.parse(readFileSync(new URL('../engines/materials.json', import.meta.url), 'utf8')).materials;

const withSchema = (edit) => ({ ...drums, schema: edit(structuredClone(drums.schema)) });
const param = (s, role) => s.params.find((p) => p.role === role);

/** The engine again with every part and parameter under an id of its own; roles stay as they were. */
function renamed(source, prefix) {
  const cap = (id) => id[0].toUpperCase() + id.slice(1);
  const partIds = Object.fromEntries(source.schema.parts.map((p) => [p.role, `${prefix}${cap(p.id)}`]));
  const newId = (id) => `${prefix}${cap(id)}`;
  const oldId = (id) => id[prefix.length].toLowerCase() + id.slice(prefix.length + 1);
  const roleOfPart = (id) => source.schema.parts.find((q) => q.id === id).role;
  const schema = structuredClone(source.schema);
  schema.parts = source.schema.parts.map((p) => ({ ...p, id: partIds[p.role] }));
  schema.params = source.schema.params.map((p) => ({
    ...p, id: newId(p.id), ...(p.part === undefined ? {} : { part: partIds[roleOfPart(p.part)] }),
    ...(p.visibleWhen ? { visibleWhen: Object.fromEntries(Object.entries(p.visibleWhen).map(([dep, allowed]) => [newId(dep), allowed])) } : {}),
  }));
  const toOriginal = (params) => Object.fromEntries(Object.entries(params).map(([k, v]) => [oldId(k), v]));
  const toNew = (params) => Object.fromEntries(Object.entries(params).map(([k, v]) => [newId(k), v]));
  return {
    ...source,
    meta: { ...source.meta, id: `renamed-${source.meta.id}`, name: 'Renamed', description: 'The same instrument under other ids' },
    schema,
    gallery: source.gallery.map((g) => ({
      ...g, id: `${prefix}-${g.id}`, params: toNew(g.params),
      parts: Object.fromEntries(Object.entries(g.parts).map(([id, items]) => [partIds[roleOfPart(id)], items.map(toNew)])),
    })),
    render: (params, note) => source.render(toOriginal(params), note),
    describe: (params) => source.describe(toOriginal(params)),
    toOriginal,
  };
}

test('a drums engine that gives its parts and parameters no roles is refused, naming what is missing', () => {
  const unroled = withSchema((s) => { s.params.forEach((p) => delete p.role); s.parts.forEach((p) => delete p.role); return s; });
  assert.throws(() => checkEngine(unroled), /has no role, but its id is the name of a role the bench uses/);
  const strange = {
    ...drums,
    schema: {
      groups: [{ id: 'g', label: 'G' }],
      parts: [{ id: 'skin', label: 'Skin', min: 1, max: 4 }],
      params: [{ id: 'pull', type: 'number', layer: 'plain', group: 'g', label: 'Pull', help: 'How hard.', min: 100, max: 9000, default: 3000, part: 'skin', physical: 'tension' }],
    },
    gallery: [{ id: 'x', name: 'X', description: 'x', params: {}, parts: { skin: [{}] } }],
  };
  assert.throws(() => checkEngine(strange), (error) => {
    assert.match(error.message, /struck-membranes bench[^.]*does not find: a part with the role "drum"/);
    for (const role of ['strikeAt', 'strikeAngle', 'stickHardness']) assert.ok(error.message.includes(role), `${role} is named`);
    return true;
  });
});

test('a drums engine is refused for a missing role, a wrong kind, or a role of another bench', () => {
  const drop = (role) => withSchema((s) => { s.params = s.params.filter((p) => p.role !== role); return s; });
  assert.throws(() => checkEngine(drop('headTension')), /headTension \(a number on each drum\)/);
  assert.throws(() => checkEngine(drop('strikeAngle')), /strikeAngle \(a number\)/);
  assert.throws(() => checkEngine(withSchema((s) => { param(s, 'shellClosed').type = 'number'; Object.assign(param(s, 'shellClosed'), { min: 0, max: 1, default: 0 }); return s; })), /shellClosed is a number but its role "shellClosed" is a toggle/);
  assert.throws(() => checkEngine(withSchema((s) => { param(s, 'headTension').role = 'tensionN'; return s; })), /does not know: headTension \(role "tensionN" on part "drum"\)/);
  assert.throws(() => checkEngine(withSchema((s) => { s.parts[0].role = 'bar'; return s; })), /the role "bar", which the struck-membranes bench does not know/);
  assert.throws(() => checkEngine({ ...drums, bench: { ...drums.bench, hands: [{ id: 'x', name: 'X', params: { malletHardness: 1 } }] } }), /"malletHardness" is not a shared role/);
  assert.throws(() => checkEngine(withSchema((s) => { param(s, 'headMaterial').options.push({ value: 'unobtanium', label: 'Unobtanium' }); return s; })), /offers "unobtanium".*materials\.json/);
});

test('the film in the materials list is a head and not a string or a bar', () => {
  const film = materials.filter((m) => m.family === 'film');
  assert.deepEqual(film.map((m) => m.id), ['pet-film']);
  assert.ok(film[0].source.locator && film[0].densityKgM3 > 1000 && film[0].densityKgM3 < 1500);
  // the other benches offer their own families, which do not include it
  for (const id of ['guitar-bench', 'bars-bench']) {
    const e = engines.get(id);
    const offered = e.schema.params.filter((p) => p.type === 'choice' && p.options).flatMap((p) => p.options.map((o) => o.value));
    assert.ok(!offered.includes('pet-film'), `${id} does not offer it`);
  }
});

test('a drums engine whose parts and parameters carry the roles under ids of its own is put on the bench, and plays the same', () => {
  const variant = renamed(drums, 'x');
  assert.doesNotThrow(() => checkEngine(variant));
  const bench = new DrumsBench(publicDescription(variant), materials);
  const entry = variant.gallery.find((g) => g.id.endsWith('tom-trio'));
  bench.load({ name: entry.name, params: entry.params, parts: entry.parts });
  assert.equal(bench.partId, 'xDrum');
  assert.deepEqual(bench.drums.map((_, i) => bench.info(i).note.name), ['A3', 'E3', 'B2']);
  assert.ok(bench.drums.every((_, i) => bench.info(i).playable && Math.abs(bench.info(i).note.cents) <= 50));
  assert.equal(bench.params.stickHardness, 0.8);
  // the saved file is in the engine's own ids, and opens again to the same instrument
  const doc = bench.toDocument();
  assert.ok('xStrikeAt' in doc.params && !('strikeAt' in doc.params));
  assert.ok(doc.parts.xDrum[0].xHeadTension > 0 && doc.parts.xDrum[0].xShellClosed === false);
  const again = new DrumsBench(publicDescription(variant), materials);
  again.load(doc);
  assert.deepEqual(again.toDocument(), doc);
  // a custom-head form is keyed by role, and its "only when" follows
  const form = bench.formSchema(bench.schema.params.filter((p) => p.part && p.role === 'headCustomDensity'));
  assert.deepEqual(form.params.map((p) => p.id), ['headCustomDensity']);
  assert.deepEqual(form.params[0].visibleWhen, { headMaterial: ['custom'] });
  // what the page sends to be rendered is in the engine's ids, and renders the very same blow
  const original = new DrumsBench(publicDescription(drums), materials);
  const first = drums.gallery.find((g) => g.id === 'tom-trio');
  original.load({ name: 'o', params: first.params, parts: first.parts });
  const place = { at: 0.65, angle: 40, velocity: 0.7 };
  const spec = new DrumsSound({ context: null, bench }).strikeSpec(2, place);
  const baseSpec = new DrumsSound({ context: null, bench: original }).strikeSpec(2, place);
  assert.ok(Object.keys(spec.params).every((k) => /^x[A-Z]/.test(k)), 'only the engine\'s own ids are sent');
  assert.deepEqual(variant.toOriginal(spec.params), baseSpec.params);
  assert.equal(spec.midi, baseSpec.midi);
  const note = normalizeNote({ midi: spec.midi, velocity: spec.layer, durationS: 0.4 }, drums.limits);
  const a = variant.render(normalizeParams(variant.schema, spec.params), note);
  const b = drums.render(normalizeParams(drums.schema, baseSpec.params), note);
  assert.ok(a.pcm.some((x) => x !== 0));
  assert.deepEqual(Array.from(a.pcm).slice(0, 4000), Array.from(b.pcm).slice(0, 4000));
  assert.ok(bench.rack.length >= 5 && bench.rack.every((r) => Number.isFinite(r.params.headTension) && typeof r.params.headMaterial === 'string'));
});

const loaded = (id = 'tom-trio') => {
  const bench = new DrumsBench(publicDescription(drums), materials);
  const entry = drums.gallery.find((g) => g.id === id);
  bench.load({ name: entry.name, params: entry.params, parts: entry.parts });
  return bench;
};

test('tuning a drum to its nearest note puts the head on it, the keys reach the drum that has the note, and a head that cannot reach is refused', () => {
  const bench = loaded();
  bench.setDrum(1, { headTension: Math.round(bench.drums[1].headTension * 1.03) });
  assert.notEqual(bench.info(1).note.cents, 0);
  assert.ok(bench.tuneTo(1));
  assert.ok(Math.abs(bench.info(1).note.cents) <= 1, `${bench.info(1).note.cents} cents`);
  assert.equal(bench.drumForMidi(52), 1);
  assert.equal(bench.drumForMidi(57), 0);
  assert.equal(bench.drumForMidi(60), null);
  assert.deepEqual(bench.playableRange(), { lowMidi: 47, highMidi: 57 });
  // a note no tension in range can give, for this size of head
  bench.setDrum(0, { headDiameterMm: 1100, headThicknessUm: 800 });
  assert.equal(bench.tensionFor(0, 100), null);
  // a heavier head is lower for the same tension; the shell's material does not move the note
  const before = bench.info(2).hz;
  bench.setDrum(2, { headThicknessUm: 380 });
  assert.ok(bench.info(2).hz < before);
  bench.setDrum(2, { headThicknessUm: 190 });
  bench.setDrum(2, { shellMaterial: 'brass' });
  assert.ok(Math.abs(bench.info(2).hz / before - 1) < 1e-12);
});

test('a strike is kept to the nearest place that sounds the same, and the mirror image of a strike is the same strike', () => {
  assert.equal(angleKey(40), 30);
  assert.equal(angleKey(320), angleKey(40), 'either side of the line to the listener');
  assert.equal(angleKey(180), 180);
  assert.equal(angleKey(-90), angleKey(90));
  const bench = loaded();
  const sound = new DrumsSound({ context: null, bench });
  const a = sound.strikeSpec(0, { at: 0.52, angle: 40, velocity: 0.7 });
  const b = sound.strikeSpec(0, { at: 0.5, angle: 320, velocity: 0.7 });
  assert.equal(a.config, b.config);
  assert.equal(a.dist, b.dist, 'the same note is looked up');
  assert.deepEqual(a.params, b.params);
  const c = sound.strikeSpec(0, { at: 0.8, angle: 40, velocity: 0.7 });
  assert.notEqual(a.dist, c.dist);
  assert.equal(a.config, c.config, 'one drum, one set of notes');
  // the shell's material is not sent, so a different shell does not remake the notes
  const wood = sound.strikeSpec(1, { velocity: 0.7 });
  bench.setDrum(1, { shellMaterial: 'brass' });
  assert.equal(sound.strikeSpec(1, { velocity: 0.7 }).config, wood.config);
  bench.setDrum(1, { headTension: bench.drums[1].headTension + 100 });
  assert.notEqual(sound.strikeSpec(1, { velocity: 0.7 }).config, wood.config);
});

test('the row of drums is laid out at true size, a press finds the drum and the place on its head, and a new drum goes in where it is dropped', () => {
  const bench = loaded();
  const lay = layout(bench, 0);
  assert.deepEqual(lay.drums.map((d) => d.D), [254, 305, 356]);
  for (let i = 1; i < lay.drums.length; i++) assert.ok(lay.drums[i].x - lay.drums[i].R > lay.drums[i - 1].x + lay.drums[i - 1].R, 'no two shells overlap');
  const mid = lay.drums[1];
  const hit = drumAt(lay, mid.x + 0.5 * mid.R, 0);
  assert.equal(hit.i, 1);
  assert.ok(Math.abs(hit.r - 0.5) < 1e-9 && Math.abs(hit.angle) < 1e-9);
  assert.ok(Math.abs(drumAt(lay, mid.x, mid.R * 0.4).angle - 90) < 1e-9, 'straight down the page is 90 degrees');
  assert.equal(drumAt(lay, (lay.drums[0].x + lay.drums[1].x) / 2, 0), null, 'between two drums there is no head');
  assert.deepEqual(strikePlace({ r: 1.02, angle: 200.4 }), { at: 0.95, angle: 200 }, 'the rim itself is kept off');
  assert.equal(slotAt(lay, lay.drums[0].x - 10), 0);
  assert.equal(slotAt(lay, (lay.drums[0].x + lay.drums[1].x) / 2), 1);
  assert.equal(slotAt(lay, lay.drums[2].x + 10), 3);
  // pinned, a drum made wider keeps its centre while the others move
  bench.setDrum(1, { headDiameterMm: 500 });
  const pinned = layout(bench, 0, { i: 1, x: mid.x });
  assert.equal(pinned.drums[1].x, mid.x);
  assert.ok(pinned.drums[2].x > lay.drums[2].x - 1);
  assert.equal(lugCount(178), 4);
  assert.equal(lugCount(305), 6);
  assert.equal(lugCount(660), 10);
});
