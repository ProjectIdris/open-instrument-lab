// SPDX-License-Identifier: GPL-3.0-only
// Waveform and spectrum displays, drawn from the audio analyser.

function colors() {
  const style = getComputedStyle(document.documentElement);
  return { line: style.getPropertyValue('--accent').trim() || '#b4491f', grid: style.getPropertyValue('--line').trim() || '#ddd', ink: style.getPropertyValue('--muted').trim() || '#666' };
}

export class Scope {
  constructor({ wave, spectrum, audio }) {
    this.wave = wave;
    this.spectrum = spectrum;
    this.audio = audio;
    this.time = new Float32Array(audio.analyser.fftSize);
    this.freq = new Float32Array(audio.analyser.frequencyBinCount);
    this.running = false;
    this.loop = this.loop.bind(this);
  }

  start() {
    if (this.running) return;
    this.running = true;
    requestAnimationFrame(this.loop);
  }

  loop() {
    this.draw();
    if (this.audio.isSounding) requestAnimationFrame(this.loop);
    else { this.running = false; this.draw(); }
  }

  draw() {
    const { analyser, context } = this.audio;
    analyser.getFloatTimeDomainData(this.time);
    analyser.getFloatFrequencyData(this.freq);
    const c = colors();
    this.#drawWave(c);
    this.#drawSpectrum(c, context.sampleRate);
  }

  #drawWave({ line, grid }) {
    const ctx = this.wave.getContext('2d');
    const { width, height } = this.wave;
    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = grid; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, height / 2); ctx.lineTo(width, height / 2); ctx.stroke();
    // Start the trace where the signal rises through zero so it holds still.
    let start = 0;
    for (let i = 1; i < this.time.length / 2; i++) if (this.time[i - 1] < 0 && this.time[i] >= 0) { start = i; break; }
    const shown = 1024;
    ctx.strokeStyle = line; ctx.lineWidth = 2; ctx.beginPath();
    for (let x = 0; x < width; x++) {
      const v = this.time[start + Math.floor((x / width) * shown)] ?? 0;
      const y = height / 2 - v * (height / 2) * 0.95;
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  #drawSpectrum({ line, grid, ink }, sampleRate) {
    const ctx = this.spectrum.getContext('2d');
    const { width, height } = this.spectrum;
    ctx.clearRect(0, 0, width, height);
    const low = 30; const high = Math.min(16000, sampleRate / 2);
    const binHz = sampleRate / this.audio.analyser.fftSize;
    ctx.strokeStyle = grid; ctx.fillStyle = ink; ctx.lineWidth = 1; ctx.font = '11px system-ui';
    for (const hz of [100, 1000, 10000]) {
      const x = (Math.log(hz / low) / Math.log(high / low)) * width;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height - 14); ctx.stroke();
      ctx.fillText(hz >= 1000 ? `${hz / 1000} kHz` : `${hz} Hz`, x + 3, height - 3);
    }
    ctx.fillStyle = line;
    const floor = -100;
    for (let x = 0; x < width; x += 2) {
      const hz = low * (high / low) ** (x / width);
      const next = low * (high / low) ** ((x + 2) / width);
      let peak = floor;
      for (let b = Math.floor(hz / binHz); b <= Math.max(Math.floor(hz / binHz), Math.floor(next / binHz)); b++) peak = Math.max(peak, this.freq[b] ?? floor);
      const level = Math.min(1, Math.max(0, (peak - floor) / 100));
      ctx.fillRect(x, height - 14 - level * (height - 18), 2, level * (height - 18));
    }
  }
}
