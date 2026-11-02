// SPDX-License-Identifier: GPL-3.0-only
// The drums on the bench: a row of drums, each with its own head, size, tension and shell, and what they add up
// to. Nothing here draws or plays; it keeps the document and does the arithmetic, using the same physics file the
// engine uses. Like the other benches, every value is kept by its role and turned back into the engine's own ids
// only where it leaves for the engine (see model.js beside this one).
import { normalizeInstrument } from '/shared/schema.mjs';
import { roleMaps, sharedToRoles, sharedToIds, partToRoles, partToIds, formSchema } from '/shared/roles.mjs';
import { headTensionForHz, hzToMidi, membraneModes, midiToHz, nearestNote } from '/shared/physics.mjs';

/** The mode a tom is heard to sound at: the lowest with a nodal diameter. */
const MAIN_TONE = { m: 1, n: 1 };

export const MIN_HZ = 20;
export const MAX_HZ = 12000;
const HISTORY_LIMIT = 60;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export class DrumsBench {
  /** @param engine one engine description from /api/engines whose bench is `struck-membranes` @param materials the starter materials */
  constructor(engine, materials) {
    this.engine = engine;
    this.materials = materials;
    this.schema = engine.schema;
    this.maps = roleMaps(engine.schema);
    this.partId = this.maps.partId.drum;
    this.name = '';
    this.params = {};
    this.drums = [];
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

  /** The engine's own ids for what the bench keeps by role (shared values and a drum's values together). */
  toEngineValues(values) { return partToIds(this.maps, 'drum', sharedToIds(this.maps, values)); }

  /** A form for some of the schema's parameters, keyed by role. */
  formSchema(params) { return formSchema(this.schema, this.maps, params); }

  /** Rack entries (name, description, params) with their params keyed by role. */
  get rack() { return (this.partDef.rack ?? []).map((entry) => ({ ...entry, params: partToRoles(this.maps, 'drum', entry.params) })); }

  get hands() { return this.engine.bench.hands ?? []; }

  /** Replace the whole instrument (a starting point, or an opened file). */
  load({ name, params, parts, volumeDb = 0 }) {
    const checked = normalizeInstrument(this.schema, { params, parts });
    this.name = name;
    this.params = sharedToRoles(this.maps, checked.params);
    this.drums = checked.parts[this.partId].map((item) => partToRoles(this.maps, 'drum', item));
    this.otherParts = Object.fromEntries(Object.entries(checked.parts).filter(([id]) => id !== this.partId));
    this.volumeDb = volumeDb;
    this.history = [];
    this.remember();
    this.emit('load');
  }

  toDocument() {
    const parts = { ...structuredClone(this.otherParts), [this.partId]: this.drums.map((item) => partToIds(this.maps, 'drum', structuredClone(item))) };
    return { name: this.name, engine: this.engine.id, params: sharedToIds(this.maps, structuredClone(this.params)), parts, volumeDb: this.volumeDb };
  }

  // ------------------------------------------------------------------ undo

  snapshot() { return JSON.stringify({ params: this.params, drums: this.drums }); }

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
    const { params, drums } = JSON.parse(this.history.at(-1));
    this.params = params;
    this.drums = drums;
    this.emit('undo');
    return true;
  }

  // ------------------------------------------------------------------ edits

  set(patch) {
    Object.assign(this.params, patch);
    this.emit('edit');
  }

  setDrum(i, patch) {
    Object.assign(this.drums[i], patch);
    this.emit('edit');
  }

  /** What is under drum i: 'open', 'head' (a second head, if the engine has one) or 'closed' (a bowl). */
  bottomState(i) {
    const d = this.drums[i];
    return d.shellClosed ? 'closed' : d.bottomHead ? 'head' : 'open';
  }

  /** The values that put drum i's bottom in its next state (open, then a second head if it can have one, then closed, then open). */
  nextBottom(i) {
    const hasHead = this.paramDef('bottomHead') !== undefined;
    const next = { open: hasHead ? 'head' : 'closed', head: 'closed', closed: 'open' }[this.bottomState(i)];
    return { shellClosed: next === 'closed', ...(hasHead ? { bottomHead: next === 'head' } : {}) };
  }

  canAddDrum() { return this.drums.length < this.partDef.max; }

  canRemoveDrum() { return this.drums.length > this.partDef.min; }

  defaultDrum() {
    return Object.fromEntries(this.schema.params.filter((p) => p.part === this.partId).map((p) => [p.role ?? p.id, p.default]));
  }

  insertDrum(index, values) {
    this.drums.splice(index, 0, { ...this.defaultDrum(), ...values });
    this.emit('edit');
  }

  removeDrum(index) {
    this.drums.splice(index, 1);
    this.emit('edit');
  }

  /** A value held to what its parameter allows. */
  clampTo(role, value) {
    const def = this.paramDef(role);
    return clamp(value, def.min, def.max);
  }

  // ------------------------------------------------------------------ drums in numbers

  /** A material from the starter list, or the one typed in (its density; a head has no use for stiffness). */
  material(id, customDensity) {
    if (id === 'custom') return { id: 'custom', densityKgM3: customDensity, youngModulusPa: 0, family: 'film', look: { base: '#e9eef0', grain: '#d3dce0' }, name: 'Your own' };
    return { ...this.materials.find((x) => x.id === id) };
  }

  headMaterial(i) {
    const d = this.drums[i];
    return this.material(d.headMaterial, d.headCustomDensity);
  }

  shellMaterial(i) { return this.material(this.drums[i].shellMaterial); }

  /** The inputs of the membrane physics for these drum values. */
  physicsOf(d) {
    const head = this.material(d.headMaterial, d.headCustomDensity);
    return {
      arealKgM2: head.densityKgM3 * d.headThicknessUm * 1e-6, radiusM: d.headDiameterMm / 2000, depthM: d.shellDepthMm / 1000, closed: Boolean(d.shellClosed || d.bottomHead),
    };
  }

  /** The note and other facts for drum i, with an optional change to try instead. */
  info(i, override = {}) { return this.infoFor({ ...this.drums[i], ...override }); }

  /** The same for any drum's values (a drum on the rack, say). */
  infoFor(d) {
    const physics = this.physicsOf(d);
    const modes = membraneModes({ tensionNPerM: d.headTension, ...physics });
    const hz = modes.find((m) => m.m === MAIN_TONE.m && m.n === MAIN_TONE.n).hz;
    const midi = hzToMidi(hz);
    const note = nearestNote(midi);
    return { hz, midi, modes, note, head: this.material(d.headMaterial, d.headCustomDensity), shell: this.material(d.shellMaterial), playable: hz >= MIN_HZ && hz <= MAX_HZ, openMidi: note.midi, lugs: lugCount(d.headDiameterMm) };
  }

  /** The tension (N/m, whole) that gives drum i this note, within what the tension can be; null if it cannot. */
  tensionFor(i, midiFloat, override = {}) {
    const d = { ...this.drums[i], ...override };
    const def = this.paramDef('headTension');
    const tension = Math.round(headTensionForHz(midiToHz(midiFloat), { ...this.physicsOf(d), mode: MAIN_TONE }));
    return tension >= def.min && tension <= def.max ? tension : null;
  }

  /** Tune drum i to the nearest note (the head is tightened or slackened to fit). */
  tuneTo(i, midiFloat = this.info(i).note.midi) {
    const tension = this.tensionFor(i, midiFloat);
    if (tension === null) return false;
    this.setDrum(i, { headTension: tension });
    return true;
  }

  // ------------------------------------------------------------------ playing

  /** The drum that sounds this note (the one closest in tune, if several do), or null. */
  drumForMidi(midi) {
    let found = null;
    this.drums.forEach((_, i) => {
      const info = this.info(i);
      if (!info.playable || info.note.midi !== midi) return;
      if (found === null || Math.abs(info.note.cents) < Math.abs(this.info(found).note.cents)) found = i;
    });
    return found;
  }

  /** The lowest and highest note any drum sounds, or null. */
  playableRange() {
    const mids = this.drums.map((_, i) => this.info(i)).filter((x) => x.playable).map((x) => x.note.midi);
    return mids.length ? { lowMidi: Math.min(...mids), highMidi: Math.max(...mids) } : null;
  }
}

/** How many lugs hold a head of this diameter, drawn round the rim: even, 4 to 10. */
export function lugCount(diameterMm) {
  return clamp(2 * Math.round(diameterMm / 110), 4, 10);
}
