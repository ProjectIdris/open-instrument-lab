// SPDX-License-Identifier: GPL-3.0-only
// Working the bars by hand: every drag on the bench lands here.
// The bench itself (bench.params, bench.bars) is changed directly while the hand moves, so the picture and the
// pitch follow it. When the hand lets go the edit becomes a step that can be undone and the real sound is made.
import { ARCH_FULL_DEPTH } from '/shared/physics.mjs';
import { layout, barAt, strikeFraction, SIDE_SCALE, TUBE_DRAW } from './geometry.js';

const PULL_PX = 70; // how far a hand lifts the mallet for the hardest blow
const MIN_TUBE_MM = 40; // a tube pushed shorter than this is taken off
const round1 = (x) => Math.round(x * 10) / 10;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * @param app { view, bench, ui, preview, redraw(), status(text), length(mm), wake(), strike(i, fraction, velocity, at), settle(i) }
 */
export function attachBarsInteraction(app) {
  const { view, bench, ui } = app;
  const svg = view.svg;
  let drag = null;

  const noteText = (i) => {
    const info = bench.info(i);
    if (!info.playable) return 'out of range';
    const c = info.note.cents;
    return `${info.note.name}${c === 0 ? '' : ` ${c > 0 ? '+' : '−'}${Math.abs(c)}¢`}`;
  };

  /** Show the note under the hand and sound the cheap stand-in tone for bar i. */
  const follow = (i, pt, extra = '') => {
    ui.selected = i;
    ui.rideTag = { x: pt.x, y: pt.y, text: `${noteText(i)}${extra}` };
    const info = bench.info(i);
    if (info.playable) app.preview.set(info.hz);
    app.redraw();
  };

  svg.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const pt = view.toMm(event.clientX, event.clientY);
    ui.pointer = pt;
    const target = event.target.closest?.('[data-role]');
    const role = target?.dataset.role;
    const index = target?.dataset.index === undefined ? undefined : Number(target.dataset.index);
    const lay = layout(bench, ui.selected);
    try { svg.setPointerCapture(event.pointerId); } catch { /* a synthetic or already-ended pointer: the drag still works without capture */ }
    app.wake?.();

    if (role === 'bar-end' || role === 'bar-end-side') {
      drag = { kind: role, i: index };
      app.preview.start(bench.info(index).hz);
      follow(index, pt, ` · ${app.length(bench.bars[index].barLengthMm)}`);
    } else if (role === 'bar-arch') {
      drag = { kind: role, i: index };
      app.preview.start(bench.info(index).hz);
      follow(index, pt);
    } else if (role === 'bar-thick') {
      drag = { kind: role, i: index };
      app.preview.start(bench.info(index).hz);
      follow(index, pt, ` · ${app.length(bench.bars[index].barThicknessMm)} thick`);
    } else if (role === 'tube-end') {
      drag = { kind: role, i: index };
      ui.selected = index;
    } else if (role === 'tag') {
      drag = { kind: 'tag', i: index, x: event.clientX, y: event.clientY, moved: false };
      ui.selected = index;
      app.redraw();
    } else if (role === 'bar-side' || role === 'tube-body') {
      ui.selected = index;
      app.redraw();
      drag = { kind: 'select' };
    } else if (role === 'bar') {
      const hit = barAt(lay, pt.x, pt.y);
      if (hit) {
        drag = { kind: 'strike', i: hit.i, u: hit.u, cx: event.clientX, cy: event.clientY, at: { ...pt } };
        ui.selected = hit.i;
        ui.strikeAim = { x: pt.x, y: pt.y, lift: 0 };
        ui.rideTag = { x: pt.x, y: pt.y, text: noteText(hit.i) };
        app.redraw();
      }
    } else if (role === 'frame' || role === 'bg' || !role) {
      drag = { kind: 'pan', x: event.clientX, y: event.clientY };
      svg.classList.add('panning');
    }
    if (drag) event.preventDefault();
  });

  svg.addEventListener('pointermove', (event) => {
    const pt = view.toMm(event.clientX, event.clientY);
    ui.pointer = pt;
    if (!drag) { if (ui.hand) app.redraw(); return; }
    const lay = layout(bench, ui.selected);
    const { side } = lay;

    switch (drag.kind) {
      case 'pan':
        view.panBy(event.clientX - drag.x, event.clientY - drag.y);
        drag.x = event.clientX;
        drag.y = event.clientY;
        return;
      case 'select':
        return;
      case 'bar-end':
      case 'bar-end-side': {
        const half = drag.kind === 'bar-end' ? Math.abs(pt.y) : Math.abs(pt.x);
        bench.setBar(drag.i, { barLengthMm: bench.clampLength(2 * half) });
        follow(drag.i, pt, ` · ${app.length(bench.bars[drag.i].barLengthMm)}`);
        return;
      }
      case 'bar-arch': {
        // How much of the thickness is left at the middle sets how deep the arch is: all of it, none; the full arch, 56% gone.
        const left = clamp((pt.y - side.y) / side.T, 0, 1);
        bench.setBar(drag.i, { barUndercut: clamp(Math.round(((1 - left) / ARCH_FULL_DEPTH) * 100) / 100, 0, 1) });
        follow(drag.i, pt, ` · arch ${Math.round(bench.bars[drag.i].barUndercut * 100)}%`);
        return;
      }
      case 'bar-thick': {
        const def = bench.paramDef('barThicknessMm');
        bench.setBar(drag.i, { barThicknessMm: round1(clamp((pt.y - side.y) / SIDE_SCALE, def.min, def.max)) });
        follow(drag.i, pt, ` · ${app.length(bench.bars[drag.i].barThicknessMm)} thick`);
        return;
      }
      case 'tube-end': {
        const def = bench.paramDef('tubeLengthMm');
        const mm = (pt.y - (side.y + side.T + 10)) / TUBE_DRAW;
        ui.removingTube = mm < MIN_TUBE_MM;
        if (!ui.removingTube) bench.setBar(drag.i, { tubeLengthMm: Math.round(clamp(mm, def.min, def.max)) });
        const info = bench.info(drag.i);
        ui.rideTag = { x: pt.x, y: pt.y, text: ui.removingTube ? 'Let go to take the tube off' : `Tube ${app.length(bench.bars[drag.i].tubeLengthMm)}, ${info.tubeCents === 0 ? 'tuned to the note' : `${Math.abs(info.tubeCents)}¢ ${info.tubeCents > 0 ? 'above' : 'below'} the note`}` };
        app.redraw();
        return;
      }
      case 'tag': {
        if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 6) drag.moved = true;
        if (drag.moved) {
          const rect = svg.getBoundingClientRect();
          const outside = event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom
            || Math.abs(pt.x) > lay.frameHalf + 60 || Math.abs(pt.y) > lay.maxHalf + 70;
          ui.removing = outside && bench.canRemoveBar() ? drag.i : null;
          ui.rideTag = { x: pt.x, y: pt.y, text: ui.removing === null ? 'Drag off the frame to take it away' : 'Let go to take the bar away' };
          app.redraw();
        }
        return;
      }
      case 'strike': {
        const lift = clamp(Math.hypot(event.clientX - drag.cx, event.clientY - drag.cy) / PULL_PX, 0, 1);
        ui.strikeAim = { x: drag.at.x, y: drag.at.y, lift };
        const place = Math.round(strikeFraction(drag.u) * 100);
        ui.rideTag = { x: pt.x, y: pt.y, text: `${noteText(drag.i)} · struck ${place}% from the end` };
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

    if (d.kind === 'pan' || d.kind === 'select') { app.redraw(); return; }
    if (d.kind === 'strike') {
      const lift = ui.strikeAim?.lift ?? 0;
      ui.strikeAim = null;
      const velocity = lift < 0.07 ? 0.6 : 0.3 + 0.7 * lift;
      app.strike(d.i, strikeFraction(d.u), velocity, d.u);
      app.redraw();
      return;
    }
    if (d.kind === 'tag') {
      const removing = ui.removing;
      ui.removing = null;
      if (d.moved && removing !== null) {
        bench.removeBar(removing);
        ui.selected = Math.min(ui.selected ?? 0, bench.bars.length - 1);
        bench.commit();
        app.status('Bar taken away. Drag a bar from the rack onto the frame to put one back.');
        app.settle();
      } else if (!d.moved) {
        app.cutNearest(d.i);
      }
      app.redraw();
      return;
    }
    if (d.kind === 'tube-end' && ui.removingTube) {
      ui.removingTube = false;
      bench.setBar(d.i, { tubeFit: false });
      app.status('Tube taken off.');
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
