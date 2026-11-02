// SPDX-License-Identifier: GPL-3.0-only
// Working the instrument by hand: every drag on the bench lands here.
// The bench itself (bench.params, bench.strings) is changed directly while the
// hand moves, so the picture and the pitch follow it. When the hand lets go the
// edit becomes a step that can be undone and the real sound is made.
import { layout, stringAt, fretSlotNear, pickupAtPoint } from './geometry.js';
import { strumCrossings, strokeSpeed, strumVelocity } from './strum.js';

const PEG_DEGREES_PER_OCTAVE_OF_TENSION = 540; // the same constant the peg is drawn with
const SWEEP_POINTS = 16; // how much of a strum's path is drawn behind the hand
const TRAIL_MS = 400; // how much of it is kept to measure speed from
const round = Math.round;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * @param app { view, bench, ui, preview, redraw(), status(text), pluck(i, distMm, velocity), strumStart(tMs), strum(hit), settle(i), tuneNearest(i) }
 */
export function attachInteraction(app) {
  const { view, bench, ui } = app;
  const svg = view.svg;
  let drag = null;
  // Any instrument the bench draws as plucked strings can be strummed, unless its engine says it cannot.
  const strummable = () => bench.engine.bench?.kind === 'plucked-strings' && bench.engine.bench.strum !== false;
  // The browser's menu would open under the hand that is strumming.
  svg.addEventListener('contextmenu', (event) => event.preventDefault());
  const noteText = (i) => {
    const info = bench.info(i);
    if (!info.playable) return 'out of range';
    const c = info.note.cents;
    return `${info.note.name}${c === 0 ? '' : ` ${c > 0 ? '+' : '−'}${Math.abs(c)}¢`}`;
  };

  const nearestString = (y, x) => {
    const lay = layout(bench);
    let best = 0;
    for (let i = 1; i < lay.n; i++) if (Math.abs(y - lay.stringY(i, x)) < Math.abs(y - lay.stringY(best, x))) best = i;
    return best;
  };

  /** Show the note under the hand and sound the cheap stand-in tone for string i. */
  const follow = (i, pt) => {
    ui.selected = i;
    ui.rideTag = { x: pt.x, y: pt.y, text: noteText(i) };
    const info = bench.info(i);
    if (info.playable) app.preview.set(info.hz);
    app.redraw();
  };

  svg.addEventListener('pointerdown', (event) => {
    if (event.button === 2) {
      if (drag || !strummable()) return;
      const pt = view.toMm(event.clientX, event.clientY);
      ui.pointer = pt;
      try { svg.setPointerCapture(event.pointerId); } catch { /* a synthetic or already-ended pointer: the strum still works without capture */ }
      app.wake?.();
      app.strumStart(event.timeStamp);
      drag = { kind: 'strum', prev: { ...pt, t: event.timeStamp }, trail: [{ t: event.timeStamp, x: event.clientX, y: event.clientY }] };
      ui.sweep = [pt];
      event.preventDefault();
      return;
    }
    if (event.button !== 0) return;
    const pt = view.toMm(event.clientX, event.clientY);
    ui.pointer = pt;
    const target = event.target.closest?.('[data-role]');
    const role = target?.dataset.role;
    const lay = layout(bench);
    try { svg.setPointerCapture(event.pointerId); } catch { /* a synthetic or already-ended pointer: the drag still works without capture */ }
    app.wake?.();

    if (role === 'peg') {
      const i = Number(target.dataset.index);
      const peg = lay.pegs[i];
      drag = { kind: 'peg', i, cx: peg.x, cy: peg.y, last: Math.atan2(pt.y - peg.y, pt.x - peg.x), start: structuredClone(bench.strings[i]) };
      app.preview.start(bench.info(i).hz);
      follow(i, pt);
    } else if (role === 'nut' || role === 'bridge') {
      drag = { kind: role, nutX: lay.nutX, lead: nearestString(pt.y, pt.x) };
      app.preview.start(bench.info(drag.lead).hz);
      follow(drag.lead, pt);
    } else if (role === 'tag') {
      drag = { kind: 'tag', i: Number(target.dataset.index), x: event.clientX, y: event.clientY, moved: false };
      ui.selected = drag.i;
      app.redraw();
    } else if (role?.startsWith('outline-') || role === 'hole-size' || role === 'depth') {
      drag = { kind: role };
    } else {
      // A string wins over whatever lies under it (the sound hole, the body): that is where a hand plucks.
      // A wire or the pickup is grabbed between the strings; a string's own width still plucks it, so the reach is tighter there.
      const hit = stringAt(lay, pt.x, pt.y, view.px(role === 'fret' || role === 'pickup' ? 4 : 8));
      if (hit) {
        drag = { kind: 'pluck', i: hit.i, x: clamp(pt.x, lay.nutX + 3, lay.bridgeX - 3) };
        ui.selected = hit.i;
        ui.pull = { i: hit.i, x: drag.x, dy: clamp(pt.y - lay.stringY(hit.i, pt.x), -16, 16) };
        ui.rideTag = { x: pt.x, y: pt.y, text: noteText(hit.i) };
        app.redraw();
      } else if (role === 'fret') {
        const number = Number(target.dataset.fret);
        drag = { kind: 'fret', index: bench.fretItems.findIndex((f) => f.fretNumber === number), number };
        ui.rideTag = { x: pt.x, y: pt.y, text: `Fret ${number}` };
        app.redraw();
      } else if (role === 'pickup' && lay.pickup) {
        drag = { kind: 'pickup', grab: pt.x - lay.pickup.x };
        ui.rideTag = { x: pt.x, y: pt.y, text: `Pickup ${app.length(lay.pickup.atMm)} from the bridge` };
        app.redraw();
      } else if (role === 'hole') {
        drag = { kind: 'hole', grabX: pt.x - lay.hole.x };
      } else if (role === 'bg' || !role) {
        drag = { kind: 'pan', x: event.clientX, y: event.clientY };
        svg.classList.add('panning');
      }
    }
    if (drag) event.preventDefault();
  });

  svg.addEventListener('pointermove', (event) => {
    const pt = view.toMm(event.clientX, event.clientY);
    ui.pointer = pt;
    if (!drag) { if (ui.hand) app.redraw(); return; }
    const lay = layout(bench);
    const p = bench.params;
    if (drag.kind === 'strum') { sweep(event, lay); return; }

    switch (drag.kind) {
      case 'pan':
        view.panBy(event.clientX - drag.x, event.clientY - drag.y);
        drag.x = event.clientX;
        drag.y = event.clientY;
        return;
      case 'nut': {
        const scale = clamp(round(lay.bridgeX - pt.x), Math.max(bench.paramDef('scaleLengthMm').min, p.bridgeAtMm + 40), bench.paramDef('scaleLengthMm').max);
        bench.set({ scaleLengthMm: scale });
        drag.lead = nearestString(pt.y, pt.x);
        follow(drag.lead, pt);
        return;
      }
      case 'bridge': {
        const def = bench.paramDef('scaleLengthMm');
        const bridge = clamp(round(pt.x), Math.max(bench.paramDef('bridgeAtMm').min, drag.nutX + def.min), Math.min(bench.paramDef('bridgeAtMm').max, p.bodyLengthMm - 30, drag.nutX + def.max));
        bench.set({ bridgeAtMm: bridge, scaleLengthMm: round(bridge - drag.nutX) });
        drag.lead = nearestString(pt.y, pt.x);
        follow(drag.lead, pt);
        return;
      }
      case 'peg': {
        const angle = Math.atan2(pt.y - drag.cy, pt.x - drag.cx);
        let delta = ((angle - drag.last) * 180) / Math.PI;
        while (delta > 180) delta -= 360;
        while (delta < -180) delta += 360;
        drag.last = angle;
        const tension = bench.clampTension(bench.strings[drag.i].tensionN * 2 ** (delta / PEG_DEGREES_PER_OCTAVE_OF_TENSION));
        bench.setString(drag.i, { tensionN: Math.round(tension * 100) / 100 });
        follow(drag.i, { x: drag.cx, y: drag.cy });
        return;
      }
      case 'pluck': {
        const y0 = lay.stringY(drag.i, drag.x);
        ui.pull = { i: drag.i, x: drag.x, dy: clamp(pt.y - y0, -16, 16) };
        ui.rideTag = { x: pt.x, y: pt.y, text: noteText(drag.i) };
        app.redraw();
        return;
      }
      case 'tag': {
        if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 6) drag.moved = true;
        if (drag.moved) {
          const rect = svg.getBoundingClientRect();
          const outside = event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom
            || Math.abs(pt.y) > lay.bodyHalf + 25 || pt.x > p.bodyLengthMm + 40 || pt.x < lay.headX - 30;
          ui.removing = outside && bench.canRemoveString() ? drag.i : null;
          ui.rideTag = { x: pt.x, y: pt.y, text: ui.removing === null ? 'Drag off the guitar to take it off' : 'Let go to take it off' };
          app.redraw();
        }
        return;
      }
      case 'fret': {
        // Off the neck means "take it out"; on it, the wire snaps to the nearest place that has none.
        const outside = Math.abs(pt.y) > lay.halfWidth(clamp(pt.x, lay.nutX, lay.bridgeX)) + 34 || pt.x < lay.nutX - 12 || pt.x > lay.bridgeX;
        const next = bench.freeFretNear(fretSlotNear(lay, pt.x), drag.number);
        if (next !== null && next !== drag.number && !outside) { bench.moveFret(drag.index, next); drag.number = next; }
        ui.removingFret = outside && bench.canRemoveFret() ? drag.number : null;
        ui.rideTag = { x: pt.x, y: pt.y, text: ui.removingFret === null ? `Fret ${drag.number}` : 'Let go to take it out' };
        app.redraw();
        return;
      }
      case 'pickup': {
        // Along the strings it slides; off them it is on its way out.
        const at = pickupAtPoint(lay, bench, pt.x - drag.grab, pt.y, 30);
        if (at !== null) bench.fitPickup(at);
        ui.removingPickup = at === null;
        ui.rideTag = { x: pt.x, y: pt.y, text: ui.removingPickup ? 'Let go to take it off' : `Pickup ${app.length(bench.pickup.atMm)} from the bridge` };
        app.redraw();
        return;
      }
      case 'outline-upper': bench.set({ upperBoutMm: clamp(round(2 * Math.abs(pt.y)), 150, 420) }); break;
      case 'outline-lower': bench.set({ lowerBoutMm: clamp(round(2 * Math.abs(pt.y)), 180, 500) }); break;
      case 'outline-waist': bench.set({ waistMm: clamp(round(2 * Math.abs(pt.y)), 110, 380), waistAt: clamp(round((pt.x / p.bodyLengthMm) * 200) / 200, 0.35, 0.65) }); break;
      case 'outline-tail': bench.set({ bodyLengthMm: clamp(round(pt.x), Math.max(250, p.bridgeAtMm + 30), 650) }); break;
      case 'hole': bench.set({ holeAtMm: clamp(round(pt.x - drag.grabX), 40, 300) }); break;
      case 'hole-size': bench.set({ holeDiameterMm: clamp(round(2 * Math.hypot(pt.x - lay.hole.x, pt.y)), 20, 140) }); break;
      case 'depth': bench.set({ bodyDepthMm: clamp(round(pt.y - lay.side.y), 40, 160) }); break;
      default: return;
    }
    ui.rideTag = { x: pt.x, y: pt.y, text: describeBody(drag.kind, bench.params, app) };
    app.redraw();
  });

  /** The strum moved: sound every string its path crossed, in order, each at the moment the hand reached it. */
  const sweep = (event, lay) => {
    // A fast hand makes more pointer positions than the browser reports one by one; the extra ones are in between.
    const samples = event.getCoalescedEvents?.();
    for (const s of samples?.length ? samples : [event]) {
      const here = view.toMm(s.clientX, s.clientY);
      const cur = { ...here, t: s.timeStamp };
      drag.trail.push({ t: s.timeStamp, x: s.clientX, y: s.clientY });
      while (drag.trail.length > 2 && drag.trail[0].t < s.timeStamp - TRAIL_MS) drag.trail.shift();
      for (const c of strumCrossings(lay, drag.prev, cur)) {
        if (!bench.info(c.i).playable) continue;
        const tMs = drag.prev.t + c.t * (cur.t - drag.prev.t);
        const velocity = strumVelocity(strokeSpeed(drag.trail, tMs));
        app.strum({ i: c.i, x: c.x, distMm: lay.bridgeX - c.x, velocity, amp: c.dir * (1.8 + 5.5 * velocity), tMs });
      }
      drag.prev = cur;
      ui.sweep.push(here);
      if (ui.sweep.length > SWEEP_POINTS) ui.sweep.shift();
    }
    ui.pointer = drag.prev;
    app.redraw();
  };

  const finish = (event) => {
    if (!drag) return;
    if ((drag.kind === 'strum') !== (event.button === 2) && event.type === 'pointerup') return; // the other button letting go
    const d = drag;
    drag = null;
    ui.sweep = null;
    svg.classList.remove('panning');
    try { svg.releasePointerCapture(event.pointerId); } catch { /* already released */ }
    const lay = layout(bench);
    ui.rideTag = null;
    app.preview.stop();

    if (d.kind === 'pan') return;
    if (d.kind === 'strum') { app.redraw(); return; }
    if (d.kind === 'pluck') {
      const pull = ui.pull;
      ui.pull = null;
      const size = Math.abs(pull?.dy ?? 0);
      const velocity = size < 1 ? 0.55 : 0.3 + 0.7 * Math.min(1, size / 12);
      app.pluck(d.i, lay.bridgeX - d.x, velocity, pull?.dy && Math.abs(pull.dy) >= 1 ? pull.dy : 2.5, d.x);
      app.redraw();
      return;
    }
    if (d.kind === 'fret' || d.kind === 'pickup') {
      const taking = d.kind === 'fret' ? ui.removingFret !== null && ui.removingFret !== undefined : ui.removingPickup;
      ui.removingFret = null;
      ui.removingPickup = false;
      if (taking) {
        if (d.kind === 'fret') bench.removeFret(d.index);
        else bench.removePickup();
        app.status(d.kind === 'fret' ? 'Fret taken out. A string cannot be stopped there now. Drag one from the rack to put it back.' : 'Pickup taken off: the sound comes from the body again.');
      }
      const changed = bench.commit();
      app.redraw();
      if (changed) app.settle(d.kind === 'pickup' ? ui.selected : undefined);
      return;
    }
    if (d.kind === 'tag') {
      const removing = ui.removing;
      ui.removing = null;
      if (d.moved && removing !== null) {
        bench.removeString(removing);
        ui.selected = Math.min(ui.selected ?? 0, bench.strings.length - 1);
        bench.commit();
        app.status('String taken off. Drag a string from the rack to put one back.');
        app.settle();
      } else if (!d.moved) {
        app.tuneNearest(d.i);
      }
      app.redraw();
      return;
    }
    const changed = bench.commit();
    app.redraw();
    if (changed) app.settle(d.kind === 'peg' ? d.i : d.lead);
  };
  svg.addEventListener('pointerup', finish);
  svg.addEventListener('pointercancel', finish);
  svg.addEventListener('pointerleave', () => { if (!drag) { ui.pointer = null; if (ui.hand) app.redraw(); } });

  svg.addEventListener('wheel', (event) => {
    event.preventDefault();
    view.zoomAt(Math.exp(-event.deltaY * 0.0015), event.clientX, event.clientY);
  }, { passive: false });
}

function describeBody(kind, p, app) {
  const len = (mm) => app.length(mm);
  switch (kind) {
    case 'nut': case 'bridge': return `Length ${len(p.scaleLengthMm)}`;
    case 'outline-upper': return `Upper bout ${len(p.upperBoutMm)}`;
    case 'outline-lower': return `Lower bout ${len(p.lowerBoutMm)}`;
    case 'outline-waist': return `Waist ${len(p.waistMm)}`;
    case 'outline-tail': return `Body ${len(p.bodyLengthMm)} long`;
    case 'hole': return `Hole ${len(p.holeAtMm)} from the neck`;
    case 'hole-size': return `Hole ${len(p.holeDiameterMm)} wide`;
    case 'depth': return `Depth ${len(p.bodyDepthMm)}`;
    default: return '';
  }
}
