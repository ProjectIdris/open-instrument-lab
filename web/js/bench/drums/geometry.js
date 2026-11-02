// SPDX-License-Identifier: GPL-3.0-only
// Where everything is on the drums bench, in millimetres. The drums stand in a row, each a circle seen from above,
// side by side along x and centred on y = 0, all at true size. A side view of the selected drum sits below them.
import { lugCount } from './model.js';

export const GAP = 60; // between one shell and the next
export const SHELL_WALL = 10; // how far the shell shows outside the head, drawn
export const LUG_AT = 4; // lugs sit this far outside the rim's edge
export const LUG_R = 7;
export const THICK_SCALE = 40; // the side view draws the head this many times too thick, so it can be seen
export const LISTENER_GAP = 90; // from the last shell to the listener

/** `pin` ({ i, x }) holds drum i's centre at x, whatever the others do: used while a hand makes a drum wider. */
export function layout(bench, selected = 0, pin = null) {
  const n = bench.drums.length;
  const sel = Math.min(Math.max(selected, 0), Math.max(0, n - 1));
  const radii = bench.drums.map((d) => d.headDiameterMm / 2);
  const total = radii.reduce((sum, r) => sum + 2 * (r + SHELL_WALL), 0) + GAP * Math.max(0, n - 1);
  let x = -total / 2;
  const drums = bench.drums.map((d, i) => {
    const R = radii[i];
    x += R + SHELL_WALL;
    const entry = { i, x, y: 0, R, D: d.headDiameterMm, lugs: lugCount(d.headDiameterMm) };
    x += R + SHELL_WALL + GAP;
    return entry;
  });
  const shift = pin && drums[pin.i] ? pin.x - drums[pin.i].x : 0;
  for (const entry of drums) entry.x += shift;
  const maxR = Math.max(60, ...radii) + SHELL_WALL;
  const d = bench.drums[sel];
  const side = { y: maxR + 135, D: d.headDiameterMm, depth: d.shellDepthMm, thick: (d.headThicknessUm / 1000) * THICK_SCALE, closed: d.shellClosed, bottom: bench.bottomState(sel), bottomThick: ((d.bottomThicknessUm ?? d.headThicknessUm) / 1000) * THICK_SCALE, i: sel };
  const listener = { x: total / 2 + shift + LISTENER_GAP, y: 0 };
  const extent = {
    x0: Math.min(-total / 2 + shift, -side.D / 2) - 70,
    x1: Math.max(listener.x, side.D / 2) + 90,
    y0: -maxR - 90,
    y1: side.y + side.depth + 110,
  };
  return { n, drums, maxR, total, shift, side, listener, extent, selected: sel };
}

/** The drum whose head is under a point on the top view, how far from its centre (0 to 1 of the radius) and the angle round it, or null. */
export function drumAt(lay, x, y, reach = 0) {
  for (const b of lay.drums) {
    const dx = x - b.x;
    const dy = y - b.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= b.R + reach) return { i: b.i, r: dist / b.R, angle: ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360 };
  }
  return null;
}

/** Where a new drum dropped at x would go in the row (0 to n). */
export function slotAt(lay, x) {
  let slot = 0;
  for (const b of lay.drums) if (x > b.x) slot = b.i + 1;
  return slot;
}

/** Is the point on the row, or near enough that a drum dropped there joins it? */
export function onRow(lay, x, y) {
  return Math.abs(x - lay.shift) <= lay.total / 2 + 80 && Math.abs(y) <= lay.maxR + 70;
}

/** Where a strike lands, as the engine takes it: the fraction of the radius (kept off the very rim) and the angle in degrees. */
export const strikePlace = (hit) => ({ at: Math.min(0.95, hit.r), angle: Math.round(hit.angle) % 360 });
