// SPDX-License-Identifier: GPL-3.0-only
// The parts of the page every bench shares: the top bar, the menu of instruments on the wall, saving and
// opening, undo, the unit, the player's controls at the bottom, MIDI. Each kind of bench (strings, bars) puts
// its own bench, drawing, racks and way of playing behind them.
import { parseFile, saveFile, saveBytes, toFile } from '../files.js';
import { noteName } from '../keyboard.js';
import { connectMidi } from '../midi.js';
import { renderNote } from '../api.js';
import { scaleWav } from '../wav.js';
import { zipStore } from '../zip.js';
import { MAX_VERSIONS, Versions } from './versions.js';

export const $ = (id) => document.getElementById(id);
export const WINDOW_OCTAVES = 3;
export const MM_PER_INCH = 25.4;
const PENDING = 'studio-open';

export function setStatus(text, isError = false) {
  const node = $('status');
  node.textContent = text;
  node.dataset.error = String(isError);
}

export function showProgress({ total, done }) {
  $('progress').textContent = total && done < total ? `Getting the notes ready: ${done} of ${total}` : total ? 'Notes ready' : '';
}

export const lengthText = (ui, mm) => (ui.unit === 'in' ? `${(mm / MM_PER_INCH).toFixed(2)} in` : `${Math.round(mm)} mm`);

/** Words on the page that depend on the kind of bench. */
export function applyKindText(text) {
  for (const [id, value] of Object.entries(text)) {
    const node = $(id);
    if (!node) continue;
    if (id === 'bench-svg') node.setAttribute('aria-label', value);
    else node.textContent = value;
  }
}

/** The engine to put on the bench: the one in the address (?engine=), else the first that has a workbench. */
export function chooseEngine(engines) {
  const params = new URLSearchParams(location.search);
  const wanted = params.get('engine');
  const benches = engines.filter((e) => e.bench);
  const engine = benches.find((e) => e.id === wanted) ?? benches[0] ?? null;
  const entry = engine?.gallery.find((g) => g.id === params.get('instrument')) ?? engine?.gallery[0];
  return { engine, entry, wanted };
}

/** An instrument saved for another engine, waiting for the page to be reloaded on that engine. */
export function takePendingFile() {
  try {
    const text = sessionStorage.getItem(PENDING);
    sessionStorage.removeItem(PENDING);
    return text;
  } catch { return null; }
}

function goTo(engineId, instrumentId, pending) {
  try { if (pending) sessionStorage.setItem(PENDING, pending); } catch { /* the instrument just won't carry over */ }
  const params = new URLSearchParams({ engine: engineId });
  if (instrumentId) params.set('instrument', instrumentId);
  location.search = params.toString();
}

/**
 * @param app { engine, engines, bench, view, ui, audio, state, redraw(), settle(), loadInstrument(doc), fitText,
 *   defaultName, onUnit(), exportList(velocity) -> [{ midi, spec }]: the notes the keys play at present }
 */
export function createShell(app) {
  const { ui, audio, state } = app;
  const versions = new Versions();

  function closeMenu() {
    for (const name of ['instruments', 'export']) {
      $(`${name}-menu`).hidden = true;
      $(`${name}-button`).setAttribute('aria-expanded', 'false');
    }
  }

  /** Changing to another kind of instrument reloads the page, and the versions on the shelf go with it. */
  const leaveOk = () => versions.count < 2 || confirm('Changing to another kind of instrument closes this bench, and the versions on the shelf with it. Save them first if you want them. Go on?');

  /** Every instrument of every bench engine, grouped by engine. One of another kind reloads the page on its engine. */
  function buildMenu() {
    const menu = $('instruments-menu');
    menu.replaceChildren();
    for (const engine of app.engines.filter((e) => e.bench)) {
      const heading = document.createElement('h3');
      heading.className = 'menu-heading';
      heading.textContent = engine.name;
      menu.append(heading);
      for (const entry of engine.gallery) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'menu-item';
        button.dataset.engine = engine.id;
        button.dataset.instrument = entry.id;
        const title = document.createElement('strong');
        title.textContent = entry.name;
        const text = document.createElement('span');
        text.textContent = entry.description;
        button.append(title, text);
        button.addEventListener('click', () => {
          closeMenu();
          if (engine.id !== app.engine.id) { if (leaveOk()) goTo(engine.id, entry.id); return; }
          if (!bringIn({ name: entry.name, params: entry.params, parts: entry.parts })) return;
          setStatus(`${entry.name}: ${entry.description}`);
        });
        menu.append(button);
      }
    }
  }

  function setSustain(on) {
    audio.setSustain(on);
    $('sustain').setAttribute('aria-pressed', String(on));
  }

  function showWindow() {
    $('octave-label').textContent = `${noteName(state.start)} – ${noteName(state.start + 12 * WINDOW_OCTAVES - 1)}`;
  }

  /** Put the keyboard's window round a range of notes (the lowest, and a little above). */
  function windowTo(range) {
    if (!range) return;
    state.start = Math.max(0, Math.min(132 - 12 * WINDOW_OCTAVES, 12 * Math.round((range.lowMidi + 5) / 12)));
    state.keyboard.setStart(state.start);
    showWindow();
  }

  function shiftOctave(delta) {
    const next = state.start + delta * 12;
    if (next < 0 || next + 12 * WINDOW_OCTAVES > 132) return;
    state.start = next;
    state.keyboard.setStart(next);
    showWindow();
    app.settle();
  }

  /** The name and volume that come with an instrument. */
  function showDocument({ name, volumeDb }) {
    $('instrument-name').value = name;
    $('volume').value = String(volumeDb);
    audio.setVolumeDb(volumeDb);
    $('volume-out').textContent = `${volumeDb > 0 ? '+' : ''}${volumeDb} dB`;
  }

  // ---------------------------------------------------------------- versions: duplicate, and flip between two

  const capture = () => ({ doc: app.bench.toDocument(), history: app.bench.history.slice() });

  function putOnBench(version) {
    app.loadInstrument(version.doc);
    if (version.history.length) app.bench.history = version.history.slice();
    app.redraw();
    showVersions();
  }

  function showVersions() {
    const strip = $('versions');
    strip.hidden = versions.count < 2;
    $('compare').disabled = versions.count < 2;
    if (strip.hidden) return;
    const list = $('versions-list');
    list.replaceChildren();
    for (const version of versions.list) {
      const on = version.id === versions.activeId;
      const chip = document.createElement('span');
      chip.className = 'version';
      const pick = document.createElement('button');
      pick.type = 'button';
      pick.className = 'version-pick';
      pick.setAttribute('aria-pressed', String(on));
      pick.textContent = `${version.number}  ${on ? app.bench.name || version.doc.name : version.doc.name}`;
      pick.title = on ? 'On the bench now' : 'Put this one on the bench';
      pick.addEventListener('click', () => switchTo(version.id));
      chip.append(pick);
      if (!on) {
        const drop = document.createElement('button');
        drop.type = 'button';
        drop.className = 'version-drop';
        drop.setAttribute('aria-label', `Take version ${version.number} off the shelf`);
        drop.textContent = '×';
        drop.title = 'Take it off the shelf';
        drop.addEventListener('click', () => { versions.remove(version.id); showVersions(); });
        chip.append(drop);
      }
      list.append(chip);
    }
  }

  function switchTo(id) {
    const target = versions.switchTo(id, capture());
    if (!target) return;
    putOnBench(target);
    setStatus(`Version ${target.number} is on the bench.`);
  }

  /**
   * Put an instrument from the gallery or a file on the bench. While versions are on the shelf, what is on the bench is
   * kept there and the new one joins it as a version, so no unsaved edit is replaced; a full shelf refuses it in words.
   */
  function bringIn(doc) {
    if (versions.active) {
      if (!versions.adopt(capture(), doc)) { setStatus(`The shelf holds ${MAX_VERSIONS} versions. Take one off it (the × beside it) or save one first: opening another instrument would replace the one on the bench with its edits.`, true); return false; }
      app.loadInstrument(doc);
      showVersions();
      return true;
    }
    app.loadInstrument(doc);
    return true;
  }

  function duplicate() {
    const copy = versions.duplicate(capture());
    if (!copy) { setStatus(`The shelf holds ${MAX_VERSIONS} versions. Take one off it (the × beside it) or save one first, then make the copy.`, true); return; }
    putOnBench(copy);
    setStatus(`Made a copy: it is on the bench as version ${copy.number}, and the one before is on the shelf. Press A/B to flip between them.`);
  }

  function compare() {
    const other = versions.compare(capture());
    if (!other) { setStatus('Make a copy first (Duplicate), then change it and press A/B to compare.'); return; }
    putOnBench(other);
    setStatus(`Version ${other.number} is on the bench.`);
  }

  // ---------------------------------------------------------------- saving the sound as WAV

  const slug = (text) => text.replace(/[^a-z0-9#]+/gi, '-').replace(/^-|-$/g, '') || 'instrument';

  /** One note as the server made it, at the instrument's volume. */
  async function noteWav(item) {
    const { data } = await renderNote({ engine: app.engine.id, params: item.spec.params, note: { midi: item.spec.midi, velocity: item.spec.layer, durationS: state.sound.durationS } });
    return scaleWav(new Uint8Array(data), 10 ** (app.bench.volumeDb / 20));
  }

  function buildExportMenu() {
    const menu = $('export-menu');
    menu.replaceChildren();
    const items = app.exportList(state.velocity);
    if (!items.length) {
      const none = document.createElement('p');
      none.className = 'rack-hint';
      none.textContent = 'Nothing on the keys sounds yet. Change the instrument so a note can be played, then come back.';
      menu.append(none);
      return;
    }
    const chosen = items.find((item) => item.midi === state.lastMidi) ?? items[items.length >> 1];
    const row = document.createElement('label');
    row.className = 'export-row';
    row.textContent = 'Note ';
    const select = document.createElement('select');
    select.id = 'export-note';
    for (const item of items) {
      const option = document.createElement('option');
      option.value = String(item.midi);
      option.textContent = noteName(item.midi);
      option.selected = item === chosen;
      select.append(option);
    }
    row.append(select);
    const one = document.createElement('button');
    one.type = 'button';
    one.id = 'export-one';
    one.textContent = 'Save this note as a WAV';
    one.addEventListener('click', () => saveSounds([items.find((item) => item.midi === Number(select.value))], false));
    const all = document.createElement('button');
    all.type = 'button';
    all.id = 'export-all';
    all.textContent = `Save all ${items.length} notes on the keys (one zip of WAVs)`;
    all.addEventListener('click', () => saveSounds(items, true));
    const hint = document.createElement('p');
    hint.className = 'rack-hint';
    hint.textContent = 'Saved as you hear them: the touch and the volume on the bar below, and the note length chosen there.';
    menu.append(row, one, all, hint);
  }

  async function saveSounds(items, asZip) {
    closeMenu();
    const name = slug(app.bench.name || app.defaultName);
    const files = [];
    let limited = 0;
    try {
      for (const [n, item] of items.entries()) {
        setStatus(items.length > 1 ? `Making the sounds to save: ${n + 1} of ${items.length}…` : 'Making the sound to save…');
        const made = await noteWav(item);
        if (made.limited) limited++;
        files.push({ name: `${name}-${noteName(item.midi).replace('♯', '#')}.wav`, data: made.bytes });
      }
    } catch (error) {
      setStatus(`Could not save the sound: ${error.message}`, true);
      return;
    }
    if (asZip) saveBytes(zipStore(files), `${name}-wavs.zip`, 'application/zip');
    else saveBytes(files[0].data, files[0].name, 'audio/wav');
    const what = asZip ? `${files.length} sounds in ${name}-wavs.zip` : files[0].name;
    setStatus(`Saved ${what}${limited ? `. ${limited === 1 ? 'One was' : `${limited} were`} turned down a little so the volume would not clip.` : '.'}`);
  }

  function wire() {
    const { bench, view } = app;
    $('instruments-button').addEventListener('click', () => {
      const open = $('instruments-menu').hidden;
      closeMenu();
      $('instruments-menu').hidden = !open;
      $('instruments-button').setAttribute('aria-expanded', String(open));
    });
    $('export-button').addEventListener('click', () => {
      const open = $('export-menu').hidden;
      closeMenu();
      if (open) buildExportMenu();
      $('export-menu').hidden = !open;
      $('export-button').setAttribute('aria-expanded', String(open));
    });
    $('duplicate').addEventListener('click', duplicate);
    $('compare').addEventListener('click', compare);
    showVersions();
    document.addEventListener('pointerdown', (event) => { if (!event.target.closest?.('.menu')) closeMenu(); });
    $('undo').addEventListener('click', () => bench.undo());
    $('view-fit').addEventListener('click', () => view.fit());
    $('unit').addEventListener('click', () => {
      ui.unit = ui.unit === 'mm' ? 'in' : 'mm';
      $('unit').textContent = ui.unit;
      app.redraw();
    });
    window.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyZ' && !(event.target instanceof HTMLInputElement)) { event.preventDefault(); bench.undo(); }
      if (event.altKey && event.code === 'KeyB') { event.preventDefault(); compare(); }
    });
    $('instrument-name').addEventListener('input', (event) => { bench.name = event.target.value; showVersions(); });
    $('velocity').addEventListener('input', (event) => { state.velocity = Number(event.target.value); $('velocity-out').textContent = state.velocity.toFixed(2); });
    $('volume').addEventListener('input', (event) => {
      bench.volumeDb = Number(event.target.value);
      audio.setVolumeDb(bench.volumeDb);
      $('volume-out').textContent = `${bench.volumeDb > 0 ? '+' : ''}${bench.volumeDb} dB`;
    });
    $('length').addEventListener('change', (event) => { state.sound.durationS = Number(event.target.value); app.settle(); });
    $('sustain').addEventListener('click', () => setSustain($('sustain').getAttribute('aria-pressed') !== 'true'));
    $('octave-down').addEventListener('click', () => shiftOctave(-1));
    $('octave-up').addEventListener('click', () => shiftOctave(1));
    $('save-file').addEventListener('click', () => {
      const doc = bench.toDocument();
      saveFile(toFile({ ...doc, name: doc.name || app.defaultName }));
    });
    $('open-file').addEventListener('change', async (event) => {
      const [file] = event.target.files;
      event.target.value = '';
      if (!file) return;
      try {
        const text = await file.text();
        const opened = parseFile(text, app.engines);
        if (!opened.engine.bench) throw new Error('That instrument is for the plain panel. Open it from "Other instruments" at the top right.');
        if (opened.engine.id !== app.engine.id) { if (leaveOk()) goTo(opened.engine.id, null, text); return; }
        if (!bringIn({ name: opened.name, params: opened.params, parts: opened.parts, volumeDb: opened.volumeDb })) return;
        setStatus(`Opened ${opened.name}.`);
      } catch (error) {
        setStatus(error.message, true);
      }
    });
    $('midi').addEventListener('click', async () => {
      try {
        await audio.wake();
        await connectMidi({
          onNoteOn: (midi, velocity) => state.keyboard.noteOn(midi, velocity, 'midi'),
          onNoteOff: (midi) => state.keyboard.noteOff(midi, 'midi'),
          onSustain: setSustain,
          onChange: (names) => { $('midi-status').textContent = names.length ? `Listening to: ${names.join(', ')}` : 'No MIDI keyboard found. Plug one in.'; },
        });
      } catch (error) {
        $('midi-status').textContent = error.message;
      }
    });
  }

  return { buildMenu, closeMenu, setSustain, shiftOctave, windowTo, showDocument, wire };
}
