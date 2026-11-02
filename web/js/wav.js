// SPDX-License-Identifier: GPL-3.0-only
// Reading and scaling the plain 16-bit mono WAV files the server makes, so a sound can be saved at the volume you hear it.

const text = (view, at, n) => String.fromCharCode(...Array.from({ length: n }, (_, i) => view.getUint8(at + i)));

/** The samples (-1..1) and sample rate of a 16-bit PCM WAV. Throws if it is anything else. */
export function readWav16(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const { dataAt, size, sampleRate } = locate(view);
  return { sampleRate, samples: Float32Array.from({ length: size / 2 }, (_, i) => view.getInt16(dataAt + i * 2, true) / 32768) };
}

function locate(view) {
  if (view.byteLength < 44 || text(view, 0, 4) !== 'RIFF' || text(view, 8, 4) !== 'WAVE') throw new Error('That is not a WAV file.');
  let at = 12;
  let sampleRate = 0;
  let bits = 0;
  let channels = 0;
  while (at + 8 <= view.byteLength) {
    const id = text(view, at, 4);
    const size = view.getUint32(at + 4, true);
    if (id === 'fmt ') {
      channels = view.getUint16(at + 10, true);
      sampleRate = view.getUint32(at + 12, true);
      bits = view.getUint16(at + 22, true);
    } else if (id === 'data') {
      if (bits !== 16 || channels !== 1) throw new Error('That is not a WAV file this page can read (it needs 16-bit mono).');
      return { dataAt: at + 8, size: Math.min(size, view.byteLength - at - 8) & ~1, sampleRate };
    }
    at += 8 + size + (size & 1);
  }
  throw new Error('That is not a WAV file: it has no sound in it.');
}

/**
 * The same WAV at `gain` times the level. If that would clip, it is turned down to `ceiling` instead.
 * At a gain of 1 the bytes come back unchanged. Returns { bytes, limited }.
 */
export function scaleWav(bytes, gain, ceiling = 0.99) {
  const out = new Uint8Array(bytes);
  const view = new DataView(out.buffer);
  const { dataAt, size } = locate(view);
  let peak = 0;
  for (let i = 0; i < size / 2; i++) peak = Math.max(peak, Math.abs(view.getInt16(dataAt + i * 2, true)));
  let g = gain;
  let limited = false;
  if (peak * g > 32767 * ceiling) { g = (32767 * ceiling) / peak; limited = true; }
  if (g !== 1) for (let i = 0; i < size / 2; i++) view.setInt16(dataAt + i * 2, Math.round(view.getInt16(dataAt + i * 2, true) * g), true);
  return { bytes: out, limited };
}
