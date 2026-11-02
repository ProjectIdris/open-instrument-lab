// SPDX-License-Identifier: GPL-3.0-only
// Working the drums by hand: every drag on the bench lands here.
// The bench itself (bench.params, bench.drums) is changed directly while the hand moves, so the picture and the
// pitch follow it. When the hand lets go the edit becomes a step that can be undone and the real sound is made.
import { layout, drumAt, strikePlace, THICK_SCALE } from './geometry.js';

const PULL_PX = 70; // how far a hand lifts the stick for the hardest blow
const QUARTER_TURN = Math.PI / 2;
const TURN_SEMITONES = 1; // a quarter turn round the drum is about a semitone of tension
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const wrapAngle = (a) => (a > Math.PI ? a - 2 * Math.PI : a < -Math.PI ? a + 2 * Math.PI : a);

/**
 * @param app { view, bench, ui, preview, redraw(), status(text), length(mm), wake(), strike(i, place, velocity), settle(i), tuneNearest(i) }
 */
export function attachDrumsInteraction(app) {
  const { view, bench, ui } = app;
  const svg = view.svg;
  let drag = null;

  const noteText = (i) => {
    const info = bench.info(i);
    if (!info.playable) return 'out of range';
    const c = info.note.cents;
    return `${info.note.name}${c === 0 ? '' : ` ${c > 0 ? '+' : '−'}${Math.abs(c)}¢`}`;
  };

  /** Show the note under the hand and sound the cheap stand-in tone for drum i. */
  const follow = (i, pt, extra = '') => {
    ui.selected = i;
    ui.rideTag = { x: pt.x, y: pt.y, text: `${noteText(i)}${extra}` };
    const info = bench.info(i);
    if (info.playable) app.preview.set(info.hz);
    app.redraw();
  };

  const centreOf = (i) => layout(bench, ui.selected, ui.pin).drums[i];

  svg.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const pt = view.toMm(event.clientX, event.clientY);
    ui.pointer = pt;
    const target = event.target.closest?.('[data-role]');
    const role = target?.dataset.role;
    const index = target?.dataset.index === undefined ? undefined : Number(target.dataset.index);
    const lay = layout(bench, ui.selected, ui.pin);
    try { svg.setPointerCapture(event.pointerId); } catch { /* a synthetic or already-ended pointer: the drag still works without capture */ }
    app.wake?.();

    if (role === 'drum-rim' || role === 'drum-size-side') {
      drag = { kind: role, i: index };
      if (role === 'drum-rim') ui.pin = { i: index, x: lay.drums[index].x };
      app.preview.start(bench.info(index).hz);
      follow(index, pt, ` · ${app.length(bench.drums[index].headDiameterMm)}`);
    } else if (role === 'drum-lug') {
      const c = lay.drums[index];
      const a = Math.atan2(pt.y - c.y, pt.x - c.x);
      drag = { kind: role, i: index, last: a, total: 0, t0: bench.drums[index].headTension };
      app.preview.start(bench.info(index).hz);
      follow(index, pt, ` · ${Math.round(bench.drums[index].headTension)} N/m`);
    } else if (role === 'drum-depth' || role === 'drum-thick') {
      drag = { kind: role, i: index };
      app.preview.start(bench.info(index).hz);
      follow(index, pt);
    } else if (role === 'drum-bottom') {
      drag = { kind: role, i: index };
      ui.selected = index;
    } else if (role === 'tag') {
      drag = { kind: 'tag', i: index, x: event.clientX, y: event.clientY, moved: false };
      ui.selected = index;
      app.redraw();
    } else if (role === 'drum-side' || role === 'drum-head-side' || role === 'drum-shell') {
      ui.selected = index;
      app.redraw();
      drag = { kind: 'select' };
    } else if (role === 'drum-head') {
      const hit = drumAt(lay, pt.x, pt.y);
      if (hit) {
        drag = { kind: 'strike', i: hit.i, hit, cx: event.clientX, cy: event.clientY, at: { ...pt } };
        ui.selected = hit.i;
        ui.strikeAim = { x: pt.x, y: pt.y, lift: 0 };
        ui.rideTag = { x: pt.x, y: pt.y, text: noteText(hit.i) };
        app.redraw();
      }
    } else if (role === 'bg' || !role) {
      drag = { kind: 'pan', x: event.clientX, y: event.clientY };
      svg.classList.add('panning');
    }
    if (drag) event.preventDefault();
  });

  svg.addEventListener('pointermove', (event) => {
    const pt = view.toMm(event.clientX, event.clientY);
    ui.pointer = pt;
    if (!drag) { if (ui.hand) app.redraw(); return; }
    const lay = layout(bench, ui.selected, ui.pin);
    const { side } = lay;

    switch (drag.kind) {
      case 'pan':
        view.panBy(event.clientX - drag.x, event.clientY - drag.y);
        drag.x = event.clientX;
        drag.y = event.clientY;
        return;
      case 'select':
      case 'drum-bottom':
        return;
      case 'drum-rim': {
        const c = lay.drums[drag.i];
        bench.setDrum(drag.i, { headDiameterMm: Math.round(bench.clampTo('headDiameterMm', 2 * Math.hypot(pt.x - c.x, pt.y - c.y))) });
        follow(drag.i, pt, ` · ${app.length(bench.drums[drag.i].headDiameterMm)}`);
        return;
      }
      case 'drum-size-side': {
        bench.setDrum(drag.i, { headDiameterMm: Math.round(bench.clampTo('headDiameterMm', 2 * Math.abs(pt.x))) });
        follow(drag.i, pt, ` · ${app.length(bench.drums[drag.i].headDiameterMm)}`);
        return;
      }
      case 'drum-lug': {
        const c = centreOf(drag.i);
        const a = Math.atan2(pt.y - c.y, pt.x - c.x);
        drag.total += wrapAngle(a - drag.last);
        drag.last = a;
        const tension = bench.clampTo('headTension', drag.t0 * 2 ** ((2 * TURN_SEMITONES * drag.total) / QUARTER_TURN / 12));
        bench.setDrum(drag.i, { headTension: Math.round(tension) });
        follow(drag.i, pt, ` · ${Math.round(tension)} N/m`);
        return;
      }
      case 'drum-depth': {
        bench.setDrum(drag.i, { shellDepthMm: Math.round(bench.clampTo('shellDepthMm', pt.y - side.y)) });
        follow(drag.i, pt, ` · ${app.length(bench.drums[drag.i].shellDepthMm)} deep`);
        return;
      }
      case 'drum-thick': {
        const top = side.y - side.thick / 2;
        const um = ((pt.y - top) / THICK_SCALE) * 1000;
        bench.setDrum(drag.i, { headThicknessUm: Math.round(bench.clampTo('headThicknessUm', um)) });
        follow(drag.i, pt, ` · ${Math.round(bench.drums[drag.i].headThicknessUm)} µm thick`);
        return;
      }
      case 'tag': {
        if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 6) drag.moved = true;
        if (drag.moved) {
          const rect = svg.getBoundingClientRect();
          const outside = event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom
            || Math.abs(pt.x - lay.shift) > lay.total / 2 + 80 || Math.abs(pt.y) > lay.maxR + 90;
          ui.removing = outside && bench.canRemoveDrum() ? drag.i : null;
          ui.rideTag = { x: pt.x, y: pt.y, text: ui.removing === null ? 'Drag off the row to take it away' : 'Let go to take the drum away' };
          app.redraw();
        }
        return;
      }
      case 'strike': {
        const lift = clamp(Math.hypot(event.clientX - drag.cx, event.clientY - drag.cy) / PULL_PX, 0, 1);
        ui.strikeAim = { x: drag.at.x, y: drag.at.y, lift };
        ui.rideTag = { x: pt.x, y: pt.y, text: `${noteText(drag.i)} · struck ${Math.round(Math.min(0.95, drag.hit.r) * 100)}% out from the centre` };
        app.redraw();
        return;
      }
      default:
    }
  });

  const finish = (event) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    svg.classList.remove('panning');
    try { svg.releasePointerCapture(event.pointerId); } catch { /* already released */ }
    ui.rideTag = null;
    app.preview.stop();
    if (ui.pin) { ui.pin = null; view.fit?.(); }

    if (d.kind === 'pan' || d.kind === 'select') { app.redraw(); return; }
    if (d.kind === 'strike') {
      const lift = ui.strikeAim?.lift ?? 0;
      ui.strikeAim = null;
      const velocity = lift < 0.07 ? 0.6 : 0.3 + 0.7 * lift;
      app.strike(d.i, strikePlace(d.hit), velocity);
      app.redraw();
      return;
    }
    if (d.kind === 'drum-bottom') {
      bench.setDrum(d.i, bench.nextBottom(d.i));
      app.status({
        closed: 'Bottom closed: a cushion of air under the head lifts the lowest modes, more the shallower the drum.',
        head: 'A second head under the shell: the two heads share the air between them, so the lowest sound is the pair moving against it.',
        open: 'Bottom open: the air moves freely on both sides of the head.',
      }[bench.bottomState(d.i)]);
      bench.commit();
      app.settle(d.i);
      return;
    }
    if (d.kind === 'tag') {
      const removing = ui.removing;
      ui.removing = null;
      if (d.moved && removing !== null) {
        bench.removeDrum(removing);
        ui.selected = Math.min(ui.selected ?? 0, bench.drums.length - 1);
        bench.commit();
        app.status('Drum taken away. Drag a drum from the rack onto the row to put one back.');
        app.view.fit?.();
        app.settle();
      } else if (!d.moved) {
        app.tuneNearest(d.i);
      }
      app.redraw();
      return;
    }
    const changed = bench.commit();
    app.redraw();
    if (changed) app.settle(d.i);
  };
  svg.addEventListener('pointerup', finish);
  svg.addEventListener('pointercancel', finish);
  svg.addEventListener('pointerleave', () => { if (!drag) { ui.pointer = null; if (ui.hand) app.redraw(); } });

  svg.addEventListener('wheel', (event) => {
    event.preventDefault();
    view.zoomAt(Math.exp(-event.deltaY * 0.0015), event.clientX, event.clientY);
  }, { passive: false });
}
