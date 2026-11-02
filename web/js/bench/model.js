// SPDX-License-Identifier: GPL-3.0-only
// The instrument on the bench: its shared values, its strings, and what they
// add up to. Nothing here draws or plays; it only keeps the document and does
// the arithmetic, using the same physics file the engine uses.
//
// The bench finds everything by role, never by id. The engine tags the parts and
// parameters it has with a `role` (see "What the bench requires" in
// docs/engines.md); inside the bench every value is keyed by its role, and it is
// turned back into the engine's own ids only where it leaves for the engine (the
// saved file, the notes sent to render). A parameter with no role is kept under
// its own id and the bench does nothing with it.
import { normalizeInstrument } from '/shared/schema.mjs';
import { roleMaps, sharedToRoles, sharedToIds, partToRoles, partToIds, formSchema } from '/shared/roles.mjs';
import { stringPhysics, nearestNote, tensionForHz, midiToHz } from '/shared/physics.mjs';

export const MIN_HZ = 16;
export const MAX_HZ = 1400;
const HISTORY_LIMIT = 60;

export async function loadMaterials() {
  const response = await fetch('/shared/materials.json');
  if (!response.ok) throw new Error('could not load the materials list');
  return (await response.json()).materials;
}

export class Bench {
  /** @param engine one engine description from /api/engines that has a `bench` @param materials the starter materials */
  constructor(engine, materials) {
    this.engine = engine;
    this.materials = materials;
    this.schema = engine.schema;
    this.maps = roleMaps(engine.schema);
    this.partId = this.maps.partId.string;
    // Optional parts: the fret wires, and the pickup (two shared values).
    this.fretPartId = this.maps.partId.fret ?? null;
    this.hasFrets = this.fretPartId !== null && this.maps.part.fret?.fretNumber !== undefined;
    this.hasPickup = this.maps.shared.pickupFit !== undefined && this.maps.shared.pickupAtMm !== undefined;
    this.otherParts = {};
    this.name = '';
    this.params = {};
    this.strings = [];
    this.fretItems = [];
    this.volumeDb = 0;
    this.history = [];
    this.listeners = new Set();
  }

  onChange(fn) { this.listeners.add(fn); }

  emit(kind = 'edit') { for (const fn of this.listeners) fn(kind); }

  /** The schema entry of the parameter with this role (or, with no role, this id). */
  paramDef(role) { return this.schema.params.find((p) => (p.role ?? p.id) === role); }

  get partDef() { return this.schema.parts.find((p) => p.id === this.partId); }

  /** The engine's own ids for what the bench keeps by role (shared values and a string's values together). */
  toEngineValues(values) {
    return partToIds(this.maps, 'string', sharedToIds(this.maps, values));
  }

  /** A form for some of the schema's parameters, keyed by role. */
  formSchema(params) { return formSchema(this.schema, this.maps, params); }

  /** Rack entries (name, description, params) with their params keyed by role. */
  get rack() {
    return (this.partDef.rack ?? []).map((entry) => ({ ...entry, params: partToRoles(this.maps, 'string', entry.params) }));
  }

  /** Replace the whole instrument (a starting point, or an opened file). */
  load({ name, params, parts, volumeDb = 0 }) {
    const checked = normalizeInstrument(this.schema, { params, parts });
    this.name = name;
    this.params = sharedToRoles(this.maps, checked.params);
    this.strings = checked.parts[this.partId].map((item) => partToRoles(this.maps, 'string', item));
    if (this.hasFrets) {
      // A file that lists no frets gets the engine's ordinary neck, not a single fret.
      const listed = parts?.[this.fretPartId] !== undefined;
      this.fretItems = listed ? checked.parts[this.fretPartId].map((item) => partToRoles(this.maps, 'fret', item)) : this.standardFrets();
      this.tidyFrets();
    }
    this.otherParts = Object.fromEntries(Object.entries(checked.parts).filter(([id]) => id !== this.partId && id !== this.fretPartId));
    this.volumeDb = volumeDb;
    this.history = [];
    this.remember();
    this.emit('load');
  }

  toDocument() {
    const parts = { ...structuredClone(this.otherParts), [this.partId]: this.strings.map((item) => partToIds(this.maps, 'string', structuredClone(item))) };
    if (this.hasFrets) parts[this.fretPartId] = this.fretItems.map((item) => partToIds(this.maps, 'fret', structuredClone(item)));
    return { name: this.name, engine: this.engine.id, params: sharedToIds(this.maps, structuredClone(this.params)), parts, volumeDb: this.volumeDb };
  }

  // ------------------------------------------------------------------ undo

  snapshot() { return JSON.stringify({ params: this.params, strings: this.strings, frets: this.fretItems }); }

  remember() {
    this.history.push(this.snapshot());
    if (this.history.length > HISTORY_LIMIT) this.history.shift();
  }

  /** Called when a hand lets go: that edit becomes a step to undo. */
  commit() {
    this.tidyFrets();
    const last = this.history.at(-1);
    const now = this.snapshot();
    if (last === now) return false;
    this.history.push(now);
    if (this.history.length > HISTORY_LIMIT) this.history.shift();
    return true;
  }

  get canUndo() { return this.history.length > 1; }

  undo() {
    if (!this.canUndo) return false;
    this.history.pop();
    const { params, strings, frets } = JSON.parse(this.history.at(-1));
    this.params = params;
    this.strings = strings;
    this.fretItems = frets;
    this.emit('undo');
    return true;
  }

  // ------------------------------------------------------------------ frets

  get fretDef() { return this.hasFrets ? this.paramDef('fretNumber') : null; }

  get fretPartDef() { return this.hasFrets ? this.schema.parts.find((p) => p.id === this.fretPartId) : null; }

  /** The semitone each fret wire stands at, lowest first. */
  get fretNumbers() { return this.fretItems.map((f) => f.fretNumber).sort((a, b) => a - b); }

  defaultFret() {
    return Object.fromEntries(this.schema.params.filter((p) => p.part === this.fretPartId).map((p) => [p.role ?? p.id, p.default]));
  }

  /** Frets 1 up to the engine's usual count. */
  standardFrets() {
    // From the lowest place the engine allows (a neck whose first wire may not be below the third fret starts there).
    const { min, max } = this.fretDef;
    const count = Math.min(this.fretPartDef.standard ?? this.fretPartDef.max, max - min + 1);
    return Array.from({ length: count }, (_, k) => ({ ...this.defaultFret(), fretNumber: min + k }));
  }

  /** No two wires at one place, lowest first. */
  tidyFrets() {
    if (!this.hasFrets) return;
    const seen = new Set();
    this.fretItems = this.fretItems
      .filter((f) => !seen.has(f.fretNumber) && seen.add(f.fretNumber))
      .sort((a, b) => a.fretNumber - b.fretNumber);
  }

  canAddFret() { return this.hasFrets && this.fretItems.length < this.fretPartDef.max; }

  canRemoveFret() { return this.hasFrets && this.fretItems.length > this.fretPartDef.min; }

  hasFret(n) { return this.fretItems.some((f) => f.fretNumber === n); }

  /** The nearest place a wire could go that has none. `from` is where the wire is now, if it is being moved. */
  freeFretNear(target, from = null) {
    const max = this.fretDef.max, min = this.fretDef.min;
    let best = null;
    for (let n = min; n <= max; n++) {
      if (n !== from && this.hasFret(n)) continue;
      if (best === null || Math.abs(n - target) < Math.abs(best - target)) best = n;
    }
    return best;
  }

  addFret(n) {
    this.fretItems.push({ ...this.defaultFret(), fretNumber: n });
    this.tidyFrets();
    this.emit('edit');
  }

  /** Item `index` of the list (the order is kept while a hand is moving it). */
  moveFret(index, n) {
    this.fretItems[index].fretNumber = n;
    this.emit('edit');
  }

  removeFret(index) {
    this.fretItems.splice(index, 1);
    this.emit('edit');
  }

  // ------------------------------------------------------------------ pickup

  /** Where the pickup is, in mm from the bridge, or null when none is fitted. */
  get pickup() {
    if (!this.hasPickup || this.params.pickupFit !== 'magnetic') return null;
    return { atMm: this.params.pickupAtMm };
  }

  get pickupDef() { return this.hasPickup ? this.paramDef('pickupAtMm') : null; }

  fitPickup(atMm) {
    const def = this.pickupDef;
    this.set({ pickupFit: 'magnetic', pickupAtMm: Math.min(def.max, Math.max(def.min, Math.round(atMm))) });
  }

  removePickup() { this.set({ pickupFit: 'none' }); }

  // ------------------------------------------------------------------ edits

  set(patch) {
    Object.assign(this.params, patch);
    this.emit('edit');
  }

  setString(i, patch) {
    Object.assign(this.strings[i], patch);
    this.emit('edit');
  }

  canAddString() { return this.strings.length < this.partDef.max; }

  canRemoveString() { return this.strings.length > this.partDef.min; }

  insertString(index, values) {
    this.strings.splice(index, 0, { ...this.defaultString(), ...values });
    this.emit('edit');
  }

  removeString(index) {
    this.strings.splice(index, 1);
    this.emit('edit');
  }

  defaultString() {
    return Object.fromEntries(this.schema.params.filter((p) => p.part === this.partId).map((p) => [p.role ?? p.id, p.default]));
  }

  // ------------------------------------------------------------------ strings in numbers

  material(id, customDensity, customModulusGPa) {
    if (id === 'custom') return { densityKgM3: customDensity, youngModulusPa: customModulusGPa * 1e9, family: 'custom', look: { base: '#b9bec4', grain: '#8a9097' }, name: 'Your own' };
    const m = this.materials.find((x) => x.id === id);
    return { ...m };
  }

  stringMaterial(i) {
    const s = this.strings[i];
    return this.material(s.stringMaterial, s.stringCustomDensity, s.stringCustomModulus);
  }

  /** Pitch and other facts for string i, with an optional tension or length to try instead. */
  info(i, override = {}) {
    const s = { ...this.strings[i], ...override };
    const mat = this.material(s.stringMaterial, s.stringCustomDensity, s.stringCustomModulus);
    const scaleLengthMm = override.scaleLengthMm ?? this.params.scaleLengthMm;
    const physics = stringPhysics({ ...mat, diameterMm: s.stringDiameterMm, wound: s.stringWound, tensionN: s.tensionN, scaleLengthMm, stiffness: this.params.stiffness });
    const note = nearestNote(physics.midi);
    return { ...physics, note, mat, playable: physics.hz >= MIN_HZ && physics.hz <= MAX_HZ, openMidi: note.midi };
  }

  /** The tension that gives string i this pitch, or null when it is outside what a string can carry. */
  tensionFor(i, midiFloat, override = {}) {
    const s = { ...this.strings[i], ...override };
    const mat = this.material(s.stringMaterial, s.stringCustomDensity, s.stringCustomModulus);
    const scaleLengthMm = override.scaleLengthMm ?? this.params.scaleLengthMm;
    const physics = stringPhysics({ ...mat, diameterMm: s.stringDiameterMm, wound: s.stringWound, tensionN: 1, scaleLengthMm, stiffness: this.params.stiffness });
    const t = tensionForHz({ lengthM: physics.lengthM, hz: midiToHz(midiFloat), linearDensityKgM: physics.mu, bendingNm2: physics.bending });
    return t;
  }

  clampTension(t) {
    const def = this.paramDef('tensionN');
    return Math.min(def.max, Math.max(def.min, t));
  }

  /** Retune string i to a pitch (clamped to a tension the string can take). */
  tuneTo(i, midiFloat) {
    this.setString(i, { tensionN: round1(this.clampTension(this.tensionFor(i, midiFloat))) });
  }

  /** Change a string's make but keep its pitch, as a maker retunes a new string. */
  swapString(i, patch) {
    const midi = this.info(i).midi;
    const next = { ...this.strings[i], ...patch };
    const t = this.tensionFor(i, midi, next);
    this.strings[i] = { ...next, tensionN: round1(this.clampTension(t)) };
    this.emit('edit');
  }

  /** The note a new string should be tuned to in slot `index`. */
  targetMidiForSlot(index) {
    const n = this.strings.length;
    const mids = this.strings.map((_, i) => this.info(i).midi);
    if (!n) return 52;
    if (index <= 0) return mids[0] - 5;
    if (index >= n) return mids[n - 1] + 5;
    return Math.round((mids[index - 1] + mids[index]) / 2);
  }

  /** Can a finger stop a string at this fret? The open string always sounds; the rest need a wire there. */
  reaches(fret, maxFret = 19) {
    if (!this.hasFrets) return fret >= 0 && fret <= maxFret;
    return fret === 0 || this.hasFret(fret);
  }

  /** Which string can sound a note, and at which fret. Highest string that reaches it, like a player's first choice. */
  stringForMidi(midi, maxFret = 19) {
    let found = null;
    this.strings.forEach((_, i) => {
      const open = this.info(i);
      if (!open.playable) return;
      const fret = midi - open.openMidi;
      if (fret >= 0 && this.reaches(fret, maxFret)) found = { string: i, fret };
    });
    return found;
  }

  /** The lowest and highest note the strings can reach. */
  playableRange(maxFret = 19) {
    const opens = this.strings.map((_, i) => this.info(i)).filter((x) => x.playable).map((x) => x.openMidi);
    if (!opens.length) return null;
    const top = this.hasFrets ? Math.max(0, ...this.fretNumbers) : maxFret;
    return { lowMidi: Math.min(...opens), highMidi: Math.max(...opens) + top };
  }
}

export const round1 = (x) => Math.round(x * 10) / 10;
