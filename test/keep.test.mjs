// SPDX-License-Identifier: GPL-3.0-only
// Keeping what you made: versions to flip between, and sounds saved as WAV files.
import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { encodeWav } from '../server/wav.mjs';
import { readWav16, scaleWav } from '../web/js/wav.js';
import { zipStore, crc32 } from '../web/js/zip.js';
import { Versions, MAX_VERSIONS } from '../web/js/bench/versions.js';

const capture = (name, extra = {}) => ({ doc: { name, engine: 'guitar-bench', params: { a: 1 }, parts: { string: [{ x: 1 }] }, volumeDb: 0, ...extra }, history: [`${name}-0`] });

// ---------------------------------------------------------------- versions

test('a duplicate leaves the original as version 1 and puts a copy on the bench as version 2', () => {
  const v = new Versions();
  assert.equal(v.count, 0);
  const copy = v.duplicate(capture('My guitar'));
  assert.equal(v.count, 2);
  assert.deepEqual(v.list.map((x) => x.number), [1, 2]);
  assert.equal(copy.doc.name, 'My guitar copy');
  assert.equal(v.active.number, 2);
  assert.equal(v.list[0].doc.name, 'My guitar', 'the original is kept as it was');
  assert.notEqual(copy.doc.params, v.list[0].doc.params, 'a copy, not the same object');
});

test('compare flips between the last two versions and keeps what was done to each', () => {
  const v = new Versions();
  v.duplicate(capture('Banjo'));
  // work on the copy, then compare: the copy's edits are kept and the original comes back
  const back = v.compare(capture('Banjo copy', { params: { a: 2 } }));
  assert.equal(back.doc.name, 'Banjo');
  assert.equal(back.doc.params.a, 1);
  assert.equal(v.active.number, 1);
  assert.equal(v.list[1].doc.params.a, 2, 'version 2 holds the edit made to it');
  const again = v.compare(capture('Banjo', { params: { a: 5 } }));
  assert.equal(again.doc.params.a, 2);
  assert.equal(v.list[0].doc.params.a, 5);
  assert.equal(v.active.number, 2);
});

test('undo history travels with its version', () => {
  const v = new Versions();
  v.duplicate({ doc: capture('X').doc, history: ['s0', 's1', 's2'] });
  const first = v.compare({ doc: capture('X copy').doc, history: ['c0', 'c1'] });
  assert.deepEqual(first.history, ['s0', 's1', 's2']);
  const second = v.compare({ doc: capture('X').doc, history: ['s0', 's1', 's2', 's3'] });
  assert.deepEqual(second.history, ['c0', 'c1']);
});

test('switching to a chosen version, removing one that is not on the bench, and the limit', () => {
  const v = new Versions();
  v.duplicate(capture('A'));
  v.duplicate(capture('A copy'));
  assert.equal(v.count, 3);
  const target = v.switchTo(v.list[0].id, capture('A copy copy'));
  assert.equal(target.doc.name, 'A');
  assert.equal(v.remove(v.active.id), false, 'the one on the bench stays');
  assert.equal(v.remove(v.list[1].id), true);
  assert.equal(v.count, 2);
  assert.equal(v.compare(capture('A')).doc.name, 'A copy copy', 'compare goes to the last one used that is still there');
});

test('a full shelf refuses a new copy and keeps every version, instead of dropping an unsaved one', () => {
  const crowded = new Versions();
  const made = [];
  for (let i = 0; i < MAX_VERSIONS - 1; i++) made.push(crowded.duplicate(capture(`Z${i}`, { params: { a: i } })));
  assert.equal(crowded.count, MAX_VERSIONS);
  const before = crowded.list.map((x) => `${x.number}:${x.doc.name}:${x.doc.params.a}`);
  const activeBefore = crowded.activeId;
  assert.equal(crowded.duplicate(capture('Z-last')), null, 'the ninth is refused');
  assert.deepEqual(crowded.list.map((x) => `${x.number}:${x.doc.name}:${x.doc.params.a}`), before, 'nothing was dropped or changed');
  assert.equal(crowded.activeId, activeBefore);
  assert.equal(crowded.remove(crowded.list[0].id), true);
  assert.ok(crowded.duplicate(capture('Z-last')), 'with one taken off there is room again');
});

test('opening another instrument keeps the edited version on the shelf, and A/B brings it back with its edits', () => {
  const v = new Versions();
  v.duplicate(capture('Original'));
  const edited = { doc: { ...capture('Original copy').doc, params: { a: 99 } }, history: ['edit-1', 'edit-2'] };
  const gallery = { name: 'Gallery guitar', params: { a: 5 }, parts: {} };
  const adopted = v.adopt(edited, gallery);
  assert.equal(adopted.doc.name, 'Gallery guitar');
  assert.equal(v.count, 3);
  assert.equal(v.active.id, adopted.id);
  // A/B from the gallery instrument (unchanged) returns to the edited copy, whole
  const back = v.compare({ doc: gallery, history: [] });
  assert.equal(back.doc.params.a, 99, 'the edit is still there');
  assert.deepEqual(back.history, ['edit-1', 'edit-2']);
  assert.deepEqual(v.list.map((x) => x.doc.name), ['Original', 'Original copy', 'Gallery guitar']);
  // with nothing on the shelf there is nothing to keep, and a full shelf refuses the new instrument
  assert.equal(new Versions().adopt(edited, gallery), null);
  const crowded = new Versions();
  for (let i = 0; i < MAX_VERSIONS - 1; i++) crowded.duplicate(capture(`Z${i}`));
  assert.equal(crowded.adopt(edited, gallery), null);
  assert.equal(crowded.count, MAX_VERSIONS);
});

test('with nothing to compare, compare does nothing; numbers are not reused after a removal', () => {
  const v = new Versions();
  assert.equal(v.compare(capture('Solo')), null);
  v.duplicate(capture('Solo'));
  v.switchTo(v.list[0].id, capture('Solo copy'));
  v.remove(v.list[1].id);
  assert.equal(v.compare(capture('Solo')), null, 'only one version is left');
  v.duplicate(capture('Solo'));
  assert.deepEqual(v.list.map((x) => x.number), [1, 3]);
});

// ---------------------------------------------------------------- WAV

const tone = (n, amp) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin(i * 0.05));

test('a WAV the server made is read back, and scaled without losing a step when the gain is 1', () => {
  const wav = new Uint8Array(encodeWav(tone(2000, 0.5), 44100));
  const read = readWav16(wav);
  assert.equal(read.sampleRate, 44100);
  assert.equal(read.samples.length, 2000);
  const same = scaleWav(wav, 1);
  assert.deepEqual(Array.from(same.bytes), Array.from(wav), 'unchanged at unity gain');
  assert.equal(same.limited, false);
});

test('volume is applied to the saved sound, and a sound that would clip is turned down instead', () => {
  const wav = new Uint8Array(encodeWav(tone(2000, 0.5), 48000));
  const half = readWav16(scaleWav(wav, 0.5).bytes).samples;
  const base = readWav16(wav).samples;
  const worst = base.reduce((m, v, i) => Math.max(m, Math.abs(half[i] - v * 0.5)), 0);
  assert.ok(worst < 2 / 32768, `half the volume: out by ${worst}`);
  const loud = scaleWav(wav, 4);
  assert.equal(loud.limited, true);
  const peak = readWav16(loud.bytes).samples.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  assert.ok(peak <= 0.99 + 1 / 32768 && peak > 0.97, `peak ${peak}`);
  assert.throws(() => readWav16(new Uint8Array(20)), /not a WAV/);
});

// ---------------------------------------------------------------- zip

function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--;
  assert.ok(end >= 0, 'end of central directory');
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const files = [];
  for (let i = 0; i < count; i++) {
    assert.equal(view.getUint32(at, true), 0x02014b50);
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 24, true);
    const nameLen = view.getUint16(at + 28, true);
    const extraLen = view.getUint16(at + 30, true);
    const commentLen = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLen));
    assert.equal(view.getUint32(local, true), 0x04034b50);
    const dataAt = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const raw = bytes.subarray(dataAt, dataAt + size);
    files.push({ name, method, crc, data: method === 8 ? new Uint8Array(inflateRawSync(raw)) : raw });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

test('a zip of WAV files can be read back, names and bytes and checksums intact', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const a = new Uint8Array(encodeWav(tone(500, 0.3), 48000));
  const b = new Uint8Array(encodeWav(tone(900, 0.2), 48000));
  const zip = zipStore([{ name: 'My guitar-C#3.wav', data: a }, { name: 'My guitar-D3.wav', data: b }]);
  const files = readZip(zip);
  assert.deepEqual(files.map((f) => f.name), ['My guitar-C#3.wav', 'My guitar-D3.wav']);
  assert.deepEqual(Array.from(files[0].data), Array.from(a));
  assert.deepEqual(Array.from(files[1].data), Array.from(b));
  assert.equal(files[0].crc, crc32(a));
  assert.equal(zipStore([]).length, 22, 'an empty zip is just its end record');
});
