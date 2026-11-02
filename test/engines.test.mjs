// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEngines, checkEngine } from '../engines/registry.mjs';
import { defaults, normalizeNote, normalizeParams } from '../engines/schema.mjs';
import { materials, resolveMaterial } from '../engines/materials.mjs';
import { measuredPitch } from './helpers.mjs';

const { engines, problems } = await loadEngines({ env: { STUDIO_ENGINE_DIRS: '' } });

test('the built-in engines load and pass the contract', () => {
  assert.deepEqual(problems, []);
  assert.ok(engines.has('guitar-bench'));
  assert.ok(engines.has('string-waveguide'));
  assert.ok(engines.has('modal-bar'));
});

test('every gallery instrument renders audible, finite sound at its reference note', () => {
  for (const engine of engines.values()) {
    for (const entry of engine.gallery) {
      const params = normalizeParams(engine.schema, entry.params);
      const { lowMidi, highMidi } = engine.describe(params);
      const midi = Math.round((lowMidi + highMidi) / 2);
      const { pcm, sampleRate } = engine.render(params, normalizeNote({ midi, velocity: 0.7, durationS: 1 }, engine.limits));
      assert.equal(pcm.length, sampleRate);
      let peak = 0;
      for (const v of pcm) { assert.ok(Number.isFinite(v), `${entry.id} has a non-finite sample`); peak = Math.max(peak, Math.abs(v)); }
      assert.ok(peak > 1e-6, `${engine.meta.id}/${entry.id} is silent`);
    }
  }
});

test('notes sound at the pitch that was asked for', () => {
  for (const [engineId, galleryId, midis] of [['string-waveguide', 'electric-clean', [43, 52, 64, 76]], ['string-waveguide', 'bass-fingers', [31, 40, 55]], ['modal-bar', 'maple-bar', [55, 67, 79]], ['modal-bar', 'steel-bar', [60, 84]]]) {
    const engine = engines.get(engineId);
    const params = normalizeParams(engine.schema, engine.gallery.find((g) => g.id === galleryId).params);
    for (const midi of midis) {
      const { pcm, sampleRate } = engine.render(params, normalizeNote({ midi, velocity: 0.7, durationS: 1.2 }, engine.limits));
      const expected = 440 * 2 ** ((midi - 69) / 12);
      const off = measuredPitch(pcm, sampleRate, expected);
      assert.ok(Math.abs(off) < 8, `${galleryId} midi ${midi}: ${off.toFixed(0)} cents from the target`);
    }
  }
});

test('every parameter can be pushed to both ends of its range without failing', () => {
  let unplayable = 0;
  for (const engine of engines.values()) {
    const base = defaults(engine.schema);
    for (const param of engine.schema.params) {
      const values = param.type === 'number' ? [param.min, param.max] : param.type === 'choice' ? param.options.map((o) => o.value) : [true, false];
      for (const value of values) {
        const params = normalizeParams(engine.schema, { ...base, [param.id]: value });
        let range;
        try { range = engine.describe(params); } catch (error) {
          // A string pushed to an extreme of length, tension or thickness may simply not sound; that is the engine saying so.
          if (error.unplayable) { unplayable++; continue; }
          throw error;
        }
        const { lowMidi, highMidi } = range;
        for (const midi of [lowMidi, Math.round((lowMidi + highMidi) / 2), highMidi]) {
          const { pcm } = engine.render(params, normalizeNote({ midi, velocity: 1, durationS: 0.4 }, engine.limits));
          for (const v of pcm) if (!Number.isFinite(v)) assert.fail(`${engine.meta.id}: ${param.id}=${value} at midi ${midi} gives a non-finite sample`);
        }
      }
    }
  }
  assert.ok(unplayable < 12, `${unplayable} extreme values were refused as unplayable`);
});

test('harder touch is louder and a longer ring time lasts longer', () => {
  const engine = engines.get('modal-bar');
  const params = normalizeParams(engine.schema, {});
  const energy = (p, velocity, from = 0, to = 1) => {
    const { pcm, sampleRate } = engine.render(p, normalizeNote({ midi: 72, velocity, durationS: 2 }, engine.limits));
    let sum = 0;
    for (let i = Math.floor(from * sampleRate); i < Math.min(pcm.length, Math.floor(to * sampleRate)); i++) sum += pcm[i] ** 2;
    return sum;
  };
  assert.ok(energy(params, 1) > energy(params, 0.3) * 4);
  assert.ok(energy({ ...params, ringTime: 6 }, 0.7, 1, 2) > energy({ ...params, ringTime: 0.3 }, 0.7, 1, 2) * 10);
});

test('the material library is complete and typed values reach the model', () => {
  for (const m of materials) {
    assert.ok(m.densityKgM3 > 100 && m.densityKgM3 < 25000, m.id);
    assert.ok(m.youngModulusPa > 1e8 && m.youngModulusPa < 6e11, m.id);
    assert.ok(m.source?.title && m.source?.locator && m.source?.publisher, `${m.id} needs a source`);
  }
  assert.deepEqual(resolveMaterial('custom', 1234, 56), { densityKgM3: 1234, youngModulusPa: 56e9 });
  const bar = engines.get('modal-bar');
  const base = normalizeParams(bar.schema, { material: 'custom', customDensity: 700, customModulus: 13 });
  const stiff = normalizeParams(bar.schema, { material: 'custom', customDensity: 700, customModulus: 130 });
  // For the same pitch the bar length goes as the fourth root of stiffness over density.
  const a = bar.render(base, normalizeNote({ midi: 72, durationS: 0.5 }, bar.limits));
  const b = bar.render(stiff, normalizeNote({ midi: 72, durationS: 0.5 }, bar.limits));
  assert.ok(Math.abs(b.lengthM / a.lengthM - 10 ** 0.25) < 0.005, `bar length ratio ${b.lengthM / a.lengthM}`);
  const strings = engines.get('string-waveguide');
  const steel = strings.render(normalizeParams(strings.schema, {}), normalizeNote({ midi: 55, durationS: 0.5 }, strings.limits));
  const nylon = strings.render(normalizeParams(strings.schema, { stringMaterial: 'custom', stringCustomDensity: 1140, stringCustomModulus: 3 }), normalizeNote({ midi: 55, durationS: 0.5 }, strings.limits));
  let different = 0;
  for (let i = 0; i < steel.pcm.length; i++) different += Math.abs(steel.pcm[i] - nylon.pcm[i]);
  assert.ok(different > 0, 'a different string material must change the sound');
});

test('a plug-in folder is picked up, a broken one is reported and does not stop the rest', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'studio-plugins-'));
  try {
    await mkdir(join(dir, 'good'));
    await writeFile(join(dir, 'good', 'engine.mjs'), `
      export const meta = { id: 'test-tone', name: 'Test tone', description: 'A sine wave.' };
      export const schema = { groups: [{ id: 'g', label: 'Tone' }], params: [{ id: 'detune', type: 'number', layer: 'plain', group: 'g', label: 'Detune', help: 'Cents sharp or flat.', min: -100, max: 100, default: 0 }] };
      export const gallery = [{ id: 'plain', name: 'Plain tone', description: 'A sine.', params: {} }];
      export const limits = {};
      export const describe = () => ({ lowMidi: 36, highMidi: 96 });
      export function render(params, note) {
        const sampleRate = 44100, pcm = new Float32Array(Math.round(note.durationS * sampleRate)), hz = 440 * 2 ** ((note.midi - 69 + params.detune / 100) / 12);
        for (let i = 0; i < pcm.length; i++) pcm[i] = 0.5 * Math.sin((2 * Math.PI * hz * i) / sampleRate) * Math.exp(-3 * i / sampleRate);
        return { pcm, sampleRate };
      }`);
    await mkdir(join(dir, 'bad'));
    await writeFile(join(dir, 'bad', 'engine.mjs'), 'export const meta = { id: "Bad Id", name: "x", description: "y" };');
    await mkdir(join(dir, 'throws'));
    await writeFile(join(dir, 'throws', 'engine.mjs'), 'throw new Error("boom");');
    const loaded = await loadEngines({ env: { STUDIO_ENGINE_DIRS: dir } });
    assert.ok(loaded.engines.has('test-tone'), 'the good plug-in loads');
    assert.ok(loaded.engines.has('modal-bar'), 'built-in engines still load');
    assert.equal(loaded.problems.length, 2);
    assert.ok(loaded.problems.some((p) => /boom/.test(p.message)));
    assert.ok(loaded.problems.some((p) => /meta.id/.test(p.message)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('checkEngine rejects a gallery entry that breaks its own schema', () => {
  const modal = engines.get('modal-bar');
  const broken = { ...modal, gallery: [{ id: 'x', name: 'X', description: 'x', params: { ringTime: 9999 } }] };
  assert.throws(() => checkEngine(broken), /gallery "x"/);
});
