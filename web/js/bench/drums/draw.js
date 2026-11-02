// SPDX-License-Identifier: GPL-3.0-only
// Draws the drums bench: the row of drums seen from above, heads and lugs and shells, and below it a side view of
// the selected drum with its depth, its bottom and its head. SVG, rebuilt on each change.
import { el, materialFill } from '../draw.js';
import { ViewPort } from '../viewport.js';
import { layout, LUG_AT, LUG_R, SHELL_WALL, THICK_SCALE } from './geometry.js';

const MM_PER_INCH = 25.4;
const RING_S = 1.0; // how long a blow is shown on the head

export class DrumsView extends ViewPort {
  constructor(svg, bench, ui) {
    super(svg);
    this.bench = bench;
    this.ui = ui;
    new ResizeObserver(() => { this.measure(); if (this.autoFit && this.bench.drums.length) this.fit(); else { this.apply(); this.render(); } }).observe(svg);
  }

  /** Frame the whole instrument. */
  fit() { this.fitExtent(layout(this.bench, this.ui.selected, this.ui.pin).extent); }

  #length(mm) {
    return this.ui.unit === 'in' ? `${(mm / MM_PER_INCH).toFixed(1)} in` : `${Math.round(mm)} mm`;
  }

  render() {
    const { bench, ui, svg } = this;
    if (!bench.drums.length) return;
    const lay = layout(bench, ui.selected, ui.pin);
    const px = (n) => this.px(n);
    const defs = el('defs');
    const g = el('g');
    for (const b of lay.drums) this.#drum(g, defs, b, px);
    this.#dropMarks(g, lay, ui.drop);
    this.#listener(g, lay, px);
    this.#tags(g, lay, px);
    this.#sideView(g, defs, lay, px);
    if (ui.strikeAim) {
      const { x, y, lift } = ui.strikeAim;
      g.append(el('circle', { cx: x, cy: y, r: px(5 + lift * 10), fill: 'none', stroke: 'var(--accent)', 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke', opacity: 0.8, 'pointer-events': 'none' }));
    }
    if (ui.rideTag) {
      const t = ui.rideTag;
      const w = px(8.5 * t.text.length + 18);
      const h = px(24);
      g.append(el('g', { 'pointer-events': 'none' },
        el('rect', { x: t.x + px(16), y: t.y - px(38), width: w, height: h, rx: px(6), fill: '#2a2620', opacity: 0.92 }),
        el('text', { x: t.x + px(16) + w / 2, y: t.y - px(38) + h * 0.7, 'font-size': px(14), 'text-anchor': 'middle', fill: '#fff', 'font-weight': 600 }, t.text)));
    }
    if (ui.hand && ui.pointer) {
      const s = px(1);
      g.append(el('g', { transform: `translate(${ui.pointer.x + 6 * s} ${ui.pointer.y + 6 * s}) scale(${s})`, 'pointer-events': 'none', opacity: 0.9 }, stickGlyph(bench.hands.find((h) => h.id === ui.hand))));
    }
    svg.replaceChildren(defs, g);
  }

  // ------------------------------------------------------------------ a drum seen from above

  #drum(g, defs, b, px) {
    const { bench, ui } = this;
    const info = bench.info(b.i);
    const selected = ui.selected === b.i;
    const hit = ui.hits?.get(b.i);
    const age = hit ? (performance.now() - hit.t0) / 1000 : Infinity;
    const shellR = b.R + SHELL_WALL;
    g.append(el('circle', { cx: b.x, cy: b.y, r: shellR, fill: materialFill(defs, info.shell), stroke: selected ? 'var(--accent)' : '#3a2a1c', 'stroke-width': selected ? 2.4 : 1.2, 'vector-effect': 'non-scaling-stroke', 'data-role': 'drum-shell', 'data-index': b.i, 'data-surface': 'shell', class: 'surface' }));
    // The head: a pale film, a little darker where it is wound tight.
    const lit = ui.drop?.kind === 'head' && ui.drop.i === b.i;
    const gradient = `head-${b.i}`;
    defs.append(el('radialGradient', { id: gradient }, el('stop', { offset: 0, 'stop-color': info.head.look.base }), el('stop', { offset: 1, 'stop-color': info.head.look.grain })));
    g.append(el('circle', { cx: b.x, cy: b.y, r: b.R, fill: `url(#${gradient})`, stroke: lit ? 'var(--accent)' : '#7d858c', 'stroke-width': lit ? 2.6 : 1, 'vector-effect': 'non-scaling-stroke', 'data-role': 'drum-head', 'data-index': b.i, 'data-surface': 'head', class: 'surface' }));
    // The first nodal circle of the second round mode, as a faint hint of where the head divides.
    g.append(el('circle', { cx: b.x, cy: b.y, r: b.R * 0.4355, fill: 'none', stroke: '#9aa3ad', 'stroke-width': 0.8, 'stroke-dasharray': '3 4', 'vector-effect': 'non-scaling-stroke', opacity: 0.55, 'pointer-events': 'none' }));
    // The hoop is where a hand takes hold to make the drum wider.
    g.append(el('circle', { cx: b.x, cy: b.y, r: b.R, fill: 'none', stroke: '#c4c9ce', 'stroke-width': 4, 'vector-effect': 'non-scaling-stroke', opacity: 0.9, 'pointer-events': 'none' }));
    g.append(el('circle', { cx: b.x, cy: b.y, r: b.R + SHELL_WALL * 0.55, fill: 'none', stroke: 'transparent', 'stroke-width': px(14), 'data-role': 'drum-rim', 'data-index': b.i, class: 'handle grab', 'pointer-events': 'stroke' },
      el('title', {}, `Drag to make drum ${b.i + 1} wider or narrower (now ${this.#length(b.D)})`)));
    // Lugs, evenly round the rim: turn any of them to tighten or slacken the head.
    for (let k = 0; k < b.lugs; k++) {
      const a = (2 * Math.PI * (k + 0.5)) / b.lugs;
      const x = b.x + (b.R + LUG_AT) * Math.cos(a);
      const y = b.y + (b.R + LUG_AT) * Math.sin(a);
      g.append(el('circle', { cx: x, cy: y, r: Math.max(LUG_R, px(5)), fill: '#d9dde1', stroke: '#4c545c', 'stroke-width': 1.2, 'vector-effect': 'non-scaling-stroke', 'data-role': 'drum-lug', 'data-index': b.i, class: 'handle grab', 'pointer-events': 'all' },
        el('title', {}, `Drag round the drum to tighten or slacken the head (now ${Math.round(bench.drums[b.i].headTension)} N/m)`)));
      g.append(el('line', { x1: x - LUG_R * 0.55, x2: x + LUG_R * 0.55, y1: y, y2: y, stroke: '#4c545c', 'stroke-width': 1.4, 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none', transform: `rotate(${(a * 180) / Math.PI} ${x} ${y})` }));
    }
    if (age < RING_S) {
      const fade = 1 - age / RING_S;
      g.append(el('circle', { cx: b.x, cy: b.y, r: b.R, fill: '#fff', opacity: 0.3 * fade, 'pointer-events': 'none' }));
      const at = hit.at;
      const px0 = b.x + at.r * b.R * Math.cos(at.angle);
      const py0 = b.y + at.r * b.R * Math.sin(at.angle);
      g.append(el('circle', { cx: px0, cy: py0, r: 4 + 0.6 * b.R * age, fill: 'none', stroke: 'var(--accent)', 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke', opacity: 0.85 * fade, 'pointer-events': 'none' }));
    }
  }

  #dropMarks(g, lay, drop) {
    if (!drop) return;
    if (drop.kind === 'shell' || drop.kind === 'head') {
      const b = lay.drums[drop.i];
      g.append(el('circle', { cx: b.x, cy: b.y, r: b.R + SHELL_WALL + 3, fill: 'var(--accent)', opacity: 0.18, stroke: 'var(--accent)', 'stroke-width': 2.4, 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' }));
    } else if (drop.kind === 'insert') {
      const before = lay.drums[drop.insert];
      const after = lay.drums[drop.insert - 1];
      const x = before && after ? (before.x - before.R + after.x + after.R) / 2 : before ? before.x - before.R - SHELL_WALL - 20 : after.x + after.R + SHELL_WALL + 20;
      g.append(el('line', { x1: x, x2: x, y1: -lay.maxR - 10, y2: lay.maxR + 10, stroke: 'var(--accent)', 'stroke-width': 3, 'stroke-dasharray': '6 4', 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' }));
    }
  }

  /** The listener the strike angle is measured from: a small head with sound arcs, to the right of the row. */
  #listener(g, lay, px) {
    const { x, y } = lay.listener;
    g.append(el('g', { 'pointer-events': 'none', opacity: 0.75 },
      el('circle', { cx: x, cy: y, r: 14, fill: '#e8e4da', stroke: '#6b6558', 'stroke-width': 1.2, 'vector-effect': 'non-scaling-stroke' }),
      el('path', { d: `M${x - 26} ${y - 14} Q${x - 36} ${y} ${x - 26} ${y + 14}`, fill: 'none', stroke: '#6b6558', 'stroke-width': 1.4, 'vector-effect': 'non-scaling-stroke' }),
      el('path', { d: `M${x - 38} ${y - 22} Q${x - 52} ${y} ${x - 38} ${y + 22}`, fill: 'none', stroke: '#6b6558', 'stroke-width': 1.4, 'vector-effect': 'non-scaling-stroke' }),
      el('text', { x, y: y + 34, 'font-size': px(11), 'text-anchor': 'middle', fill: 'var(--muted)' }, 'listener')));
  }

  #tags(g, lay, px) {
    const { bench, ui } = this;
    const fs = px(11);
    for (const b of lay.drums) {
      const info = bench.info(b.i);
      const c = info.note.cents;
      const text = info.playable ? `${info.note.name}${c === 0 ? '' : ` ${c > 0 ? '+' : '−'}${Math.abs(c)}¢`}` : 'out of range';
      const inTune = Math.abs(c) <= 5;
      const w = Math.max(px(8 * text.length + 12), 28);
      const h = px(16);
      const y = -b.R - SHELL_WALL - px(14) - h / 2;
      const removing = ui.removing === b.i;
      g.append(el('g', { class: `tag ${removing ? 'removing' : ''}`, 'data-role': 'tag', 'data-index': b.i },
        el('rect', { x: b.x - w / 2, y: y - h / 2, width: w, height: h, rx: h / 2, fill: removing ? '#f3c9c0' : '#fffdf6', stroke: inTune ? '#4e8a4a' : '#c28a2a', 'stroke-width': 1.4, 'vector-effect': 'non-scaling-stroke', opacity: removing ? 0.6 : 0.96, class: 'handle grab', 'pointer-events': 'all' }),
        el('text', { x: b.x, y: y + fs * 0.35, 'font-size': fs, 'text-anchor': 'middle', fill: '#2a2620', 'pointer-events': 'none', 'font-variant-numeric': 'tabular-nums' }, text),
        el('title', {}, 'Click to tune this drum to its nearest note. Drag it off the row to take the drum away.')));
      if (ui.selected === b.i) {
        const d = bench.drums[b.i];
        g.append(el('text', { x: b.x, y: b.R + SHELL_WALL + px(16), 'font-size': px(10.5), 'text-anchor': 'middle', fill: 'var(--accent)', 'font-weight': 600, 'pointer-events': 'none', 'font-variant-numeric': 'tabular-nums' },
          `${this.#length(b.D)} · ${Math.round(d.headTension)} N/m`));
      }
    }
  }

  // ------------------------------------------------------------------ the side view

  #sideView(g, defs, lay, px) {
    const { bench } = this;
    const { side } = lay;
    const i = side.i;
    const info = bench.info(i);
    const half = side.D / 2;
    const y0 = side.y;
    const top = y0 - side.thick / 2;
    g.append(el('text', { x: -half, y: y0 - px(30), 'font-size': px(11), fill: 'var(--muted)', 'pointer-events': 'none' }, `Side view of drum ${i + 1}: the head drawn ${THICK_SCALE} times too thick`));
    // The shell: two walls, the bottom if it is closed.
    const wall = Math.max(6, SHELL_WALL * 0.7);
    const fill = materialFill(defs, info.shell);
    for (const sign of [-1, 1]) {
      g.append(el('rect', { x: sign < 0 ? -half - wall : half, y: y0, width: wall, height: side.depth, fill, stroke: '#3a2a1c', 'stroke-width': 1.2, 'vector-effect': 'non-scaling-stroke', 'data-role': 'drum-side', 'data-index': i, 'data-surface': 'shell', class: 'surface' }));
    }
    const bottom = y0 + side.depth;
    if (side.closed) {
      g.append(el('rect', { x: -half - wall, y: bottom - wall, width: side.D + 2 * wall, height: wall, fill, stroke: '#3a2a1c', 'stroke-width': 1.2, 'vector-effect': 'non-scaling-stroke', 'data-role': 'drum-side', 'data-index': i, 'data-surface': 'shell', class: 'surface' }));
      g.append(el('rect', { x: -half, y: y0 + side.thick / 2, width: side.D, height: Math.max(0, side.depth - wall - side.thick / 2), fill: '#aeb8c2', opacity: 0.16, 'pointer-events': 'none' }));
    } else if (side.bottom === 'head') {
      // a second head across the bottom, resting on its own hoop, and the air between the two heads
      g.append(el('rect', { x: -half, y: y0 + side.thick / 2, width: side.D, height: Math.max(0, side.depth - side.bottomThick / 2 - side.thick / 2), fill: '#aeb8c2', opacity: 0.16, 'pointer-events': 'none' }));
      g.append(el('rect', { x: -half, y: bottom - side.bottomThick, width: side.D, height: side.bottomThick, rx: 1, fill: info.head.look.grain, stroke: '#7d858c', 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' }));
    } else {
      g.append(el('line', { x1: -half - wall, x2: half + wall, y1: bottom, y2: bottom, stroke: '#6b6558', 'stroke-width': 1.4, 'stroke-dasharray': '7 5', 'vector-effect': 'non-scaling-stroke', opacity: 0.8, 'pointer-events': 'none' }));
    }
    // A click along the bottom changes it: open, a second head, closed.
    g.append(el('rect', { x: -half - wall, y: bottom - px(9), width: side.D + 2 * wall, height: px(18), fill: 'transparent', 'data-role': 'drum-bottom', 'data-index': i, class: 'handle grab', 'pointer-events': 'all' },
      el('title', {}, 'Click to change the bottom: open, a second head, or closed')));
    g.append(el('text', { x: half + wall + px(8), y: bottom - px(4), 'font-size': px(11), fill: 'var(--muted)', 'pointer-events': 'none' }, { closed: 'closed bottom', head: 'second head', open: 'open bottom' }[side.bottom]));
    // The head lies across the top, and rests on the hoop.
    g.append(el('rect', { x: -half, y: top, width: side.D, height: side.thick, rx: 1, fill: info.head.look.grain, stroke: '#7d858c', 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke', 'data-role': 'drum-head-side', 'data-index': i, 'data-surface': 'head', class: 'surface' }));
    for (const sign of [-1, 1]) {
      g.append(el('rect', { x: sign * half - (sign < 0 ? 4 : 0), y: top - 5, width: 4, height: side.thick + 10, fill: '#c4c9ce', stroke: '#4c545c', 'stroke-width': 0.8, 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' }));
    }
    // Handles: the depth (under the middle), the head's thickness (at the left end of the head), the width (the two walls).
    g.append(el('circle', { cx: 0, cy: bottom, r: Math.max(5, px(7)), fill: 'var(--accent)', stroke: '#fff', 'stroke-width': 1.4, 'vector-effect': 'non-scaling-stroke', 'data-role': 'drum-depth', 'data-index': i, class: 'handle ns', 'pointer-events': 'all' },
      el('title', {}, `Drag to make the shell deeper or shallower (now ${this.#length(side.depth)})`)));
    g.append(el('text', { x: px(10), y: bottom - px(12), 'font-size': px(11), fill: 'var(--accent)', 'font-weight': 600, 'pointer-events': 'none' }, `Depth ${this.#length(side.depth)}`));
    g.append(el('circle', { cx: -half + px(12), cy: top + side.thick, r: Math.max(4, px(6)), fill: '#fff', stroke: 'var(--accent)', 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke', 'data-role': 'drum-thick', 'data-index': i, class: 'handle ns', 'pointer-events': 'all' },
      el('title', {}, `Drag to make the head thicker or thinner (now ${Math.round(bench.drums[i].headThicknessUm)} µm)`)));
    g.append(el('text', { x: -half + px(24), y: top - px(8), 'font-size': px(11), fill: 'var(--accent)', 'font-weight': 600, 'pointer-events': 'none' }, `Head ${Math.round(bench.drums[i].headThicknessUm)} µm`));
    for (const sign of [-1, 1]) {
      g.append(el('rect', { x: sign * (half + wall) - px(6), y: y0, width: px(12), height: side.depth, fill: 'transparent', 'data-role': 'drum-size-side', 'data-index': i, class: 'handle ew', 'pointer-events': 'all' },
        el('title', {}, `Drag to make the drum wider or narrower (now ${this.#length(side.D)})`)));
    }
  }
}

/** A stick, mallet or beater, head down: the head shows how hard it is. */
export function stickGlyph(hand) {
  const hardness = hand?.params?.stickHardness ?? 0.5;
  const kind = hand?.glyph ?? 'stick';
  if (kind === 'stick') {
    return el('g', {},
      el('line', { x1: 0, y1: 0, x2: 34, y2: -38, stroke: '#b98a54', 'stroke-width': 4, 'stroke-linecap': 'round' }),
      el('ellipse', { cx: 0, cy: 0, rx: hardness > 0.9 ? 3.6 : 4.4, ry: hardness > 0.9 ? 3.6 : 5.4, transform: 'rotate(-48)', fill: hardness > 0.9 ? '#f1ecd8' : '#b98a54', stroke: '#3a2a1c', 'stroke-width': 1.1 }));
  }
  const r = kind === 'beater' ? 9 : 11;
  return el('g', {},
    el('line', { x1: 0, y1: 0, x2: 26, y2: -30, stroke: '#8a6a3c', 'stroke-width': 3, 'stroke-linecap': 'round' }),
    el('circle', { cx: 0, cy: 0, r, fill: kind === 'beater' ? '#c9b99a' : '#c9a3c4', stroke: '#3a2a1c', 'stroke-width': 1.2 }),
    el('circle', { cx: 0, cy: 0, r: r - 3, fill: 'none', stroke: kind === 'beater' ? '#a39370' : '#a67ba0', 'stroke-width': 1, 'stroke-dasharray': '2 2' }));
}
