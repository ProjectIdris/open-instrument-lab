// SPDX-License-Identifier: GPL-3.0-only
// Where everything is on the bench, in millimetres. The origin is the middle of
// the body where the neck joins it; x runs along the instrument towards the
// tail and y across it. The numbers are the instrument's real measurements,
// so the drawing is to scale.
import { bodyOutline, fretPositionM } from '/shared/physics.mjs';

/** Frets drawn when an engine does not list its own. */
export const FRETS = 19;
const HEADSTOCK_MM = 190;
const NUT_SPACING = 7.4;
const BRIDGE_SPACING = 10.8;
const EDGE = 4.5;

export function layout(bench) {
  const p = bench.params;
  const n = bench.strings.length;
  const scale = p.scaleLengthMm;
  const bridgeX = p.bridgeAtMm;
  const nutX = bridgeX - scale;
  const spacing = (x) => NUT_SPACING + (BRIDGE_SPACING - NUT_SPACING) * ((x - nutX) / scale);
  const stringY = (i, x) => (i - (n - 1) / 2) * spacing(x);
  const halfWidth = (x) => ((n - 1) * spacing(x)) / 2 + EDGE;

  const outline = bodyOutline({ lengthM: p.bodyLengthMm / 1000, upperM: p.upperBoutMm / 1000, waistM: p.waistMm / 1000, lowerM: p.lowerBoutMm / 1000, waistAt: p.waistAt });
  const body = outline.points.map(([x, y]) => [x * 1000, y * 1000]);
  const anchors = outline.anchors.map(([x, y]) => [x * 1000, y * 1000]);
  const bodyHalf = Math.max(...body.map(([, y]) => Math.abs(y)));

  // Every place a wire could stand (fretX[k] is the wire for semitone k + 1), and the ones that have a wire.
  const slots = bench.hasFrets ? bench.fretDef.max : FRETS;
  const fretX = Array.from({ length: slots }, (_, k) => nutX + fretPositionM(scale / 1000, k + 1) * 1000);
  const fretNumbers = bench.hasFrets ? bench.fretNumbers : Array.from({ length: FRETS }, (_, k) => k + 1);
  const lastFret = Math.max(0, ...fretNumbers);
  const boardEnd = Math.min(nutX + fretPositionM(scale / 1000, Math.max(lastFret, 1)) * 1000 + 12, bridgeX - 40);
  const nutHalf = halfWidth(nutX);
  const headHalf = Math.max(30, nutHalf + 9);
  const headX = nutX - HEADSTOCK_MM;

  const upperCount = Math.ceil(n / 2);
  const pegs = bench.strings.map((_, i) => {
    const top = i < upperCount;
    const slot = top ? upperCount - 1 - i : n - 1 - i;
    const x = nutX - 42 - slot * 34;
    const y = (top ? -1 : 1) * (headHalf + 12);
    return { i, x, y, post: [x, (top ? -1 : 1) * (headHalf - 6)], top };
  });

  const side = { y: bodyHalf + 62, depth: p.bodyDepthMm, topThickness: p.topThicknessMm };
  const rulerY = -Math.max(bodyHalf, headHalf + 24) - 42;
  return {
    n, scale, bridgeX, nutX, stringY, halfWidth, spacing, body, anchors, bodyHalf,
    fretX, fretNumbers, boardEnd, nutHalf, headHalf, headX, pegs, side, rulerY,
    hole: { x: p.holeAtMm, r: p.holeDiameterMm / 2 },
    pickup: bench.pickup ? { x: bridgeX - Math.min(bench.pickup.atMm, scale - 5), atMm: bench.pickup.atMm } : null,
    bridgeHalf: ((n - 1) * BRIDGE_SPACING) / 2 + 16,
    extent: { x0: headX - 20, x1: Math.max(p.bodyLengthMm, bridgeX) + 24, y0: rulerY - 30, y1: side.y + side.depth + 32 },
  };
}

/** The string nearest a point, if the point is on the sounding length and within `reachMm` of it. */
export function stringAt(lay, x, y, reachMm) {
  if (x < lay.nutX - 2 || x > lay.bridgeX + 2) return null;
  let best = null;
  for (let i = 0; i < lay.n; i++) {
    const d = Math.abs(y - lay.stringY(i, x));
    if (d <= reachMm && (!best || d < best.d)) best = { i, d };
  }
  return best;
}

/** Where a new string would go for a drop at height y: a slot between strings, or a string to replace. */
export function slotAt(lay, x, y, replaceMm) {
  const near = stringAt(lay, x, y, replaceMm);
  if (near) return { replace: near.i };
  let slot = 0;
  for (let i = 0; i < lay.n; i++) if (y > lay.stringY(i, x)) slot = i + 1;
  return { insert: slot };
}

/** Is a point on the neck or fingerboard (where a string may be dropped)? */
export function onNeck(lay, x, y, marginMm = 14) {
  return x >= lay.nutX - 6 && x <= Math.max(lay.boardEnd, 0) + 20 && Math.abs(y) <= lay.halfWidth(Math.min(Math.max(x, lay.nutX), lay.bridgeX)) + marginMm;
}

/** Where a pickup would sit for a point on the strings, in mm from the bridge, or null if the point is not over them. */
export function pickupAtPoint(lay, bench, x, y, marginMm = 14) {
  const def = bench.pickupDef;
  if (!def || x < lay.nutX + 10 || x > lay.bridgeX - 4 || Math.abs(y) > lay.halfWidth(x) + marginMm) return null;
  return Math.min(def.max, Math.max(def.min, Math.round(lay.bridgeX - x)));
}

/** The semitone whose slot is nearest an x on the neck (its wire need not exist yet). */
export function fretSlotNear(lay, x) {
  let best = 1;
  lay.fretX.forEach((fx, k) => { if (Math.abs(fx - x) < Math.abs(lay.fretX[best - 1] - x)) best = k + 1; });
  return best;
}
