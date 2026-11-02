// SPDX-License-Identifier: GPL-3.0-only
// The racks round the bars bench: swatches of wood and metal on the shelf, bars, a gouge and tubes on the
// left and right, and the mallets. Everything on a rack is dragged onto the instrument, or tapped.
import { el } from '../draw.js';
import { makeDragger, swatchTile, ownTile, tile, svgIcon } from '../rackkit.js';
import { layout, onFrame, slotAt } from './geometry.js';
import { malletGlyph } from './draw.js';

const GOUGE_STEP = 0.25; // one pass of the gouge takes the arch a quarter of the way to full

function barIcon(material) {
  const { base, grain } = material.look;
  const lines = [0, 1, 2, 3, 4, 5].map((k) => el('line', { x1: 6, x2: 58, y1: 22 + k * 4.2, y2: 22 + k * 4.2, stroke: grain, 'stroke-width': 0.9, opacity: 0.9 }));
  return svgIcon(
    el('rect', { x: 6, y: 20, width: 52, height: 26, rx: 3, fill: material.family === 'wood' ? base : grain, stroke: '#3a2a1c', 'stroke-width': 1.2 }),
    material.family === 'wood' ? lines : el('rect', { x: 8, y: 22, width: 48, height: 5, rx: 2, fill: '#fff', opacity: 0.55 }),
    el('rect', { x: 14, y: 46, width: 6, height: 4, fill: '#8a6a3c' }), el('rect', { x: 44, y: 46, width: 6, height: 4, fill: '#8a6a3c' }));
}

const gougeIcon = () => svgIcon(
  el('rect', { x: 8, y: 26, width: 30, height: 12, rx: 4, fill: '#8a6a3c', stroke: '#3a2a1c', 'stroke-width': 1.2 }),
  el('path', { d: 'M38 28 L58 24 Q62 32 58 40 L38 36 Z', fill: '#c4c9ce', stroke: '#4c545c', 'stroke-width': 1.2 }),
  el('path', { d: 'M44 29 Q50 32 44 35', fill: 'none', stroke: '#4c545c', 'stroke-width': 1 }));

const tubeIcon = () => svgIcon(
  el('rect', { x: 24, y: 6, width: 16, height: 48, fill: '#9aa3ad', stroke: '#4c545c', 'stroke-width': 1.2 }),
  el('ellipse', { cx: 32, cy: 6, rx: 8, ry: 3, fill: '#2d3338' }),
  el('line', { x1: 24, x2: 40, y1: 54, y2: 54, stroke: '#2d3338', 'stroke-width': 3 }));

/**
 * @param app { bench, view, ui, redraw(), status(text), length(mm), settle(i), wake(), openDrawer() }
 * @param els { woods, metals, bars, parts, hands } containers
 */
export function buildBarsRacks(app, els) {
  const { bench, view, ui } = app;

  const barUnder = (event) => {
    const hit = document.elementsFromPoint(event.clientX, event.clientY).find((n) => ['bar', 'bar-side', 'tube-body'].includes(n.dataset?.role));
    return hit ? Number(hit.dataset.index) : null;
  };

  /** What is under the pointer that this payload can be dropped on? */
  function probe(event, payload) {
    const rect = view.svg.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return null;
    const pt = view.toMm(event.clientX, event.clientY);
    const lay = layout(bench, ui.selected);
    switch (payload.type) {
      case 'material': {
        const i = barUnder(event);
        if (i !== null) return { kind: 'bar', i };
        if (payload.material.family === 'wood' && document.elementsFromPoint(event.clientX, event.clientY).some((n) => n.dataset?.role === 'frame')) return { kind: 'frame' };
        return null;
      }
      case 'gouge': {
        const i = barUnder(event);
        return i === null ? null : { kind: 'carve', i };
      }
      case 'tube': {
        const i = barUnder(event);
        return i === null ? null : { kind: 'tube', i };
      }
      default:
        if (!bench.canAddBar() || !onFrame(lay, pt.x, pt.y)) return null;
        return { kind: 'insert', insert: slotAt(lay, pt.x) };
    }
  }

  const startDrag = makeDragger(app, probe, (payload) => (payload.type === 'bar' ? 'Drop a bar onto the frame.' : payload.type === 'gouge' ? 'Drop the gouge onto a bar to carve its underside.' : payload.type === 'tube' ? 'Drop the tube onto a bar.' : 'Drop it onto a bar.'));

  // ------------------------------------------------------------ swatches

  function applyMaterial(material, drop) {
    if (drop.kind === 'frame') {
      const def = bench.paramDef('frameWood');
      if (!def?.options.some((o) => o.value === material.id)) { app.status('The frame has no place for that wood.'); return; }
      bench.set({ frameWood: material.id });
      app.status(`${material.name} frame. In this basic model the frame's wood changes how it looks, not how the bars sound.`);
      bench.commit();
      app.redraw();
      return;
    }
    const kept = bench.swapMaterial(drop.i, { barMaterial: material.id });
    ui.selected = drop.i;
    app.status(kept ? `${material.name} bar, cut to the note it had.` : `${material.name} bar. It cannot be cut to its old note within the lengths a bar can be, so the note has changed.`);
    if (material.id === 'custom') app.openDrawer();
    bench.commit();
    app.settle(drop.i);
  }

  function addShelf(container, material) {
    const where = material.family === 'wood' ? 'a bar or the frame' : 'a bar';
    const node = swatchTile(material, `${material.name}: ${Math.round(material.densityKgM3)} kg/m³, ${(material.youngModulusPa / 1e9).toFixed(1)} GPa. Drag onto ${where}.`);
    node.addEventListener('pointerdown', (event) => startDrag(event, node, {
      type: 'material', material,
      tap: () => app.status(`${material.name}: drag it onto ${where}. The bar is cut again to the note it had.`),
      drop: (drop) => applyMaterial(material, drop),
    }));
    container.append(node);
  }

  function addOwn(container, family) {
    const node = ownTile();
    const material = { id: 'custom', name: 'Your own', family, densityKgM3: 0, youngModulusPa: 0, look: { base: '#cfc6b3', grain: '#a99f8a' } };
    node.addEventListener('pointerdown', (event) => startDrag(event, node, {
      type: 'material', material,
      tap: () => app.status('Your own material: drag it onto a bar, then type its density and stiffness in the drawer.'),
      drop: (drop) => applyMaterial(material, drop),
    }));
    container.append(node);
  }

  for (const m of bench.materials.filter((x) => x.family === 'wood')) addShelf(els.woods, m);
  addOwn(els.woods, 'wood');
  for (const m of bench.materials.filter((x) => x.family === 'metal' || x.family === 'polymer')) addShelf(els.metals, m);
  addOwn(els.metals, 'metal');

  // ------------------------------------------------------------ bars

  for (const entry of bench.rack) {
    const info = bench.infoFor({ ...bench.defaultBar(), ...entry.params });
    const node = tile(barIcon(info.mat), entry.name, `${info.note.name} · ${app.length(entry.params.barLengthMm)}`, `${entry.description} Drag it onto the frame; it goes in the row where you drop it.`);
    node.addEventListener('pointerdown', (event) => startDrag(event, node, {
      type: 'bar',
      tap: () => {
        if (!bench.canAddBar()) { app.status(`That is the most bars the frame takes (${bench.partDef.max}).`); return; }
        addBar(entry, bench.bars.length);
      },
      drop: (drop) => addBar(entry, drop.insert),
    }));
    els.bars.append(node);
  }

  function addBar(entry, slot) {
    bench.insertBar(slot, entry.params);
    ui.selected = slot;
    const info = bench.info(slot);
    app.status(`${entry.name} added: ${info.note.name}${info.note.cents ? ` (${info.note.cents > 0 ? '+' : '−'}${Math.abs(info.note.cents)}¢)` : ''}. Stretch it to change the note.`);
    bench.commit();
    app.view.fit?.();
    app.settle(slot);
  }

  // ------------------------------------------------------------ the gouge and the tube

  const gouge = tile(gougeIcon(), 'Gouge', 'carves the arch', 'A gouge. Drag it onto a bar to cut the arch under it a quarter deeper; carving lowers the bar\'s note. Or drag the dot under the bar in the side view.');
  gouge.addEventListener('pointerdown', (event) => startDrag(event, gouge, {
    type: 'gouge',
    tap: () => app.status('Drag the gouge onto a bar to carve the arch under it.'),
    drop: (drop) => carve(drop.i),
  }));
  els.parts.append(gouge);

  const tube = tile(tubeIcon(), 'Tube', 'resonator', 'A resonator tube, closed at the bottom. Drag it onto a bar: it is cut to ring at the bar\'s note. Drag its lower end in the side view to change its length.');
  tube.addEventListener('pointerdown', (event) => startDrag(event, tube, {
    type: 'tube',
    tap: () => app.status('Drag the tube onto a bar to hang it underneath.'),
    drop: (drop) => hang(drop.i),
  }));
  els.parts.append(tube);

  function carve(i) {
    const was = bench.bars[i].barUndercut;
    const before = bench.info(i);
    if (was >= 1) { app.status('That bar already has the full arch.'); return; }
    bench.setBar(i, { barUndercut: Math.min(1, Math.round((was + GOUGE_STEP) * 100) / 100) });
    ui.selected = i;
    const after = bench.info(i);
    app.status(`Arch ${Math.round(bench.bars[i].barUndercut * 100)}%. The note went from ${before.note.name} to ${after.note.name}${after.note.cents ? ` ${after.note.cents > 0 ? '+' : '−'}${Math.abs(after.note.cents)}¢` : ''}: carving lowers a bar. Click its note tag to cut it back to a note.`);
    bench.commit();
    app.settle(i);
  }

  function hang(i) {
    bench.setBar(i, { tubeFit: true, tubeLengthMm: bench.tunedTubeMm(i) });
    ui.selected = i;
    app.status(`Tube cut to ring at ${bench.info(i).note.name}, ${app.length(bench.bars[i].tubeLengthMm)} long. Drag its lower end in the side view to tune it.`);
    bench.commit();
    app.settle(i);
  }

  // ------------------------------------------------------------ mallets

  const handButtons = new Map();
  for (const hand of bench.hands) {
    const hardness = hand.params.malletHardness ?? 0.5;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'hand';
    button.setAttribute('aria-pressed', 'false');
    button.title = `${hand.name}: take it up and strike a bar.`;
    const glyph = el('svg', { viewBox: '-14 -34 52 52', width: 38, height: 44 }, malletGlyph(hardness));
    const label = document.createElement('span');
    label.textContent = hand.name;
    button.append(glyph, label);
    button.addEventListener('click', () => {
      pick(hand.id);
      bench.commit();
      app.settle();
    });
    els.hands.append(button);
    handButtons.set(hand.id, button);
  }

  function pick(id) {
    const hand = bench.hands.find((h) => h.id === id);
    if (!hand) return;
    ui.hand = id;
    ui.handHardness = hand.params.malletHardness;
    bench.set(hand.params);
    mark();
    app.status(`${hand.name} in hand. Press on a bar to strike it where you press; lift away before you let go for a harder blow.`);
  }

  /** Show which mallet matches the document's hardness. */
  function mark() {
    const current = bench.params.malletHardness;
    let best = null;
    for (const hand of bench.hands) {
      const d = Math.abs((hand.params.malletHardness ?? current) - current);
      if (!best || d < best.d) best = { id: hand.id, d };
    }
    ui.hand = best && best.d < 0.06 ? best.id : null;
    ui.handHardness = ui.hand ? bench.hands.find((h) => h.id === ui.hand).params.malletHardness : current;
    for (const [id, button] of handButtons) button.setAttribute('aria-pressed', String(ui.hand === id));
  }

  return { mark, pick };
}
