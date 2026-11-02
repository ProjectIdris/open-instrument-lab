// SPDX-License-Identifier: GPL-3.0-only
// Engine schema helpers. An engine describes its controls as plain data and the
// UI, the server validation and the saved-instrument format are all derived
// from that description. See docs/engines.md.

export const PARAM_TYPES = ['number', 'choice', 'toggle'];
export const LAYERS = ['plain', 'advanced'];
// What a number is in the world, so the workbench can put it where a maker
// expects it: a length is dragged along the instrument, a tension is a peg, and
// so on. 'other' is for numbers that have no place on the object.
// A `role` is what the workbench does with a parameter or a part: the bench is drawn from the roles it finds
// (see docs/engines.md, "What the bench requires"), and an engine's own ids can be anything.
const ROLE = /^[a-z][A-Za-z0-9]*$/;
export const PHYSICAL = ['length', 'tension', 'material', 'diameter', 'thickness', 'depth', 'place', 'hardness', 'time', 'fraction', 'angle', 'other'];

/** Check an engine schema is well formed. Throws a descriptive Error. */
export function validateSchema(schema) {
  if (!schema || !Array.isArray(schema.params) || !Array.isArray(schema.groups)) throw new Error('schema needs groups[] and params[]');
  const groups = new Set();
  for (const g of schema.groups) {
    if (typeof g.id !== 'string' || typeof g.label !== 'string') throw new Error('group needs id and label');
    if (groups.has(g.id)) throw new Error(`duplicate group ${g.id}`);
    groups.add(g.id);
  }
  const parts = new Set();
  const partRoles = new Set();
  for (const part of schema.parts ?? []) {
    if (typeof part.id !== 'string' || typeof part.label !== 'string') throw new Error('part needs id and label');
    if (parts.has(part.id)) throw new Error(`duplicate part ${part.id}`);
    if (!Number.isInteger(part.min) || !Number.isInteger(part.max) || part.min < 1 || part.min > part.max) throw new Error(`part ${part.id}: min and max must be whole numbers, 1 or more, min not above max`);
    parts.add(part.id);
    if (part.role !== undefined) {
      if (typeof part.role !== 'string' || !ROLE.test(part.role)) throw new Error(`part ${part.id}: role must be a short camelCase word`);
      if (partRoles.has(part.role)) throw new Error(`part ${part.id}: another part already has the role ${part.role}`);
      partRoles.add(part.role);
    }
    if (part.standard !== undefined && !(Number.isInteger(part.standard) && part.standard >= part.min && part.standard <= part.max)) throw new Error(`part ${part.id}: standard must be a whole number from ${part.min} to ${part.max}`);
  }
  const roles = new Set();
  const ids = new Set();
  for (const p of schema.params) {
    const where = `param ${p?.id}`;
    if (p.part !== undefined && !parts.has(p.part)) throw new Error(`${where}: unknown part ${p.part}`);
    if (p.physical !== undefined && !PHYSICAL.includes(p.physical)) throw new Error(`${where}: physical must be one of ${PHYSICAL.join(', ')}`);
    if (p.role !== undefined) {
      if (typeof p.role !== 'string' || !ROLE.test(p.role)) throw new Error(`${where}: role must be a short camelCase word`);
      const scoped = `${p.part ?? ''}/${p.role}`;
      if (roles.has(scoped)) throw new Error(`${where}: another ${p.part ? `${p.part} ` : 'shared '}parameter already has the role ${p.role}`);
      roles.add(scoped);
    }
    if (p.affectsSound !== undefined && typeof p.affectsSound !== 'boolean') throw new Error(`${where}: affectsSound must be true or false`);
    if (typeof p.id !== 'string' || !/^[a-zA-Z][a-zA-Z0-9]*$/.test(p.id)) throw new Error(`${where}: id must be alphanumeric`);
    if (ids.has(p.id)) throw new Error(`duplicate param ${p.id}`);
    ids.add(p.id);
    if (!PARAM_TYPES.includes(p.type)) throw new Error(`${where}: unknown type ${p.type}`);
    if (!LAYERS.includes(p.layer)) throw new Error(`${where}: layer must be plain or advanced`);
    if (!groups.has(p.group)) throw new Error(`${where}: unknown group ${p.group}`);
    for (const key of ['label', 'help']) if (typeof p[key] !== 'string' || !p[key]) throw new Error(`${where}: ${key} is required`);
    if (p.type === 'number') {
      for (const key of ['min', 'max', 'default']) if (typeof p[key] !== 'number' || !Number.isFinite(p[key])) throw new Error(`${where}: ${key} must be a number`);
      if (!(p.min < p.max)) throw new Error(`${where}: min must be below max`);
      if (p.default < p.min || p.default > p.max) throw new Error(`${where}: default outside range`);
      if (p.scale !== undefined && !['linear', 'log'].includes(p.scale)) throw new Error(`${where}: scale must be linear or log`);
      if (p.scale === 'log' && p.min <= 0) throw new Error(`${where}: log scale needs min above zero`);
      if (p.integer && !Number.isInteger(p.default)) throw new Error(`${where}: integer default`);
    } else if (p.type === 'choice') {
      if (!Array.isArray(p.options) || !p.options.length) throw new Error(`${where}: options required`);
      if (p.options.some((o) => typeof o.value !== 'string' || typeof o.label !== 'string')) throw new Error(`${where}: option needs value and label`);
      if (!p.options.some((o) => o.value === p.default)) throw new Error(`${where}: default is not an option`);
    } else if (typeof p.default !== 'boolean') throw new Error(`${where}: toggle default must be boolean`);
  }
  for (const p of schema.params) {
    for (const [dep, allowed] of Object.entries(p.visibleWhen ?? {})) {
      const target = schema.params.find((q) => q.id === dep);
      if (!target) throw new Error(`param ${p.id}: visibleWhen refers to unknown ${dep}`);
      if (!Array.isArray(allowed)) throw new Error(`param ${p.id}: visibleWhen.${dep} must be a list`);
    }
  }
  return true;
}

/** Default value for every parameter. */
export function defaults(schema) {
  return Object.fromEntries(schema.params.map((p) => [p.id, p.default]));
}

/** True when a parameter applies to the current values (see `visibleWhen`). */
export function isVisible(param, values) {
  return Object.entries(param.visibleWhen ?? {}).every(([dep, allowed]) => allowed.includes(values[dep]));
}

/**
 * Fill defaults and check every value. Unknown keys and out-of-range values
 * are errors: a saved file from elsewhere must never be silently bent.
 */
export function normalizeParams(schema, input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('params must be an object');
  const known = new Set(schema.params.map((p) => p.id));
  for (const key of Object.keys(input)) if (!known.has(key)) throw new Error(`unknown parameter ${key}`);
  const out = {};
  for (const p of schema.params) {
    const value = input[p.id] ?? p.default;
    if (p.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${p.id} must be a number`);
      if (value < p.min || value > p.max) throw new Error(`${p.id} must be between ${p.min} and ${p.max}`);
      if (p.integer && !Number.isInteger(value)) throw new Error(`${p.id} must be a whole number`);
    } else if (p.type === 'choice') {
      if (!p.options.some((o) => o.value === value)) throw new Error(`${p.id} must be one of ${p.options.map((o) => o.value).join(', ')}`);
    } else if (typeof value !== 'boolean') throw new Error(`${p.id} must be true or false`);
    out[p.id] = value;
  }
  return out;
}

/** Check a note request against the engine's limits. */
export function normalizeNote(note = {}, limits = {}) {
  const { midi, velocity = 0.7, durationS = 1.6 } = note;
  const { minDurationS = 0.2, maxDurationS = 8 } = limits;
  if (!Number.isInteger(midi) || midi < 0 || midi > 127) throw new Error('note.midi must be a whole number from 0 to 127');
  if (typeof velocity !== 'number' || !(velocity >= 0.05 && velocity <= 1)) throw new Error('note.velocity must be from 0.05 to 1');
  if (typeof durationS !== 'number' || !(durationS >= minDurationS && durationS <= maxDurationS)) throw new Error(`note.durationS must be from ${minDurationS} to ${maxDurationS}`);
  return { midi, velocity, durationS };
}

/** The shared parameters (not belonging to a part) and the ids each part owns. */
export function partIds(schema, partId) {
  return schema.params.filter((p) => p.part === partId).map((p) => p.id);
}

/**
 * Check an instrument made of parts: shared `params` plus, for each part in the
 * schema, a list of instances (`parts[partId]`, for example one per string).
 * Returns { params, parts } with defaults filled in. Plain engines have no parts.
 */
export function normalizeInstrument(schema, input = {}) {
  const shared = schema.params.filter((p) => p.part === undefined);
  const sharedIds = new Set(shared.map((p) => p.id));
  const given = input.params ?? {};
  for (const key of Object.keys(given)) if (!sharedIds.has(key)) throw new Error(`unknown parameter ${key}`);
  const base = normalizeParams({ ...schema, params: shared }, given);
  const parts = {};
  const known = new Set((schema.parts ?? []).map((p) => p.id));
  for (const key of Object.keys(input.parts ?? {})) if (!known.has(key)) throw new Error(`unknown part ${key}`);
  for (const part of schema.parts ?? []) {
    const list = input.parts?.[part.id] ?? [{}];
    if (!Array.isArray(list) || list.length < part.min || list.length > part.max) throw new Error(`${part.label} count must be from ${part.min} to ${part.max}`);
    const own = new Set(partIds(schema, part.id));
    parts[part.id] = list.map((instance) => {
      for (const key of Object.keys(instance ?? {})) if (!own.has(key)) throw new Error(`unknown ${part.label} parameter ${key}`);
      const values = normalizeParams({ ...schema, params: schema.params.filter((p) => p.part === part.id) }, instance);
      normalizeParams(schema, { ...base, ...values });
      return values;
    });
  }
  return { params: base, parts };
}
