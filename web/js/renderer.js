// SPDX-License-Identifier: GPL-3.0-only
// Gets notes ready to play: asks the server, keeps what comes back, and
// prepares the whole keyboard in the background after every change so the
// next key press is instant.
import { renderNote } from './api.js';

export const VELOCITY_LAYERS = [0.4, 0.7, 0.95];

/** The closest rendered touch layer for a velocity from 0 to 1. */
export function layerFor(velocity) {
  return VELOCITY_LAYERS.reduce((best, v) => (Math.abs(v - velocity) < Math.abs(best - velocity) ? v : best));
}

const BACKGROUND_PARALLEL = 4;
const KEEP_BUFFERS = 600;

export class Renderer {
  constructor({ context, onProgress = () => {}, onError = () => {} }) {
    this.context = context;
    this.onProgress = onProgress;
    this.onError = onError;
    this.instrument = null;
    this.buffers = new Map();
    this.inflight = new Map();
    this.backgroundQueue = [];
    this.backgroundRunning = 0;
    this.generation = 0;
    this.progress = { total: 0, done: 0 };
  }

  /** Start using new instrument values; anything still being made for the old ones is dropped. */
  setInstrument({ engine, params, durationS }) {
    this.generation++;
    for (const job of this.inflight.values()) job.controller.abort();
    this.inflight.clear();
    this.backgroundQueue = [];
    this.backgroundRunning = 0;
    this.instrument = { engine, params, durationS, id: JSON.stringify([engine, params, durationS]) };
    this.progress = { total: 0, done: 0 };
    this.onProgress({ ...this.progress });
  }

  #key(midi, layer) {
    return `${this.instrument.id}|${midi}|${layer}`;
  }

  /** A ready AudioBuffer, or undefined. */
  get(midi, layer) {
    const key = this.#key(midi, layer);
    const buffer = this.buffers.get(key);
    if (buffer) { this.buffers.delete(key); this.buffers.set(key, buffer); }
    return buffer;
  }

  /** Make a note now (jumps the queue). Resolves to an AudioBuffer. */
  request(midi, layer, priority = 0) {
    const ready = this.get(midi, layer);
    if (ready) return Promise.resolve(ready);
    const key = this.#key(midi, layer);
    const existing = this.inflight.get(key);
    if (existing && (priority >= existing.priority)) return existing.promise;
    if (existing) existing.controller.abort();
    const controller = new AbortController();
    const generation = this.generation;
    const { engine, params, durationS } = this.instrument;
    const job = { controller, priority };
    job.promise = renderNote({ engine, params, note: { midi, velocity: layer, durationS }, priority, signal: controller.signal })
      .then(async ({ data }) => {
        const buffer = await this.context.decodeAudioData(data);
        if (generation !== this.generation) return buffer;
        this.buffers.set(key, buffer);
        while (this.buffers.size > KEEP_BUFFERS) this.buffers.delete(this.buffers.keys().next().value);
        return buffer;
      })
      .finally(() => { if (this.inflight.get(key) === job) this.inflight.delete(key); });
    this.inflight.set(key, job);
    return job.promise;
  }

  /** Quietly prepare these notes, nearest to the middle of the list first. */
  prefetch(midis, layer = 0.7) {
    const generation = this.generation;
    const order = midis.slice().sort((a, b) => Math.abs(a - midis[midis.length >> 1]) - Math.abs(b - midis[midis.length >> 1]));
    const wanted = order.filter((midi) => !this.get(midi, layer));
    this.progress = { total: midis.length, done: midis.length - wanted.length };
    this.onProgress({ ...this.progress });
    for (const midi of wanted) this.backgroundQueue.push({ midi, layer, generation });
    this.#pumpBackground();
  }

  #pumpBackground() {
    while (this.backgroundRunning < BACKGROUND_PARALLEL && this.backgroundQueue.length) {
      const job = this.backgroundQueue.shift();
      if (job.generation !== this.generation) continue;
      this.backgroundRunning++;
      this.request(job.midi, job.layer, 1)
        .then(() => {
          if (job.generation !== this.generation) return;
          this.progress.done++;
          this.onProgress({ ...this.progress });
        })
        .catch((error) => {
          if (error.name !== 'AbortError' && job.generation === this.generation) this.onError(error);
        })
        .finally(() => {
          if (job.generation === this.generation) this.backgroundRunning--;
          this.#pumpBackground();
        });
    }
  }
}
