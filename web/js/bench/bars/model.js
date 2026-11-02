// SPDX-License-Identifier: GPL-3.0-only
// The bars on the bench: a row of bars, each with its own material, length, thickness, arch and tube, and what
// they add up to. Nothing here draws or plays; it keeps the document and does the arithmetic, using the same
// physics file the engine uses. Like the strings bench, every value is kept by its role and turned back into the
// engine's own ids only where it leaves for the engine (see model.js beside this one).
import { normalizeInstrument } from '/shared/schema.mjs';
import { roleMaps, sharedToRoles, sharedToIds, partToRoles, partToIds, formSchema } from '/shared/roles.mjs';
import { barFrequencies, barLengthForHz, nearestNote, hzToMidi, midiToHz, tubeHz, tubeLengthForHz } from '/shared/physics.mjs';

export const MIN_HZ = 20;
export const MAX_HZ = 12000;
const HISTORY_LIMIT = 60;
const round1 = (x) => Math.round(x * 10) / 10;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export class BarsBench {
  /** @param engine one engine description from /api/engines whose bench is `struck-bars` @param materials the starter materials */
  constructor(engine, materials) {
    this.engine = engine;
    this.materials = materials;
    this.schema = engine.schema;
    this.maps = roleMaps(engine.schema);
    this.partId = this.maps.partId.bar;
    this.name = '';
    this.params = {};
    this.bars = [];
    this.otherParts = {};
    this.volumeDb = 0;
    this.history = [];
    this.listeners = new Set();
  }

  onChange(fn) { this.listeners.add(fn); }

  emit(kind = 'edit') { for (const fn of this.listeners) fn(kind); }

  /** The schema entry of the parameter with this role (or, with no role, this id). */
  paramDef(role) { return this.schema.params.find((p) => (p.role ?? p.id) === role); }

  get partDef() { return this.schema.parts.find((p) => p.id === this.partId); }

  /** The engine's own ids for what the bench keeps by role (shared values and a bar's values together). */
  toEngineValues(values) { return partToIds(this.maps, 'bar', sharedToIds(this.maps, values)); }

  /** A form for some of the schema's parameters, keyed by role. */
  formSchema(params) { return formSchema(this.schema, this.maps, params); }

  /** Rack entries (name, description, params) with their params keyed by role. */
  get rack() { return (this.partDef.rack ?? []).map((entry) => ({ ...entry, params: partToRoles(this.maps, 'bar', entry.params) })); }

  get hands() { return this.engine.bench.hands ?? []; }

  /** Replace the whole instrument (a starting point, or an opened file). */
  load({ name, params, parts, volumeDb = 0 }) {
    const checked = normalizeInstrument(this.schema, { params, parts });
    this.name = name;
    this.params = sharedToRoles(this.maps, checked.params);
    this.bars = checked.parts[this.partId].map((item) => partToRoles(this.maps, 'bar', item));
    this.otherParts = Object.fromEntries(Object.entries(checked.parts).filter(([id]) => id !== this.partId));
    this.volumeDb = volumeDb;
    this.history = [];
    this.remember();
    this.emit('load');
  }

  toDocument() {
    const parts = { ...structuredClone(this.otherParts), [this.partId]: this.bars.map((item) => partToIds(this.maps, 'bar', structuredClone(item))) };
    return { name: this.name, engine: this.engine.id, params: sharedToIds(this.maps, structuredClone(this.params)), parts, volumeDb: this.volumeDb };
  }

  // ------------------------------------------------------------------ undo

  snapshot() { return JSON.stringify({ params: this.params, bars: this.bars }); }

  remember() {
    this.history.push(this.snapshot());
    if (this.history.length > HISTORY_LIMIT) this.history.shift();
  }

  /** Called when a hand lets go: that edit becomes a step to undo. */
  commit() {
    const now = this.snapshot();
    if (this.history.at(-1) === now) return false;
    this.history.push(now);
    if (this.history.length > HISTORY_LIMIT) this.history.shift();
    return true;
  }

  get canUndo() { return this.history.length > 1; }

  undo() {
    if (!this.canUndo) return false;
    this.history.pop();
    const { params, bars } = JSON.parse(this.history.at(-1));
    this.params = params;
    this.bars = bars;
    this.emit('undo');
    return true;
  }

  // ------------------------------------------------------------------ edits

  set(patch) {
    Object.assign(this.params, patch);
    this.emit('edit');
  }

  setBar(i, patch) {
    Object.assign(this.bars[i], patch);
    this.emit('edit');
  }

  canAddBar() { return this.bars.length < this.partDef.max; }

  canRemoveBar() { return this.bars.length > this.partDef.min; }

  defaultBar() {
    return Object.fromEntries(this.schema.params.filter((p) => p.part === this.partId).map((p) => [p.role ?? p.id, p.default]));
  }

  insertBar(index, values) {
    this.bars.splice(index, 0, { ...this.defaultBar(), ...values });
    this.emit('edit');
  }

  removeBar(index) {
    this.bars.splice(index, 1);
    this.emit('edit');
  }

  // ------------------------------------------------------------------ bars in numbers

  material(id, customDensity, customModulusGPa) {
    if (id === 'custom') return { densityKgM3: customDensity, youngModulusPa: customModulusGPa * 1e9, family: 'custom', look: { base: '#b9bec4', grain: '#8a9097' }, name: 'Your own' };
    return { ...this.materials.find((x) => x.id === id) };
  }

  barMaterial(i) {
    const b = this.bars[i];
    return this.material(b.barMaterial, b.barCustomDensity, b.barCustomModulus);
  }

  /** The note and other facts for bar i, with an optional change to try instead. */
  info(i, override = {}) { return this.infoFor({ ...this.bars[i], ...override }); }

  /** The same for any bar's values (a bar on the rack, say). */
  infoFor(b) {
    const mat = this.material(b.barMaterial, b.barCustomDensity, b.barCustomModulus);
    const modes = barFrequencies({ densityKgM3: mat.densityKgM3, youngModulusPa: mat.youngModulusPa, lengthM: b.barLengthMm / 1000, thicknessM: b.barThicknessMm / 1000, undercut: b.barUndercut });
    const hz = modes[0];
    const midi = hzToMidi(hz);
    const note = nearestNote(midi);
    const tube = b.tubeFit ? tubeHz(b.tubeLengthMm / 1000) : null;
    return { hz, midi, modes, note, mat, playable: hz >= MIN_HZ && hz <= MAX_HZ, openMidi: note.midi, tubeHz: tube, tubeCents: tube === null ? null : Math.round(1200 * Math.log2(tube / hz)) };
  }

  /** The length (mm, to a tenth) that gives bar i this note, within what the bar's length can be; null if it cannot. */
  lengthFor(i, midiFloat, override = {}) {
    const b = { ...this.bars[i], ...override };
    const mat = this.material(b.barMaterial, b.barCustomDensity, b.barCustomModulus);
    const def = this.paramDef('barLengthMm');
    const lengthM = barLengthForHz({ hz: midiToHz(midiFloat), densityKgM3: mat.densityKgM3, youngModulusPa: mat.youngModulusPa, thicknessM: b.barThicknessMm / 1000, undercut: b.barUndercut });
    const mm = round1(lengthM * 1000);
    return mm >= def.min && mm <= def.max ? mm : null;
  }

  clampLength(mm) {
    const def = this.paramDef('barLengthMm');
    return round1(clamp(mm, def.min, def.max));
  }

  /** Cut bar i to the nearest note (the bar is shortened or lengthened to fit). */
  cutTo(i, midiFloat = this.info(i).note.midi) {
    const mm = this.lengthFor(i, midiFloat);
    if (mm === null) return false;
    this.setBar(i, { barLengthMm: mm });
    return true;
  }

  /** Change a bar's make but keep its note, as a maker re-cuts a bar from other stock. */
  swapMaterial(i, patch) {
    const midi = this.info(i).midi;
    const next = { ...this.bars[i], ...patch };
    const mm = this.lengthFor(i, midi, next);
    this.bars[i] = { ...next, barLengthMm: mm ?? this.clampLength(this.bars[i].barLengthMm) };
    this.emit('edit');
    return mm !== null;
  }

  /** The tube length (mm, to the whole millimetre) that rings at bar i's note. */
  tunedTubeMm(i) {
    const def = this.paramDef('tubeLengthMm');
    return Math.round(clamp(tubeLengthForHz(this.info(i).hz) * 1000, def.min, def.max));
  }

  // ------------------------------------------------------------------ playing

  /** The bar that sounds this note (the one closest in tune, if several do), or null. */
  barForMidi(midi) {
    let found = null;
    this.bars.forEach((_, i) => {
      const info = this.info(i);
      if (!info.playable || info.note.midi !== midi) return;
      if (found === null || Math.abs(info.note.cents) < Math.abs(this.info(found).note.cents)) found = i;
    });
    return found;
  }

  /** The lowest and highest note any bar sounds, or null. */
  playableRange() {
    const mids = this.bars.map((_, i) => this.info(i)).filter((x) => x.playable).map((x) => x.note.midi);
    return mids.length ? { lowMidi: Math.min(...mids), highMidi: Math.max(...mids) } : null;
  }
}
