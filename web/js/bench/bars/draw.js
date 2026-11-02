// SPDX-License-Identifier: GPL-3.0-only
// Draws the bars bench: the row of bars on their frame, seen from above, and below it a side view of the
// selected bar with its carved arch and its tube. SVG, rebuilt on each change.
import { archThickness, BAR_NODE } from '/shared/physics.mjs';
import { el, materialFill } from '../draw.js';
import { ViewPort } from '../viewport.js';
import { layout, BAR_WIDTH, PITCH, RAIL, SIDE_SCALE, TUBE_DRAW, TUBE_MOUTH } from './geometry.js';

const MM_PER_INCH = 25.4;
const RING_S = 0.9; // how long a blow is shown on the bar

const points = (list) => list.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');

export class BarsView extends ViewPort {
  constructor(svg, bench, ui) {
    super(svg);
    this.bench = bench;
    this.ui = ui;
    new ResizeObserver(() => { this.measure(); if (this.autoFit && this.bench.bars.length) this.fit(); else { this.apply(); this.render(); } }).observe(svg);
  }

  /** Frame the whole instrument. */
  fit() { this.fitExtent(layout(this.bench, this.ui.selected).extent); }

  #length(mm) {
    return this.ui.unit === 'in' ? `${(mm / MM_PER_INCH).toFixed(2)} in` : `${Math.round(mm * 10) / 10} mm`;
  }

  render() {
    const { bench, ui, svg } = this;
    if (!bench.bars.length) return;
    const lay = layout(bench, ui.selected);
    const px = (n) => this.px(n);
    const defs = el('defs');
    const g = el('g');
    const drop = ui.drop;

    this.#frame(g, defs, lay, drop);
    for (const b of lay.bars) this.#bar(g, defs, lay, b, px);
    this.#tubes(g, lay);
    this.#dropMarks(g, lay, drop, px);
    this.#tags(g, lay, px);
    this.#sideView(g, defs, lay, px);
    this.#ruler(g, lay, px);
    if (ui.strikeAim) {
      const { x, y, lift } = ui.strikeAim;
      g.append(el('circle', { cx: x, cy: y, r: px(5 + lift * 10), fill: 'none', stroke: 'var(--accent)', 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke', opacity: 0.8, 'pointer-events': 'none' }));
    }
    if (ui.rideTag) {
      const t = ui.rideTag;
      const w = px(10 * t.text.length + 18);
      const h = px(24);
      g.append(el('g', { 'pointer-events': 'none' },
        el('rect', { x: t.x + px(16), y: t.y - px(38), width: w, height: h, rx: px(6), fill: '#2a2620', opacity: 0.92 }),
        el('text', { x: t.x + px(16) + w / 2, y: t.y - px(38) + h * 0.7, 'font-size': px(14), 'text-anchor': 'middle', fill: '#fff', 'font-weight': 600 }, t.text)));
    }
    if (ui.hand && ui.pointer) {
      const s = px(1);
      g.append(el('g', { transform: `translate(${ui.pointer.x + 6 * s} ${ui.pointer.y + 6 * s}) scale(${s})`, 'pointer-events': 'none', opacity: 0.9 }, malletGlyph(ui.handHardness ?? 0.5)));
    }
    svg.replaceChildren(defs, g);
  }

  // ------------------------------------------------------------------ the frame: two rails under the bars

  #frame(g, defs, lay, drop) {
    const fill = materialFill(defs, this.#frameWood());
    const lit = drop?.kind === 'frame';
    for (const r of lay.rails) {
      const poly = [[r.x0, r.y0 - RAIL / 2], [r.x1, r.y1 - RAIL / 2], [r.x1, r.y1 + RAIL / 2], [r.x0, r.y0 + RAIL / 2]];
      g.append(el('polygon', { points: points(poly), fill, stroke: lit ? 'var(--accent)' : '#3a2a1c', 'stroke-width': lit ? 2.4 : 1, 'vector-effect': 'non-scaling-stroke', 'data-surface': 'frame', 'data-role': 'frame', class: 'surface' }));
    }
  }

  #frameWood() {
    const { bench } = this;
    const id = bench.params.frameWood;
    return id === 'custom' ? { ...bench.material('custom', 500, 10), id: 'custom-wood', family: 'wood', look: { base: '#dcc9a3', grain: '#bba37c' } } : bench.material(id ?? 'american-basswood');
  }

  // ------------------------------------------------------------------ a bar seen from above

  #bar(g, defs, lay, b, px) {
    const { bench, ui } = this;
    const info = bench.info(b.i);
    const selected = ui.selected === b.i;
    const hit = ui.hits?.get(b.i);
    const age = hit ? (performance.now() - hit.t0) / 1000 : Infinity;
    // The bar lies along its length (y); the grain runs along it.
    g.append(el('g', { transform: `translate(${b.x} 0) rotate(90)` },
      el('rect', { x: -b.half, y: -BAR_WIDTH / 2, width: b.L, height: BAR_WIDTH, rx: 3, fill: materialFill(defs, info.mat), stroke: selected ? 'var(--accent)' : info.playable ? '#3a2a1c' : '#d9534f', 'stroke-width': selected ? 2.4 : 1.2, 'vector-effect': 'non-scaling-stroke', 'data-role': 'bar', 'data-index': b.i, 'data-surface': 'bar', class: 'surface' })));
    if (age < RING_S) {
      const fade = 1 - age / RING_S;
      g.append(el('rect', { x: b.x - BAR_WIDTH / 2, y: -b.half, width: BAR_WIDTH, height: b.L, rx: 3, fill: '#fff', opacity: 0.35 * fade, 'pointer-events': 'none' }));
      const y = -b.half + hit.at * b.L;
      g.append(el('circle', { cx: b.x, cy: y, r: 4 + 22 * age, fill: 'none', stroke: 'var(--accent)', 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke', opacity: 0.8 * fade, 'pointer-events': 'none' }));
    }
    // The ends are where a hand takes hold to stretch the bar.
    for (const sign of [-1, 1]) {
      const y = sign * b.half;
      g.append(el('rect', { x: b.x - 11, y: y - (sign < 0 ? 0 : 3.5), width: 22, height: 3.5, rx: 1.5, fill: selected ? 'var(--accent)' : '#6b6558', opacity: selected ? 0.95 : 0.55, 'pointer-events': 'none' }));
      g.append(el('rect', { x: b.x - BAR_WIDTH / 2, y: y - px(7), width: BAR_WIDTH, height: px(14), fill: 'transparent', 'data-role': 'bar-end', 'data-index': b.i, class: 'handle ns', 'pointer-events': 'all' },
        el('title', {}, `Drag to make bar ${b.i + 1} longer or shorter (now ${this.#length(b.L)})`)));
    }
  }

  /** Where a tube hangs, seen through the bar from above: a ring the size of its mouth. */
  #tubes(g, lay) {
    for (const b of lay.bars) {
      if (!this.bench.bars[b.i].tubeFit) continue;
      g.append(el('circle', { cx: b.x, cy: 0, r: TUBE_MOUTH / 2 - 2, fill: 'none', stroke: '#1f2328', 'stroke-width': 1.4, 'stroke-dasharray': '4 3', 'vector-effect': 'non-scaling-stroke', opacity: 0.6, 'pointer-events': 'none' }));
    }
  }

  #dropMarks(g, lay, drop, px) {
    if (!drop) return;
    const mark = (b, color = 'var(--accent)') => g.append(el('rect', { x: b.x - BAR_WIDTH / 2 - 3, y: -b.half - 3, width: BAR_WIDTH + 6, height: b.L + 6, rx: 5, fill: color, opacity: 0.2, stroke: 'var(--accent)', 'stroke-width': 2.4, 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' }));
    if (drop.kind === 'bar' || drop.kind === 'tube' || drop.kind === 'carve') mark(lay.bars[drop.i]);
    else if (drop.kind === 'insert') {
      const x = (drop.insert - lay.n / 2) * PITCH;
      g.append(el('line', { x1: x, x2: x, y1: -lay.maxHalf - 10, y2: lay.maxHalf + 10, stroke: 'var(--accent)', 'stroke-width': 3, 'stroke-dasharray': '6 4', 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' }));
    }
  }

  #tags(g, lay, px) {
    const { bench, ui } = this;
    const fs = px(11);
    for (const b of lay.bars) {
      const info = bench.info(b.i);
      const c = info.note.cents;
      const text = info.playable ? `${info.note.name}${c === 0 ? '' : ` ${c > 0 ? '+' : '−'}${Math.abs(c)}¢`}` : 'out of range';
      const inTune = Math.abs(c) <= 5;
      const w = Math.max(px(8 * text.length + 12), 28);
      const h = px(16);
      const y = -b.half - px(14) - h / 2;
      const removing = ui.removing === b.i;
      g.append(el('g', { class: `tag ${removing ? 'removing' : ''}`, 'data-role': 'tag', 'data-index': b.i },
        el('rect', { x: b.x - w / 2, y: y - h / 2, width: w, height: h, rx: h / 2, fill: removing ? '#f3c9c0' : '#fffdf6', stroke: inTune ? '#4e8a4a' : '#c28a2a', 'stroke-width': 1.4, 'vector-effect': 'non-scaling-stroke', opacity: removing ? 0.6 : 0.96, class: 'handle grab', 'pointer-events': 'all' }),
        el('text', { x: b.x, y: y + fs * 0.35, 'font-size': fs, 'text-anchor': 'middle', fill: '#2a2620', 'pointer-events': 'none', 'font-variant-numeric': 'tabular-nums' }, text),
        el('title', {}, 'Click to cut this bar to its nearest note. Drag it off the frame to take the bar away.')));
      if (ui.selected === b.i) g.append(el('text', { x: b.x, y: b.half + px(14), 'font-size': px(10.5), 'text-anchor': 'middle', fill: 'var(--accent)', 'font-weight': 600, 'pointer-events': 'none', 'font-variant-numeric': 'tabular-nums' }, this.#length(b.L)));
    }
  }

  /** A rule along the selected bar's length. */
  #ruler(g, lay, px) {
    const b = lay.bars[lay.selected];
    const x = b.x - BAR_WIDTH / 2 - px(14);
    const color = 'var(--accent)';
    g.append(el('line', { x1: x, x2: x, y1: -b.half, y2: b.half, stroke: color, 'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' }));
    for (const y of [-b.half, b.half]) g.append(el('line', { x1: x - px(4), x2: x + px(4), y1: y, y2: y, stroke: color, 'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' }));
  }

  // ------------------------------------------------------------------ the side view

  #sideView(g, defs, lay, px) {
    const { bench, ui } = this;
    const { side } = lay;
    const i = side.i;
    const bar = bench.bars[i];
    const info = bench.info(i);
    const fill = materialFill(defs, info.mat);
    const y0 = side.y;
    const half = side.L / 2;
    g.append(el('text', { x: -half, y: y0 - px(26), 'font-size': px(11), fill: 'var(--muted)', 'pointer-events': 'none' }, `Side view of bar ${i + 1}: thickness drawn ${SIDE_SCALE} times too big${side.tube ? `, tube ${TUBE_DRAW} of its length` : ''}`));
    // The bar's outline: a flat top, and an underside cut away across the middle.
    const steps = 60;
    const top = [[-half, y0], [half, y0]];
    const under = [];
    for (let s = steps; s >= 0; s--) {
      const u = s / steps;
      under.push([-half + u * side.L, y0 + side.T * archThickness(bar.barUndercut, u)]);
    }
    g.append(el('polygon', { points: points([...top, ...under]), fill, stroke: '#3a2a1c', 'stroke-width': 1.2, 'vector-effect': 'non-scaling-stroke', 'data-surface': 'bar', 'data-role': 'bar-side', 'data-index': i, class: 'surface' }));
    // The cords it rests on, 22% of the way in from each end.
    for (const u of [BAR_NODE, 1 - BAR_NODE]) {
      g.append(el('rect', { x: -half + u * side.L - 5, y: y0 + side.T, width: 10, height: 7, rx: 2, fill: '#8a6a3c', stroke: '#3a2a1c', 'stroke-width': 0.8, 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' }));
    }
    // A tube hangs from the middle, closed at the bottom.
    if (side.tube) {
      const x = -TUBE_MOUTH / 2;
      const y = y0 + side.T + 10;
      g.append(el('rect', { x, y, width: TUBE_MOUTH, height: side.tubeDrawn, fill: '#9aa3ad', stroke: '#4c545c', 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke', opacity: 0.95, 'data-role': 'tube-body', 'data-index': i, class: 'surface' }));
      g.append(el('line', { x1: x, x2: x + TUBE_MOUTH, y1: y + side.tubeDrawn, y2: y + side.tubeDrawn, stroke: '#2d3338', 'stroke-width': 3, 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' }));
      const tc = info.tubeCents;
      const text = `Tube ${this.#length(bar.tubeLengthMm)}: ${tc === 0 ? 'tuned to the note' : `${Math.abs(tc)}¢ ${tc > 0 ? 'above' : 'below'} the note`}`;
      g.append(el('text', { x: x + TUBE_MOUTH + px(8), y: y + side.tubeDrawn / 2, 'font-size': px(11), fill: 'var(--muted)', 'pointer-events': 'none' }, text));
      g.append(el('circle', { cx: 0, cy: y + side.tubeDrawn, r: Math.max(5, px(7)), fill: 'var(--accent)', stroke: '#fff', 'stroke-width': 1.4, 'vector-effect': 'non-scaling-stroke', 'data-role': 'tube-end', 'data-index': i, class: 'handle ns', 'pointer-events': 'all' },
        el('title', {}, 'Drag to make the tube longer or shorter. Lift it up into the bar to take it off.')));
    }
    // Handles: the arch (under the middle), the thickness (under an end), the ends.
    const apexY = y0 + side.T * archThickness(bar.barUndercut, 0.5);
    g.append(el('circle', { cx: 0, cy: apexY, r: Math.max(5, px(7)), fill: 'var(--accent)', stroke: '#fff', 'stroke-width': 1.4, 'vector-effect': 'non-scaling-stroke', 'data-role': 'bar-arch', 'data-index': i, class: 'handle ns', 'pointer-events': 'all' },
      el('title', {}, 'Drag up to carve the arch under the bar deeper, down to leave more wood. The full arch tunes the first overtone to two octaves above the note.')));
    g.append(el('text', { x: px(10), y: apexY - px(10), 'font-size': px(11), fill: 'var(--accent)', 'font-weight': 600, 'pointer-events': 'none' }, bar.barUndercut > 0 ? `Arch ${Math.round(bar.barUndercut * 100)}%` : 'Plain'));
    g.append(el('circle', { cx: -half + px(10), cy: y0 + side.T, r: Math.max(4, px(6)), fill: '#fff', stroke: 'var(--accent)', 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke', 'data-role': 'bar-thick', 'data-index': i, class: 'handle ns', 'pointer-events': 'all' },
      el('title', {}, `Drag to make the bar thicker or thinner (now ${this.#length(bar.barThicknessMm)})`)));
    for (const sign of [-1, 1]) {
      g.append(el('rect', { x: sign * half - px(6), y: y0 - px(2), width: px(12), height: side.T + px(4), fill: 'transparent', 'data-role': 'bar-end-side', 'data-index': i, class: 'handle ew', 'pointer-events': 'all' },
        el('title', {}, `Drag to make the bar longer or shorter (now ${this.#length(bar.barLengthMm)})`)));
    }
  }
}

/** A mallet, head down: a big soft head for a soft mallet, a small hard one for a hard mallet. */
export function malletGlyph(hardness) {
  const r = 10 - 4.5 * hardness;
  const head = hardness < 0.3 ? '#c9a3c4' : hardness < 0.6 ? '#b3492f' : hardness < 0.9 ? '#e8e4da' : '#c9a24a';
  return el('g', {},
    el('line', { x1: 0, y1: 0, x2: 26, y2: -30, stroke: '#8a6a3c', 'stroke-width': 3, 'stroke-linecap': 'round' }),
    el('circle', { cx: 0, cy: 0, r, fill: head, stroke: '#3a2a1c', 'stroke-width': 1.2 }),
    hardness < 0.3 ? el('circle', { cx: 0, cy: 0, r: r - 3, fill: 'none', stroke: '#a67ba0', 'stroke-width': 1, 'stroke-dasharray': '2 2' }) : null);
}
