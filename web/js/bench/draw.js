// SPDX-License-Identifier: GPL-3.0-only
// Draws the bench: the instrument to scale, seen from above, as SVG.
// The whole picture is rebuilt on each change (a few hundred shapes), which
// keeps the code simple and is fast enough to follow a hand.
import { layout } from './geometry.js';
import { ViewPort } from './viewport.js';

const NS = 'http://www.w3.org/2000/svg';
const MM_PER_INCH = 25.4;
const VISUAL_HZ = 6; // how fast a plucked string is drawn swinging, so the eye can follow it

export function el(tag, attrs = {}, ...children) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) if (value !== undefined && value !== null) node.setAttribute(key, String(value));
  for (const child of children.flat()) if (child) node.append(child);
  return node;
}

const hash = (text) => [...text].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const points = (list) => list.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
const pathOf = (list, close = true) => `M${points(list).replaceAll(' ', ' L')}${close ? ' Z' : ''}`;

/** A wood grain or metal sheen to fill a shape with, defined once in `defs`. */
export function materialFill(defs, material) {
  const id = `m-${(material.id ?? 'custom').replace(/[^a-z0-9]+/gi, '-')}`;
  if (defs.querySelector(`#${id}`)) return `url(#${id})`;
  const { base, grain } = material.look;
  if (material.family === 'wood') {
    const gap = 2.2 + (hash(material.id ?? 'x') % 6) * 0.6;
    const lines = [];
    for (let k = 0; k < 9; k++) {
      const y = k * gap + (k % 3) * 0.25;
      lines.push(el('path', { d: `M0 ${y} C 25 ${y + 0.9}, 55 ${y - 0.9}, 80 ${y}`, stroke: grain, 'stroke-width': 0.55 + (k % 3) * 0.18, fill: 'none', opacity: 0.9 }));
    }
    defs.append(el('pattern', { id, patternUnits: 'userSpaceOnUse', width: 80, height: gap * 9 }, el('rect', { width: 80, height: gap * 9, fill: base }), ...lines));
  } else {
    defs.append(el('linearGradient', { id, x1: 0, y1: 0, x2: 0, y2: 1 },
      el('stop', { offset: 0, 'stop-color': grain }), el('stop', { offset: 0.35, 'stop-color': '#ffffff' }), el('stop', { offset: 0.5, 'stop-color': base }), el('stop', { offset: 1, 'stop-color': grain })));
  }
  return `url(#${id})`;
}

export class BenchView extends ViewPort {
  constructor(svg, bench, ui) {
    super(svg);
    this.bench = bench;
    this.ui = ui;
    new ResizeObserver(() => { this.measure(); if (this.autoFit && this.bench.strings.length) this.fit(); else { this.apply(); this.render(); } }).observe(svg);
  }

  /** Frame the whole instrument. */
  fit() {
    this.fitExtent(layout(this.bench).extent);
  }

  /** Frame the neck and sound hole. */
  fitNeck() {
    const lay = layout(this.bench);
    this.measure();
    const x0 = lay.nutX - 60;
    const x1 = Math.max(lay.hole.x + lay.hole.r, lay.bridgeX) + 80;
    const y0 = -Math.max(lay.headHalf + 24, 80);
    const y1 = -y0;
    this.autoFit = false;
    this.view = { cx: (x0 + x1) / 2, cy: 0, scale: Math.min(this.size.w / (x1 - x0), this.size.h / (y1 - y0)) };
    this.apply();
    this.render();
  }

  // ------------------------------------------------------------------ materials as pictures

  #fillFor(defs, material) { return materialFill(defs, material); }

  #wood(id, custom) {
    const { bench } = this;
    // A wood the maker typed in: drawn as plain, pale wood.
    return id === 'custom' ? { ...bench.material('custom', custom.density, custom.modulus), id: 'custom-wood', family: 'wood', look: { base: '#dcc9a3', grain: '#bba37c' } } : bench.material(id);
  }

  // ------------------------------------------------------------------ the picture

  render() {
    const { bench, ui } = this;
    if (!bench.strings.length) return;
    const lay = layout(bench);
    const p = bench.params;
    const svg = this.svg;
    const defs = el('defs');
    const g = el('g');
    const px = (n) => this.px(n);
    const top = this.#wood(p.topWood, { density: p.topCustomDensity, modulus: p.topCustomModulus });
    const back = this.#wood(p.backWood, { density: p.backCustomDensity, modulus: p.backCustomModulus });
    const neck = this.#wood(p.neckWood);
    const topFill = this.#fillFor(defs, top);
    const backFill = this.#fillFor(defs, back);
    const neckFill = this.#fillFor(defs, neck);
    const drop = ui.drop;
    const dropClass = (surface) => (drop?.surface === surface ? 'drop-target' : '');

    g.append(el('rect', { x: lay.extent.x0 - 4000, y: lay.extent.y0 - 4000, width: 8000 + lay.extent.x1 - lay.extent.x0, height: 8000 + lay.extent.y1 - lay.extent.y0, fill: 'transparent', 'data-role': 'bg' }));

    this.#sideView(g, lay, p, backFill, topFill, neckFill, dropClass);
    // Body
    g.append(el('path', { d: pathOf(lay.body), fill: topFill, stroke: '#3a2a1c', 'stroke-width': 1.4, 'vector-effect': 'non-scaling-stroke', 'data-surface': 'top', class: dropClass('top') }));
    g.append(el('path', { d: pathOf(lay.body.map(([x, y]) => [x, y * 0.965])), fill: 'none', stroke: '#00000030', 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' }));
    // Sound hole
    const { x: hx, r: hr } = lay.hole;
    g.append(el('circle', { cx: hx, cy: 0, r: hr + 5, fill: 'none', stroke: '#2a1d12', 'stroke-width': 3, opacity: 0.85, 'pointer-events': 'none' }));
    g.append(el('circle', { cx: hx, cy: 0, r: hr, fill: '#15110d', stroke: '#2a1d12', 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke', 'data-role': 'hole' }));
    // Neck
    const halfAt = lay.halfWidth;
    const neckPoly = [[lay.nutX, -halfAt(lay.nutX) - 1.5], [4, -halfAt(0) - 3], [4, halfAt(0) + 3], [lay.nutX, halfAt(lay.nutX) + 1.5]];
    g.append(el('polygon', { points: points(neckPoly), fill: neckFill, stroke: '#3a2a1c', 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke', 'data-surface': 'neck', class: dropClass('neck') }));
    const board = [[lay.nutX, -halfAt(lay.nutX)], [lay.boardEnd, -halfAt(lay.boardEnd)], [lay.boardEnd, halfAt(lay.boardEnd)], [lay.nutX, halfAt(lay.nutX)]];
    g.append(el('polygon', { points: points(board), fill: '#1f1710', opacity: 0.5, 'data-surface': 'neck', class: dropClass('neck'), 'pointer-events': 'none' }));
    // Headstock
    const hs = lay.headHalf;
    const head = [[lay.nutX, -halfAt(lay.nutX) - 1.5], [lay.nutX - 30, -hs + 2], [lay.headX + 12, -hs], [lay.headX, -hs + 12], [lay.headX, hs - 12], [lay.headX + 12, hs], [lay.nutX - 30, hs - 2], [lay.nutX, halfAt(lay.nutX) + 1.5]];
    g.append(el('polygon', { points: points(head), fill: neckFill, stroke: '#3a2a1c', 'stroke-width': 1, 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke', 'data-surface': 'neck', class: dropClass('neck') }));
    // Frets: the wires that are on the neck. Each can be dragged along it, or off it to take it out.
    const draggable = bench.hasFrets;
    for (const n of lay.fretNumbers) {
      const k = n - 1;
      const x = lay.fretX[k];
      const taking = ui.removingFret === n;
      g.append(el('line', { x1: x, x2: x, y1: -halfAt(x) + 0.5, y2: halfAt(x) - 0.5, stroke: taking ? '#d9534f' : '#d9d4c7', 'stroke-width': Math.max(1, 1.1), 'stroke-dasharray': taking ? '3 3' : undefined, 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' }));
      if ([2, 4, 6, 8, 11, 14, 16].includes(k)) g.append(el('circle', { cx: (x + (lay.fretX[k - 1] ?? lay.nutX)) / 2, cy: 0, r: 1.8, fill: '#e8e1d0', opacity: 0.65, 'pointer-events': 'none' }));
      if (draggable) g.append(el('rect', { x: x - px(4), y: -halfAt(x), width: px(8), height: 2 * halfAt(x), fill: 'transparent', 'data-role': 'fret', 'data-fret': n, class: 'handle ew', 'pointer-events': 'all' }, el('title', {}, `Fret ${n}: drag it along the neck, or off the guitar to take it out`)));
    }
    if (drop?.fret !== undefined) {
      const x = lay.fretX[drop.fret - 1];
      g.append(el('line', { x1: x, x2: x, y1: -halfAt(x), y2: halfAt(x), stroke: 'var(--accent)', 'stroke-width': 3, 'stroke-dasharray': '5 3', 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' }));
    }
    // Pegs and the string beyond the nut
    for (const peg of lay.pegs) this.#peg(g, lay, peg, bench, px);
    // Nut
    const nutW = 4;
    g.append(el('rect', { x: lay.nutX - nutW, y: -halfAt(lay.nutX) - 0.5, width: nutW, height: 2 * halfAt(lay.nutX) + 1, fill: '#efe9dc', stroke: '#8a826f', 'stroke-width': 0.8, 'vector-effect': 'non-scaling-stroke', rx: 1, 'pointer-events': 'none' }));
    g.append(el('rect', { x: lay.nutX - px(10), y: -halfAt(lay.nutX) - px(4), width: px(20), height: 2 * halfAt(lay.nutX) + px(8), fill: 'transparent', 'data-role': 'nut', class: 'handle ew', 'pointer-events': 'all' }, el('title', {}, 'Nut: drag to lengthen or shorten the strings')));
    // A pickup lies under the strings; the strings are drawn over it.
    if (lay.pickup) this.#pickup(g, lay, lay.pickup.x, { removing: ui.removingPickup }, px);
    else if (drop?.pickup !== undefined) this.#pickup(g, lay, lay.bridgeX - drop.pickup, { ghost: true }, px);
    // Strings
    for (let i = 0; i < lay.n; i++) this.#string(g, defs, lay, i, px);
    // Bridge
    const bw = 16;
    g.append(el('rect', { x: lay.bridgeX - bw / 2 - 6, y: -lay.bridgeHalf, width: bw + 12, height: 2 * lay.bridgeHalf, rx: 7, fill: '#2b1d13', stroke: '#120c07', 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' }));
    g.append(el('rect', { x: lay.bridgeX - 1.6, y: -lay.bridgeHalf + 6, width: 3.2, height: 2 * lay.bridgeHalf - 12, fill: '#efe9dc', 'pointer-events': 'none' }));
    g.append(el('rect', { x: lay.bridgeX - px(12), y: -lay.bridgeHalf - px(4), width: px(24), height: 2 * lay.bridgeHalf + px(8), fill: 'transparent', 'data-role': 'bridge', class: 'handle ew', 'pointer-events': 'all' }, el('title', {}, 'Bridge: drag to move it along the body')));
    // Drop marker for a string being brought from the rack
    if (drop?.replace !== undefined) {
      const x0 = lay.nutX;
      g.append(el('line', { x1: x0, x2: lay.bridgeX, y1: lay.stringY(drop.replace, x0), y2: lay.stringY(drop.replace, lay.bridgeX), stroke: 'var(--accent)', 'stroke-width': 5, opacity: 0.45, 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' }));
    } else if (drop?.insert !== undefined) {
      const yy = (x) => (drop.insert <= 0 ? lay.stringY(0, x) - lay.spacing(x) / 2 : drop.insert >= lay.n ? lay.stringY(lay.n - 1, x) + lay.spacing(x) / 2 : (lay.stringY(drop.insert - 1, x) + lay.stringY(drop.insert, x)) / 2);
      g.append(el('line', { x1: lay.nutX, x2: lay.bridgeX, y1: yy(lay.nutX), y2: yy(lay.bridgeX), stroke: 'var(--accent)', 'stroke-width': 3, 'stroke-dasharray': '6 4', 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' }));
    }
    this.#handles(g, lay, px);
    this.#ruler(g, lay, px);
    this.#tags(g, lay, px);
    svg.replaceChildren(defs, g);
  }

  #sideView(g, lay, p, backFill, topFill, neckFill, dropClass) {
    const { side } = lay;
    const B = p.bodyLengthMm;
    const y0 = side.y;
    const px = (n) => this.px(n);
    g.append(el('text', { x: 0, y: y0 - px(8), 'font-size': px(11), fill: 'var(--muted)', 'pointer-events': 'none' }, 'Side view'));
    // Back and sides: the body between the top and the back.
    g.append(el('rect', { x: 0, y: y0, width: B, height: side.depth, rx: 6, fill: backFill, stroke: '#3a2a1c', 'stroke-width': 1.2, 'vector-effect': 'non-scaling-stroke', 'data-surface': 'back', class: dropClass('back') }));
    // The top, drawn at its real thickness, with the sound hole cut through it.
    const t = Math.max(1.5, side.topThickness);
    const hx = lay.hole.x;
    const r = lay.hole.r;
    g.append(el('rect', { x: 0, y: y0, width: Math.max(0, hx - r), height: t, fill: topFill, 'data-surface': 'top', class: dropClass('top') }));
    g.append(el('rect', { x: hx + r, y: y0, width: Math.max(0, B - hx - r), height: t, fill: topFill, 'data-surface': 'top', class: dropClass('top') }));
    g.append(el('rect', { x: 0, y: y0, width: B, height: side.depth, rx: 6, fill: 'none', stroke: '#3a2a1c', 'stroke-width': 1.2, 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' }));
    // The neck seen from the side.
    g.append(el('rect', { x: lay.nutX - 190, y: y0, width: -lay.nutX + 190 + 6, height: 22, fill: neckFill, stroke: '#3a2a1c', 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke', 'data-surface': 'neck', class: dropClass('neck') }));
    // Depth handle along the bottom edge.
    g.append(el('rect', { x: 0, y: y0 + side.depth - px(6), width: B, height: px(12), fill: 'transparent', 'data-role': 'depth', class: 'handle ns', 'pointer-events': 'all' }, el('title', {}, 'Drag the bottom edge to make the body deeper or shallower')));
    g.append(el('text', { x: B / 2, y: y0 + side.depth + px(16), 'font-size': px(11), 'text-anchor': 'middle', fill: 'var(--muted)', 'pointer-events': 'none' }, `Depth ${this.#length(side.depth)}`));
  }

  /** A magnetic pickup: a case across the strings with a pole piece under each. Its length along the strings is the 12 mm the engine models. */
  #pickup(g, lay, x, { ghost = false, removing = false } = {}, px) {
    const half = lay.halfWidth(x) + 3.5;
    const w = 12;
    const opacity = ghost ? 0.5 : 1;
    g.append(el('rect', { x: x - w / 2, y: -half, width: w, height: 2 * half, rx: 3, fill: removing ? '#6a2a28' : '#1d1b19', stroke: removing ? '#d9534f' : '#0a0908', 'stroke-width': 1, 'stroke-dasharray': removing ? '4 3' : undefined, 'vector-effect': 'non-scaling-stroke', opacity, 'pointer-events': 'none' }));
    for (let i = 0; i < lay.n; i++) g.append(el('circle', { cx: x, cy: lay.stringY(i, x), r: 1.7, fill: '#b9b3a4', stroke: '#3a362f', 'stroke-width': 0.5, 'vector-effect': 'non-scaling-stroke', opacity, 'pointer-events': 'none' }));
    if (ghost) return;
    g.append(el('rect', { x: x - Math.max(w / 2, px(8)), y: -half - px(3), width: 2 * Math.max(w / 2, px(8)), height: 2 * half + px(6), fill: 'transparent', 'data-role': 'pickup', class: 'handle ew', 'pointer-events': 'all' },
      el('title', {}, `Pickup, ${this.#length(lay.pickup.atMm)} from the bridge: drag it along the strings, or off the guitar to take it off`)));
  }

  #peg(g, lay, peg, bench, px) {
    const info = bench.info(peg.i);
    const y = lay.stringY(peg.i, lay.nutX);
    const [postX, postY] = peg.post;
    g.append(el('line', { x1: lay.nutX, y1: y, x2: postX, y2: postY, stroke: '#c8ccd0', 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke', opacity: 0.8, 'pointer-events': 'none' }));
    const angle = 540 * Math.log2(Math.max(0.01, bench.strings[peg.i].tensionN) / 80);
    const selected = this.ui.selected === peg.i;
    g.append(el('circle', { cx: peg.x, cy: peg.y, r: 8, fill: '#bfb9aa', stroke: selected ? 'var(--accent)' : '#6b6558', 'stroke-width': selected ? 2.4 : 1.2, 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' }));
    g.append(el('g', { transform: `translate(${peg.x} ${peg.y}) rotate(${angle.toFixed(1)})`, 'pointer-events': 'none' },
      el('rect', { x: -3.5, y: -13, width: 7, height: 26, rx: 3.5, fill: '#e9e4d6', stroke: '#6b6558', 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke' }),
      el('circle', { r: 2.5, fill: '#6b6558' })));
    g.append(el('circle', { cx: peg.x, cy: peg.y, r: Math.max(13, px(14)), fill: 'transparent', 'data-role': 'peg', 'data-index': peg.i, class: 'handle grab', 'pointer-events': 'all' }, el('title', {}, `Peg for string ${peg.i + 1}: turn it to tighten or loosen the string (now ${info.note.name})`)));
  }

  #string(g, defs, lay, i, px) {
    const { bench, ui } = this;
    const s = bench.strings[i];
    const info = bench.info(i);
    const material = info.mat;
    const x0 = lay.nutX;
    const x1 = lay.bridgeX;
    const L = x1 - x0;
    const sag = Math.min(6, 2.4 * (80 / Math.max(3, s.tensionN)) ** 1.1);
    const pull = ui.pull?.i === i ? ui.pull : null;
    const vib = ui.vibrations.get(i);
    const now = performance.now();
    const samples = 44;
    const pts = [];
    for (let k = 0; k <= samples; k++) {
      const u = k / samples;
      const x = x0 + u * L;
      let dy = 4 * sag * u * (1 - u) * 0.5;
      if (pull) {
        const a = Math.min(0.98, Math.max(0.02, (pull.x - x0) / L));
        dy += pull.dy * (u < a ? u / a : (1 - u) / (1 - a));
      }
      if (vib) {
        const t = (now - vib.t0) / 1000;
        const a = Math.min(0.98, Math.max(0.02, (vib.x - x0) / L));
        let sum = 0;
        let norm = 0;
        for (let h = 1; h <= 6; h++) {
          const weight = Math.sin(h * Math.PI * a) / (h * h);
          norm += weight * Math.sin(h * Math.PI * a);
          sum += weight * Math.sin(h * Math.PI * u) * Math.cos(2 * Math.PI * h * VISUAL_HZ * t * vib.speed) * Math.exp(-t / (vib.tau / h ** 0.5));
        }
        dy += (vib.amp * sum) / (norm || 1);
      }
      pts.push([x, lay.stringY(i, x) + dy]);
    }
    const wide = Math.max(2, 1.3 + s.stringDiameterMm * 1.7);
    const color = material.family === 'polymer' ? '#f1ecd8' : material.look.grain === '#8d5f31' ? '#b07a43' : material.look.base;
    const selected = ui.selected === i;
    if (selected) g.append(el('path', { d: pathOf(pts, false), fill: 'none', stroke: 'var(--accent)', 'stroke-width': wide + 5, opacity: 0.25, 'stroke-linecap': 'round', 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' }));
    g.append(el('path', { d: pathOf(pts, false), fill: 'none', stroke: '#00000040', 'stroke-width': wide + 1.2, 'vector-effect': 'non-scaling-stroke', transform: 'translate(0 0.8)', 'pointer-events': 'none' }));
    g.append(el('path', { d: pathOf(pts, false), fill: 'none', stroke: color, 'stroke-width': wide, 'stroke-linecap': 'round', 'vector-effect': 'non-scaling-stroke', 'stroke-dasharray': s.stringWound ? '1.2 0.8' : undefined, 'pointer-events': 'none' }));
    // Winding drawn as short cross-strokes would be to scale but too fine to see; the dashes stand for it.
    void defs;
    // A finger held on the string by the keyboard.
    for (const [, f] of ui.fingers) {
      if (f.string !== i || f.fret < 1) continue;
      const fx = lay.fretX[f.fret - 1];
      const before = lay.fretNumbers.filter((n) => n < f.fret).pop(); // the wire the finger sits behind
      const fprev = before === undefined ? lay.nutX : lay.fretX[before - 1];
      g.append(el('circle', { cx: (fx + fprev) / 2, cy: lay.stringY(i, (fx + fprev) / 2), r: Math.max(3.2, px(5)), fill: 'var(--accent)', stroke: '#fff', 'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' }));
    }
  }

  #handles(g, lay, px) {
    const handle = (role, x, y, title, extra = {}) => {
      g.append(el('circle', { cx: x, cy: y, r: Math.max(5, px(7)), fill: '#fffdf6', stroke: 'var(--accent)', 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke', opacity: 0.9, 'pointer-events': 'none' }));
      g.append(el('circle', { cx: x, cy: y, r: Math.max(8, px(13)), fill: 'transparent', 'data-role': role, class: 'handle grab', 'pointer-events': 'all', ...extra }, el('title', {}, title)));
    };
    const [, , upper, waist, lower, , tail] = lay.anchors;
    handle('outline-upper', upper[0], upper[1], 'Upper bout: drag to make the shoulders wider or narrower');
    handle('outline-waist', waist[0], waist[1], 'Waist: drag across to pinch it, along to move it');
    handle('outline-lower', lower[0], lower[1], 'Lower bout: drag to make the tail end wider or narrower');
    handle('outline-tail', tail[0], tail[1], 'Tail: drag to make the body longer or shorter');
    handle('hole-size', lay.hole.x, lay.hole.r, 'Sound hole: drag its edge to make it bigger or smaller');
  }

  #length(mm) {
    return this.ui.unit === 'in' ? `${(mm / MM_PER_INCH).toFixed(2)} in` : `${Math.round(mm)} mm`;
  }

  #ruler(g, lay, px) {
    const y = lay.rulerY;
    const x0 = lay.nutX - 190;
    const x1 = Math.max(lay.extent.x1 - 20, lay.bridgeX);
    const inch = this.ui.unit === 'in';
    const unit = inch ? MM_PER_INCH : 10;
    const major = inch ? 4 : 10; // every 4 in, or every 100 mm
    g.append(el('line', { x1: x0, x2: x1, y1: y, y2: y, stroke: 'var(--muted)', 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' }));
    const from = Math.ceil((x0 - lay.nutX) / unit);
    const to = Math.floor((x1 - lay.nutX) / unit);
    for (let k = from; k <= to; k++) {
      const x = lay.nutX + k * unit;
      const isMajor = k % major === 0;
      const dense = this.pxPerMm * unit < 5;
      if (dense && !isMajor && !(inch && k % 1 === 0 && this.pxPerMm * unit >= 5)) continue;
      g.append(el('line', { x1: x, x2: x, y1: y, y2: y + px(isMajor ? 9 : 5), stroke: 'var(--muted)', 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' }));
      if (isMajor) g.append(el('text', { x, y: y - px(4), 'font-size': px(10.5), 'text-anchor': 'middle', fill: 'var(--muted)', 'pointer-events': 'none' }, inch ? `${k} in` : `${k * 10} mm`));
    }
    // The scale length, nut to bridge.
    const by = y + px(24);
    g.append(el('line', { x1: lay.nutX, x2: lay.bridgeX, y1: by, y2: by, stroke: 'var(--accent)', 'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' }));
    for (const x of [lay.nutX, lay.bridgeX]) g.append(el('line', { x1: x, x2: x, y1: by - px(5), y2: by + px(5), stroke: 'var(--accent)', 'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' }));
    g.append(el('text', { x: (lay.nutX + lay.bridgeX) / 2, y: by - px(5), 'font-size': px(11.5), 'text-anchor': 'middle', fill: 'var(--accent)', 'font-weight': 600, 'pointer-events': 'none' }, `Vibrating length ${this.#length(lay.scale)}`));
  }

  #tags(g, lay, px) {
    const { bench, ui } = this;
    const fs = px(10.5);
    for (let i = 0; i < lay.n; i++) {
      const info = bench.info(i);
      const text = info.playable ? `${info.note.name} ${info.note.cents === 0 ? '' : `${info.note.cents > 0 ? '+' : '−'}${Math.abs(info.note.cents)}¢`}`.trim() : 'out of range';
      const inTune = Math.abs(info.note.cents) <= 5;
      const x = lay.bridgeX + px(30);
      // The tags are spread a little further apart than the strings so they can be read and grabbed.
      const gap = Math.max(lay.spacing(lay.bridgeX), px(18));
      const y = (i - (lay.n - 1) / 2) * gap;
      const w = px(8 * text.length + 12);
      const h = px(15);
      g.append(el('line', { x1: lay.bridgeX + 9, y1: lay.stringY(i, lay.bridgeX), x2: x, y2: y, stroke: '#6b6558', 'stroke-width': 0.8, 'vector-effect': 'non-scaling-stroke', opacity: 0.7, 'pointer-events': 'none' }));
      const removing = ui.removing === i;
      g.append(el('g', { class: `tag ${removing ? 'removing' : ''}`, 'data-role': 'tag', 'data-index': i },
        el('rect', { x, y: y - h / 2, width: w, height: h, rx: h / 2, fill: removing ? '#f3c9c0' : '#fffdf6', stroke: inTune ? '#4e8a4a' : '#c28a2a', 'stroke-width': 1.4, 'vector-effect': 'non-scaling-stroke', opacity: removing ? 0.6 : 0.96, class: 'handle grab', 'pointer-events': 'all' }),
        el('text', { x: x + w / 2, y: y + fs * 0.35, 'font-size': fs, 'text-anchor': 'middle', fill: '#2a2620', 'pointer-events': 'none', 'font-variant-numeric': 'tabular-nums' }, text),
        el('title', {}, 'Click to tune this string to its nearest note. Drag it off the guitar to take the string off.')));
    }
    if (ui.rideTag) {
      const t = ui.rideTag;
      const w = px(10 * t.text.length + 18);
      const h = px(24);
      g.append(el('g', { 'pointer-events': 'none' },
        el('rect', { x: t.x + px(16), y: t.y - px(38), width: w, height: h, rx: px(6), fill: '#2a2620', opacity: 0.92 }),
        el('text', { x: t.x + px(16) + w / 2, y: t.y - px(38) + h * 0.7, 'font-size': px(14), 'text-anchor': 'middle', fill: '#fff', 'font-weight': 600 }, t.text)));
    }
    if (ui.sweep?.length > 1) {
      // The path of a strum, fading behind the hand.
      const n = ui.sweep.length;
      for (let k = 1; k < n; k++) {
        const [a, b] = [ui.sweep[k - 1], ui.sweep[k]];
        g.append(el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: 'var(--accent)', 'stroke-width': 3, 'stroke-linecap': 'round', 'vector-effect': 'non-scaling-stroke', opacity: (0.55 * k) / n, 'pointer-events': 'none' }));
      }
    }
    if (ui.hand && ui.pointer) {
      const { x, y } = ui.pointer;
      const s = px(1);
      g.append(el('g', { transform: `translate(${x + 8 * s} ${y + 8 * s}) scale(${s})`, 'pointer-events': 'none', opacity: 0.9 }, handGlyph(ui.hand)));
    }
  }
}

export function handGlyph(hand) {
  if (hand === 'pick') return el('path', { d: 'M0 0 C 12 -2 20 6 14 20 C 10 28 4 30 0 22 C -4 12 -4 4 0 0 Z', fill: '#d9a441', stroke: '#6e4b10', 'stroke-width': 1.2 });
  if (hand === 'thumb') return el('path', { d: 'M0 0 C 6 -6 18 -4 20 6 C 21 18 12 28 3 26 C -4 24 -6 8 0 0 Z', fill: '#e8b9a0', stroke: '#8a5a44', 'stroke-width': 1.2 });
  return el('path', { d: 'M0 0 C 5 -8 12 -8 14 0 L 14 24 C 12 30 4 30 2 24 Z', fill: '#e8b9a0', stroke: '#8a5a44', 'stroke-width': 1.2 });
}

