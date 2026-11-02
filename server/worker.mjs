// SPDX-License-Identifier: GPL-3.0-only
// Render thread. Loads the engines once, then renders whatever it is sent.
import { parentPort } from 'node:worker_threads';
import { loadEngines } from '../engines/registry.mjs';
import { normalizeNote, normalizeParams } from '../engines/schema.mjs';
import { finish, gainFromPeak, peakOf, referenceNote } from './leveling.mjs';

const { engines } = await loadEngines();
const gains = new Map();
const GAIN_LIMIT = 64;
const CEILING = 0.98; // the loudest sample a note may have

function gainFor(engine, requested) {
  // An engine may say which values really change loudness (see docs/engines.md).
  const level = engine.levelling?.(requested);
  const params = level?.params ?? requested;
  const key = engine.meta.id + JSON.stringify(params);
  if (gains.has(key)) return gains.get(key);
  const note = { ...referenceNote(engine.describe(params)), ...level?.note };
  const { pcm } = engine.render(params, normalizeNote(note, engine.limits));
  const gain = gainFromPeak(peakOf(pcm));
  if (gains.size >= GAIN_LIMIT) gains.delete(gains.keys().next().value);
  gains.set(key, gain);
  return gain;
}

parentPort.on('message', async ({ id, engineId, params, note }) => {
  const started = performance.now();
  try {
    const engine = engines.get(engineId);
    if (!engine) throw new Error(`no engine called ${engineId}`);
    const p = normalizeParams(engine.schema, params);
    const n = normalizeNote(note, engine.limits);
    const gain = gainFor(engine, p);
    const result = await engine.render(p, n);
    // The level is set from one reference note, so a note much louder than that one must not be allowed to clip.
    const peak = peakOf(result.pcm);
    const applied = peak * gain > CEILING ? CEILING / peak : gain;
    const pcm = finish(result.pcm, applied, result.sampleRate);
    parentPort.postMessage({ id, pcm, sampleRate: result.sampleRate, gain: applied, ms: performance.now() - started }, [pcm.buffer]);
  } catch (error) {
    parentPort.postMessage({ id, error: String(error?.message ?? error) });
  }
});
parentPort.postMessage({ ready: true });
