// SPDX-License-Identifier: GPL-3.0-only
// The racks around the bench: swatches of wood and metal on the shelf, coils of
// string on the left, and the hands on the right. Everything on a rack is
// dragged onto the instrument, or tapped.
import { layout, onNeck, slotAt, stringAt, fretSlotNear, pickupAtPoint } from './geometry.js';
import { el, handGlyph } from './draw.js';
import { makeDragger, swatchBackground } from './rackkit.js';

function coilIcon(entry, material) {
  const d = entry.params.stringDiameterMm;
  const width = Math.min(7, 1.2 + d * 2.2);
  const color = material.family === 'polymer' ? '#f1ecd8' : material.look.base;
  const rings = [22, 17, 12, 7].map((r) => el('ellipse', { cx: 32, cy: 32, rx: r, ry: r * 0.78, fill: 'none', stroke: color, 'stroke-width': width, 'stroke-dasharray': entry.params.stringWound ? '1.6 1' : undefined }));
  const shadow = [22, 17, 12, 7].map((r) => el('ellipse', { cx: 32, cy: 33.2, rx: r, ry: r * 0.78, fill: 'none', stroke: '#00000030', 'stroke-width': width + 1 }));
  return el('svg', { viewBox: '0 0 64 64', width: 64, height: 64, class: 'coil-icon' }, ...shadow, ...rings, el('line', { x1: 54, y1: 32, x2: 63, y2: 22, stroke: color, 'stroke-width': width }));
}

/**
 * @param app { bench, view, ui, redraw(), status(text), settle(i), openDrawer() }
 * @param els { woods, metals, strings, hands } containers
 */
export function buildRacks(app, els) {
  const { bench, view, ui } = app;
  const engine = bench.engine;
  // The three surfaces a material can be dropped on, as the roles of their wood.
  const surfaces = { top: 'topWood', back: 'backWood', neck: 'neckWood' };
  const rack = bench.rack;

  // ------------------------------------------------------------ dragging from a rack

  const startDrag = makeDragger(app, (event, payload) => probe(event, payload),
    (payload) => (payload.type === 'fret' ? 'Drop a fret onto the neck.' : payload.type === 'pickup' ? 'Drop the pickup onto the strings.' : 'Drop a string onto the neck.'));

  /** What is under the pointer that this payload can be dropped on? */
  function probe(event, payload) {
    const rect = view.svg.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return null;
    const pt = view.toMm(event.clientX, event.clientY);
    const lay = layout(bench);
    if (payload.type === 'material') {
      const family = payload.material.family;
      if (family === 'wood') {
        const surface = document.elementsFromPoint(event.clientX, event.clientY).find((n) => n.dataset?.surface)?.dataset.surface;
        return surface && surfaces[surface] ? { surface } : null;
      }
      const near = stringAt(lay, pt.x, pt.y, view.px(12));
      return near ? { replace: near.i, material: true } : null;
    }
    if (payload.type === 'fret') {
      if (!bench.canAddFret() || pt.x < lay.nutX || pt.x > lay.bridgeX - 20 || Math.abs(pt.y) > lay.halfWidth(Math.min(Math.max(pt.x, lay.nutX), lay.bridgeX)) + 14) return null;
      const fret = bench.freeFretNear(fretSlotNear(lay, pt.x));
      return fret === null ? null : { fret };
    }
    if (payload.type === 'pickup') {
      const at = pickupAtPoint(lay, bench, pt.x, pt.y, 14);
      return at === null ? null : { pickup: at };
    }
    if (!onNeck(lay, pt.x, pt.y, 28)) return null;
    const x = Math.min(lay.bridgeX, Math.max(lay.nutX, pt.x));
    const slot = slotAt(lay, x, pt.y, Math.min(view.px(6), lay.spacing(x) * 0.28));
    if (slot.insert !== undefined && !bench.canAddString()) return null;
    return slot;
  }

  // ------------------------------------------------------------ swatches

  function addSwatch(container, material) {
    const node = document.createElement('div');
    node.className = 'swatch';
    node.title = `${material.name}: ${Math.round(material.densityKgM3)} kg/m³, ${(material.youngModulusPa / 1e9).toFixed(1)} GPa. Drag onto ${material.family === 'wood' ? 'the top, back or neck' : 'a string'}.`;
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.style.background = swatchBackground(material);
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = material.name;
    node.append(chip, label);
    node.addEventListener('pointerdown', (event) => startDrag(event, node, {
      type: 'material',
      material,
      tap: () => app.status(`${material.name}: drag it onto ${material.family === 'wood' ? 'the top, the back or the neck' : 'a string'}.`),
      drop: (drop) => applyMaterial(material, drop),
    }));
    container.append(node);
  }

  function addOwn(container, family) {
    const node = document.createElement('div');
    node.className = 'swatch own';
    node.title = 'Your own material: drag it on, then type its density and stiffness in the drawer.';
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = '+';
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = 'Your own';
    node.append(chip, label);
    const material = { id: 'custom', name: 'Your own', family, densityKgM3: 0, youngModulusPa: 0, look: { base: '#cfc6b3', grain: '#a99f8a' } };
    node.addEventListener('pointerdown', (event) => startDrag(event, node, {
      type: 'material', material,
      tap: () => app.status('Your own material: drag it onto a part, then type its density and stiffness in the drawer.'),
      drop: (drop) => applyMaterial(material, drop),
    }));
    container.append(node);
  }

  function applyMaterial(material, drop) {
    if (drop.surface) {
      const id = surfaces[drop.surface];
      const def = bench.paramDef(id);
      if (!def.options.some((o) => o.value === material.id)) { app.status('The neck has no place for a custom wood in this basic model.'); return; }
      bench.set({ [id]: material.id });
      app.status(drop.surface === 'neck' ? `${material.name} neck. In this basic model the neck wood changes how it looks, not how it sounds.` : `${material.name} ${drop.surface === 'top' ? 'top' : 'back and sides'}.`);
    } else {
      bench.swapString(drop.replace, { stringMaterial: material.id });
      app.status(`${material.name} string, retuned to the note it had.`);
      ui.selected = drop.replace;
    }
    if (material.id === 'custom') app.openDrawer();
    bench.commit();
    app.settle(drop.replace);
  }

  for (const m of bench.materials.filter((x) => x.family === 'wood')) addSwatch(els.woods, m);
  addOwn(els.woods, 'wood');
  for (const m of bench.materials.filter((x) => x.family === 'metal' || x.family === 'polymer')) addSwatch(els.metals, m);
  addOwn(els.metals, 'metal');

  // ------------------------------------------------------------ string coils

  for (const entry of rack) {
    const material = bench.material(entry.params.stringMaterial);
    const node = document.createElement('div');
    node.className = 'coil';
    node.title = `${entry.description} Drag it onto the neck. Drop it on a string to swap that one.`;
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = entry.name;
    const size = document.createElement('span');
    size.className = 'size';
    size.textContent = `${entry.params.stringDiameterMm} mm`;
    node.append(coilIcon(entry, material), label, size);
    node.addEventListener('pointerdown', (event) => startDrag(event, node, {
      type: 'string',
      tap: () => {
        if (!bench.canAddString()) { app.status(`That is the most strings this instrument takes (${bench.partDef.max}).`); return; }
        addCoil(entry, { insert: bench.strings.length });
      },
      drop: (drop) => addCoil(entry, drop),
    }));
    els.strings.append(node);
  }

  function addCoil(entry, drop) {
    if (drop.replace !== undefined) {
      bench.swapString(drop.replace, entry.params);
      ui.selected = drop.replace;
      app.status(`${entry.name} fitted in place of string ${drop.replace + 1}, tuned to the same note.`);
      bench.commit();
      app.settle(drop.replace);
      return;
    }
    const slot = drop.insert;
    const target = bench.targetMidiForSlot(slot);
    bench.insertString(slot, entry.params);
    bench.tuneTo(slot, target);
    ui.selected = slot;
    const info = bench.info(slot);
    app.status(`${entry.name} added and tuned towards ${info.note.name}${info.note.cents ? ` (${info.note.cents > 0 ? '+' : '−'}${Math.abs(info.note.cents)}¢)` : ''}. Turn its peg to tune it.`);
    bench.commit();
    app.settle(slot);
  }

  // ------------------------------------------------------------ frets and the pickup

  function partTile(label, note, icon, title, payload) {
    const node = document.createElement('div');
    node.className = 'coil';
    node.title = title;
    const name = document.createElement('span');
    name.className = 'label';
    name.textContent = label;
    const size = document.createElement('span');
    size.className = 'size';
    size.textContent = note;
    node.append(icon, name, size);
    node.addEventListener('pointerdown', (event) => startDrag(event, node, payload));
    els.parts?.append(node);
  }

  const wireIcon = () => el('svg', { viewBox: '0 0 64 64', width: 64, height: 64, class: 'coil-icon' },
    el('rect', { x: 8, y: 14, width: 48, height: 36, rx: 3, fill: '#4a3524' }), el('line', { x1: 32, y1: 12, x2: 32, y2: 52, stroke: '#d9d4c7', 'stroke-width': 4, 'stroke-linecap': 'round' }));
  const pickupIcon = () => el('svg', { viewBox: '0 0 64 64', width: 64, height: 64, class: 'coil-icon' },
    el('rect', { x: 24, y: 8, width: 16, height: 48, rx: 4, fill: '#1d1b19', stroke: '#0a0908' }), ...[16, 26, 38, 48].map((y) => el('circle', { cx: 32, cy: y, r: 2.4, fill: '#b9b3a4' })));

  if (bench.hasFrets) {
    partTile('Fret', 'one wire', wireIcon(), 'A fret wire. Drag it onto the neck; it snaps to the nearest place with no wire. A string can only be stopped where there is one.', {
      type: 'fret',
      tap: () => {
        if (!bench.canAddFret()) { app.status(`That is the most frets this neck takes (${bench.fretPartDef.max}).`); return; }
        addFret(bench.freeFretNear(1));
      },
      drop: (drop) => addFret(drop.fret),
    });
  }
  if (bench.hasPickup) {
    partTile('Pickup', 'magnetic', pickupIcon(), 'A magnetic pickup. Drag it onto the strings; the sound is then taken from the strings at that spot, as on an electric guitar. Drag it along to change the tone.', {
      type: 'pickup',
      tap: () => app.status(bench.pickup ? 'The pickup is already fitted: drag it along the strings to change the tone.' : 'Drag the pickup onto the strings.'),
      drop: (drop) => fitPickup(drop.pickup),
    });
  }
  if (els.parts) els.parts.closest('[data-parts]')?.toggleAttribute('hidden', !bench.hasFrets && !bench.hasPickup);

  function addFret(n) {
    bench.addFret(n);
    app.status(`Fret ${n} added. A string can now be stopped there.`);
    bench.commit();
    app.settle();
  }

  function fitPickup(at) {
    const was = bench.pickup;
    bench.fitPickup(at);
    app.status(was ? `Pickup moved to ${app.length(at)} from the bridge.` : `Pickup fitted ${app.length(at)} from the bridge. The sound is now taken from the strings, not the body. Drag it along the strings to change the tone.`);
    bench.commit();
    app.settle(ui.selected);
  }

  // ------------------------------------------------------------ hands

  const handButtons = new Map();
  for (const hand of engine.bench.hands ?? []) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'hand';
    button.setAttribute('aria-pressed', 'false');
    button.title = `${hand.name}: take it up and touch a string.`;
    const glyph = el('svg', { viewBox: '-4 -12 40 52', width: 36, height: 44 }, handGlyph(hand.id));
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
    const hand = engine.bench.hands.find((h) => h.id === id);
    if (!hand) return;
    ui.hand = id;
    bench.set(hand.params);
    mark();
    app.status(`${hand.name} in hand. Touch a string to pluck it; pull further for a harder pluck.`);
  }

  /** Show which hand matches the document's pick hardness. */
  function mark() {
    const current = bench.params.pickHardness;
    let best = null;
    for (const hand of engine.bench.hands ?? []) {
      const d = Math.abs((hand.params.pickHardness ?? current) - current);
      if (!best || d < best.d) best = { id: hand.id, d };
    }
    ui.hand = best && best.d < 0.06 ? best.id : null;
    for (const [id, button] of handButtons) button.setAttribute('aria-pressed', String(ui.hand === id));
  }

  return { mark, pick };
}
