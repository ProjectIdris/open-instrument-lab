// SPDX-License-Identifier: GPL-3.0-only
// A cheap, immediate tone that follows the hand while a string is being
// changed. It is only a stand-in (a plain buzzy wave at the string's pitch);
// the real plucked sound is made when the hand lets go.

const LOW_HZ = 20;
const HIGH_HZ = 5000;

export class PreviewTone {
  constructor(audio) {
    this.audio = audio;
    this.node = null;
  }

  start(hz) {
    if (this.node) return;
    const ctx = this.audio.context;
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    filter.type = 'lowpass';
    filter.Q.value = 0.5;
    gain.gain.value = 0;
    osc.connect(filter).connect(gain).connect(this.audio.master);
    const now = ctx.currentTime;
    osc.frequency.value = clamp(hz);
    filter.frequency.value = Math.min(6000, clamp(hz) * 5);
    gain.gain.setTargetAtTime(0.05, now, 0.01);
    osc.start();
    this.node = { osc, filter, gain };
  }

  set(hz) {
    if (!this.node) return;
    const now = this.audio.context.currentTime;
    this.node.osc.frequency.setTargetAtTime(clamp(hz), now, 0.015);
    this.node.filter.frequency.setTargetAtTime(Math.min(6000, clamp(hz) * 5), now, 0.015);
  }

  stop() {
    if (!this.node) return;
    const { osc, gain } = this.node;
    const now = this.audio.context.currentTime;
    gain.gain.setTargetAtTime(0, now, 0.03);
    osc.stop(now + 0.25);
    this.node = null;
  }
}

const clamp = (hz) => Math.min(HIGH_HZ, Math.max(LOW_HZ, hz));
