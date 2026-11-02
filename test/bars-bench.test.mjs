// SPDX-License-Identifier: GPL-3.0-only
// What the bars bench keeps, and does the arithmetic of, as bars are stretched, carved, swapped and hung with tubes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { loadEngines, publicDescription } from '../engines/registry.mjs';

register('./shared-loader.mjs', import.meta.url);
const { BarsBench } = await import('../web/js/bench/bars/model.js');
const { BarsSound } = await import('../web/js/bench/bars/sound.js');
const { layout, slotAt, barAt, strikeFraction } = await import('../web/js/bench/bars/geometry.js');

const { engines } = await loadEngines({ env: { STUDIO_ENGINE_DIRS: '' } });
const description = publicDescription(engines.get('bars-bench'));
const materials = JSON.parse(readFileSync(new URL('../engines/materials.json', import.meta.url), 'utf8')).materials;

function bench(id = 'maple-xylophone') {
  const b = new BarsBench(description, materials);
  const entry = description.gallery.find((g) => g.id === id);
  b.load({ name: entry.name, params: entry.params, parts: entry.parts });
  return b;
}

test('the bench keeps the gallery bars by role, and gives back a document the engine accepts', () => {
  const b = bench();
  assert.equal(b.bars.length, 8);
  assert.deepEqual(b.bars.map((_, i) => b.info(i).note.name), ['C5', 'D5', 'E5', 'F5', 'G5', 'A5', 'B5', 'C6']);
  assert.ok(b.bars.every((_, i) => Math.abs(b.info(i).note.cents) <= 3));
  const doc = b.toDocument();
  const again = new BarsBench(description, materials);
  again.load(doc);
  assert.deepEqual(again.bars, b.bars);
});

test('stretching a bar lowers its note and carving it lowers it again; both are one step to undo', () => {
  const b = bench('single-maple-bar');
  const was = b.info(0).hz;
  b.setBar(0, { barLengthMm: b.bars[0].barLengthMm * 1.1 });
  b.commit();
  assert.ok(b.info(0).hz < was * 0.84, 'a tenth longer is about 1.7 semitones down (hz goes as 1/L²)');
  const stretched = b.info(0).hz;
  b.setBar(0, { barUndercut: 1 });
  b.commit();
  assert.ok(b.info(0).hz < stretched * 0.6);
  assert.ok(Math.abs(b.info(0).modes[1] / b.info(0).modes[0] - 4) < 0.01);
  assert.ok(b.undo());
  assert.equal(b.bars[0].barUndercut, 0);
  assert.ok(b.undo());
  assert.ok(Math.abs(b.info(0).hz - was) < 1e-9);
});

test('cutting a bar to its nearest note, and to a note it cannot reach', () => {
  const b = bench('single-maple-bar');
  b.setBar(0, { barLengthMm: b.bars[0].barLengthMm + 3.3 });
  assert.ok(Math.abs(b.info(0).note.cents) > 5);
  assert.ok(b.cutTo(0));
  assert.ok(Math.abs(b.info(0).note.cents) <= 1);
  assert.equal(b.lengthFor(0, 0), null, 'a note that would need a bar longer than the bench allows');
  assert.equal(b.cutTo(0, 20), false);
});

test('a bar made of another material is cut again to the note it had', () => {
  const b = bench('single-maple-bar');
  const note = b.info(0).note.name;
  for (const barMaterial of ['steel-music-wire', 'brass', 'western-redcedar', 'american-basswood']) {
    assert.equal(b.swapMaterial(0, { barMaterial }), true, barMaterial);
    assert.equal(b.info(0).note.name, note, barMaterial);
    assert.ok(Math.abs(b.info(0).note.cents) <= 1, barMaterial);
  }
  assert.notEqual(b.bars[0].barLengthMm, 0);
});

test('a tube hung on a bar is cut to ring at its note', () => {
  const b = bench('single-maple-bar');
  b.setBar(0, { tubeFit: true, tubeLengthMm: b.tunedTubeMm(0) });
  assert.ok(Math.abs(b.info(0).tubeCents) <= 10, `${b.info(0).tubeCents} cents`);
  assert.equal(b.info(0).tubeHz > 0, true);
  b.setBar(0, { tubeFit: false });
  assert.equal(b.info(0).tubeHz, null);
});

test('the keyboard finds the bar cut to a note, and the range follows the bars', () => {
  const b = bench();
  assert.equal(b.barForMidi(72), 0);
  assert.equal(b.barForMidi(84), 7);
  assert.equal(b.barForMidi(73), null, 'no bar is cut to C sharp');
  assert.deepEqual(b.playableRange(), { lowMidi: 72, highMidi: 84 });
  b.removeBar(0);
  assert.equal(b.barForMidi(72), null);
});

test('bars come and go within what the frame takes, and the row is laid out about its middle', () => {
  const b = bench('single-maple-bar');
  assert.equal(b.canRemoveBar(), false, 'a frame keeps at least one bar');
  for (let i = 0; i < 11; i++) b.insertBar(b.bars.length, b.rack[0].params);
  assert.equal(b.bars.length, 12);
  assert.equal(b.canAddBar(), false);
  const lay = layout(b, 0);
  assert.ok(Math.abs(lay.bars[0].x + lay.bars.at(-1).x) < 1e-9);
  assert.equal(slotAt(lay, -1000), 0);
  assert.equal(slotAt(lay, 1000), 12);
  assert.equal(slotAt(lay, lay.bars[3].x + 3), 4, 'right of a bar\'s middle goes after it');
  assert.equal(slotAt(lay, lay.bars[3].x - 3), 3, 'left of it, before it');
  const hit = barAt(lay, lay.bars[2].x, -lay.bars[2].half * 0.5);
  assert.equal(hit.i, 2);
  assert.ok(Math.abs(hit.u - 0.25) < 1e-9);
  assert.equal(barAt(lay, lay.bars[2].x + 23, 0), null, 'the gap between two bars');
  assert.ok(Math.abs(strikeFraction(0.9) - 0.1) < 1e-12);
});

test('a blow is asked for in the engine\'s ids, quantised, and the same blow is the same request', () => {
  const b = bench();
  const sound = new BarsSound({ context: null, bench: b });
  const a = sound.strikeSpec(1, { at: 0.301, velocity: 0.7 });
  const c = sound.strikeSpec(1, { at: 0.309, velocity: 0.72 });
  assert.equal(a.config, c.config, 'the same bar and mallet');
  assert.equal(a.midi, 74);
  assert.equal(a.params.strikeAt, 0.3);
  assert.equal(a.layer, c.layer);
  const harder = sound.strikeSpec(1, { at: 0.3, velocity: 0.7, hardness: 0.9 });
  assert.notEqual(harder.config, a.config, 'a harder mallet is another set of notes');
  assert.ok(!('frameWood' in a.params), 'the frame\'s wood does not change a note');
});
