// SPDX-License-Identifier: GPL-3.0-only
// The on-screen piano and the computer keyboard.

const WHITE = [0, 2, 4, 5, 7, 9, 11];
const BLACK_AFTER = { 0: 1, 2: 3, 5: 6, 7: 8, 9: 10 };
const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

export const noteName = (midi) => `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;

// Offsets from the C at the left of the window, by physical key position
// (event.code), so the layout works on any keyboard language.
export const COMPUTER_KEYS = {
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11,
  KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16,
};
const KEY_LABELS = { KeyA: 'A', KeyW: 'W', KeyS: 'S', KeyE: 'E', KeyD: 'D', KeyF: 'F', KeyT: 'T', KeyG: 'G', KeyY: 'Y', KeyH: 'H', KeyU: 'U', KeyJ: 'J', KeyK: 'K', KeyO: 'O', KeyL: 'L', KeyP: 'P', Semicolon: ';' };

function isTyping(target) {
  return target instanceof HTMLElement && (target.isContentEditable || ['TEXTAREA', 'SELECT'].includes(target.tagName) || (target.tagName === 'INPUT' && ['text', 'number', 'search'].includes(target.type)));
}

export class Keyboard {
  /**
   * @param {HTMLElement} root element that will hold the keys
   * @param {{ onNoteOn(midi, velocity, source), onNoteOff(midi, source), onSustain(on), onOctave(delta), getVelocity() }} handlers
   */
  constructor(root, handlers, octaves = 3) {
    this.root = root;
    this.handlers = handlers;
    this.octaves = octaves;
    this.start = 48;
    this.range = { lowMidi: 0, highMidi: 127 };
    this.nodes = new Map();
    this.pointers = new Map();
    this.down = new Set();
    this.build();
    this.bindComputerKeyboard();
  }

  setStart(midi) {
    this.start = midi;
    this.build();
  }

  setRange(range) {
    this.range = range;
    for (const [midi, node] of this.nodes) node.classList.toggle('disabled', midi < range.lowMidi || midi > range.highMidi);
  }

  mark(midi, { down, pending }) {
    const node = this.nodes.get(midi);
    if (!node) return;
    if (down !== undefined) node.classList.toggle('down', down);
    if (pending !== undefined) node.classList.toggle('pending', pending);
  }

  build() {
    this.root.replaceChildren();
    this.nodes.clear();
    const whiteCount = this.octaves * 7;
    const width = 100 / whiteCount;
    const labelByOffset = Object.fromEntries(Object.entries(COMPUTER_KEYS).map(([code, offset]) => [offset, KEY_LABELS[code]]));
    for (let w = 0; w < whiteCount; w++) {
      const offsetInOctave = WHITE[w % 7];
      const midi = this.start + Math.floor(w / 7) * 12 + offsetInOctave;
      this.#addKey(midi, 'white', w * width, width, labelByOffset[midi - this.start]);
      const black = BLACK_AFTER[offsetInOctave];
      if (black !== undefined && w < whiteCount - 1) {
        const blackMidi = this.start + Math.floor(w / 7) * 12 + black;
        this.#addKey(blackMidi, 'black', (w + 1) * width - width * 0.3, width * 0.6, labelByOffset[blackMidi - this.start]);
      }
    }
    this.setRange(this.range);
    for (const midi of this.down) this.mark(midi, { down: true });
  }

  #addKey(midi, kind, left, width, computerLabel) {
    const node = document.createElement('button');
    node.type = 'button';
    node.tabIndex = -1;
    node.className = `key ${kind}`;
    node.dataset.midi = String(midi);
    node.setAttribute('aria-label', noteName(midi));
    node.style.left = `${left}%`;
    node.style.width = `${width}%`;
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = computerLabel ?? (midi % 12 === 0 ? noteName(midi) : '');
    node.append(label);
    node.addEventListener('pointerdown', (event) => this.#pointerDown(event, midi, node));
    node.addEventListener('pointerup', (event) => this.#pointerUp(event));
    node.addEventListener('pointercancel', (event) => this.#pointerUp(event));
    this.nodes.set(midi, node);
    this.root.append(node);
  }

  #velocityFromPointer(event, node) {
    const rect = node.getBoundingClientRect();
    const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
    return Math.min(1, 0.3 + 0.7 * y);
  }

  #pointerDown(event, midi, node) {
    if (node.classList.contains('disabled')) return;
    node.setPointerCapture?.(event.pointerId);
    this.pointers.set(event.pointerId, midi);
    this.noteOn(midi, this.#velocityFromPointer(event, node), 'screen');
    event.preventDefault();
  }

  #pointerUp(event) {
    const midi = this.pointers.get(event.pointerId);
    if (midi === undefined) return;
    this.pointers.delete(event.pointerId);
    this.noteOff(midi, 'screen');
  }

  noteOn(midi, velocity, source) {
    if (midi < this.range.lowMidi || midi > this.range.highMidi) return;
    if (this.down.has(midi)) return;
    this.down.add(midi);
    this.mark(midi, { down: true });
    this.handlers.onNoteOn(midi, velocity, source);
  }

  noteOff(midi, source) {
    if (!this.down.has(midi)) return;
    this.down.delete(midi);
    this.mark(midi, { down: false });
    this.handlers.onNoteOff(midi, source);
  }

  bindComputerKeyboard() {
    const held = new Map();
    window.addEventListener('keydown', (event) => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target)) return;
      if (event.code === 'KeyZ') { this.handlers.onOctave(-1); return; }
      if (event.code === 'KeyX') { this.handlers.onOctave(1); return; }
      if (event.code === 'Space' && !(event.target instanceof HTMLButtonElement)) { event.preventDefault(); this.handlers.onSustain(true); return; }
      const offset = COMPUTER_KEYS[event.code];
      if (offset === undefined) return;
      const midi = this.start + offset;
      held.set(event.code, midi);
      this.noteOn(midi, this.handlers.getVelocity(), 'computer');
      event.preventDefault();
    });
    window.addEventListener('keyup', (event) => {
      if (event.code === 'Space') { this.handlers.onSustain(false); return; }
      const midi = held.get(event.code);
      if (midi === undefined) return;
      held.delete(event.code);
      this.noteOff(midi, 'computer');
    });
    window.addEventListener('blur', () => {
      for (const midi of [...held.values()]) this.noteOff(midi, 'computer');
      held.clear();
    });
  }
}
