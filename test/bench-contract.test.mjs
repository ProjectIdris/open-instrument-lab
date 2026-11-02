// SPDX-License-Identifier: GPL-3.0-only
// What an engine must provide to be put on the plucked-strings bench: parts and parameters found by their role,
// never by their id. An engine that gives no roles is refused in plain words; one that gives every role under
// ids of its own is put on the bench, and plays the same.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { loadEngines, checkEngine, publicDescription } from '../engines/registry.mjs';
import { validateSchema, normalizeParams, normalizeNote } from '../engines/schema.mjs';

register('./shared-loader.mjs', import.meta.url);
const { Bench } = await import('../web/js/bench/model.js');
const { BenchSound } = await import('../web/js/bench/sound.js');
const { BarsBench } = await import('../web/js/bench/bars/model.js');
const { BarsSound } = await import('../web/js/bench/bars/sound.js');

const { engines } = await loadEngines({ env: { STUDIO_ENGINE_DIRS: '' } });
const guitar = engines.get('guitar-bench');
const barsEngine = engines.get('bars-bench');
const materials = JSON.parse(readFileSync(new URL('../engines/materials.json', import.meta.url), 'utf8')).materials;

const withSchema = (edit) => ({ ...guitar, schema: edit(structuredClone(guitar.schema)) });
const param = (s, role) => s.params.find((p) => p.role === role);

/**
 * An engine again with every part and parameter under an id of its own, and its render and describe taking those
 * ids. Roles stay as they were: that is all the bench is allowed to go by.
 */
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

test('an engine that asks for the bench but gives its parts and parameters no roles is refused, naming what is missing', () => {
  // A string instrument that is plainly valid by the schema rules, but says nothing about what its parts are.
  const course = {
    ...guitar,
    schema: {
      groups: [{ id: 'g', label: 'G' }],
      parts: [{ id: 'course', label: 'Course', min: 1, max: 4 }],
      params: [{ id: 'gauge', type: 'number', layer: 'plain', group: 'g', label: 'Gauge', help: 'How thick.', min: 0.2, max: 2, default: 0.5, part: 'course', physical: 'diameter' }],
    },
    gallery: [{ id: 'x', name: 'X', description: 'x', params: {}, parts: { course: [{}] } }],
    bench: { kind: 'plucked-strings' },
  };
  assert.throws(() => checkEngine(course), (error) => {
    assert.match(error.message, /does not find: a part with the role "string"/);
    for (const role of ['scaleLengthMm', 'bridgeAtMm', 'pluckDistanceMm', 'topWood']) assert.ok(error.message.includes(role), `${role} is named`);
    assert.match(error.message, /Give each parameter its `role`/);
    assert.match(error.message, /docs\/engines\.md/);
    return true;
  });
  // Ids that happen to be the guitar's, with no roles, are no help: the bench goes by role, not by id.
  const unroled = withSchema((s) => { s.params.forEach((p) => delete p.role); s.parts.forEach((p) => delete p.role); return s; });
  assert.throws(() => checkEngine(unroled), /has no role, but its id is the name of a role the bench uses/);
});

test('each role must be there, of the right kind, on the right thing', () => {
  const drop = (role, part) => withSchema((s) => { s.params = s.params.filter((p) => !(p.role === role && p.part === part)); return s; });
  assert.throws(() => checkEngine(drop('tensionN', 'string')), /tensionN \(a number on each string\)/);
  assert.throws(() => checkEngine(drop('scaleLengthMm')), /scaleLengthMm \(a number\)/);
  assert.throws(() => checkEngine(withSchema((s) => { Object.assign(param(s, 'stringWound'), { type: 'number', min: 0, max: 1, default: 0 }); return s; })), /stringWound is a number but its role "stringWound" is a toggle/);
  assert.throws(() => checkEngine(withSchema((s) => { param(s, 'bridgeAtMm').part = 'string'; return s; })), /have a role the plucked-strings bench does not know: bridgeAtMm/);
  assert.throws(() => checkEngine(withSchema((s) => { param(s, 'tensionN').role = 'pull'; return s; })), /role "pull"/);
  assert.throws(() => checkEngine(withSchema((s) => { s.parts.find((p) => p.role === 'fret').role = 'wing'; return s; })), /the role "wing", which the plucked-strings bench does not know/);
});

test('a role may be given to only one part or parameter in its place, and must be written plainly', () => {
  const twice = structuredClone(guitar.schema);
  param(twice, 'scaleLengthMm').role = 'bridgeAtMm';
  assert.throws(() => validateSchema(twice), /role bridgeAtMm/);
  const twiceParts = structuredClone(guitar.schema);
  twiceParts.parts.find((p) => p.role === 'fret').role = 'string';
  assert.throws(() => validateSchema(twiceParts), /role string/);
  const odd = structuredClone(guitar.schema);
  param(odd, 'scaleLengthMm').role = 'Scale Length';
  assert.throws(() => validateSchema(odd), /role/);
});

test('an engine that does not ask for the bench is not held to any of this', () => {
  const plain = { ...guitar };
  delete plain.bench;
  assert.doesNotThrow(() => checkEngine(plain));
});

test('an engine whose parts and parameters carry the roles under ids of its own is put on the bench, and plays the same', () => {
  const variant = renamed(guitar, 'x');
  assert.doesNotThrow(() => checkEngine(variant));
  assert.notEqual(variant.schema.params[0].id, guitar.schema.params[0].id);
  const bench = new Bench(publicDescription(variant), materials);
  const entry = variant.gallery[0];
  bench.load({ name: entry.name, params: entry.params, parts: entry.parts });
  assert.equal(bench.partId, 'xString');
  assert.equal(bench.fretPartId, 'xFret');
  assert.deepEqual(bench.strings.map((_, i) => bench.info(i).note.name), ['E2', 'A2', 'D3', 'G3', 'B3', 'E4']);
  assert.ok(bench.strings.every((_, i) => Number.isFinite(bench.info(i).hz) && bench.info(i).playable));
  assert.deepEqual(bench.fretNumbers, Array.from({ length: 19 }, (_, k) => k + 1));
  // the bench keeps values by role, and the saved file is in the engine's own ids and valid for it
  assert.equal(bench.params.scaleLengthMm, guitar.gallery[0].params.scaleLengthMm);
  const doc = bench.toDocument();
  assert.ok('xScaleLengthMm' in doc.params && !('scaleLengthMm' in doc.params));
  assert.ok(doc.parts.xString[0].xTensionN > 0 && doc.parts.xFret[0].xFretNumber === 1);
  const again = new Bench(publicDescription(variant), materials);
  again.load(doc);
  assert.deepEqual(again.toDocument(), doc);

  // what the page sends to be rendered is in the engine's ids, and renders to the very same notes as the guitar's
  const original = new Bench(publicDescription(guitar), materials);
  original.load({ name: 'g', params: guitar.gallery[0].params, parts: guitar.gallery[0].parts });
  const sound = new BenchSound({ context: null, bench });
  const base = new BenchSound({ context: null, bench: original });
  const spec = sound.pluckSpec(2, { velocity: 0.7, fret: 3 });
  const baseSpec = base.pluckSpec(2, { velocity: 0.7, fret: 3 });
  assert.ok(Object.keys(spec.params).every((k) => /^x[A-Z]/.test(k)), 'only the engine\'s own ids are sent');
  assert.deepEqual(variant.toOriginal(spec.params), baseSpec.params);
  assert.equal(spec.midi, baseSpec.midi);
  assert.equal(spec.dist, baseSpec.dist);
  const note = normalizeNote({ midi: spec.midi, velocity: spec.layer, durationS: 0.4 }, guitar.limits);
  const a = variant.render(normalizeParams(variant.schema, spec.params), note);
  const b = guitar.render(normalizeParams(guitar.schema, baseSpec.params), note);
  const samples = (r) => Array.from(r.pcm).slice(0, 4000);
  assert.ok(samples(a).length > 0 && samples(a).some((x) => x !== 0));
  assert.deepEqual(samples(a), samples(b));

  // rack entries come to the bench keyed by role too
  assert.ok(bench.rack.length >= 3 && bench.rack.every((r) => Number.isFinite(r.params.stringDiameterMm) && typeof r.params.stringMaterial === 'string'));
});

test('without its frets or pickup roles an engine is still a bench, and a part that says its ordinary count gets it', () => {
  const bare = withSchema((s) => {
    s.parts = s.parts.filter((p) => p.role !== 'fret');
    s.params = s.params.filter((p) => p.part !== 'fret' && p.role !== 'pickupFit' && p.role !== 'pickupAtMm');
    return s;
  });
  bare.gallery = guitar.gallery.map((g) => {
    const { fret, ...parts } = g.parts;
    const { pickupFit, pickupAtMm, ...params } = g.params;
    return { ...g, params, parts };
  });
  assert.doesNotThrow(() => checkEngine(bare));
  const plain = new Bench(publicDescription(bare), materials);
  assert.equal(plain.hasFrets, false);
  assert.equal(plain.hasPickup, false);
  const short = withSchema((s) => { s.parts.find((p) => p.role === 'fret').standard = 12; return s; });
  const withShort = new Bench(publicDescription(short), materials);
  withShort.load({ name: 'x', params: guitar.gallery[0].params, parts: { string: guitar.gallery[0].parts.string } });
  assert.deepEqual(withShort.fretNumbers, Array.from({ length: 12 }, (_, k) => k + 1));
});

test('a pickup role with no partner, and a fret role that is not a whole number from 1, are refused in plain words', () => {
  assert.throws(() => checkEngine(withSchema((s) => { s.params = s.params.filter((p) => p.role !== 'pickupAtMm'); return s; })), /pickupAtMm \(it goes with pickupFit\)/);
  assert.throws(() => checkEngine(withSchema((s) => { param(s, 'fretNumber').min = 0; return s; })), /whole number/);
  assert.throws(() => checkEngine(withSchema((s) => { param(s, 'pickupFit').options = [{ value: 'none', label: 'None' }]; return s; })), /must offer the options "none" and "magnetic"/);
});

test('a string material the bench does not know is refused when the engine loads', () => {
  const odd = withSchema((s) => { param(s, 'stringMaterial').options.push({ value: 'unobtanium', label: 'Unobtanium' }); return s; });
  assert.throws(() => checkEngine(odd), /offers "unobtanium".*materials\.json/);
  const custom = withSchema((s) => s);
  assert.doesNotThrow(() => checkEngine(custom), 'the engine\'s own list, with "custom", is fine');
});

// ---------------------------------------------------------------- the struck-bars bench

const barsWith = (edit) => ({ ...barsEngine, schema: edit(structuredClone(barsEngine.schema)) });

test('a bars engine that gives its parts and parameters no roles is refused, naming what is missing', () => {
  const unroled = barsWith((s) => { s.params.forEach((p) => delete p.role); s.parts.forEach((p) => delete p.role); return s; });
  assert.throws(() => checkEngine(unroled), /has no role, but its id is the name of a role the bench uses/);
  // ids of its own and no roles at all: the bench does not guess from what a parameter is called
  const strange = {
    ...barsEngine,
    schema: {
      groups: [{ id: 'g', label: 'G' }],
      parts: [{ id: 'plank', label: 'Plank', min: 1, max: 4 }],
      params: [{ id: 'span', type: 'number', layer: 'plain', group: 'g', label: 'Span', help: 'How long.', min: 40, max: 900, default: 300, part: 'plank', physical: 'length' }],
    },
    gallery: [{ id: 'x', name: 'X', description: 'x', params: {}, parts: { plank: [{}] } }],
  };
  assert.throws(() => checkEngine(strange), (error) => {
    assert.match(error.message, /struck-bars bench[^.]*does not find: a part with the role "bar"/);
    for (const role of ['strikeAt', 'malletHardness']) assert.ok(error.message.includes(role), `${role} is named`);
    return true;
  });
});

test('a bars engine is refused for a missing role, a wrong kind, or a role of another bench', () => {
  const drop = (role) => barsWith((s) => { s.params = s.params.filter((p) => p.role !== role); return s; });
  assert.throws(() => checkEngine(drop('barLengthMm')), /barLengthMm \(a number on each bar\)/);
  assert.throws(() => checkEngine(drop('strikeAt')), /strikeAt \(a number\)/);
  assert.throws(() => checkEngine(barsWith((s) => { Object.assign(param(s, 'barLengthMm'), { type: 'choice', options: [{ value: 'a', label: 'A' }], default: 'a' }); delete param(s, 'barLengthMm').min; delete param(s, 'barLengthMm').max; return s; })), /role "barLengthMm" is a number/);
  assert.throws(() => checkEngine(barsWith((s) => { param(s, 'tubeFit').type = 'number'; Object.assign(param(s, 'tubeFit'), { min: 0, max: 1, default: 0 }); return s; })), /tubeFit is a number but its role "tubeFit" is a toggle/);
  // a guitar's role on a bars engine is not known to the bars bench
  assert.throws(() => checkEngine(barsWith((s) => { param(s, 'barLengthMm').role = 'tensionN'; return s; })), /does not know: barLengthMm \(role "tensionN" on part "bar"\)/);
  assert.throws(() => checkEngine(barsWith((s) => { s.parts[0].role = 'string'; return s; })), /the role "string", which the struck-bars bench does not know/);
  assert.throws(() => checkEngine({ ...barsEngine, bench: { ...barsEngine.bench, hands: [{ id: 'x', name: 'X', params: { tensionN: 1 } }] } }), /"tensionN" is not a shared role/);
});

test('a bars engine whose parts and parameters carry the roles under ids of its own is put on the bench, and plays the same', () => {
  const variant = renamed(barsEngine, 'x');
  assert.doesNotThrow(() => checkEngine(variant));
  const bench = new BarsBench(publicDescription(variant), materials);
  const entry = variant.gallery.find((g) => g.id.endsWith('basswood-marimba'));
  bench.load({ name: entry.name, params: entry.params, parts: entry.parts });
  assert.equal(bench.partId, 'xBar');
  assert.equal(bench.bars.length, 8);
  assert.ok(bench.bars.every((b, i) => Number.isFinite(bench.info(i).hz) && bench.info(i).playable && Math.abs(bench.info(i).note.cents) <= 3), 'the bars are cut to their notes');
  assert.equal(bench.params.malletHardness, barsEngine.gallery.find((g) => g.id === 'basswood-marimba').params.malletHardness);
  // the saved file is in the engine's own ids, and opens again to the same instrument
  const doc = bench.toDocument();
  assert.ok('xStrikeAt' in doc.params && !('strikeAt' in doc.params));
  assert.ok(doc.parts.xBar[0].xBarLengthMm > 0 && doc.parts.xBar[0].xTubeFit === true);
  const again = new BarsBench(publicDescription(variant), materials);
  again.load(doc);
  assert.deepEqual(again.toDocument(), doc);
  // a custom-material form is keyed by role, and its "only when" follows
  const form = bench.formSchema(bench.schema.params.filter((p) => p.part && /Custom/.test(p.role)));
  assert.deepEqual(form.params.map((p) => p.id), ['barCustomDensity', 'barCustomModulus']);
  assert.deepEqual(form.params[0].visibleWhen, { barMaterial: ['custom'] });
  // what the page sends to be rendered is in the engine's ids, and renders the very same blow
  const original = new BarsBench(publicDescription(barsEngine), materials);
  const first = barsEngine.gallery.find((g) => g.id === 'basswood-marimba');
  original.load({ name: 'o', params: first.params, parts: first.parts });
  const spec = new BarsSound({ context: null, bench }).strikeSpec(2, { at: 0.3, velocity: 0.7 });
  const baseSpec = new BarsSound({ context: null, bench: original }).strikeSpec(2, { at: 0.3, velocity: 0.7 });
  assert.ok(Object.keys(spec.params).every((k) => /^x[A-Z]/.test(k)), 'only the engine\'s own ids are sent');
  assert.deepEqual(variant.toOriginal(spec.params), baseSpec.params);
  assert.equal(spec.midi, baseSpec.midi);
  const note = normalizeNote({ midi: spec.midi, velocity: spec.layer, durationS: 0.4 }, barsEngine.limits);
  const a = variant.render(normalizeParams(variant.schema, spec.params), note);
  const b = barsEngine.render(normalizeParams(barsEngine.schema, baseSpec.params), note);
  assert.ok(a.pcm.some((x) => x !== 0));
  assert.deepEqual(Array.from(a.pcm).slice(0, 4000), Array.from(b.pcm).slice(0, 4000));
  assert.ok(bench.rack.length >= 4 && bench.rack.every((r) => Number.isFinite(r.params.barLengthMm) && typeof r.params.barMaterial === 'string'));
});
