// SPDX-License-Identifier: GPL-3.0-only
// The HTTP application: static files, the engine list and note rendering.
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngines, publicDescription } from '../engines/registry.mjs';
import { normalizeNote, normalizeParams } from '../engines/schema.mjs';
import { encodeWav } from './wav.mjs';
import { ByteCache } from './cache.mjs';
import { RenderPool } from './pool.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const webRoot = join(root, 'web');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-cache',
};
const MAX_BODY = 64 * 1024;

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
}

function sendJson(res, status, value) {
  send(res, status, JSON.stringify(value), { 'Content-Type': MIME['.json'] });
}

function sendBodyError(res, error) {
  if (error.status === 413) return send(res, 413, JSON.stringify({ error: error.message }), { 'Content-Type': MIME['.json'], Connection: 'close' });
  return sendJson(res, 400, { error: 'body must be JSON' });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) { req.pause(); reject(Object.assign(new Error('request too large'), { status: 413 })); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** Reject requests whose Host or Origin is not this local server (DNS rebinding and cross-site posts). */
function hostIsLocal(req, port) {
  const host = req.headers.host ?? '';
  const allowed = new Set([`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]);
  if (!allowed.has(host)) return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return allowed.has(new URL(origin).host); } catch { return false; }
}

export async function createApp({ port, cacheMb = Number(process.env.STUDIO_CACHE_MB ?? 256), poolSize } = {}) {
  const { engines, problems } = await loadEngines();
  const pool = new RenderPool({ size: poolSize });
  await pool.start();
  const cache = new ByteCache(cacheMb * 1024 * 1024);
  const description = () => ({ engines: [...engines.values()].sort((a, b) => (a.meta.order ?? 100) - (b.meta.order ?? 100) || a.meta.name.localeCompare(b.meta.name)).map(publicDescription), problems: problems.map((p) => ({ message: p.message })) });

  async function render(req, res) {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch (error) {
      return sendBodyError(res, error);
    }
    const engine = engines.get(body?.engine);
    if (!engine) return sendJson(res, 400, { error: `no engine called ${JSON.stringify(body?.engine)}` });
    let params;
    let note;
    try {
      params = normalizeParams(engine.schema, body.params);
      note = normalizeNote(body.note, engine.limits);
      const range = engine.describe(params);
      if (note.midi < range.lowMidi || note.midi > range.highMidi) throw new Error(`this instrument plays notes ${range.lowMidi} to ${range.highMidi}`);
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
    const priority = body.priority === 1 ? 1 : 0;
    const key = createHash('sha1').update(JSON.stringify([engine.meta.id, params, note])).digest('hex');
    const cached = cache.get(key);
    if (cached) return send(res, 200, cached.wav, { 'Content-Type': 'audio/wav', 'X-Cache': 'hit', 'X-Render-Ms': '0', 'X-Gain': String(cached.gain) });
    let job;
    try {
      job = pool.submit({ key, engineId: engine.meta.id, params, note, priority });
    } catch (error) {
      return sendJson(res, 503, { error: error.message });
    }
    res.on('close', () => { if (!res.writableEnded) job.cancel(); });
    try {
      const done = await job.promise;
      const wav = encodeWav(done.pcm, done.sampleRate);
      cache.set(key, { wav, gain: done.gain }, wav.length);
      if (!res.writableEnded && !res.destroyed) send(res, 200, wav, { 'Content-Type': 'audio/wav', 'X-Cache': 'miss', 'X-Render-Ms': done.ms.toFixed(0), 'X-Gain': String(done.gain) });
    } catch (error) {
      if (error.cancelled) return;
      if (!res.destroyed) sendJson(res, 500, { error: error.message });
    }
  }

  async function describeRoute(req, res) {
    let body;
    try { body = JSON.parse(await readBody(req)); } catch (error) { return sendBodyError(res, error); }
    const engine = engines.get(body?.engine);
    if (!engine) return sendJson(res, 400, { error: `no engine called ${JSON.stringify(body?.engine)}` });
    try {
      return sendJson(res, 200, engine.describe(normalizeParams(engine.schema, body.params)));
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  async function staticFile(req, res, pathname) {
    const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
    let file;
    // Files the page shares with the engines, served from one place so they cannot drift apart.
    const shared = { 'shared/schema.mjs': 'schema.mjs', 'shared/physics.mjs': 'physics.mjs', 'shared/roles.mjs': 'roles.mjs', 'shared/materials.json': 'materials.json' }[rel];
    if (shared) {
      file = join(root, 'engines', shared);
    } else {
      file = normalize(join(webRoot, rel));
      if (file !== webRoot && !file.startsWith(webRoot + sep)) return sendJson(res, 403, { error: 'forbidden' });
    }
    const type = MIME[extname(file)];
    if (!type) return sendJson(res, 404, { error: 'not found' });
    try {
      send(res, 200, await readFile(file), { 'Content-Type': type });
    } catch {
      sendJson(res, 404, { error: 'not found' });
    }
  }

  const server = createServer(async (req, res) => {
    try {
      if (!hostIsLocal(req, port ?? server.address().port)) return sendJson(res, 403, { error: 'this server only answers on localhost' });
      const { pathname } = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && pathname === '/api/engines') return sendJson(res, 200, description());
      if (req.method === 'GET' && pathname === '/api/status') return sendJson(res, 200, { pool: pool.stats, cache: cache.stats });
      if (req.method === 'POST' && pathname === '/api/describe') {
        if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) return sendJson(res, 415, { error: 'send application/json' });
        return await describeRoute(req, res);
      }
      if (req.method === 'POST' && pathname === '/api/render') {
        if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) return sendJson(res, 415, { error: 'send application/json' });
        return await render(req, res);
      }
      if (req.method === 'GET' || req.method === 'HEAD') return await staticFile(req, res, pathname);
      return sendJson(res, 405, { error: 'method not allowed' });
    } catch (error) {
      if (!res.headersSent) sendJson(res, 500, { error: 'server error' });
      console.error(error);
    }
  });
  const close = async () => {
    await new Promise((resolve) => { server.close(resolve); server.closeAllConnections?.(); });
    await pool.close();
  };
  return { server, pool, cache, engines, problems, close };
}
