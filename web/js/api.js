// SPDX-License-Identifier: GPL-3.0-only
// Talking to the local server.

export async function loadEngines() {
  const response = await fetch('/api/engines');
  if (!response.ok) throw new Error(`could not load the instrument list (${response.status})`);
  return response.json();
}

/** Ask for one rendered note. Resolves to { data: ArrayBuffer, cached, ms }. */
export async function renderNote({ engine, params, note, priority = 0, signal }) {
  const response = await fetch('/api/render', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ engine, params, note, priority }),
    signal,
  });
  if (!response.ok) {
    let message = `render failed (${response.status})`;
    try { message = (await response.json()).error ?? message; } catch { /* keep the generic message */ }
    throw new Error(message);
  }
  return {
    data: await response.arrayBuffer(),
    cached: response.headers.get('X-Cache') === 'hit',
    ms: Number(response.headers.get('X-Render-Ms') ?? 0),
  };
}

/** The notes an instrument with these values can play: { lowMidi, highMidi }. */
export async function describeInstrument({ engine, params }) {
  const response = await fetch('/api/describe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ engine, params }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? 'could not describe the instrument');
  return body;
}
