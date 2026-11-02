// SPDX-License-Identifier: GPL-3.0-only
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { createApp } from '../server/app.mjs';
import { normalizeInstrument } from '../engines/schema.mjs';

let app;
let base;
before(async () => {
  app = await createApp({ poolSize: 2, cacheMb: 16 });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${app.server.address().port}`;
});
after(async () => { await app.close(); });

const post = (path, body, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });

test('the page and its scripts are served', async () => {
  const page = await fetch(base + '/');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal((await fetch(base + '/js/forms-main.js')).status, 200);
  assert.equal((await fetch(base + '/shared/schema.mjs')).status, 200);
});

test('files outside the web folder are never served', async () => {
  for (const path of ['/../package.json', '/..%2fpackage.json', '/%2e%2e/server/app.mjs', '/js/../../package.json', '/engines/schema.mjs', '/shared/../server/app.mjs']) {
    const response = await fetch(base + path);
    assert.ok([403, 404].includes(response.status), `${path} gave ${response.status}`);
  }
});

test('the engine list describes every control and instrument', async () => {
  const body = await (await fetch(base + '/api/engines')).json();
  assert.deepEqual(body.problems, []);
  assert.deepEqual(body.engines.map((e) => e.id), ['guitar-bench', 'bars-bench', 'drum-bench', 'string-waveguide', 'modal-bar']);
  for (const engine of body.engines) {
    assert.ok(engine.schema.params.length > 4);
    assert.ok(engine.gallery.length >= 3);
  }
});

test('a note comes back as a WAV file, and the second request is cached', async () => {
  const request = { engine: 'modal-bar', params: { ringTime: 0.5 }, note: { midi: 72, velocity: 0.7, durationS: 0.6 } };
  const first = await post('/api/render', request);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('content-type'), 'audio/wav');
  assert.equal(first.headers.get('x-cache'), 'miss');
  const wav = Buffer.from(await first.arrayBuffer());
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  assert.equal(wav.readUInt32LE(24), 44100);
  assert.equal(wav.readUInt32LE(40), Math.round(0.6 * 44100) * 2);
  let peak = 0;
  for (let i = 44; i < wav.length; i += 2) peak = Math.max(peak, Math.abs(wav.readInt16LE(i)));
  assert.ok(peak > 3000 && peak < 32768, `peak ${peak}`);
  const second = await post('/api/render', request);
  assert.equal(second.headers.get('x-cache'), 'hit');
  assert.deepEqual(Buffer.from(await second.arrayBuffer()), wav);
});

test('every instrument in the gallery is levelled to about the same loudness', async () => {
  const peaks = [];
  for (const engine of app.engines.values()) {
    for (const entry of engine.gallery) {
      // An engine made of parts is measured on its first string; its levelling says which values do not count.
      const instrument = normalizeInstrument(engine.schema, entry);
      const first = Object.fromEntries(Object.entries(instrument.parts).map(([id, list]) => [id, list[0]]));
      const flat = Object.assign({}, instrument.params, ...Object.values(first));
      const level = engine.levelling?.(flat);
      const params = level?.params ?? flat;
      const describe = await (await post('/api/describe', { engine: engine.meta.id, params })).json();
      const midi = level?.note?.midi ?? Math.round(describe.lowMidi + 0.35 * (describe.highMidi - describe.lowMidi));
      const response = await post('/api/render', { engine: engine.meta.id, params, note: { midi, velocity: 0.7, durationS: 1 } });
      assert.equal(response.status, 200, `${engine.meta.id}/${entry.id}`);
      const wav = Buffer.from(await response.arrayBuffer());
      let peak = 0;
      for (let i = 44; i < wav.length - 3000; i += 2) peak = Math.max(peak, Math.abs(wav.readInt16LE(i)) / 32768);
      peaks.push([engine.meta.id, entry.id, peak]);
    }
  }
  for (const [engine, id, peak] of peaks) assert.ok(Math.abs(peak - 0.3) < 0.02, `${engine}/${id} peaks at ${peak.toFixed(3)}`);
});

test('bad requests get a plain error, not a crash', async () => {
  const cases = [
    [{ engine: 'nope', params: {}, note: { midi: 60 } }, /no engine/],
    [{ engine: 'modal-bar', params: { ringTime: 999 }, note: { midi: 72 } }, /ringTime/],
    [{ engine: 'modal-bar', params: { ghost: 1 }, note: { midi: 72 } }, /unknown parameter/],
    [{ engine: 'modal-bar', params: {}, note: { midi: 5 } }, /plays notes/],
    [{ engine: 'modal-bar', params: {}, note: { midi: 72, durationS: 500 } }, /durationS/],
    [{ engine: 'modal-bar', params: {}, note: { midi: 72, velocity: 7 } }, /velocity/],
  ];
  for (const [body, pattern] of cases) {
    const response = await post('/api/render', body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.match((await response.json()).error, pattern);
  }
  assert.equal((await post('/api/render', '{not json')).status, 400);
  assert.equal((await post('/api/render', 'x'.repeat(70000))).status, 413);
  assert.equal((await fetch(base + '/api/render', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' })).status, 415);
  assert.equal((await fetch(base + '/api/render')).status, 404);
});

function rawRequest(path, { method = 'GET', headers = {}, body } = {}) {
  const { port } = app.server.address();
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, method, headers }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject);
    req.end(body);
  });
}

test('requests addressed to some other host or from some other site are refused', async () => {
  assert.equal(await rawRequest('/api/engines', { headers: { Host: 'evil.example' } }), 403);
  assert.equal(await rawRequest('/api/engines', { headers: { Host: `localhost:${app.server.address().port}` } }), 200);
  const body = JSON.stringify({ engine: 'modal-bar', params: {}, note: { midi: 72 } });
  const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), Origin: 'https://evil.example' };
  assert.equal(await rawRequest('/api/render', { method: 'POST', headers, body }), 403);
});

test('many notes at once are all made, and priority work is not starved', async () => {
  const notes = Array.from({ length: 24 }, (_, i) => post('/api/render', { engine: 'string-waveguide', params: { ringTime: 0.5 + i / 100 }, note: { midi: 52 + (i % 12), velocity: 0.7, durationS: 0.5 }, priority: 1 }));
  const interactive = post('/api/render', { engine: 'modal-bar', params: {}, note: { midi: 70, velocity: 0.7, durationS: 0.5 }, priority: 0 });
  const started = Date.now();
  const first = await interactive;
  assert.equal(first.status, 200);
  const interactiveMs = Date.now() - started;
  const all = await Promise.all(notes);
  assert.ok(all.every((r) => r.status === 200));
  assert.ok(interactiveMs < 2000, `interactive note took ${interactiveMs} ms behind a background queue`);
  assert.deepEqual((await (await fetch(base + '/api/status')).json()).pool.queued, 0);
});

test('a request that is abandoned before it starts is dropped', async () => {
  const pool = app.pool;
  const before = pool.stats;
  const jobs = Array.from({ length: 12 }, (_, i) => pool.submit({ key: `drop-${i}`, engineId: 'string-waveguide', params: { ...app.engines.get('string-waveguide').gallery[0].params, pickNoise: 0.001 * i }, note: { midi: 50 + i, velocity: 0.7, durationS: 1 }, priority: 1 }));
  jobs.slice(4).forEach((job) => job.cancel());
  const settled = await Promise.allSettled(jobs.map((j) => j.promise));
  assert.equal(settled.filter((s) => s.status === 'fulfilled').length, 4);
  assert.ok(settled.slice(4).every((s) => s.reason?.cancelled));
  assert.equal(before.queued, 0);
});
