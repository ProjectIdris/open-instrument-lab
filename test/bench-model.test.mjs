// SPDX-License-Identifier: GPL-3.0-only
// The workbench's own arithmetic (the page's model and geometry), run in Node.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { loadEngines, publicDescription } from '../engines/registry.mjs';

register('./shared-loader.mjs', import.meta.url);
const { Bench } = await import('../web/js/bench/model.js');
const { layout, stringAt, slotAt, onNeck, FRETS } = await import('../web/js/bench/geometry.js');

const { engines } = await loadEngines({ env: { STUDIO_ENGINE_DIRS: '' } });
const description = publicDescription(engines.get('guitar-bench'));
const materials = JSON.parse(readFileSync(new URL('../engines/materials.json', import.meta.url), 'utf8')).materials;

function steelGuitar() {
  const bench = new Bench(description, materials);
  const entry = description.gallery[0];
  bench.load({ name: entry.name, params: entry.params, parts: entry.parts });
  return bench;
}

test('a loaded guitar has its strings tuned and its keys mapped to the highest string that reaches them', () => {
  const bench = steelGuitar();
  assert.deepEqual(bench.strings.map((_, i) => bench.info(i).note.name), ['E2', 'A2', 'D3', 'G3', 'B3', 'E4']);
  assert.deepEqual(bench.stringForMidi(40), { string: 0, fret: 0 });
  assert.deepEqual(bench.stringForMidi(45), { string: 1, fret: 0 }, 'an open A is the A string, not the fifth fret of the E');
  assert.deepEqual(bench.stringForMidi(52), { string: 2, fret: 2 });
  assert.equal(bench.stringForMidi(30), null);
  assert.deepEqual(bench.playableRange(), { lowMidi: 40, highMidi: 64 + FRETS });
});

test('lengthening the string lowers the pitch, a peg raises it, and tuning to the nearest note brings it back', () => {
  const bench = steelGuitar();
  const before = bench.info(0).midi;
  bench.set({ scaleLengthMm: 700 });
  assert.ok(bench.info(0).midi < before - 1, 'a longer string at the same tension is lower');
  assert.equal(bench.info(0).note.name, 'D♯2');
  const t = bench.strings[0].tensionN;
  bench.setString(0, { tensionN: t * 1.2 });
  assert.ok(bench.info(0).midi > bench.info(0, { tensionN: t }).midi);
  bench.tuneTo(0, bench.info(0).note.midi);
  assert.equal(Math.abs(bench.info(0).note.cents), 0, 'tuned to the nearest note, to the cent');
});

test('a string swapped for another keeps its note, and a new one is tuned to its slot', () => {
  const bench = steelGuitar();
  const note = bench.info(2).midi;
  bench.swapString(2, { stringMaterial: 'phosphor-bronze' });
  assert.ok(Math.abs(bench.info(2).midi - note) < 0.02, 'same note');
  assert.notEqual(bench.strings[2].tensionN, 122.7, 'but not the same tension');
  const n = bench.strings.length;
  assert.ok(Math.abs(bench.targetMidiForSlot(n) - (64 + 5)) < 0.05, 'above the last string: a fourth up');
  assert.ok(Math.abs(bench.targetMidiForSlot(0) - (40 - 5)) < 0.05);
  assert.equal(bench.targetMidiForSlot(3), Math.round((50 + 55) / 2));
  bench.insertString(3, { stringDiameterMm: 0.7, stringWound: true });
  assert.equal(bench.strings.length, n + 1);
  assert.equal(bench.strings[3].stringDiameterMm, 0.7);
  assert.equal(bench.strings[3].stringMaterial, 'steel-music-wire', 'unset values take their defaults');
  // The most a guitar takes, and the fewest.
  while (bench.canAddString()) bench.insertString(0, {});
  assert.equal(bench.strings.length, 8);
  while (bench.canRemoveString()) bench.removeString(0);
  assert.equal(bench.strings.length, 1);
});

test('undo steps back through edits that were let go of, and not through those still being dragged', () => {
  const bench = steelGuitar();
  assert.equal(bench.canUndo, false);
  bench.set({ scaleLengthMm: 650 }); bench.set({ scaleLengthMm: 660 }); bench.set({ scaleLengthMm: 670 });
  assert.equal(bench.commit(), true, 'one drag is one step');
  assert.equal(bench.commit(), false, 'nothing new to remember');
  bench.removeString(5);
  bench.commit();
  assert.equal(bench.strings.length, 5);
  bench.undo();
  assert.equal(bench.strings.length, 6);
  assert.equal(bench.params.scaleLengthMm, 670);
  bench.undo();
  assert.equal(bench.params.scaleLengthMm, 645);
  assert.equal(bench.canUndo, false);
});

test('the picture is to scale: the nut sits one scale length from the bridge and frets follow equal temperament', () => {
  const bench = steelGuitar();
  const lay = layout(bench);
  assert.equal(lay.bridgeX - lay.nutX, 645);
  assert.ok(Math.abs(lay.fretX[11] - lay.nutX - 322.5) < 0.01, 'the twelfth fret is half way');
  assert.equal(lay.n, 6);
  // A wider neck for more strings.
  const wide = lay.halfWidth(lay.nutX);
  bench.insertString(6, {});
  assert.ok(layout(bench).halfWidth(lay.nutX) > wide + 3, 'the neck is wider for another string');
  // Hit tests.
  const l2 = layout(steelGuitar());
  const x = l2.nutX + 300;
  assert.equal(stringAt(l2, x, l2.stringY(3, x) + 1, 3).i, 3);
  assert.equal(stringAt(l2, x, 90, 3), null);
  assert.equal(stringAt(l2, l2.bridgeX + 50, 0, 3), null, 'past the bridge there is no string');
  assert.deepEqual(slotAt(l2, x, (l2.stringY(2, x) + l2.stringY(3, x)) / 2, 2), { insert: 3 });
  assert.deepEqual(slotAt(l2, x, l2.stringY(2, x), 2), { replace: 2 });
  assert.deepEqual(slotAt(l2, x, -60, 2), { insert: 0 });
  assert.equal(onNeck(l2, x, 0), true);
  assert.equal(onNeck(l2, x, 100), false);
});

test('a body drawn bigger is bigger on the bench, and its sound hole stays where it was put', () => {
  const bench = steelGuitar();
  const a = layout(bench);
  bench.set({ lowerBoutMm: 460, bodyLengthMm: 560, holeAtMm: 150, holeDiameterMm: 80 });
  const b = layout(bench);
  assert.ok(b.bodyHalf > a.bodyHalf);
  assert.equal(b.hole.x, 150);
  assert.equal(b.hole.r, 40);
  assert.ok(Math.max(...b.body.map(([px]) => px)) > Math.max(...a.body.map(([px]) => px)) + 40);
});
