// SPDX-License-Identifier: GPL-3.0-only
// Strumming by hand: the right button held down while the hand sweeps across the
// strings. Each string sounds as the hand crosses it. This file is the geometry
// and the arithmetic; interact.js feeds it the pointer and main.js makes the sound.

const MARGIN_MM = 2; // a crossing this close to the nut or the bridge is on the wood, not on the string
const SPEED_FLOOR = 200; // px per second: slower than this is the softest touch
const SPEED_RANGE = 2000; // px per second above the floor that reaches full strength
const WINDOW_MS = 60; // how far back a sweep's speed is measured

/**
 * The strings a straight stroke from `a` to `b` crosses, in the order the hand
 * reaches them. Points are in bench millimetres. Each crossing says which string,
 * where along the instrument (`x`), how far along the stroke (`t`, 0 to 1) and
 * which way the hand went (`dir`: +1 towards increasing y, -1 the other way).
 */
export function strumCrossings(lay, a, b) {
  const out = [];
  for (let i = 0; i < lay.n; i++) {
    const fa = a.y - lay.stringY(i, a.x);
    const fb = b.y - lay.stringY(i, b.x);
    const before = fa >= 0;
    const after = fb >= 0;
    if (before === after) continue;
    const t = fa / (fa - fb); // the gap to a string is linear along a straight stroke
    const x = a.x + t * (b.x - a.x);
    if (x < lay.nutX + MARGIN_MM || x > lay.bridgeX - MARGIN_MM) continue;
    out.push({ i, x, t, dir: after ? 1 : -1 });
  }
  return out.sort((p, q) => p.t - q.t || p.dir * (p.i - q.i));
}

/** How fast the hand was going (screen px per second) at time `tMs`, from a trail of { t, x, y } in px and ms. */
export function strokeSpeed(trail, tMs) {
  let first = trail.findIndex((p) => p.t >= tMs - WINDOW_MS);
  if (first < 0) first = trail.length - 1;
  if (first > 0 && trail[first].t > tMs) first--; // the point just before the crossing, so one segment still gives a speed
  let path = 0;
  for (let k = first + 1; k < trail.length; k++) path += Math.hypot(trail[k].x - trail[k - 1].x, trail[k].y - trail[k - 1].y);
  const elapsed = trail.length - 1 > first ? trail[trail.length - 1].t - trail[first].t : 0;
  return (path / Math.max(elapsed, 8)) * 1000;
}

/** A sweep's speed as how hard the strings are struck, 0.25 (a drift) to 1 (a hard strum). */
export function strumVelocity(pxPerSecond) {
  return Math.min(1, Math.max(0.25, 0.25 + (0.75 * (pxPerSecond - SPEED_FLOOR)) / SPEED_RANGE));
}

/** Each string of a strum is turned down by this much, so that all of them sounding together do not overload: n strings add up about as much as one at full strength times the square root of n. */
export const strumTrim = (strings) => 1 / Math.sqrt(Math.max(1, strings));

/**
 * The strings of one strum, sounded in the order the hand reached them.
 *
 * Each crossing says how to get its sound (`fetch`, which may take a while for a string
 * that has not been made yet) and the moment the hand reached it. All the sounds are asked
 * for at once, but they are played one after another: a crossing waits for the ones before
 * it, and then the hand's own gaps are kept (see `strumWhen`). A late sound delays the
 * strum; it never reorders or squeezes it.
 */
export class StrumLine {
  /** @param clock { offset, last } @param io { now(): audio seconds, play(voice, sound, when) } */
  constructor(clock, io) {
    this.clock = clock;
    this.io = io;
    this.tail = Promise.resolve();
  }

  add({ tMs, voice, fetch }) {
    const sound = Promise.resolve().then(fetch).catch(() => null); // a string that cannot sound is left out, the rest go on
    this.tail = this.tail.then(async () => {
      const ready = await sound;
      if (ready) this.io.play(voice, ready, strumWhen(this.clock, tMs, this.io.now()));
    });
    return this.tail;
  }
}

/**
 * When, on the audio clock, a crossing at pointer time `tMs` should sound.
 * `clock.offset` turns pointer time into audio time. A crossing is never put
 * before the one that went ahead of it by less than the hand's own gap, so a page
 * that was late with its events still plays a strum, not a chord.
 */
export function strumWhen(clock, tMs, nowAudio) {
  let when = tMs / 1000 + clock.offset;
  if (clock.last) when = Math.max(when, clock.last.when + (tMs - clock.last.t) / 1000);
  when = Math.max(when, nowAudio + 0.002);
  clock.last = { when, t: tMs };
  return when;
}
