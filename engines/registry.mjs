// SPDX-License-Identifier: GPL-3.0-only
// Finds and checks engine plug-ins.
//
// An engine is a folder that contains `engine.mjs`. Engines are looked for in
//   1. the `engines/` folder of this repository (the built-in ones),
//   2. a git-ignored `plugins/` folder next to it, and
//   3. every folder named in the STUDIO_ENGINE_DIRS environment variable
//      (separated like PATH: `;` on Windows, `:` elsewhere).
// A folder that fails to load or fails the checks is reported and skipped; it
// never stops the others from loading. See docs/engines.md for the contract.
import { readdir, stat } from 'node:fs/promises';
import { delimiter, join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { byId } from './materials.mjs';
import { validateSchema, defaults, normalizeParams, normalizeInstrument } from './schema.mjs';

export const API_VERSION = 1;
const here = dirname(fileURLToPath(import.meta.url));

export function searchDirs(env = process.env) {
  const extra = (env.STUDIO_ENGINE_DIRS ?? '').split(delimiter).filter(Boolean).map((d) => resolve(d));
  return [here, resolve(here, '..', 'plugins'), ...extra];
}

/** Throws if an engine module breaks the contract. */
export function checkEngine(mod) {
  const { meta, schema, gallery, render, describe } = mod;
  if (!meta || typeof meta.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(meta.id)) throw new Error('meta.id must be lowercase letters, digits and dashes');
  if (typeof meta.name !== 'string' || typeof meta.description !== 'string') throw new Error('meta.name and meta.description are required');
  if (meta.apiVersion !== undefined && meta.apiVersion !== API_VERSION) throw new Error(`engine wants plug-in API ${meta.apiVersion}, this build speaks ${API_VERSION}`);
  validateSchema(schema);
  checkBench(mod.bench, schema);
  if (typeof render !== 'function') throw new Error('render(params, note) is required');
  if (typeof describe !== 'function') throw new Error('describe(params) is required');
  if (!Array.isArray(gallery) || !gallery.length) throw new Error('gallery needs at least one instrument');
  const seen = new Set();
  for (const g of gallery) {
    if (typeof g.id !== 'string' || typeof g.name !== 'string' || typeof g.description !== 'string') throw new Error('gallery entries need id, name and description');
    if (seen.has(g.id)) throw new Error(`duplicate gallery id ${g.id}`);
    seen.add(g.id);
    try { normalizeInstrument(schema, g); } catch (error) { throw new Error(`gallery "${g.id}": ${error.message}`); }
  }
  const range = describe(defaults(schema));
  if (!Number.isInteger(range?.lowMidi) || !Number.isInteger(range?.highMidi) || range.lowMidi > range.highMidi) throw new Error('describe() must return { lowMidi, highMidi }');
}

// What each bench kind draws and plays: the roles it looks for, found by the `role` the schema gives a part or a
// parameter, never by id. An engine that asks for a bench must give every required role, of the right kind and on
// the right part, or it is refused with a message that names what is missing. docs/engines.md ("What the bench
// requires") lists them for a plug-in author; keep the two the same.
const MATERIAL = { type: 'choice', materials: true }; // a choice whose options are the materials list, or "custom"
export const BENCH_KINDS = {
  'plucked-strings': {
    parts: {
      string: { required: true, roles: { stringMaterial: MATERIAL, stringCustomDensity: 'number', stringCustomModulus: 'number', stringDiameterMm: 'number', stringWound: 'toggle', tensionN: 'number' } },
      fret: { required: false, roles: { fretNumber: { type: 'number', whole: true } } },
    },
    shared: {
      required: {
        scaleLengthMm: 'number', bridgeAtMm: 'number', bodyLengthMm: 'number', upperBoutMm: 'number', waistMm: 'number', lowerBoutMm: 'number',
        waistAt: 'number', bodyDepthMm: 'number', topThicknessMm: 'number', holeDiameterMm: 'number', holeAtMm: 'number',
        pluckDistanceMm: 'number', pickHardness: 'number', topWood: MATERIAL, backWood: MATERIAL, neckWood: MATERIAL,
      },
      optional: {
        topCustomDensity: 'number', topCustomModulus: 'number', backCustomDensity: 'number', backCustomModulus: 'number', stiffness: 'number',
        pickupFit: { type: 'choice', has: ['none', 'magnetic'] }, pickupAtMm: 'number',
      },
      together: [['pickupFit', 'pickupAtMm']],
    },
  },
  'struck-bars': {
    parts: {
      bar: {
        required: true,
        roles: {
          barMaterial: MATERIAL, barCustomDensity: 'number', barCustomModulus: 'number', barLengthMm: 'number', barThicknessMm: 'number',
          barUndercut: 'number', tubeFit: 'toggle', tubeLengthMm: 'number',
        },
      },
    },
    shared: {
      required: { strikeAt: 'number', malletHardness: 'number' },
      optional: { frameWood: { type: 'choice', materials: true } },
      together: [],
    },
  },
  'struck-membranes': {
    parts: {
      drum: {
        required: true,
        roles: {
          shellMaterial: MATERIAL, shellDepthMm: 'number', shellClosed: 'toggle',
          headMaterial: MATERIAL, headCustomDensity: 'number', headThicknessUm: 'number', headDiameterMm: 'number', headTension: 'number',
        },
        optional: { bottomHead: 'toggle', bottomTension: 'number', bottomThicknessUm: 'number' },
      },
    },
    shared: {
      required: { strikeAt: 'number', strikeAngle: 'number', stickHardness: 'number' },
      optional: {},
      together: [],
    },
  },
};

const kindOf = (spec) => (typeof spec === 'string' ? { type: spec } : spec);
const article = (type) => (type === 'toggle' ? 'a toggle' : `a ${type}`);

/** An engine that wants the workbench says which kind, and gives its parts and parameters the roles that kind draws. */
function checkBench(bench, schema) {
  if (bench === undefined) return;
  const kind = BENCH_KINDS[bench.kind];
  if (!kind) throw new Error(`bench.kind "${bench.kind}" is not one this build can draw (it draws: ${Object.keys(BENCH_KINDS).join(', ')})`);
  if (bench.strum !== undefined && typeof bench.strum !== 'boolean') throw new Error('bench.strum must be true or false');
  const parts = schema.parts ?? [];
  const partRoleOfId = Object.fromEntries(parts.filter((p) => p.role).map((p) => [p.id, p.role]));
  const knownParts = Object.keys(kind.parts);
  for (const part of parts) if (part.role && !knownParts.includes(part.role)) throw new Error(`part "${part.id}" has the role "${part.role}", which the ${bench.kind} bench does not know (it knows: ${knownParts.join(', ')})`);
  const missing = [];
  for (const [role, spec] of Object.entries(kind.parts)) if (spec.required && !parts.some((p) => p.role === role)) missing.push(`a part with the role "${role}"`);
  const sharedKnown = { ...kind.shared.required, ...kind.shared.optional };
  const partRoles = (spec) => ({ ...spec.roles, ...spec.optional });
  const names = new Set([...Object.keys(sharedKnown), ...Object.values(kind.parts).flatMap((p) => Object.keys(partRoles(p)))]);
  const unknown = [];
  const mistyped = [];
  const found = new Set();
  for (const p of schema.params) {
    if (!p.role) {
      if (names.has(p.id)) throw new Error(`parameter "${p.id}" has no role, but its id is the name of a role the bench uses; give it a role, or another id`);
      continue;
    }
    const owner = p.part === undefined ? undefined : partRoleOfId[p.part];
    const spec = (p.part === undefined ? sharedKnown : kind.parts[owner] && partRoles(kind.parts[owner]))?.[p.role];
    if (spec === undefined) { unknown.push(`${p.id} (role "${p.role}"${p.part === undefined ? '' : ` on part "${p.part}"`})`); continue; }
    found.add(`${owner ?? ''}/${p.role}`);
    const want = kindOf(spec);
    if (p.type !== want.type) { mistyped.push(`${p.id} is ${article(p.type)} but its role "${p.role}" is ${article(want.type)}`); continue; }
    if (want.materials) {
      const bad = p.options.map((o) => o.value).filter((v) => v !== 'custom' && !byId(v));
      if (bad.length) throw new Error(`${p.id} (role "${p.role}") offers ${bad.map((v) => `"${v}"`).join(', ')}, which ${bad.length > 1 ? 'are' : 'is'} not in the materials list (engines/materials.json). The bench knows a material only from that list, or "custom".`);
    }
    if (want.has && !want.has.every((v) => p.options.some((o) => o.value === v))) mistyped.push(`${p.id} (role "${p.role}") must offer the options ${want.has.map((v) => `"${v}"`).join(' and ')}`);
    if (want.whole && (p.integer !== true || !Number.isInteger(p.min) || !Number.isInteger(p.max) || p.min < 1)) mistyped.push(`${p.id} (role "${p.role}") must be a whole number from 1 up: say \`integer: true\`, with a whole \`min\` of 1 or more and a whole \`max\``);
    // A wire can only stand at a whole place, and the part must be able to have as many as it asks for at the least.
    if (want.whole && p.part !== undefined) {
      const owner = parts.find((q) => q.id === p.part);
      const places = Math.floor(p.max) - Math.ceil(p.min) + 1;
      if (owner && places < owner.min) mistyped.push(`${p.id} (role "${p.role}") has ${places} place${places === 1 ? '' : 's'} for a wire, but the part "${owner.id}" must have at least ${owner.min}`);
    }
  }
  for (const [role, spec] of Object.entries(kind.shared.required)) if (!found.has(`/${role}`)) missing.push(`${role} (${article(kindOf(spec).type)})`);
  for (const [partRole, spec] of Object.entries(kind.parts)) {
    if (!parts.some((p) => p.role === partRole)) continue;
    for (const [role, type] of Object.entries(spec.roles)) if (!found.has(`${partRole}/${role}`)) missing.push(`${role} (${article(kindOf(type).type)} on each ${partRole})`);
  }
  for (const group of kind.shared.together ?? []) {
    const have = group.filter((r) => found.has(`/${r}`));
    if (have.length && have.length < group.length) missing.push(`${group.filter((r) => !have.includes(r)).join(', ')} (it goes with ${have.join(', ')})`);
  }
  if (unknown.length) throw new Error(`these parameters have a role the ${bench.kind} bench does not know: ${unknown.join('; ')}. See "What the bench requires" in docs/engines.md.`);
  if (mistyped.length) throw new Error(`the ${bench.kind} bench finds these roles but not of the kind it needs: ${mistyped.join('; ')}.`);
  if (missing.length) throw new Error(`asks for the ${bench.kind} bench but this build draws it from roles it does not find: ${missing.join(', ')}. Give each parameter its \`role\`. See "What the bench requires" in docs/engines.md.`);
  for (const hand of bench.hands ?? []) {
    if (typeof hand.id !== 'string' || typeof hand.name !== 'string') throw new Error('bench.hands need id and name');
    for (const key of Object.keys(hand.params ?? {})) if (!(key in sharedKnown)) throw new Error(`bench.hands: "${key}" is not a shared role of the ${bench.kind} bench`);
  }
}

/**
 * Load every engine. Returns { engines: Map(id -> module + path), problems: [{ path, message }] }.
 */
export async function loadEngines({ env = process.env } = {}) {
  const engines = new Map();
  const problems = [];
  for (const dir of searchDirs(env)) {
    let names;
    try { names = await readdir(dir); } catch { continue; }
    for (const name of names.sort()) {
      const folder = join(dir, name);
      const file = join(folder, 'engine.mjs');
      try { if (!(await stat(file)).isFile()) continue; } catch { continue; }
      try {
        const mod = await import(pathToFileURL(file).href);
        checkEngine(mod);
        if (engines.has(mod.meta.id)) throw new Error(`engine id "${mod.meta.id}" is already loaded from ${engines.get(mod.meta.id).path}`);
        engines.set(mod.meta.id, { ...mod, path: file });
      } catch (error) {
        problems.push({ path: file, message: error.message });
      }
    }
  }
  return { engines, problems };
}

/** The part of an engine the browser needs. */
export function publicDescription(engine) {
  return {
    id: engine.meta.id,
    name: engine.meta.name,
    description: engine.meta.description,
    schema: engine.schema,
    gallery: engine.gallery,
    limits: engine.limits ?? {},
    ...(engine.bench ? { bench: engine.bench } : {}),
  };
}
