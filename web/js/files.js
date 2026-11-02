// SPDX-License-Identifier: GPL-3.0-only
// The instrument file: a small JSON document anyone can open.
import { normalizeInstrument } from '/shared/schema.mjs';

export const FORMAT = 'instrument-lab-studio.instrument';
export const VERSION = 2;

export function toFile({ name, engine, params, parts, volumeDb }) {
  return { format: FORMAT, version: VERSION, name, engine, params, ...(parts && Object.keys(parts).length ? { parts } : {}), volumeDb };
}

/** Hand the browser some bytes to save under this file name. */
export function saveBytes(bytes, filename, type) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([bytes], { type }));
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 10000);
}

/** Download an instrument as a .json file. */
export function saveFile(file) {
  const name = file.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'instrument';
  saveBytes(`${JSON.stringify(file, null, 2)}\n`, `${name}.instrument.json`, 'application/json');
}

/** A part the file did not list is left out, so the page can tell "no frets listed" from "one fret" and give such a file its engine's ordinary neck. */
const onlyListed = (parts, listed) => Object.fromEntries(Object.entries(parts).filter(([id]) => listed?.[id] !== undefined));

/**
 * Check an opened file against the engines this app has.
 * Version 1 files (no parts) are still read. Returns { name, engine, params, parts, volumeDb }
 * or throws an Error that says what is wrong.
 */
export function parseFile(text, engines) {
  let file;
  try { file = JSON.parse(text); } catch { throw new Error('That file is not an instrument: it is not valid JSON.'); }
  if (file?.format !== FORMAT) throw new Error('That file is not an Open Instrument Lab instrument.');
  if (![1, VERSION].includes(file.version)) throw new Error(`That instrument file is version ${file.version}; this app reads versions 1 and ${VERSION}.`);
  const engine = engines.find((e) => e.id === file.engine);
  if (!engine) throw new Error(`This instrument needs the "${file.engine}" engine, which is not installed here.`);
  let checked;
  try { checked = normalizeInstrument(engine.schema, { params: file.params, parts: file.parts }); } catch (error) { throw new Error(`The instrument settings are not valid: ${error.message}.`); }
  const volumeDb = typeof file.volumeDb === 'number' && file.volumeDb >= -30 && file.volumeDb <= 6 ? file.volumeDb : 0;
  return { name: typeof file.name === 'string' && file.name.trim() ? file.name.trim().slice(0, 80) : 'Opened instrument', engine, params: checked.params, parts: onlyListed(checked.parts, file.parts), volumeDb };
}
