// SPDX-License-Identifier: GPL-3.0-only
// Gets the bench's notes ready to hear. A note here is one string of the
// instrument as it is built right now, so what is kept is keyed by that string's
// make and by the body, and a change to one string leaves the others' notes alone.
import { renderNote } from '../api.js';

export const LAYERS = [0.4, 0.7, 0.95];
export const layerFor = (velocity) => LAYERS.reduce((best, v) => (Math.abs(v - velocity) < Math.abs(best - velocity) ? v : best));

const PARALLEL = 4;
const KEEP = 360; // about 150 MB of decoded notes at most
const PLUCK_STEP_MM = 4;
const REST_PLUCK = 0.17; // where the keyboard "plucks": this fraction of the sounding length from the bridge

export class BenchSound {
  constructor({ context, bench, onProgress = () => {}, onError = () => {} }) {
    this.context = context;
    this.bench = bench;
    this.onProgress = onProgress;
    this.onError = onError;
    this.durationS = 2.4;
    this.configs = new Map(); // string+body make -> Map(note|layer|distance -> AudioBuffer)
    this.count = 0;
    this.inflight = new Map();
    this.queue = [];
    this.running = 0;
    this.generation = 0;
    this.progress = { total: 0, done: 0 };
  }

  /** The values the engine needs to render string i: the body, the string, and where it is plucked. */
  params(i, pluckDistanceMm, hardness) {
    const { bench } = this;
    const flat = { ...bench.params, ...bench.strings[i] };
    for (const def of bench.schema.params) if (def.affectsSound === false) delete flat[def.role ?? def.id];
    flat.pluckDistanceMm = clampPluck(pluckDistanceMm);
    if (hardness !== undefined) flat.pickHardness = hardness;
    return bench.toEngineValues(flat);
  }

  /** Describe a pluck of string i, fretted at `fret`, so it can be looked up or made. */
  pluckSpec(i, { distanceMm, fret = 0, velocity = 0.7, hardness }) {
    const info = this.bench.info(i);
    const sounding = info.lengthM * 1000 * 2 ** (-fret / 12);
    const dist = distanceMm ?? REST_PLUCK * sounding;
    const quantised = Math.round(dist / PLUCK_STEP_MM) * PLUCK_STEP_MM || PLUCK_STEP_MM;
    const params = this.params(i, quantised, hardness);
    const pluckId = this.bench.maps.shared.pluckDistanceMm;
    const { [pluckId]: dist2, ...rest } = params;
    return { params, config: JSON.stringify(rest), midi: info.openMidi + fret, layer: layerFor(velocity), dist: dist2, i };
  }

  #slot(spec) { return `${spec.midi}|${spec.layer}|${spec.dist}`; }

  get(spec) {
    return this.configs.get(spec.config)?.get(this.#slot(spec));
  }

  /** The closest note already made for the same string and body: another pluck place or touch layer. */
  nearby(spec) {
    const group = this.configs.get(spec.config);
    if (!group) return null;
    let best = null;
    for (const [slot, buffer] of group) {
      const [midi, layer, dist] = slot.split('|').map(Number);
      if (midi !== spec.midi) continue;
      const score = Math.abs(dist - spec.dist) / 40 + Math.abs(layer - spec.layer) * 2;
      if (!best || score < best.score) best = { score, buffer, layer };
    }
    return best;
  }

  request(spec, priority = 0) {
    const ready = this.get(spec);
    if (ready) return Promise.resolve(ready);
    const key = spec.config + this.#slot(spec);
    const existing = this.inflight.get(key);
    if (existing && priority >= existing.priority) return existing.promise;
    existing?.controller.abort();
    const controller = new AbortController();
    const job = { controller, priority };
    job.promise = renderNote({ engine: this.bench.engine.id, params: spec.params, note: { midi: spec.midi, velocity: spec.layer, durationS: this.durationS }, priority, signal: controller.signal })
      .then(async ({ data }) => {
        const buffer = await this.context.decodeAudioData(data);
        this.#store(spec, buffer);
        return buffer;
      })
      .finally(() => { if (this.inflight.get(key) === job) this.inflight.delete(key); });
    this.inflight.set(key, job);
    return job.promise;
  }

  #store(spec, buffer) {
    let group = this.configs.get(spec.config);
    if (!group) { group = new Map(); this.configs.set(spec.config, group); }
    const slot = this.#slot(spec);
    if (!group.has(slot)) this.count++;
    group.set(slot, buffer);
    while (this.count > KEEP) {
      const oldest = this.configs.keys().next().value;
      this.count -= this.configs.get(oldest).size;
      this.configs.delete(oldest);
    }
  }

  /** Quietly make these notes (in order), dropping anything still waiting from before. */
  prefetch(specs) {
    this.generation++;
    this.queue = [];
    const wanted = specs.filter((s) => !this.get(s));
    this.progress = { total: specs.length, done: specs.length - wanted.length };
    this.onProgress({ ...this.progress });
    const generation = this.generation;
    for (const spec of wanted) this.queue.push({ spec, generation });
    this.#pump();
  }

  #pump() {
    while (this.running < PARALLEL && this.queue.length) {
      const job = this.queue.shift();
      if (job.generation !== this.generation) continue;
      this.running++;
      this.request(job.spec, 1)
        .then(() => { if (job.generation === this.generation) { this.progress.done++; this.onProgress({ ...this.progress }); } })
        .catch((error) => { if (error.name !== 'AbortError' && job.generation === this.generation) this.onError(error); })
        .finally(() => { this.running--; this.#pump(); });
    }
  }
}

function clampPluck(mm) {
  return Math.min(600, Math.max(5, Math.round(mm)));
}
