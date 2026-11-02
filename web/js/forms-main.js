// SPDX-License-Identifier: GPL-3.0-only
// Puts the pieces together.
import { loadEngines, describeInstrument } from './api.js';
import { AudioOut } from './audio.js';
import { buildForm } from './form.js';
import { Keyboard, noteName } from './keyboard.js';
import { Renderer, layerFor, VELOCITY_LAYERS } from './renderer.js';
import { Scope } from './scope.js';
import { connectMidi } from './midi.js';
import { parseFile, saveFile, toFile } from './files.js';
import { defaults, normalizeParams } from '/shared/schema.mjs';

const $ = (id) => document.getElementById(id);
const WINDOW_OCTAVES = 3;
const TUNE = [0, 4, 7, 12, 9, 7, 4, 2, 0, 4, 7, 11, 12];
const TUNE_STEP_S = 0.34;

const audio = new AudioOut();
const scope = new Scope({ wave: $('wave'), spectrum: $('spectrum'), audio });
const state = {
  engines: [], engine: null, name: '', blurb: '', params: {}, start: null, volumeDb: 0, velocity: 0.7, durationS: 2.4,
  range: { lowMidi: 0, highMidi: 127 }, form: null, original: null, ready: false,
};
window.__studio = { state, audio }; // handy for debugging in the console

const renderer = new Renderer({
  context: audio.context,
  onProgress: ({ total, done }) => showProgress(total, done),
  onError: (error) => setStatus(`Something went wrong: ${error.message}`, true),
});

function setStatus(text, isError = false) {
  const el = $('status');
  el.textContent = text;
  el.dataset.error = isError ? 'true' : 'false';
}

function showProgress(total, done) {
  const percent = total ? Math.round((done / total) * 100) : 0;
  $('progress-bar').style.width = `${percent}%`;
  $('progress-bar').parentElement.setAttribute('aria-valuenow', String(percent));
  if (!state.ready) return;
  if (total && done < total) setStatus(`Getting the keyboard ready: ${done} of ${total} notes. You can already play.`);
  else setStatus('Ready. Play a key on the screen or the computer keyboard.');
}

function windowMidis() {
  const out = [];
  for (let m = state.start; m < state.start + 12 * WINDOW_OCTAVES; m++) if (m >= state.range.lowMidi && m <= state.range.highMidi) out.push(m);
  return out;
}

function previewMidi() {
  const { lowMidi, highMidi } = state.range;
  const target = Math.round(lowMidi + 0.35 * (highMidi - lowMidi));
  const inWindow = windowMidis();
  return inWindow.reduce((best, m) => (Math.abs(m - target) < Math.abs(best - target) ? m : best), inWindow[0] ?? target);
}

// ---------------------------------------------------------------- playing

const pressedAt = new Map();

async function noteOn(midi, velocity) {
  await audio.wake();
  audio.noteHeld(midi);
  pressedAt.set(midi, performance.now());
  const layer = layerFor(velocity);
  const exact = renderer.get(midi, layer);
  if (exact) { audio.play(midi, exact, 1); scope.start(); return; }
  // Borrow another touch layer of the same note, scaled, while the right one is made.
  const other = VELOCITY_LAYERS.find((l) => renderer.get(midi, l));
  if (other) {
    audio.play(midi, renderer.get(midi, other), velocity / other);
    scope.start();
    renderer.request(midi, layer, 1).catch(() => {});
    return;
  }
  keyboard.mark(midi, { pending: true });
  try {
    const buffer = await renderer.request(midi, layer, 0);
    keyboard.mark(midi, { pending: false });
    const heldNow = audio.held.has(midi) || performance.now() - pressedAt.get(midi) < 600;
    if (heldNow) { audio.play(midi, buffer, 1); scope.start(); if (!audio.held.has(midi)) audio.release(midi); }
  } catch (error) {
    keyboard.mark(midi, { pending: false });
    if (error.name !== 'AbortError') setStatus(`Could not make that note: ${error.message}`, true);
  }
}

function noteOff(midi) {
  audio.release(midi);
}

const keyboard = new Keyboard($('keys'), {
  onNoteOn: (midi, velocity) => noteOn(midi, velocity),
  onNoteOff: (midi) => noteOff(midi),
  onSustain: (on) => setSustain(on),
  onOctave: (delta) => shiftOctave(delta),
  getVelocity: () => state.velocity,
}, WINDOW_OCTAVES);

function setSustain(on) {
  audio.setSustain(on);
  $('sustain').setAttribute('aria-pressed', String(on));
}

function shiftOctave(delta) {
  const next = state.start + delta * 12;
  if (next < 0 || next + 12 * WINDOW_OCTAVES > 132) return;
  state.start = next;
  keyboard.setStart(next);
  updateOctaveLabel();
  renderer.prefetch(windowMidis(), 0.7);
}

function updateOctaveLabel() {
  $('octave-label').textContent = `${noteName(state.start)} – ${noteName(state.start + 12 * WINDOW_OCTAVES - 1)}`;
}

async function playTune() {
  await audio.wake();
  const root = state.start + 12;
  const midis = TUNE.map((step) => root + step).filter((m) => m >= state.range.lowMidi && m <= state.range.highMidi);
  if (!midis.length) return;
  setStatus('Getting the tune ready…');
  try {
    const buffers = await Promise.all(midis.map((m) => renderer.request(m, 0.7, 0)));
    const t0 = audio.context.currentTime + 0.1;
    midis.forEach((m, i) => {
      audio.play(m, buffers[i], 1, t0 + i * TUNE_STEP_S);
      setTimeout(() => { keyboard.mark(m, { down: true }); setTimeout(() => keyboard.mark(m, { down: false }), 180); }, (t0 - audio.context.currentTime + i * TUNE_STEP_S) * 1000);
    });
    scope.start();
    setStatus('Playing a short tune.');
    setTimeout(() => showProgress(renderer.progress.total, renderer.progress.done), midis.length * TUNE_STEP_S * 1000 + 800);
  } catch (error) {
    setStatus(`Could not play the tune: ${error.message}`, true);
  }
}

async function audition() {
  await audio.wake();
  const midi = previewMidi();
  try {
    const buffer = await renderer.request(midi, 0.7, 0);
    audio.play(midi, buffer, 1);
    scope.start();
  } catch (error) {
    if (error.name !== 'AbortError') setStatus(`Could not make a note: ${error.message}`, true);
  }
}

// ------------------------------------------------------- choosing and editing

async function applyInstrument({ auditionAfter }) {
  state.ready = false;
  setStatus('Making the first note…');
  try {
    state.range = await describeInstrument({ engine: state.engine.id, params: state.params });
  } catch (error) {
    setStatus(`This combination cannot be played: ${error.message}`, true);
    return;
  }
  keyboard.setRange(state.range);
  if (state.start === null || !windowMidis().length) {
    const target = Math.round(state.range.lowMidi + 0.35 * (state.range.highMidi - state.range.lowMidi));
    state.start = Math.max(0, Math.min(132 - 12 * WINDOW_OCTAVES, Math.round((target - 6) / 12) * 12));
    keyboard.setStart(state.start);
  }
  keyboard.setRange(state.range);
  updateOctaveLabel();
  renderer.setInstrument({ engine: state.engine.id, params: state.params, durationS: state.durationS });
  state.ready = true;
  if (auditionAfter) await audition();
  renderer.prefetch(windowMidis(), 0.7);
}

function selectInstrument({ engine, name, blurb, params, volumeDb = 0, auditionAfter = true }) {
  state.engine = engine;
  state.name = name;
  state.blurb = blurb;
  state.params = normalizeParams(engine.schema, params);
  state.original = structuredClone(state.params);
  state.volumeDb = volumeDb;
  $('volume').value = String(volumeDb);
  updateVolumeLabel();
  $('instrument-name').value = name;
  $('instrument-blurb').textContent = blurb;
  state.form = buildForm({
    schema: engine.schema,
    plainEl: $('plain-controls'),
    advancedEl: $('advanced-controls'),
    values: state.params,
    onInput: (id, value) => { state.params[id] = value; state.form.update(state.params); },
    onCommit: () => { applyInstrument({ auditionAfter: $('auto-audition').checked }); },
  });
  markGallery();
  return applyInstrument({ auditionAfter });
}

function markGallery() {
  for (const card of document.querySelectorAll('.card')) card.setAttribute('aria-current', String(card.dataset.engine === state.engine.id && card.dataset.name === state.name));
}

function buildGallery() {
  const gallery = $('gallery');
  gallery.replaceChildren();
  for (const engine of state.engines) {
    const heading = document.createElement('div');
    heading.className = 'card-group';
    heading.textContent = engine.name;
    gallery.append(heading);
    for (const entry of engine.gallery) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'card';
      card.dataset.engine = engine.id;
      card.dataset.name = entry.name;
      card.setAttribute('role', 'listitem');
      const title = document.createElement('strong');
      title.textContent = entry.name;
      const text = document.createElement('span');
      text.textContent = entry.description;
      card.append(title, text);
      card.addEventListener('click', () => {
        audio.wake();
        selectInstrument({ engine, name: entry.name, blurb: entry.description, params: { ...defaults(engine.schema), ...entry.params } });
      });
      gallery.append(card);
    }
  }
}

function updateVolumeLabel() {
  $('volume-out').textContent = `${state.volumeDb > 0 ? '+' : ''}${state.volumeDb} dB`;
  audio.setVolumeDb(state.volumeDb);
}

// -------------------------------------------------------------- wiring up

$('audition').addEventListener('click', audition);
$('phrase').addEventListener('click', playTune);
$('octave-down').addEventListener('click', () => shiftOctave(-1));
$('octave-up').addEventListener('click', () => shiftOctave(1));
$('sustain').addEventListener('click', () => setSustain($('sustain').getAttribute('aria-pressed') !== 'true'));
$('velocity').addEventListener('input', (event) => { state.velocity = Number(event.target.value); $('velocity-out').textContent = state.velocity.toFixed(2); });
$('volume').addEventListener('input', (event) => { state.volumeDb = Number(event.target.value); updateVolumeLabel(); });
$('length').addEventListener('change', (event) => { state.durationS = Number(event.target.value); applyInstrument({ auditionAfter: $('auto-audition').checked }); });
$('instrument-name').addEventListener('input', (event) => { state.name = event.target.value; });
$('reset').addEventListener('click', () => {
  state.params = structuredClone(state.original);
  state.form.update(state.params);
  applyInstrument({ auditionAfter: true });
});
$('save-file').addEventListener('click', () => saveFile(toFile({ name: state.name || 'My instrument', engine: state.engine.id, params: state.params, volumeDb: state.volumeDb })));
$('open-file').addEventListener('change', async (event) => {
  const [file] = event.target.files;
  event.target.value = '';
  if (!file) return;
  try {
    const opened = parseFile(await file.text(), state.allEngines);
    if (opened.engine.bench) throw new Error('That instrument is built on the workbench. Open it on the workbench page.');
    await selectInstrument({ engine: opened.engine, name: opened.name, blurb: 'Opened from a file.', params: opened.params, volumeDb: opened.volumeDb });
  } catch (error) {
    setStatus(error.message, true);
  }
});
$('midi').addEventListener('click', async () => {
  try {
    await audio.wake();
    await connectMidi({
      onNoteOn: (midi, velocity) => keyboard.noteOn(midi, velocity, 'midi'),
      onNoteOff: (midi) => keyboard.noteOff(midi, 'midi'),
      onSustain: setSustain,
      onChange: (names) => { $('midi-status').textContent = names.length ? `Listening to: ${names.join(', ')}` : 'No MIDI keyboard found. Plug one in.'; },
    });
  } catch (error) {
    $('midi-status').textContent = error.message;
  }
});

async function start() {
  try {
    const { engines, problems } = await loadEngines();
    state.allEngines = engines;
    state.engines = engines.filter((e) => !e.bench); // instruments with a workbench are built there
    if (problems.length) {
      $('problems').hidden = false;
      $('problems').textContent = `${problems.length} plug-in${problems.length > 1 ? 's' : ''} could not be loaded: ${problems.map((p) => p.message).join('; ')}`;
    }
    if (!engines.length) { setStatus('No instrument engines were found.', true); return; }
    buildGallery();
    scope.draw();
    const first = engines[0];
    const entry = first.gallery[0];
    await selectInstrument({ engine: first, name: entry.name, blurb: entry.description, params: { ...defaults(first.schema), ...entry.params }, auditionAfter: false });
    showProgress(renderer.progress.total, renderer.progress.done);
  } catch (error) {
    setStatus(`Could not start: ${error.message}`, true);
  }
}
start();
