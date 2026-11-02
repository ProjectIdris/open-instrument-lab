// SPDX-License-Identifier: GPL-3.0-only
// Gets the drums' notes ready to hear. A note here is one drum as it is built right now, struck at a place by a
// stick, so what is kept is keyed by that drum's make, and a change to one drum leaves the others' notes alone.
// The caching, the queue and the neighbouring-note stand-in are the strings bench's (../sound.js).
import { BenchSound, layerFor } from '../sound.js';

const RADIUS_STEP = 0.05; // strike places are kept to every 5% of the radius...
const ANGLE_STEP = 30; // ...and every 30 degrees round, the same on either side of the line to the listener
const REST_RADIUS = 0.5;

/** The angle as the sound has it: the mirror image of a strike sounds the same, so only 0 to 180 is kept. */
export function angleKey(angle) {
  const a = ((angle % 360) + 360) % 360;
  return Math.round(Math.min(a, 360 - a) / ANGLE_STEP) * ANGLE_STEP;
}

export class DrumsSound extends BenchSound {
  /** The values the engine needs to render drum i: the shared ones and the drum's own, struck at `at` of the radius and `angle` round. */
  params(i, at, angle, hardness) {
    const { bench } = this;
    const flat = { ...bench.params, ...bench.drums[i] };
    for (const def of bench.schema.params) if (def.affectsSound === false) delete flat[def.role ?? def.id];
    flat.strikeAt = Math.min(0.95, Math.max(0, at));
    flat.strikeAngle = angle;
    if (hardness !== undefined) flat.stickHardness = hardness;
    return bench.toEngineValues(flat);
  }

  /** Describe a blow on drum i so it can be looked up or made. `at` is the fraction of the radius from the centre. */
  strikeSpec(i, { at = this.bench.params.strikeAt ?? REST_RADIUS, angle = this.bench.params.strikeAngle ?? 0, velocity = 0.7, hardness } = {}) {
    const info = this.bench.info(i);
    const step = Math.round(at / RADIUS_STEP);
    const quantised = step * RADIUS_STEP;
    const turn = angleKey(angle);
    const params = this.params(i, quantised, turn, hardness);
    const { strikeAt, strikeAngle } = this.bench.maps.shared;
    const { [strikeAt]: place, [strikeAngle]: round, ...rest } = params;
    // `dist` stands for the place struck, so that a nearby note can stand in for a missing one: the radius counts most.
    return { params, config: JSON.stringify(rest), midi: info.note.midi, layer: layerFor(velocity), dist: step * 100 + turn / ANGLE_STEP, i, place, round };
  }
}
