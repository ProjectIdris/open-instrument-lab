// SPDX-License-Identifier: GPL-3.0-only
// Web Audio output: voices, master volume and an analyser for the displays.

const MAX_VOICES = 32;

export class AudioOut {
  constructor() {
    this.context = new AudioContext({ latencyHint: 'interactive' });
    this.master = this.context.createGain();
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 4096;
    this.analyser.smoothingTimeConstant = 0.6;
    this.master.connect(this.analyser);
    this.analyser.connect(this.context.destination);
    this.voices = new Set();
    this.byMidi = new Map();
    this.sustain = false;
    this.held = new Set();
    this.lastSoundAt = 0;
  }

  /** Browsers only start audio after a click or key press. */
  async wake() {
    if (this.context.state !== 'running') await this.context.resume();
  }

  setVolumeDb(db) {
    this.master.gain.setTargetAtTime(10 ** (db / 20), this.context.currentTime, 0.02);
  }

  /** Start a note. `gain` scales the buffer (used when borrowing a neighbouring touch layer). */
  play(midi, buffer, gain = 1, when = 0) {
    const ctx = this.context;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const level = ctx.createGain();
    level.gain.value = gain;
    source.connect(level).connect(this.master);
    const voice = { midi, source, level, ended: false, released: false };
    source.onended = () => { voice.ended = true; this.voices.delete(voice); if (this.byMidi.get(midi) === voice) this.byMidi.delete(midi); };
    const previous = this.byMidi.get(midi);
    if (previous) this.#fade(previous, 0.03);
    this.byMidi.set(midi, voice);
    this.voices.add(voice);
    if (this.voices.size > MAX_VOICES) this.#fade(this.voices.values().next().value, 0.05);
    source.start(when || ctx.currentTime);
    this.lastSoundAt = performance.now();
    return voice;
  }

  #fade(voice, seconds) {
    if (voice.ended || voice.released) return;
    voice.released = true;
    const now = this.context.currentTime;
    voice.level.gain.cancelScheduledValues(now);
    voice.level.gain.setValueAtTime(voice.level.gain.value, now);
    voice.level.gain.linearRampToValueAtTime(0, now + seconds);
    try { voice.source.stop(now + seconds + 0.01); } catch { /* already stopped */ }
  }

  /** Key released: damp the note unless sustain is held. */
  release(midi, seconds = 0.35) {
    this.held.delete(midi);
    const voice = this.byMidi.get(midi);
    if (!voice) return;
    if (this.sustain) { voice.sustained = true; return; }
    this.#fade(voice, seconds);
  }

  setSustain(on) {
    this.sustain = on;
    if (on) return;
    for (const voice of this.voices) if (voice.sustained && !this.held.has(voice.midi)) { voice.sustained = false; this.#fade(voice, 0.35); }
  }

  noteHeld(midi) { this.held.add(midi); }

  get isSounding() { return performance.now() - this.lastSoundAt < 6000; }
}
