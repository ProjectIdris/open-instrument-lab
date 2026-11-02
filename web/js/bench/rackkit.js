// SPDX-License-Identifier: GPL-3.0-only
// What every rack shares: lifting a tile off a rack and carrying it to the bench, and a picture of a material.
import { el } from './draw.js';

const hash = (text) => [...text].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 11);

export function swatchBackground(material) {
  const { base, grain } = material.look;
  if (material.family === 'wood') {
    const gap = 3 + (hash(material.id) % 4);
    return `repeating-linear-gradient(0deg, ${base} 0 ${gap}px, ${grain} ${gap}px ${gap + 1}px, ${base} ${gap + 1}px ${gap * 2}px)`;
  }
  return `linear-gradient(180deg, ${grain}, #ffffff 35%, ${base} 55%, ${grain})`;
}

/**
 * Returns startDrag(event, node, payload). A tile pressed and moved is lifted (a ghost follows the pointer) and
 * `probe(event, payload)` says what is under it that it can be dropped on; let go there and `payload.drop(target)`
 * runs. Pressed and let go in place, `payload.tap()` runs. Let go anywhere else, `miss(payload)` is the status.
 * @param app { ui, wake(), redraw(), status(text) }
 */
export function makeDragger(app, probe, miss) {
  const { ui } = app;
  return function startDrag(event, node, payload) {
    if (event.button !== 0) return;
    event.preventDefault();
    app.wake?.();
    const origin = { x: event.clientX, y: event.clientY };
    let ghost = null;
    let moved = false;
    const move = (e) => {
      if (!moved && Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > 5) {
        moved = true;
        ghost = node.cloneNode(true);
        ghost.classList.add('ghost');
        document.body.append(ghost);
        node.classList.add('lifted');
      }
      if (!moved) return;
      ghost.style.left = `${e.clientX}px`;
      ghost.style.top = `${e.clientY}px`;
      ui.drop = probe(e, payload);
      app.redraw();
    };
    const end = (e) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      ghost?.remove();
      node.classList.remove('lifted');
      const drop = moved && e.type === 'pointerup' ? probe(e, payload) : null;
      ui.drop = null;
      if (!moved) payload.tap?.();
      else if (drop) payload.drop(drop);
      else if (moved) app.status(miss(payload));
      app.redraw();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };
}

/** A wood or metal swatch tile for a shelf. */
export function swatchTile(material, title) {
  const node = document.createElement('div');
  node.className = 'swatch';
  node.title = title;
  const chip = document.createElement('span');
  chip.className = 'chip';
  chip.style.background = swatchBackground(material);
  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = material.name;
  node.append(chip, label);
  return node;
}

/** The "Your own" tile on a shelf: a material typed in by hand. */
export function ownTile() {
  const node = document.createElement('div');
  node.className = 'swatch own';
  node.title = 'Your own material: drag it on, then type its density and stiffness in the drawer.';
  const chip = document.createElement('span');
  chip.className = 'chip';
  chip.textContent = '+';
  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = 'Your own';
  node.append(chip, label);
  return node;
}

/** A tile for a rack: a picture, a name and a small note under it. */
export function tile(icon, label, note, title) {
  const node = document.createElement('div');
  node.className = 'coil';
  node.title = title;
  const name = document.createElement('span');
  name.className = 'label';
  name.textContent = label;
  const size = document.createElement('span');
  size.className = 'size';
  size.textContent = note;
  node.append(icon, name, size);
  return node;
}

export const svgIcon = (...children) => el('svg', { viewBox: '0 0 64 64', width: 64, height: 64, class: 'coil-icon' }, ...children);
