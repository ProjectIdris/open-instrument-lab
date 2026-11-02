// SPDX-License-Identifier: GPL-3.0-only
// A small tuner: the note a string is nearest to, and how far off it is.
import { el } from './draw.js';

const SPAN_CENTS = 50;

export class Tuner {
  constructor(root) {
    this.root = root;
    this.svg = el('svg', { viewBox: '-60 -8 120 62', class: 'tuner-dial', role: 'img', 'aria-label': 'Tuner' });
    this.name = document.createElement('div');
    this.name.className = 'tuner-note';
    this.detail = document.createElement('div');
    this.detail.className = 'tuner-detail';
    root.append(this.svg, this.name, this.detail);
    this.set(null);
  }

  /** @param info one string's facts from Bench.info, or null */
  set(info, label = '', idle = 'Touch or tune a string') {
    const cents = info?.playable ? info.note.cents : 0;
    const angle = (Math.max(-SPAN_CENTS, Math.min(SPAN_CENTS, cents)) / SPAN_CENTS) * 70;
    const polar = (deg, r) => [r * Math.sin((deg * Math.PI) / 180), -r * Math.cos((deg * Math.PI) / 180)];
    const arc = (a0, a1, r) => {
      const [x0, y0] = polar(a0, r);
      const [x1, y1] = polar(a1, r);
      return `M${x0} ${y0 + 44} A${r} ${r} 0 0 1 ${x1} ${y1 + 44}`;
    };
    const inTune = Math.abs(cents) <= 5;
    const [nx, ny] = polar(angle, 42);
    this.svg.replaceChildren(
      el('path', { d: arc(-70, 70, 46), fill: 'none', stroke: 'var(--line)', 'stroke-width': 7, 'stroke-linecap': 'round' }),
      el('path', { d: arc(-7, 7, 46), fill: 'none', stroke: '#6aa65f', 'stroke-width': 7 }),
      el('line', { x1: 0, y1: 44, x2: nx, y2: ny + 44, stroke: inTune ? '#3f8a3a' : 'var(--accent)', 'stroke-width': 2.4, 'stroke-linecap': 'round', opacity: info?.playable ? 1 : 0.2 }),
      el('circle', { cx: 0, cy: 44, r: 3.2, fill: 'var(--ink)' }));
    this.name.textContent = info?.playable ? info.note.name : '–';
    this.name.dataset.state = !info?.playable ? 'idle' : inTune ? 'good' : 'off';
    this.detail.textContent = info?.playable ? `${label}${info.hz.toFixed(1)} Hz, ${cents === 0 ? 'in tune' : `${Math.abs(cents)}¢ ${cents > 0 ? 'sharp' : 'flat'}`}` : idle;
  }
}
