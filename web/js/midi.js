// SPDX-License-Identifier: GPL-3.0-only
// Web MIDI input. Browsers ask the person for permission when this is called.

/**
 * Listen to every connected MIDI keyboard.
 * Returns { status } text for the screen, or throws a plain-language Error.
 */
export async function connectMidi({ onNoteOn, onNoteOff, onSustain, onChange }) {
  if (!navigator.requestMIDIAccess) throw new Error('This browser does not support MIDI. Chrome and Edge do.');
  const access = await navigator.requestMIDIAccess();
  const listen = (event) => {
    const [status, a, b] = event.data;
    const kind = status & 0xf0;
    if (kind === 0x90 && b > 0) onNoteOn(a, b / 127);
    else if (kind === 0x80 || (kind === 0x90 && b === 0)) onNoteOff(a);
    else if (kind === 0xb0 && a === 64) onSustain(b >= 64);
  };
  const attach = () => {
    const names = [];
    for (const input of access.inputs.values()) {
      input.onmidimessage = listen;
      names.push(input.name || 'MIDI keyboard');
    }
    onChange(names);
  };
  access.onstatechange = attach;
  attach();
}
