// SPDX-License-Identifier: GPL-3.0-only
// Where everything is on the bars bench, in millimetres. The bars lie side by side, each along y and centred on
// y = 0, so stretching a bar lengthens it both ways. A side view of the selected bar sits below them.
import { BAR_NODE } from '/shared/physics.mjs';

export const BAR_WIDTH = 40; // every bar is drawn 40 mm across; width does not change the note
export const PITCH = 46; // from one bar to the next
export const RAIL = 26; // the width of the frame's two rails
export const SIDE_SCALE = 3; // the side view draws thickness this many times too big, so the arch can be seen
export const TUBE_DRAW = 0.4; // and the tube this fraction of its length, so it fits
export const TUBE_MOUTH = 35; // the tube's outer width, mm

export function layout(bench, selected = 0) {
  const n = bench.bars.length;
  const sel = Math.min(Math.max(selected, 0), Math.max(0, n - 1));
  const bars = bench.bars.map((b, i) => ({ i, x: (i - (n - 1) / 2) * PITCH, L: b.barLengthMm, half: b.barLengthMm / 2 }));
  const maxHalf = Math.max(80, ...bars.map((b) => b.half));
  const frameHalf = (n * PITCH) / 2 + 30;
  // The two rails the bars rest on run under the nodes of the bars (22% of the way in from each end, the
  // place where a bar can rest without muffling its note): drawn straight from the first bar's to the last's.
  const nodeY = (b) => (0.5 - BAR_NODE) * b.L;
  const first = bars[0];
  const last = bars.at(-1);
  const railY = (x, sign) => {
    if (n === 1 || last.x === first.x) return sign * nodeY(first);
    return sign * (nodeY(first) + (nodeY(last) - nodeY(first)) * ((x - first.x) / (last.x - first.x)));
  };
  const rails = [-1, 1].map((sign) => ({ sign, x0: -frameHalf, x1: frameHalf, y0: railY(-frameHalf, sign), y1: railY(frameHalf, sign) }));

  // The side view of the selected bar: its top face at y = side.y, its thickness drawn SIDE_SCALE times too big.
  const b = bench.bars[sel];
  const tubeDrawn = b.tubeFit ? b.tubeLengthMm * TUBE_DRAW : 0;
  const side = { y: maxHalf + 100, L: b.barLengthMm, h: b.barThicknessMm, T: b.barThicknessMm * SIDE_SCALE, tube: b.tubeFit, tubeDrawn, i: sel };
  const sideHalf = side.L / 2;
  const extent = {
    x0: Math.min(-frameHalf, -sideHalf) - 50,
    x1: Math.max(frameHalf, sideHalf) + 50,
    y0: -maxHalf - 80,
    y1: side.y + side.T + (b.tubeFit ? tubeDrawn + 12 : 0) + 60,
  };
  return { n, bars, maxHalf, frameHalf, rails, side, extent, selected: sel };
}

/** The bar under a point on the top view, and how far along it (0 at the top end, 1 at the bottom), or null. */
export function barAt(lay, x, y, reach = 0) {
  for (const b of lay.bars) {
    if (Math.abs(x - b.x) <= BAR_WIDTH / 2 + reach && Math.abs(y) <= b.half + reach) return { i: b.i, u: (y + b.half) / b.L };
  }
  return null;
}

/** Where a new bar dropped at x would go in the row (0 to n): before the bar the point is left of the middle of, after the others. */
export function slotAt(lay, x) {
  const idx = x / PITCH + (lay.n - 1) / 2;
  return Math.min(lay.n, Math.max(0, Math.round(idx + 0.5)));
}

/** Is the point on the frame the bars lie on, or close enough that a bar dropped there joins the row? */
export function onFrame(lay, x, y) {
  return Math.abs(x) <= lay.frameHalf + 60 && Math.abs(y) <= lay.maxHalf + 50;
}

/** The place struck, as the fraction of the length from the nearer end (the bar sounds the same from either end). */
export const strikeFraction = (u) => Math.min(u, 1 - u);
