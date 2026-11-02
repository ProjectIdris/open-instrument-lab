// SPDX-License-Identifier: GPL-3.0-only
// Byte-capped least-recently-used cache.
export class ByteCache {
  constructor(maxBytes) {
    this.maxBytes = maxBytes;
    this.bytes = 0;
    this.map = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) { this.misses++; return undefined; }
    this.hits++;
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key, value, size) {
    if (size > this.maxBytes) return;
    const old = this.map.get(key);
    if (old) { this.bytes -= old.size; this.map.delete(key); }
    this.map.set(key, { value, size });
    this.bytes += size;
    while (this.bytes > this.maxBytes) {
      const [oldest, entry] = this.map.entries().next().value;
      this.map.delete(oldest);
      this.bytes -= entry.size;
    }
  }

  clear() { this.map.clear(); this.bytes = 0; }

  get stats() { return { entries: this.map.size, bytes: this.bytes, hits: this.hits, misses: this.misses }; }
}
