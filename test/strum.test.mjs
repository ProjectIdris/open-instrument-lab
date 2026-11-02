// SPDX-License-Identifier: GPL-3.0-only
// Strumming with the mouse: which strings a sweep crosses, in what order, how hard, and when each sounds.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { loadEngines, publicDescription, checkEngine } from '../engines/registry.mjs';

register('./shared-loader.mjs', import.meta.url);
const { Bench } = await import('../web/js/bench/model.js');
const { layout } = await import('../web/js/bench/geometry.js');
const { strumCrossings, strokeSpeed, strumVelocity, strumWhen, StrumLine, strumTrim } = await import('../web/js/bench/strum.js');

const { engines } = await loadEngines({ env: { STUDIO_ENGINE_DIRS: '' } });
const guitar = engines.get('guitar-bench');
const description = publicDescription(guitar);
const materials = JSON.parse(readFileSync(new URL('../engines/materials.json', import.meta.url), 'utf8')).materials;

function steelGuitar() {
  const bench = new Bench(description, materials);
  const entry = description.gallery[0];
  bench.load({ name: entry.name, params: entry.params, parts: entry.parts });
  return bench;
}

test('a sweep across the neck crosses every string once, in the order the hand reaches them', () => {
  const lay = layout(steelGuitar());
  const x = lay.nutX + (lay.bridgeX - lay.nutX) * 0.6;
  const down = strumCrossings(lay, { x, y: -40 }, { x, y: 40 });
  assert.deepEqual(down.map((c) => c.i), [0, 1, 2, 3, 4, 5]);
  assert.ok(down.every((c) => c.dir === 1 && Math.abs(c.x - x) < 1e-9));
  assert.ok(down.every((c, k) => k === 0 || c.t > down[k - 1].t));
  const up = strumCrossings(lay, { x, y: 40 }, { x, y: -40 });
  assert.deepEqual(up.map((c) => c.i), [5, 4, 3, 2, 1, 0]);
  assert.ok(up.every((c) => c.dir === -1));
});

test('where the hand crosses a slanted stroke is where that string is plucked', () => {
  const lay = layout(steelGuitar());
  const a = { x: lay.nutX + 100, y: -30 };
  const b = { x: lay.nutX + 300, y: 30 };
  const hits = strumCrossings(lay, a, b);
  assert.equal(hits.length, 6);
  for (const c of hits) {
    const y = a.y + c.t * (b.y - a.y);
    assert.ok(Math.abs(y - lay.stringY(c.i, c.x)) < 1e-9, 'the crossing is on the string');
  }
  assert.ok(hits[5].x > hits[0].x, 'a stroke that runs towards the bridge plucks the later strings nearer it');
});

test('a stroke that stays on one side, or crosses behind the bridge or in front of the nut, sounds nothing', () => {
  const lay = layout(steelGuitar());
  const x = lay.nutX + 200;
  assert.deepEqual(strumCrossings(lay, { x, y: 30 }, { x: x + 50, y: 26 }), [], 'past the last string');
  assert.deepEqual(strumCrossings(lay, { x: lay.bridgeX + 30, y: -40 }, { x: lay.bridgeX + 30, y: 40 }), [], 'behind the bridge');
  assert.deepEqual(strumCrossings(lay, { x: lay.nutX - 30, y: -40 }, { x: lay.nutX - 30, y: 40 }), [], 'on the headstock');
  assert.deepEqual(strumCrossings(lay, { x, y: -4 }, { x, y: 4 }).length, 0, 'between the middle strings');
});

test('a string is not sounded twice when the stroke is cut into pieces that meet on it', () => {
  const lay = layout(steelGuitar());
  const x = lay.nutX + 200;
  const y = lay.stringY(2, x);
  const first = strumCrossings(lay, { x, y: y - 3 }, { x, y });
  const second = strumCrossings(lay, { x, y }, { x, y: y + 3 });
  assert.equal(first.length + second.length, 1);
});

test('a hand that turns round on a string sounds it again, once each way', () => {
  const lay = layout(steelGuitar());
  const x = lay.nutX + 200;
  const y = lay.stringY(1, x);
  const there = strumCrossings(lay, { x, y: y - 2 }, { x, y: y + 2 });
  const back = strumCrossings(lay, { x, y: y + 2 }, { x, y: y - 2 });
  assert.deepEqual([there.length, back.length, there[0].dir, back[0].dir], [1, 1, 1, -1]);
});

test('a faster sweep is louder', () => {
  const slow = [{ t: 0, x: 0, y: 0 }, { t: 100, x: 0, y: 40 }]; // 400 px/s
  const fast = [{ t: 0, x: 0, y: 0 }, { t: 20, x: 0, y: 40 }]; // 2000 px/s
  const vs = strumVelocity(strokeSpeed(slow, 50));
  const vf = strumVelocity(strokeSpeed(fast, 10));
  assert.ok(vf > vs + 0.3, `${vf} against ${vs}`);
  assert.equal(strumVelocity(0), 0.25);
  assert.equal(strumVelocity(1e6), 1);
  // The speed is that of the last stretch of the stroke, not of the whole of a long drag.
  const trail = [{ t: 0, x: 0, y: 0 }, { t: 600, x: 0, y: 30 }, { t: 620, x: 0, y: 70 }];
  assert.ok(strokeSpeed(trail, 615) > 1500);
});

test('the strings of a strum sound at the hand\'s own spacing, even when the page was late with them', () => {
  const clock = { offset: -999, last: null };
  const now = 10.2;
  // Three crossings 20 ms apart whose events all arrived at once, long after they happened.
  const whens = [1000, 1020, 1040].map((t) => strumWhen(clock, t, now));
  assert.ok(whens[0] >= now + 0.002);
  assert.ok(Math.abs(whens[1] - whens[0] - 0.02) < 1e-9 && Math.abs(whens[2] - whens[1] - 0.02) < 1e-9, whens.join(' '));
  // On time, they keep the hand's timing exactly.
  const fresh = { offset: 5, last: null };
  const on = [100, 130, 170].map((t) => strumWhen(fresh, t, 0));
  assert.deepEqual(on.map((w) => Math.round((w - on[0]) * 1000)), [0, 30, 70]);
});

test('strumming is on for any plucked-string bench unless the engine turns it off, and must be a plain yes or no', () => {
  assert.doesNotThrow(() => checkEngine({ ...guitar, bench: { ...guitar.bench, strum: false } }));
  assert.doesNotThrow(() => checkEngine({ ...guitar, bench: { ...guitar.bench, strum: true } }));
  assert.throws(() => checkEngine({ ...guitar, bench: { ...guitar.bench, strum: 'sometimes' } }), /bench.strum/);
});

// ---- strings whose sounds are not ready: the order and the spacing of the stroke must survive

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

function strumOf(count, gapMs, { nowS = 5, offset = -995 } = {}) {
  const played = [];
  const clock = { offset, last: null };
  const line = new StrumLine(clock, { now: () => nowS, play: (voice, sound, when) => played.push({ voice, sound, when }) });
  const waits = Array.from({ length: count }, deferred);
  const done = waits.map((w, k) => line.add({ tMs: 1000 + k * gapMs, voice: 200 + k, fetch: () => w.promise }));
  return { played, waits, line, done, finished: () => line.tail };
}

test("sounds that are made in the opposite order still play in the order the hand crossed, at the hand's own gaps", async () => {
  const s = strumOf(6, 50);
  // The last string's sound is ready first, the first string's last.
  for (let k = 5; k >= 0; k--) { s.waits[k].resolve({ id: k }); await new Promise((r) => setImmediate(r)); }
  await s.finished();
  assert.deepEqual(s.played.map((p) => p.voice), [200, 201, 202, 203, 204, 205]);
  assert.deepEqual(s.played.map((p) => p.sound.id), [0, 1, 2, 3, 4, 5]);
  const gaps = s.played.slice(1).map((p, k) => Math.round((p.when - s.played[k].when) * 1000));
  assert.deepEqual(gaps, [50, 50, 50, 50, 50]);
  assert.ok(s.played[0].when >= 5.002, 'the first one waits for nothing but its own sound');
});

test('a string whose sound comes late holds the ones behind it, which then keep the gaps', async () => {
  const s = strumOf(4, 40);
  s.waits[1].resolve({ id: 1 }); s.waits[2].resolve({ id: 2 }); s.waits[3].resolve({ id: 3 });
  s.waits[0].resolve({ id: 0 });
  await s.finished();
  assert.deepEqual(s.played.map((p) => p.sound.id), [0, 1, 2, 3]);
  // and if the first is very late, the rest are not played before it
  const late = strumOf(3, 40);
  late.waits[1].resolve({ id: 1 }); late.waits[2].resolve({ id: 2 });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(late.played.length, 0, 'nothing sounds ahead of the string the hand reached first');
  late.waits[0].resolve({ id: 0 });
  await late.finished();
  assert.deepEqual(late.played.map((p) => p.sound.id), [0, 1, 2]);
});

test('a string that cannot sound is left out and the rest of the strum goes on in order', async () => {
  const s = strumOf(5, 30);
  s.waits[0].resolve({ id: 0 });
  s.waits[1].resolve(null);
  s.waits[2].promise.catch(() => {});
  s.waits[2].resolve(null);
  s.waits[3].resolve({ id: 3 });
  s.waits[4].resolve({ id: 4 });
  await s.finished();
  assert.deepEqual(s.played.map((p) => p.sound.id), [0, 3, 4]);
  const gaps = s.played.slice(1).map((p, k) => Math.round((p.when - s.played[k].when) * 1000));
  assert.deepEqual(gaps, [90, 30], 'the gap across the missing strings is the hand gap');
});

test('sounds that are ready in time are played exactly when the hand reached each string', async () => {
  const s = strumOf(3, 25, { nowS: 0, offset: 10 });
  s.waits.forEach((w, k) => w.resolve({ id: k }));
  await s.finished();
  assert.deepEqual(s.played.map((p) => Math.round(p.when * 1000)), [11000, 11025, 11050]);
});

test('a strum turns each string down so that six together are about as loud as one', () => {
  assert.equal(strumTrim(1), 1);
  assert.ok(Math.abs(strumTrim(6) - 1 / Math.sqrt(6)) < 1e-12);
  assert.equal(strumTrim(0), 1);
});
