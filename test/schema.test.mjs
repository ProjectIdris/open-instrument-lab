// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSchema, defaults, isVisible, normalizeParams, normalizeNote } from '../engines/schema.mjs';

const schema = {
  groups: [{ id: 'g', label: 'Group' }],
  params: [
    { id: 'kind', type: 'choice', layer: 'plain', group: 'g', label: 'Kind', help: 'Which kind.', options: [{ value: 'a', label: 'A' }, { value: 'custom', label: 'Custom' }], default: 'a' },
    { id: 'size', type: 'number', layer: 'plain', group: 'g', label: 'Size', help: 'How big.', min: 1, max: 10, default: 5, visibleWhen: { kind: ['custom'] } },
    { id: 'flag', type: 'toggle', layer: 'advanced', group: 'g', label: 'Flag', help: 'A switch.', default: false },
    { id: 'count', type: 'number', layer: 'advanced', group: 'g', label: 'Count', help: 'How many.', min: 1, max: 4, integer: true, default: 2 },
  ],
};

test('a well-formed schema validates and gives defaults', () => {
  assert.ok(validateSchema(schema));
  assert.deepEqual(defaults(schema), { kind: 'a', size: 5, flag: false, count: 2 });
});

test('schema mistakes are reported in plain words', () => {
  const broken = (change) => ({ ...schema, params: [{ ...schema.params[1], ...change }] });
  assert.throws(() => validateSchema(broken({ default: 99 })), /default outside range/);
  assert.throws(() => validateSchema(broken({ help: '' })), /help is required/);
  assert.throws(() => validateSchema(broken({ layer: 'secret' })), /layer must be/);
  assert.throws(() => validateSchema(broken({ group: 'nowhere' })), /unknown group/);
  assert.throws(() => validateSchema(broken({ scale: 'log', min: 0 })), /log scale/);
  assert.throws(() => validateSchema(broken({ visibleWhen: { ghost: ['x'] } })), /unknown ghost/);
  assert.throws(() => validateSchema({ ...schema, params: [schema.params[0], schema.params[0]] }), /duplicate param/);
});

test('visibleWhen follows the current values', () => {
  const size = schema.params[1];
  assert.equal(isVisible(size, { kind: 'a' }), false);
  assert.equal(isVisible(size, { kind: 'custom' }), true);
  assert.equal(isVisible(schema.params[0], {}), true);
});

test('normalizeParams fills defaults and refuses anything out of range', () => {
  assert.deepEqual(normalizeParams(schema, { size: 3 }), { kind: 'a', size: 3, flag: false, count: 2 });
  assert.throws(() => normalizeParams(schema, { size: 11 }), /between 1 and 10/);
  assert.throws(() => normalizeParams(schema, { kind: 'z' }), /must be one of/);
  assert.throws(() => normalizeParams(schema, { count: 1.5 }), /whole number/);
  assert.throws(() => normalizeParams(schema, { flag: 1 }), /true or false/);
  assert.throws(() => normalizeParams(schema, { nope: 1 }), /unknown parameter nope/);
  assert.throws(() => normalizeParams(schema, { size: NaN }), /must be a number/);
  assert.throws(() => normalizeParams(schema, null), /must be an object/);
});

test('normalizeNote bounds the request', () => {
  assert.deepEqual(normalizeNote({ midi: 60 }), { midi: 60, velocity: 0.7, durationS: 1.6 });
  assert.throws(() => normalizeNote({ midi: 60.5 }), /whole number/);
  assert.throws(() => normalizeNote({ midi: 60, velocity: 0 }), /velocity/);
  assert.throws(() => normalizeNote({ midi: 60, durationS: 99 }), /durationS/);
  assert.equal(normalizeNote({ midi: 60, durationS: 99 }, { maxDurationS: 120 }).durationS, 99);
});
