// SPDX-License-Identifier: GPL-3.0-only
// Gets the bars' notes ready to hear. A note here is one bar as it is built right now, struck at a place by a
// mallet, so what is kept is keyed by that bar's make, and a change to one bar leaves the others' notes alone.
// The caching, the queue and the neighbouring-note stand-in are the strings bench's (../sound.js).
import { BenchSound, layerFor } from '../sound.js';

const STRIKE_STEP = 0.02; // strike places are kept to every 2% of the bar's length
const REST_STRIKE = 0.38;

export class BarsSound extends BenchSound {
  /** The values the engine needs to render bar i: the shared ones and the bar's own, struck at `at` (a fraction of the bar's length from its end). */
  params(i, at, hardness) {
    const { bench } = this;
    const flat = { ...bench.params, ...bench.bars[i] };
    for (const def of bench.schema.params) if (def.affectsSound === false) delete flat[def.role ?? def.id];
    flat.strikeAt = Math.min(0.5, Math.max(0.03, at));
    if (hardness !== undefined) flat.malletHardness = hardness;
    return bench.toEngineValues(flat);
  }

  /** Describe a blow on bar i so it can be looked up or made. `at` is the fraction of the length from the nearer end. */
  strikeSpec(i, { at = this.bench.params.strikeAt ?? REST_STRIKE, velocity = 0.7, hardness } = {}) {
    const info = this.bench.info(i);
    const quantised = Math.round(at / STRIKE_STEP) * STRIKE_STEP;
    const params = this.params(i, quantised, hardness);
    const strikeId = this.bench.maps.shared.strikeAt;
    const { [strikeId]: place, ...rest } = params;
    // `dist` is the strike place in millimetres along the bar, so that a nearby note can stand in for a missing one.
    return { params, config: JSON.stringify(rest), midi: info.note.midi, layer: layerFor(velocity), dist: Math.round(place * this.bench.bars[i].barLengthMm), i };
  }

}
