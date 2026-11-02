// SPDX-License-Identifier: GPL-3.0-only
// Puts the workbench together: the bench, the racks, the hands, the keyboard.
import { loadEngines } from '../api.js';
import { AudioOut } from '../audio.js';
import { Keyboard } from '../keyboard.js';
import { buildForm } from '../form.js';
import { Bench, loadMaterials } from './model.js';
import { BenchView } from './draw.js';
import { layout } from './geometry.js';
import { attachInteraction } from './interact.js';
import { StrumLine, strumTrim } from './strum.js';
import { buildRacks } from './racks.js';
import { BenchSound } from './sound.js';
import { PreviewTone } from './preview.js';
import { Tuner } from './tuner.js';
import { parseFile } from '../files.js';
import { $, WINDOW_OCTAVES, setStatus, showProgress, lengthText, chooseEngine, takePendingFile, createShell } from './shell.js';

const MAX_FRET = 19;

const audio = new AudioOut();
const preview = new PreviewTone(audio);
const ui = { hand: null, unit: 'mm', selected: 0, vibrations: new Map(), fingers: new Map(), pull: null, sweep: null, drop: null, rideTag: null, pointer: null, removing: null, removingFret: null, removingPickup: false };
const state = { engines: [], velocity: 0.7, start: 48, bench: null, view: null, sound: null, racks: null, keyboard: null, drawer: null };
window.__studio = { state, ui, audio }; // handy for debugging in the console

const length = (mm) => lengthText(ui, mm);
let shell = null;

// ---------------------------------------------------------------- drawing

let drawQueued = false;
function redraw() {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => {
    drawQueued = false;
    paint();
  });
}

function paint() {
  const { bench, view } = state;
  if (!bench.strings[ui.selected]) ui.selected = Math.max(0, bench.strings.length - 1);
  view.render();
  tuner.set(bench.info(ui.selected), `String ${ui.selected + 1}, `);
  $('undo').disabled = !bench.canUndo;
  refreshDrawer();
}

const tuner = new Tuner($('tuner'));

let animating = false;
function animate() {
  const now = performance.now();
  for (const [i, v] of ui.vibrations) if (now - v.t0 > v.tau * 2500) ui.vibrations.delete(i);
  if (!ui.vibrations.size) { animating = false; paint(); return; }
  state.view.render();
  requestAnimationFrame(animate);
}
function startAnimating() {
  if (animating) return;
  animating = true;
  requestAnimationFrame(animate);
}

// ---------------------------------------------------------------- playing

/**
 * What to play for a note: the exact one if it is made, a neighbouring one at once while the exact one
 * is made, or a promise of the exact one. Resolves to { buffer, gain }, or null if it cannot sound.
 */
function soundFor(spec) {
  const { sound } = state;
  const exact = sound.get(spec);
  if (exact) return { buffer: exact, gain: 1 };
  const near = sound.nearby(spec);
  if (near) {
    sound.request(spec, 1).catch(() => {});
    return { buffer: near.buffer, gain: Math.min(2.5, spec.layer / near.layer) };
  }
  return sound.request(spec, 0).then((buffer) => ({ buffer, gain: 1 })).catch((error) => {
    if (error.name !== 'AbortError') setStatus(error.message.startsWith('this string') ? `That string cannot sound: ${error.message}` : `Could not make that note: ${error.message}`, true);
    return null;
  });
}

async function playSpec(spec, voice, when = 0) {
  await audio.wake();
  const sound = await soundFor(spec);
  if (!sound) return null;
  audio.play(voice, sound.buffer, sound.gain, when);
  return sound.buffer;
}

function swing(i, x, amp) {
  ui.vibrations.set(i, { t0: performance.now(), x, amp, tau: 2.4, speed: 1 });
  startAnimating();
}

/** Is the pickup past the end of this string's sounding length at this fret, over the dead part of the string? Say so. */
function warnDeadPickup(i, fret) {
  const { bench } = state;
  const pickup = bench.pickup;
  if (!pickup) return;
  const sounding = bench.info(i).lengthM * 1000 * 2 ** (-fret / 12);
  if (pickup.atMm > sounding) setStatus('The pickup is past the fretted note, over the dead part of the string, so this note is thin and very quiet. Slide the pickup towards the bridge.');
}

/** A touch on a string. */
function pluck(i, distMm, velocity, amp, x) {
  warnDeadPickup(i, 0);
  const spec = state.sound.pluckSpec(i, { distanceMm: distMm, velocity });
  ui.selected = i;
  swing(i, x, amp);
  playSpec(spec, 200 + i);
  redraw();
}

const STRUM_LEAD_S = 0.015; // a strum is heard this long after the hand, so every crossing can be scheduled on time
let strumLine = null;

/** The right button went down: the pointer's clock and the audio clock are lined up for this strum. */
function strumStart(pointerMs) {
  const clock = { offset: audio.context.currentTime + STRUM_LEAD_S - pointerMs / 1000, last: null };
  const trim = strumTrim(state.bench.strings.length);
  strumLine = new StrumLine(clock, {
    now: () => audio.context.currentTime,
    play: (voice, sound, when) => audio.play(voice, sound.buffer, sound.gain * trim, when),
  });
  audio.wake();
}

/** The hand crossed string i, at `distMm` from the bridge, at pointer time `tMs`. */
function strum({ i, x, distMm, velocity, amp, tMs }) {
  const spec = state.sound.pluckSpec(i, { distanceMm: distMm, velocity });
  ui.selected = i;
  swing(i, x, amp);
  strumLine.add({ tMs, voice: 200 + i, fetch: () => soundFor(spec) });
}

/** The sound that follows a change: the string you were working on, plucked open. */
function audition(i) {
  const { bench, sound } = state;
  if (i === undefined || !bench.strings[i] || !bench.info(i).playable) return;
  const spec = sound.pluckSpec(i, { velocity: 0.7 });
  const lay = layout(state.bench);
  swing(i, lay.nutX + (lay.bridgeX - lay.nutX) * 0.8, 3);
  playSpec(spec, 200 + i);
}

function windowMidis() {
  const out = [];
  for (let m = state.start; m < state.start + 12 * WINDOW_OCTAVES; m++) if (state.bench.stringForMidi(m, MAX_FRET)) out.push(m);
  return out;
}

/** After any change: forget stale work, and quietly get this guitar's notes ready. */
function settle(playString) {
  const { bench, sound, keyboard } = state;
  const range = bench.playableRange(MAX_FRET);
  if (range) keyboard.setRange(range);
  const specs = [];
  bench.strings.forEach((_, i) => { if (bench.info(i).playable) specs.push(sound.pluckSpec(i, { velocity: 0.7 })); });
  const mids = windowMidis();
  const middle = mids[mids.length >> 1] ?? 60;
  mids.sort((a, b) => Math.abs(a - middle) - Math.abs(b - middle));
  for (const midi of mids) {
    const hit = bench.stringForMidi(midi, MAX_FRET);
    if (hit && hit.fret > 0) specs.push(sound.pluckSpec(hit.string, { fret: hit.fret, velocity: 0.7 }));
  }
  sound.prefetch(specs);
  if (playString !== undefined) audition(playString);
  redraw();
}

/** The notes the keys play now, each with the note to ask the server for, so they can be saved as WAV files. */
function exportList(velocity) {
  const { bench, sound } = state;
  return windowMidis().map((midi) => {
    const hit = bench.stringForMidi(midi, MAX_FRET);
    return { midi, spec: sound.pluckSpec(hit.string, { fret: hit.fret, velocity }) };
  });
}

function noteOn(midi, velocity) {
  const { bench, sound } = state;
  const hit = bench.stringForMidi(midi, MAX_FRET);
  if (!hit) return;
  state.lastMidi = midi;
  audio.noteHeld(midi);
  ui.fingers.set(midi, hit);
  ui.selected = hit.string;
  const spec = sound.pluckSpec(hit.string, { fret: hit.fret, velocity });
  warnDeadPickup(hit.string, hit.fret);
  const lay = layout(state.bench);
  swing(hit.string, lay.bridgeX - 0.17 * (lay.bridgeX - lay.nutX) * 2 ** (-hit.fret / 12), 2.5 + 3 * velocity);
  playSpec(spec, midi);
  redraw();
}

function noteOff(midi) {
  ui.fingers.delete(midi);
  audio.release(midi);
  redraw();
}

// ---------------------------------------------------------------- the drawer

function buildDrawer() {
  const { bench } = state;
  const sharedParams = bench.schema.params.filter((p) => p.part === undefined && (p.layer === 'advanced' || /^(top|back)Custom/.test(p.role ?? p.id)));
  const stringParams = bench.schema.params.filter((p) => p.part && /Custom/.test(p.role ?? p.id));
  const subset = (params) => bench.formSchema(params);
  const dummy = document.createElement('div');
  const shared = buildForm({
    schema: subset(sharedParams), plainEl: $('drawer-shared'), advancedEl: dummy, values: bench.params,
    onInput: (id, value) => { bench.set({ [id]: value }); },
    onCommit: () => { bench.commit(); settle(ui.selected); },
  });
  const perString = buildForm({
    schema: subset(stringParams), plainEl: $('drawer-string'), advancedEl: dummy, values: bench.strings[ui.selected] ?? bench.defaultString(),
    onInput: (id, value) => { bench.setString(ui.selected, { [id]: value }); },
    onCommit: () => { bench.commit(); settle(ui.selected); },
  });
  state.drawer = { shared, perString, shownString: -1 };
}

function refreshDrawer() {
  const { drawer, bench } = state;
  if (!drawer) return;
  drawer.shared.update(bench.params);
  const s = bench.strings[ui.selected];
  if (s) drawer.perString.update(s);
  const custom = s?.stringMaterial === 'custom';
  $('drawer-string').hidden = !custom;
  $('drawer-string-title').hidden = !custom;
  $('drawer-string-title').textContent = custom ? `Your own material for string ${ui.selected + 1}` : '';
}

// ---------------------------------------------------------------- instruments and files

function loadInstrument({ name, params, parts, volumeDb = 0 }) {
  const { bench } = state;
  bench.load({ name, params, parts, volumeDb });
  ui.selected = 0;
  ui.vibrations.clear();
  ui.fingers.clear();
  shell.showDocument({ name, volumeDb });
  state.racks.mark();
  shell.windowTo(bench.playableRange(MAX_FRET));
  state.view.fit();
  settle();
}

// ---------------------------------------------------------------- start

async function start() {
  let engines;
  let problems;
  try {
    ({ engines, problems } = await loadEngines());
  } catch (error) {
    setStatus(`Could not start: ${error.message}`, true);
    return;
  }
  if (problems.length) {
    $('notice').hidden = false;
    $('notice').textContent = `${problems.length} plug-in${problems.length > 1 ? 's' : ''} could not be loaded: ${problems.map((p) => p.message).join('; ')}`;
  }
  state.engines = engines;
  const { engine, entry } = chooseEngine(engines);
  if (!engine) { setStatus('No engine with a workbench was found.', true); return; }
  const materials = await loadMaterials();
  if (engine.bench.kind === 'struck-membranes') {
    const { startDrums } = await import('./drums/main.js');
    await startDrums({ engine, entry, engines, materials, audio, preview, tuner });
    return;
  }
  if (engine.bench.kind !== 'plucked-strings') {
    const { startBars } = await import('./bars/main.js');
    await startBars({ engine, entry, engines, materials, audio, preview, tuner });
    return;
  }

  const bench = new Bench(engine, materials);
  const view = new BenchView($('bench-svg'), bench, ui);
  state.bench = bench;
  state.view = view;
  state.sound = new BenchSound({
    context: audio.context, bench,
    onProgress: showProgress,
    onError: (error) => setStatus(`Something went wrong: ${error.message}`, true),
  });
  state.keyboard = new Keyboard($('keys'), {
    onNoteOn: (midi, velocity) => noteOn(midi, velocity),
    onNoteOff: (midi) => noteOff(midi),
    onSustain: (on) => shell.setSustain(on),
    onOctave: (delta) => shell.shiftOctave(delta),
    getVelocity: () => state.velocity,
  }, WINDOW_OCTAVES);
  state.racks = buildRacks({
    bench, view, ui, redraw, status: setStatus, length, settle: (i) => settle(i), wake: () => audio.wake(),
    openDrawer: () => { $('drawer').open = true; },
  }, { woods: $('woods'), metals: $('metals'), strings: $('strings'), parts: $('parts'), hands: $('hands') });
  attachInteraction({
    view, bench, ui, preview, redraw, status: setStatus, length, wake: () => audio.wake(),
    pluck, strumStart, strum, settle: (i) => settle(i),
    tuneNearest: (i) => {
      const info = bench.info(i);
      if (!info.playable) { setStatus('That string is out of range. Turn its peg first.', true); return; }
      bench.tuneTo(i, info.note.midi);
      bench.commit();
      setStatus(`String ${i + 1} tuned to ${info.note.name}.`);
      settle(i);
    },
  });
  bench.onChange((kind) => { if (kind === 'undo') { state.racks.mark(); settle(); } });
  shell = createShell({ engine, engines, bench, view, ui, audio, state, redraw, settle: (i) => settle(i), loadInstrument, exportList, defaultName: 'My guitar' });
  shell.buildMenu();
  shell.wire();
  $('view-neck').addEventListener('click', () => view.fitNeck());
  const pending = takePendingFile();
  if (pending) {
    const opened = parseFile(pending, engines);
    loadInstrument({ name: opened.name, params: opened.params, parts: opened.parts, volumeDb: opened.volumeDb });
  } else {
    loadInstrument({ name: entry.name, params: entry.params, parts: entry.parts });
  }
  buildDrawer();
  refreshDrawer();
}

start();
