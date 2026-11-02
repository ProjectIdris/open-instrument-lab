// SPDX-License-Identifier: GPL-3.0-only
// Struck bar: a free-free bar of any material, hit by a mallet. The bar is a
// short list of vibration modes (textbook Euler–Bernoulli beam theory), each
// ringing at its own pitch and fading at its own rate.
//
// The bar is sized so the note you play is exactly the pitch of its first mode
// from the material's density and stiffness. Playing a lighter, stiffer
// material therefore changes the length of the bar and the way it rings, not
// the note.
import { byId, materialOptions, resolveMaterial, customMaterialParams } from '../materials.mjs';
import { SAMPLE_RATE, contactTimeS, contactPower, malletPulse, lossModel, sigmaAt, modeSigmas, addModeAcceleration, addTubedMode } from '../bar-voice.mjs';

export const meta = {
  id: 'modal-bar',
  order: 20,
  name: 'Struck bars',
  description: 'A bar of wood, metal or anything you can describe, hit with a mallet: xylophone, marimba, glockenspiel and stranger things.',
};

export const schema = {
  groups: [
    { id: 'bar', label: 'The bar' },
    { id: 'mallet', label: 'The mallet' },
    { id: 'ring', label: 'How it rings' },
    { id: 'output', label: 'Listening' },
  ],
  params: [
    {
      id: 'material', type: 'choice', layer: 'plain', group: 'bar', label: 'Bar material',
      help: 'What the bar is made of. Stiff, light materials sound brighter and ring differently from dense, soft ones. Pick Custom to type your own density and stiffness.',
      options: materialOptions(), default: 'sugar-maple',
    },
    ...customMaterialParams({ group: 'bar', idParam: 'material', layer: 'plain', density: 700, modulusGPa: 13 }),
    {
      id: 'undercut', type: 'number', layer: 'plain', group: 'bar', label: 'Tuned overtones',
      help: 'A plain bar has clangorous overtones. Carving the underside, as on a marimba, moves the second overtone to exactly two octaves above the note so the bar sounds clear. 0 is a plain bar; 1 is fully tuned.',
      min: 0, max: 1, step: 0.01, default: 0,
    },
    {
      id: 'resonator', type: 'toggle', layer: 'plain', group: 'bar', label: 'Tube under the bar',
      help: 'A tube, closed at the bottom, hung under the bar and cut to its note, as on a marimba. The air in it rings with the bar: the note comes out much louder against its overtones and fades a little sooner.',
      default: false,
    },
    {
      id: 'strikePosition', type: 'number', layer: 'plain', group: 'mallet', label: 'Where you strike',
      help: 'Distance of the mallet from the end of the bar as a fraction of its length. The middle gives the fullest fundamental; near the end brings out the clangy overtones.',
      unit: 'of bar length', min: 0.05, max: 0.5, step: 0.005, default: 0.38,
    },
    {
      id: 'malletHardness', type: 'number', layer: 'plain', group: 'mallet', label: 'Soft to hard mallet',
      help: 'A soft yarn mallet gives a round tone with few overtones; a hard plastic or brass mallet gives a bright, bell-like attack.',
      min: 0, max: 1, step: 0.01, default: 0.5,
    },
    {
      id: 'ringTime', type: 'number', layer: 'plain', group: 'ring', label: 'How long it rings',
      help: 'Time for the note to fade by 60 dB (to a thousandth of its loudness), for a note at middle C. Higher notes die away sooner and lower ones last longer, as in a real bar. Metal bars ring for seconds; wood for a second or two at most.',
      unit: 'seconds', min: 0.05, max: 12, scale: 'log', step: 0.01, default: 1.7,
    },
    {
      id: 'overtoneDamping', type: 'number', layer: 'advanced', group: 'ring', label: 'High overtones fade faster',
      help: 'How much quicker the higher overtones die away than the fundamental. 0 makes every overtone ring as long as the fundamental; 1 makes the high ones vanish almost at once, as in a real bar.',
      min: 0, max: 1, step: 0.01, default: 0.6,
    },
    {
      id: 'listenPosition', type: 'number', layer: 'advanced', group: 'output', label: 'Listening point',
      help: 'Where along the bar the sound is picked up. Some overtones have a quiet spot (a node) that moves with this.',
      unit: 'of bar length', min: 0.02, max: 0.98, step: 0.01, default: 0.25,
    },
  ],
};

export const gallery = [
  {
    id: 'maple-bar', name: 'Maple bar',
    description: 'A plain bar of hard maple struck with a medium mallet.',
    params: { material: 'sugar-maple', undercut: 0, strikePosition: 0.38, malletHardness: 0.45, ringTime: 1.7 },
  },
  {
    id: 'marimba-like', name: 'Tuned wooden bar',
    description: 'A hard maple bar (dense, like the rosewood of a marimba) with its overtones tuned to four and ten times the note and a tube under it cut to the note, struck with a yarn mallet: a full, round note with the overtones behind it.',
    params: { material: 'sugar-maple', undercut: 1, resonator: true, strikePosition: 0.44, malletHardness: 0.15, ringTime: 1.7 },
  },
  {
    id: 'steel-bar', name: 'Steel bar',
    description: 'A steel bar struck with a hard mallet: bright, and ringing for ten seconds or more at middle C.',
    params: { material: 'steel-music-wire', undercut: 0, strikePosition: 0.45, malletHardness: 0.85, ringTime: 12 },
  },
  {
    id: 'soft-cedar', name: 'Cedar bar',
    description: 'A light, soft wood bar that gives a short, hollow tock.',
    params: { material: 'western-redcedar', undercut: 0.5, strikePosition: 0.4, malletHardness: 0.35, ringTime: 0.9 },
  },
];

export const limits = { minDurationS: 0.2, maxDurationS: 8 };

export function describe() {
  return { lowMidi: 48, highMidi: 96 };
}

const MIDDLE_C_HZ = 261.63;
const MAX_MODES = 12;
const THICKNESS_M = 0.02;

// Roots of cos(x)cosh(x) = 1, the free-free bar: x_n L for the n-th bending mode.
function barRoots(count) {
  const roots = [];
  for (let n = 1; n <= count; n++) {
    let x = ((2 * n + 1) * Math.PI) / 2;
    for (let i = 0; i < 60; i++) {
      const f = Math.cos(x) * Math.cosh(x) - 1;
      const df = -Math.sin(x) * Math.cosh(x) + Math.cos(x) * Math.sinh(x);
      const step = f / df;
      x -= step;
      if (Math.abs(step) < 1e-13 * x) break;
    }
    roots.push(x);
  }
  return roots;
}
const ROOTS = barRoots(MAX_MODES);

// Mode shape on 0..1 along the bar for root x, normalised to unit mean square.
function modeShape(x) {
  const s = (Math.cosh(x) - Math.cos(x)) / (Math.sinh(x) - Math.sin(x));
  const shape = (u) => Math.cosh(x * u) + Math.cos(x * u) - s * (Math.sinh(x * u) + Math.sin(x * u));
  const n = 800;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n;
    sum += shape(u) ** 2;
  }
  const norm = Math.sqrt(sum / n);
  return (u) => shape(u) / norm;
}
const SHAPES = ROOTS.map(modeShape);

export function render(params, note) {
  const { densityKgM3: rho, youngModulusPa: young } = resolveMaterial(params.material, params.customDensity, params.customModulus);
  const f1 = 440 * 2 ** ((note.midi - 69) / 12);
  const omega1 = 2 * Math.PI * f1;
  // First-mode frequency of a free-free bar: w1 = (x1)^2 * (h / L^2) * sqrt(E / (12 rho)).
  const c = THICKNESS_M * Math.sqrt(young / (12 * rho));
  const lengthM = Math.sqrt((ROOTS[0] ** 2 * c) / omega1);

  // Mode frequencies relative to the first, then the undercut pulls the second
  // and third overtone towards a marimba's 4:1 and 10:1.
  const ratios = ROOTS.map((x) => (x / ROOTS[0]) ** 2);
  const tuned = ratios.slice();
  tuned[1] = ratios[1] + (4 - ratios[1]) * params.undercut;
  tuned[2] = ratios[2] + (10 - ratios[2]) * params.undercut;

  const pulse = malletPulse(contactTimeS(params.malletHardness, note.velocity), contactPower(params.malletHardness));

  // The ring time is for a note at middle C; the material's loss law (see bar-voice.mjs) gives how much sooner a higher
  // note, and how much later a lower one, dies away.
  const family = byId(params.material)?.family ?? 'wood';
  const frequencies = tuned.map((r) => f1 * r);
  const law = lossModel(family, rho);
  const ringTimeS = params.ringTime * (sigmaAt(MIDDLE_C_HZ, law) / sigmaAt(f1, law));
  const sigmas = modeSigmas(frequencies, family, { ringTimeS, overtoneDamping: params.overtoneDamping, densityKgM3: rho });
  const total = Math.round(note.durationS * SAMPLE_RATE);
  const out = new Float64Array(total);
  const nyquistLimit = 0.45 * SAMPLE_RATE;

  for (let m = 0; m < ROOTS.length; m++) {
    const f = frequencies[m];
    if (f > nyquistLimit) break;
    const drive = SHAPES[m](params.strikePosition) * note.velocity;
    const listen = SHAPES[m](params.listenPosition);
    if (m === 0 && params.resonator) addTubedMode(out, { f, sigma: sigmas[0], tubeHzValue: f, drive, listen, mouth: SHAPES[0](0.5), pulse });
    else if (Math.abs(drive * listen) > 1e-9) addModeAcceleration(out, { f, sigma: sigmas[m], gain: drive * listen, pulse });
  }

  const pcm = Float32Array.from(out);
  return { pcm, sampleRate: SAMPLE_RATE, lengthM };
}
