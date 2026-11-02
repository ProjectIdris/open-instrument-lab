// SPDX-License-Identifier: GPL-3.0-only
// The racks round the drums bench: swatches of wood, metal and film on the shelf, drums on the left, and the sticks
// on the right. Everything on a rack is dragged onto the instrument, or tapped.
import { el } from '../draw.js';
import { makeDragger, swatchTile, ownTile, tile, svgIcon } from '../rackkit.js';
import { layout, onRow, slotAt } from './geometry.js';
import { stickGlyph } from './draw.js';

function drumIcon(shell, head, lugs) {
  const spokes = [];
  for (let k = 0; k < lugs; k++) {
    const a = (2 * Math.PI * (k + 0.5)) / lugs;
    spokes.push(el('circle', { cx: 32 + 25 * Math.cos(a), cy: 32 + 25 * Math.sin(a), r: 2.2, fill: '#d9dde1', stroke: '#4c545c', 'stroke-width': 0.8 }));
  }
  return svgIcon(
    el('circle', { cx: 32, cy: 32, r: 28, fill: shell.look.base, stroke: '#3a2a1c', 'stroke-width': 1.4 }),
    el('circle', { cx: 32, cy: 32, r: 22, fill: head.look.base, stroke: '#7d858c', 'stroke-width': 1.2 }),
    el('circle', { cx: 32, cy: 32, r: 9.6, fill: 'none', stroke: head.look.grain, 'stroke-width': 1, 'stroke-dasharray': '2 3' }),
    ...spokes);
}

/**
 * @param app { bench, view, ui, redraw(), status(text), length(mm), settle(i), wake(), openDrawer() }
 * @param els { woods, metals, extras, drums, hands } containers
 */
export function buildDrumsRacks(app, els) {
  const { bench, view, ui } = app;

  const under = (event, roles) => {
    const hit = document.elementsFromPoint(event.clientX, event.clientY).find((n) => roles.includes(n.dataset?.role));
    return hit ? { role: hit.dataset.role, i: Number(hit.dataset.index) } : null;
  };

  /** What is under the pointer that this payload can be dropped on? */
  function probe(event, payload) {
    const rect = view.svg.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return null;
    const pt = view.toMm(event.clientX, event.clientY);
    const lay = layout(bench, ui.selected, ui.pin);
    if (payload.type === 'material') {
      const found = under(event, ['drum-head', 'drum-head-side', 'drum-shell', 'drum-side']);
      if (!found) return null;
      return { kind: found.role === 'drum-head' || found.role === 'drum-head-side' ? 'head' : 'shell', i: found.i };
    }
    if (!bench.canAddDrum() || !onRow(lay, pt.x, pt.y)) return null;
    return { kind: 'insert', insert: slotAt(lay, pt.x) };
  }

  const startDrag = makeDragger(app, probe, (payload) => (payload.type === 'drum' ? 'Drop a drum onto the row.' : 'Drop it onto a drum: film onto the head, wood or metal onto the shell.'));

  // ------------------------------------------------------------ swatches

  function applyMaterial(material, drop) {
    const i = drop.i;
    ui.selected = i;
    const isFilm = material.family === 'film';
    if (drop.kind === 'head' && !isFilm) { app.status(`${material.name} is a shell material: a head is a film. Drop it on the shell, the ring round the head.`); return; }
    if (drop.kind === 'shell' && isFilm) { app.status(`${material.name} is a head. Drop it on the head, the pale disc.`); return; }
    if (drop.kind === 'head') {
      const before = bench.info(i);
      bench.setDrum(i, { headMaterial: material.id });
      const after = bench.info(i);
      app.status(material.id === 'custom'
        ? 'Your own head: type its density in the drawer. The tension stays, so the note moves with its weight.'
        : `${material.name} head. The tension stays, so the note is ${after.note.name} (it was ${before.note.name}). Click the note tag to tune it back.`);
      if (material.id === 'custom') app.openDrawer();
    } else {
      bench.setDrum(i, { shellMaterial: material.id });
      app.status(`${material.name} shell. In this basic model the shell is rigid, so its material changes how the drum looks, not how it sounds.`);
    }
    bench.commit();
    app.settle(i);
  }

  function addShelf(container, material) {
    const where = material.family === 'film' ? 'the head' : 'the shell';
    const node = swatchTile(material, `${material.name}: ${Math.round(material.densityKgM3)} kg/m³. Drag onto ${where}.`);
    node.addEventListener('pointerdown', (event) => startDrag(event, node, {
      type: 'material', material,
      tap: () => app.status(`${material.name}: drag it onto ${where} of a drum.`),
      drop: (drop) => applyMaterial(material, drop),
    }));
    container.append(node);
  }

  function addOwn(container) {
    const node = ownTile();
    node.title = 'Your own head: drag it onto a head, then type its density in the drawer.';
    const material = { id: 'custom', name: 'Your own', family: 'film', densityKgM3: 0, look: { base: '#e9eef0', grain: '#d3dce0' } };
    node.addEventListener('pointerdown', (event) => startDrag(event, node, {
      type: 'material', material,
      tap: () => app.status('Your own head: drag it onto a head, then type its density in the drawer.'),
      drop: (drop) => applyMaterial(material, drop),
    }));
    container.append(node);
  }

  for (const m of bench.materials.filter((x) => x.family === 'wood')) addShelf(els.woods, m);
  for (const m of bench.materials.filter((x) => x.family === 'metal')) addShelf(els.metals, m);
  for (const m of bench.materials.filter((x) => x.family === 'film')) addShelf(els.extras, m);
  addOwn(els.extras);

  // ------------------------------------------------------------ drums

  for (const entry of bench.rack) {
    const info = bench.infoFor({ ...bench.defaultDrum(), ...entry.params });
    const node = tile(drumIcon(info.shell, info.head, info.lugs), entry.name, `${info.note.name} · ${app.length(entry.params.headDiameterMm)}`, `${entry.description} Drag it onto the row; it goes in where you drop it.`);
    node.addEventListener('pointerdown', (event) => startDrag(event, node, {
      type: 'drum',
      tap: () => {
        if (!bench.canAddDrum()) { app.status(`That is the most drums the row takes (${bench.partDef.max}).`); return; }
        addDrum(entry, bench.drums.length);
      },
      drop: (drop) => addDrum(entry, drop.insert),
    }));
    els.drums.append(node);
  }

  function addDrum(entry, slot) {
    bench.insertDrum(slot, entry.params);
    ui.selected = slot;
    const info = bench.info(slot);
    app.status(`${entry.name} added: ${info.note.name}${info.note.cents ? ` (${info.note.cents > 0 ? '+' : '−'}${Math.abs(info.note.cents)}¢)` : ''}. Turn a lug to change the note.`);
    bench.commit();
    app.view.fit?.();
    app.settle(slot);
  }

  // ------------------------------------------------------------ sticks

  const handButtons = new Map();
  for (const hand of bench.hands) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'hand';
    button.setAttribute('aria-pressed', 'false');
    button.title = `${hand.name}: take it up and strike a drum.`;
    const glyph = el('svg', { viewBox: '-14 -42 56 56', width: 38, height: 44 }, stickGlyph(hand));
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
    ui.handHardness = hand.params.stickHardness;
    bench.set(hand.params);
    mark();
    app.status(`${hand.name} in hand. Press on a head to strike it where you press; lift away before you let go for a harder blow.`);
  }

  /** Show which stick matches the document's hardness. */
  function mark() {
    const current = bench.params.stickHardness;
    let best = null;
    for (const hand of bench.hands) {
      const d = Math.abs((hand.params.stickHardness ?? current) - current);
      if (!best || d < best.d) best = { id: hand.id, d };
    }
    ui.hand = best && best.d < 0.06 ? best.id : null;
    ui.handHardness = ui.hand ? bench.hands.find((h) => h.id === ui.hand).params.stickHardness : current;
    for (const [id, button] of handButtons) button.setAttribute('aria-pressed', String(ui.hand === id));
  }

  return { mark, pick };
}
