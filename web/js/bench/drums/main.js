// SPDX-License-Identifier: GPL-3.0-only
// Puts the drums bench together: the bench, the racks, the sticks, the keyboard. Started by ../main.js when the
// engine on the bench is a `struck-membranes` one; the top bar, the menu and the player's controls are the shell's.
import { Keyboard } from '../../keyboard.js';
import { buildForm } from '../../form.js';
import { parseFile } from '../../files.js';
import { DrumsBench } from './model.js';
import { DrumsView } from './draw.js';
import { attachDrumsInteraction } from './interact.js';
import { buildDrumsRacks } from './racks.js';
import { DrumsSound } from './sound.js';
import { $, WINDOW_OCTAVES, setStatus, showProgress, lengthText, applyKindText, takePendingFile, createShell } from '../shell.js';

const HIT_SHOWN_MS = 1000;

const TEXT = {
  'shelf-metals-title': 'Metals',
  'rack-left-title': 'Drums',
  'rack-left-hint': 'Drag one onto the row.',
  'hands-title': 'Sticks and beaters',
  'tuner-hint': 'Click a drum\'s note tag to tune its head to the nearest note.',
  approx: 'The drums\' sound is an approximation worked out from the head and the air round it: a circular membrane\'s modes, loaded by the air it moves, with an air spring in a closed shell. Up to two and a half thousand modes of each head are kept, and the air between two heads is a spring that ties their modes together. The stick is a mass on a contact spring, and the microphone hears the near field of the head. A snare\'s wires are coil segments that lift off the second head and land on it again, and ring; their level and pitches are chosen against a recording. The shell is rigid. It is not a measured instrument.',
  'bench-svg': 'The drums on the bench. Press a head to strike it where you press; drag round a lug to tighten the head; drag the hoop to change the width; in the side view drag the dot under the shell for the depth, the dot at the head for its thickness; click the bottom to cycle open, a second head, closed.',
  'view-fit': 'Whole instrument',
  status: 'Press a head to strike it where you press, and lift away before you let go for a harder blow. Drag round a lug to tension the head, the hoop to make it wider, or the dot under the side view for the depth. Drop film on a head, wood or metal on a shell.',
};

export async function startDrums({ engine, entry, engines, materials, audio, preview, tuner }) {
  const ui = { hand: null, handHardness: 0.5, unit: 'mm', selected: 0, hits: new Map(), pointer: null, drop: null, rideTag: null, removing: null, strikeAim: null, pin: null };
  const state = { engines, velocity: 0.7, start: 48, bench: null, view: null, sound: null, racks: null, keyboard: null, drawer: null };
  window.__studio = { state, ui, audio, kind: 'struck-membranes' };
  applyKindText(TEXT);
  $('view-neck').hidden = true;
  $('shelf-extras').hidden = false;
  const length = (mm) => lengthText(ui, mm);

  const bench = new DrumsBench(engine, materials);
  const view = new DrumsView($('bench-svg'), bench, ui);
  state.bench = bench;
  state.view = view;
  state.sound = new DrumsSound({ context: audio.context, bench, onProgress: showProgress, onError: (error) => setStatus(`Something went wrong: ${error.message}`, true) });
  let shell = null;

  // ---------------------------------------------------------------- drawing

  let drawQueued = false;
  function redraw() {
    if (drawQueued) return;
    drawQueued = true;
    requestAnimationFrame(() => { drawQueued = false; paint(); });
  }

  function paint() {
    if (!bench.drums[ui.selected]) ui.selected = Math.max(0, bench.drums.length - 1);
    view.render();
    tuner.set(bench.info(ui.selected), `Drum ${ui.selected + 1}, `, 'Strike or tune a drum');
    $('undo').disabled = !bench.canUndo;
    refreshDrawer();
  }

  let animating = false;
  function animate() {
    const now = performance.now();
    for (const [i, h] of ui.hits) if (now - h.t0 > HIT_SHOWN_MS) ui.hits.delete(i);
    if (!ui.hits.size) { animating = false; paint(); return; }
    view.render();
    requestAnimationFrame(animate);
  }
  function startAnimating() {
    if (animating) return;
    animating = true;
    requestAnimationFrame(animate);
  }

  // ---------------------------------------------------------------- playing

  /** What to play for a blow: the exact one if it is made, a neighbouring one at once while the exact one is made, or a promise of it. */
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
      if (error.name !== 'AbortError') setStatus(error.message.startsWith('this drum') ? `That drum cannot sound: ${error.message}` : `Could not make that note: ${error.message}`, true);
      return null;
    });
  }

  async function playSpec(spec, voice) {
    await audio.wake();
    const sound = await soundFor(spec);
    if (!sound) return null;
    audio.play(voice, sound.buffer, sound.gain, 0);
    return sound.buffer;
  }

  /** A blow on drum i at `place` ({ at: of the radius, angle: degrees round }). */
  function strike(i, place, velocity) {
    const info = bench.info(i);
    if (!info.playable) { setStatus('That drum is out of range. Tighten or slacken the head first.', true); return; }
    const spec = state.sound.strikeSpec(i, { at: place.at, angle: place.angle, velocity });
    ui.selected = i;
    ui.hits.set(i, { t0: performance.now(), at: { r: place.at, angle: (place.angle * Math.PI) / 180 } });
    startAnimating();
    playSpec(spec, 300 + i);
    redraw();
  }

  /** The sound that follows a change: the drum you were working on, struck. */
  function audition(i) {
    if (i === undefined || !bench.drums[i] || !bench.info(i).playable) return;
    strike(i, { at: bench.params.strikeAt, angle: bench.params.strikeAngle }, 0.7);
  }

  function settle(playDrum) {
    const { sound, keyboard } = state;
    const range = bench.playableRange();
    if (range) keyboard.setRange(range);
    const specs = [];
    bench.drums.forEach((_, i) => { if (bench.info(i).playable) specs.push(sound.strikeSpec(i, { velocity: 0.7 })); });
    sound.prefetch(specs);
    if (view.autoFit) view.fit();
    if (playDrum !== undefined) audition(playDrum);
    redraw();
  }

  /** The notes the keys play now (a drum for each), with the note to ask the server for, so they can be saved as WAV files. */
  function exportList(velocity) {
    const out = [];
    for (let midi = state.start; midi < state.start + 12 * WINDOW_OCTAVES; midi++) {
      const i = bench.drumForMidi(midi);
      if (i !== null) out.push({ midi, spec: state.sound.strikeSpec(i, { velocity }) });
    }
    return out;
  }

  function noteOn(midi, velocity) {
    const i = bench.drumForMidi(midi);
    if (i === null) { setStatus('No drum is tuned to that note. Click a drum\'s note tag to tune it to a note.'); return; }
    state.lastMidi = midi;
    audio.noteHeld(midi);
    ui.selected = i;
    const spec = state.sound.strikeSpec(i, { velocity });
    ui.hits.set(i, { t0: performance.now(), at: { r: bench.params.strikeAt, angle: (bench.params.strikeAngle * Math.PI) / 180 } });
    startAnimating();
    playSpec(spec, midi);
    redraw();
  }

  function noteOff(midi) {
    audio.release(midi);
    redraw();
  }

  /** Click on a note tag: tune the drum to its nearest note. */
  function tuneNearest(i) {
    const info = bench.info(i);
    if (!info.playable) { setStatus('That drum is out of range. Tighten or slacken the head first.', true); return; }
    const was = info.note.cents;
    if (bench.tuneTo(i)) {
      bench.commit();
      setStatus(was === 0 ? `Drum ${i + 1} is already tuned to ${info.note.name}.` : `Drum ${i + 1} tuned to ${info.note.name} (it was ${was > 0 ? '+' : '−'}${Math.abs(was)}¢).`);
      settle(i);
    } else {
      setStatus('That note is outside what a head of this make can be tuned to. Change its size, thickness or the shell\'s depth.', true);
    }
  }

  // ---------------------------------------------------------------- the drawer

  function buildDrawer() {
    const sharedParams = bench.schema.params.filter((p) => p.part === undefined && (p.layer === 'advanced' || p.role === 'strikeAt' || p.role === 'strikeAngle'));
    const drumParams = bench.schema.params.filter((p) => p.part !== undefined && !p.onBench);
    const dummy = document.createElement('div');
    const shared = buildForm({
      schema: bench.formSchema(sharedParams), plainEl: $('drawer-shared'), advancedEl: dummy, values: bench.params,
      onInput: (id, value) => { bench.set({ [id]: value }); },
      onCommit: () => { bench.commit(); settle(ui.selected); },
    });
    const perDrum = buildForm({
      schema: bench.formSchema(drumParams), plainEl: $('drawer-string'), advancedEl: dummy, values: bench.drums[ui.selected] ?? bench.defaultDrum(),
      onInput: (id, value) => { bench.setDrum(ui.selected, { [id]: value }); },
      onCommit: () => { bench.commit(); settle(ui.selected); },
    });
    state.drawer = { shared, perDrum };
  }

  function refreshDrawer() {
    const { drawer } = state;
    if (!drawer) return;
    drawer.shared.update(bench.params);
    const d = bench.drums[ui.selected];
    if (d) drawer.perDrum.update(d);
    $('drawer-string').hidden = !d;
    $('drawer-string-title').hidden = !d;
    $('drawer-string-title').textContent = d ? `Drum ${ui.selected + 1}` : '';
  }

  // ---------------------------------------------------------------- instruments and files

  function loadInstrument({ name, params, parts, volumeDb = 0 }) {
    bench.load({ name, params, parts, volumeDb });
    ui.selected = 0;
    ui.hits.clear();
    shell.showDocument({ name, volumeDb });
    state.racks.mark();
    // The keys start at the octave the lowest drum is in, so every drum is on them.
    const range = bench.playableRange();
    shell.windowTo(range && { ...range, lowMidi: 12 * Math.floor(range.lowMidi / 12) - 5 });
    view.fit();
    settle();
  }

  // ---------------------------------------------------------------- start

  state.keyboard = new Keyboard($('keys'), {
    onNoteOn: (midi, velocity) => noteOn(midi, velocity),
    onNoteOff: (midi) => noteOff(midi),
    onSustain: (on) => shell.setSustain(on),
    onOctave: (delta) => shell.shiftOctave(delta),
    getVelocity: () => state.velocity,
  }, WINDOW_OCTAVES);
  state.racks = buildDrumsRacks({
    bench, view, ui, redraw, status: setStatus, length, settle: (i) => settle(i), wake: () => audio.wake(),
    openDrawer: () => { $('drawer').open = true; },
  }, { woods: $('woods'), metals: $('metals'), extras: $('extras'), drums: $('strings'), hands: $('hands') });
  attachDrumsInteraction({
    view, bench, ui, preview, redraw, status: setStatus, length, wake: () => audio.wake(),
    strike, settle: (i) => settle(i), tuneNearest,
  });
  bench.onChange((kind) => { if (kind === 'undo') { state.racks.mark(); settle(); } });
  shell = createShell({ engine, engines, bench, view, ui, audio, state, redraw, settle: (i) => settle(i), loadInstrument, exportList, defaultName: 'My drums' });
  shell.buildMenu();
  shell.wire();
  const pending = takePendingFile();
  if (pending) {
    const opened = parseFile(pending, engines);
    loadInstrument({ name: opened.name, params: opened.params, parts: opened.parts, volumeDb: opened.volumeDb });
  } else {
    loadInstrument({ name: entry.name, params: entry.params, parts: entry.parts });
  }
  buildDrawer();
  refreshDrawer();
  setStatus(TEXT.status);
}
