// SPDX-License-Identifier: GPL-3.0-only
// A small pool of render threads with a priority queue.
//
// Interactive requests (priority 0) jump ahead of background pre-rendering
// (priority 1). Asking for a note that is already queued or running joins that
// work instead of repeating it, and a request nobody is waiting for any more is
// dropped before it starts.
import { Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';

const WORKER_FILE = new URL('./worker.mjs', import.meta.url);

export class RenderPool {
  constructor({ size = Math.max(1, Math.min(4, availableParallelism() - 1)), maxQueue = 2000 } = {}) {
    this.size = size;
    this.maxQueue = maxQueue;
    this.workers = [];
    this.queue = [];
    this.jobs = new Map();
    this.nextId = 1;
    this.closed = false;
  }

  async start() {
    await Promise.all(Array.from({ length: this.size }, () => this.#spawn()));
  }

  #spawn() {
    return new Promise((resolve, reject) => {
      const worker = new Worker(WORKER_FILE);
      const slot = { worker, busy: null };
      this.workers.push(slot);
      worker.once('error', reject);
      worker.on('message', (message) => {
        if (message.ready) { resolve(); return; }
        const job = slot.busy;
        slot.busy = null;
        if (job) {
          this.jobs.delete(job.key);
          if (message.error) job.waiters.forEach((w) => w.reject(new Error(message.error)));
          else job.waiters.forEach((w) => w.resolve(message));
        }
        this.#pump();
      });
      worker.on('error', (error) => {
        const job = slot.busy;
        slot.busy = null;
        if (job) { this.jobs.delete(job.key); job.waiters.forEach((w) => w.reject(error)); }
      });
    });
  }

  /**
   * Render a note. `key` identifies identical work. Returns { promise, cancel }.
   * The promise rejects with { cancelled: true } if every waiter cancelled.
   */
  submit({ key, engineId, params, note, priority = 0 }) {
    if (this.closed) throw new Error('pool is closed');
    let job = this.jobs.get(key);
    if (!job) {
      if (this.queue.length >= this.maxQueue) throw new Error('too many renders queued');
      job = { key, engineId, params, note, priority, waiters: [], started: false };
      this.jobs.set(key, job);
      this.queue.push(job);
    } else if (priority < job.priority && !job.started) {
      job.priority = priority;
    }
    let waiter;
    const promise = new Promise((resolve, reject) => { waiter = { resolve, reject }; });
    job.waiters.push(waiter);
    this.#pump();
    const cancel = () => {
      const i = job.waiters.indexOf(waiter);
      if (i < 0) return;
      job.waiters.splice(i, 1);
      waiter.reject(Object.assign(new Error('cancelled'), { cancelled: true }));
      if (!job.waiters.length && !job.started) {
        this.queue = this.queue.filter((q) => q !== job);
        this.jobs.delete(job.key);
      }
    };
    return { promise, cancel };
  }

  #pump() {
    for (const slot of this.workers) {
      if (slot.busy || !this.queue.length) continue;
      let best = 0;
      for (let i = 1; i < this.queue.length; i++) if (this.queue[i].priority < this.queue[best].priority) best = i;
      const [job] = this.queue.splice(best, 1);
      job.started = true;
      slot.busy = job;
      slot.worker.postMessage({ id: this.nextId++, engineId: job.engineId, params: job.params, note: job.note });
    }
  }

  get stats() {
    return { workers: this.size, queued: this.queue.length, running: this.workers.filter((w) => w.busy).length };
  }

  async close() {
    this.closed = true;
    await Promise.all(this.workers.map((w) => w.worker.terminate()));
  }
}
