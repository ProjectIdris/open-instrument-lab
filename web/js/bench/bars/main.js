// SPDX-License-Identifier: GPL-3.0-only
// Puts the bars bench together: the bench, the racks, the mallets, the keyboard. Started by ../main.js when the
// engine on the bench is a `struck-bars` one; the top bar, the menu and the player's controls are the shell's.
import { Keyboard } from '../../keyboard.js';
import { buildForm } from '../../form.js';
import { parseFile } from '../../files.js';
import { BarsBench } from './model.js';
import { BarsView } from './draw.js';
import { attachBarsInteraction } from './interact.js';
import { buildBarsRacks } from './racks.js';
import { BarsSound } from './sound.js';
import { $, WINDOW_OCTAVES, setStatus, showProgress, lengthText, applyKindText, takePendingFile, createShell } from '../shell.js';

const HIT_SHOWN_MS = 1000;

const TEXT = {
  'shelf-metals-title': 'Metals and plastic',
  'rack-left-title': 'Bars',
  'rack-left-hint': 'Drag one onto the frame.',
  'hands-title': 'Mallets',
  'parts-title': 'Gouge and tubes',
  'parts-hint': 'Drag the gouge onto a bar to carve its underside, or a tube to hang under it.',
  'tuner-hint': 'Click a bar\'s note tag to cut it to the nearest note.',
  approx: 'The bars\' sound is an approximation worked out from their size and material (thin-beam theory, with the arch worked out by Rayleigh–Ritz). It is not a measured instrument.',
  'bench-svg': 'The bars on the bench. Press a bar to strike it; drag the end of a bar to stretch it; drag the dot under a bar in the side view to carve the arch; drag a tube onto a bar to hang it underneath.',
  'view-fit': 'Whole instrument',
  status: 'Press a bar to strike it where you press, and lift away before you let go for a harder blow. Drag the end of a bar to stretch it, drag the dot under it in the side view to carve it, or drag a bar from the rack onto the frame.',
};

export async function startBars({ engine, entry, engines, materials, audio, preview, tuner }) {
  const ui = { hand: null, handHardness: 0.5, unit: 'mm', selected: 0, hits: new Map(), pointer: null, drop: null, rideTag: null, removing: null, removingTube: false, strikeAim: null };
  const state = { engines, velocity: 0.7, start: 48, bench: null, view: null, sound: null, racks: null, keyboard: null, drawer: null };
  window.__studio = { state, ui, audio, kind: 'struck-bars' };
  applyKindText(TEXT);
  $('view-neck').hidden = true;
  const length = (mm) => lengthText(ui, mm);

  const bench = new BarsBench(engine, materials);
  const view = new BarsView($('bench-svg'), bench, ui);
  state.bench = bench;
  state.view = view;
  state.sound = new BarsSound({ context: audio.context, bench, onProgress: showProgress, onError: (error) => setStatus(`Something went wrong: ${error.message}`, true) });
  let shell = null;

  // ---------------------------------------------------------------- drawing

  let drawQueued = false;
  function redraw() {
    if (drawQueued) return;
    drawQueued = true;
    requestAnimationFrame(() => { drawQueued = false; paint(); });
  }

  function paint() {
    if (!bench.bars[ui.selected]) ui.selected = Math.max(0, bench.bars.length - 1);
    view.render();
    tuner.set(bench.info(ui.selected), `Bar ${ui.selected + 1}, `, 'Strike or cut a bar');
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
      if (error.name !== 'AbortError') setStatus(error.message.startsWith('this bar') ? `That bar cannot sound: ${error.message}` : `Could not make that note: ${error.message}`, true);
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

  /** A blow on bar i, `fraction` of the way from its nearer end (`at` is where along the whole bar, to draw it). */
  function strike(i, fraction, velocity, at = fraction) {
    const info = bench.info(i);
    if (!info.playable) { setStatus('That bar is out of range. Stretch or thicken it first.', true); return; }
    const spec = state.sound.strikeSpec(i, { at: fraction, velocity });
    ui.selected = i;
    ui.hits.set(i, { t0: performance.now(), at });
    startAnimating();
    playSpec(spec, 300 + i);
    redraw();
  }

  /** The sound that follows a change: the bar you were working on, struck. */
  function audition(i) {
    if (i === undefined || !bench.bars[i] || !bench.info(i).playable) return;
    strike(i, bench.params.strikeAt, 0.7, 0.5);
  }

  function settle(playBar) {
    const { sound, keyboard } = state;
    const range = bench.playableRange();
    if (range) keyboard.setRange(range);
    const specs = [];
    bench.bars.forEach((_, i) => { if (bench.info(i).playable) specs.push(sound.strikeSpec(i, { velocity: 0.7 })); });
    sound.prefetch(specs);
    if (playBar !== undefined) audition(playBar);
    redraw();
  }

  /** The notes the keys play now (a bar for each), with the note to ask the server for, so they can be saved as WAV files. */
  function exportList(velocity) {
    const out = [];
    for (let midi = state.start; midi < state.start + 12 * WINDOW_OCTAVES; midi++) {
      const i = bench.barForMidi(midi);
      if (i !== null) out.push({ midi, spec: state.sound.strikeSpec(i, { velocity }) });
    }
    return out;
  }

  function noteOn(midi, velocity) {
    const i = bench.barForMidi(midi);
    if (i === null) { setStatus('No bar is cut to that note. Click a bar\'s note tag to cut it to a note.'); return; }
    state.lastMidi = midi;
    audio.noteHeld(midi);
    ui.selected = i;
    const spec = state.sound.strikeSpec(i, { velocity });
    ui.hits.set(i, { t0: performance.now(), at: bench.params.strikeAt });
    startAnimating();
    playSpec(spec, midi);
    redraw();
  }

  function noteOff(midi) {
    audio.release(midi);
    redraw();
  }

  /** Click on a note tag: cut the bar to its nearest note. */
  function cutNearest(i) {
    const info = bench.info(i);
    if (!info.playable) { setStatus('That bar is out of range. Stretch or thicken it first.', true); return; }
    const was = info.note.cents;
    if (bench.cutTo(i)) {
      bench.commit();
      setStatus(was === 0 ? `Bar ${i + 1} is already cut to ${info.note.name}.` : `Bar ${i + 1} cut to ${info.note.name} (it was ${was > 0 ? '+' : '−'}${Math.abs(was)}¢).`);
      settle(i);
    } else {
      setStatus('That note is outside what a bar of this make can be cut to. Change its thickness or material.', true);
    }
  }

  // ---------------------------------------------------------------- the drawer

  function buildDrawer() {
    const sharedParams = bench.schema.params.filter((p) => p.part === undefined && (p.layer === 'advanced' || p.role === 'strikeAt'));
    const barParams = bench.schema.params.filter((p) => p.part !== undefined && !p.onBench);
    const dummy = document.createElement('div');
    const shared = buildForm({
      schema: bench.formSchema(sharedParams), plainEl: $('drawer-shared'), advancedEl: dummy, values: bench.params,
      onInput: (id, value) => { bench.set({ [id]: value }); },
      onCommit: () => { bench.commit(); settle(ui.selected); },
    });
    const perBar = buildForm({
      schema: bench.formSchema(barParams), plainEl: $('drawer-string'), advancedEl: dummy, values: bench.bars[ui.selected] ?? bench.defaultBar(),
      onInput: (id, value) => { bench.setBar(ui.selected, { [id]: value }); },
      onCommit: () => { bench.commit(); settle(ui.selected); },
    });
    state.drawer = { shared, perBar };
  }

  function refreshDrawer() {
    const { drawer } = state;
    if (!drawer) return;
    drawer.shared.update(bench.params);
    const b = bench.bars[ui.selected];
    if (b) drawer.perBar.update(b);
    $('drawer-string').hidden = !b;
    $('drawer-string-title').hidden = !b;
    $('drawer-string-title').textContent = b ? `Bar ${ui.selected + 1}` : '';
  }

  // ---------------------------------------------------------------- instruments and files

  function loadInstrument({ name, params, parts, volumeDb = 0 }) {
    bench.load({ name, params, parts, volumeDb });
    ui.selected = 0;
    ui.hits.clear();
    shell.showDocument({ name, volumeDb });
    state.racks.mark();
    shell.windowTo(bench.playableRange());
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
  state.racks = buildBarsRacks({
    bench, view, ui, redraw, status: setStatus, length, settle: (i) => settle(i), wake: () => audio.wake(),
    openDrawer: () => { $('drawer').open = true; },
  }, { woods: $('woods'), metals: $('metals'), bars: $('strings'), parts: $('parts'), hands: $('hands') });
  $('parts').closest('[data-parts]').hidden = false;
  attachBarsInteraction({
    view, bench, ui, preview, redraw, status: setStatus, length, wake: () => audio.wake(),
    strike, settle: (i) => settle(i), cutNearest,
  });
  bench.onChange((kind) => { if (kind === 'undo') { state.racks.mark(); settle(); } });
  shell = createShell({ engine, engines, bench, view, ui, audio, state, redraw, settle: (i) => settle(i), loadInstrument, exportList, defaultName: 'My bars' });
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
