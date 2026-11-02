// SPDX-License-Identifier: GPL-3.0-only
// Struck bars on the workbench: any number of bars of any material, each with its own length, thickness and
// carved arch, hit by a mallet, with an optional resonator tube hung under each.
//
// The note of a bar comes from what it is: its length, thickness, material and arch (thin-beam theory, see
// physics.mjs). Nothing here tunes a bar to a note; the page shows the note the bar has, and the player cuts
// it to length. One render is one bar: the shared values (the mallet, where it lands) plus that bar's own.
// The bar is a short list of vibration modes, each ringing at its own pitch and fading at its own rate.
import { byId, materialOptions, resolveMaterial, customMaterialParams } from '../materials.mjs';
import {
  BAR_ROOTS, barFrequencies, barLengthForHz, hzToMidi, midiToHz, tubeHz, tubeLengthForHz, TUBE_RADIUS_M,
} from '../physics.mjs';
import { SAMPLE_RATE, contactTimeS, contactPower, malletPulse, modeSigmas, addModeAcceleration, addTubedMode } from '../bar-voice.mjs';

export const meta = {
  id: 'bars-bench',
  order: 6,
  name: 'Bars workbench',
  description: 'A row of bars you cut and carve by hand: wood or metal, any length and thickness, an arch cut under each to tune its overtones, a tube hung under it to make it ring louder. The sound is an approximation worked out from the bar\'s size and material.',
};

export const bench = {
  // The parts and parameters the bench draws are found by their `role` in the schema below, not by id.
  kind: 'struck-bars',
  hands: [
    { id: 'yarn', name: 'Yarn mallet', glyph: 'mallet', params: { malletHardness: 0.12 } },
    { id: 'rubber', name: 'Rubber mallet', glyph: 'mallet', params: { malletHardness: 0.4 } },
    { id: 'plastic', name: 'Hard plastic mallet', glyph: 'mallet', params: { malletHardness: 0.75 } },
    { id: 'brass', name: 'Brass mallet', glyph: 'mallet', params: { malletHardness: 1 } },
  ],
};

const MIN_HZ = 20;
const MAX_HZ = 12000;
// Measured on the Iowa orchestral bells (brass mallet): C6 and C#6 fall 60 dB in 11.5 and 9.7 s.
const GLOCKENSPIEL_RING_S = 10;
/** A bar of this material and thickness cut to sound at a note, to a tenth of a millimetre. */
function barFor(midi, barMaterial, barThicknessMm, barUndercut = 0, extra = {}) {
  const { densityKgM3, youngModulusPa } = resolveMaterial(barMaterial);
  const lengthM = barLengthForHz({ hz: midiToHz(midi), densityKgM3, youngModulusPa, thicknessM: barThicknessMm / 1000, undercut: barUndercut });
  return { barMaterial, barThicknessMm, barUndercut, barLengthMm: Math.round(lengthM * 10000) / 10, ...extra };
}

/** The same, with a tube under it tuned to the note. */
const withTube = (midi, ...rest) => barFor(midi, ...rest, { tubeFit: true, tubeLengthMm: Math.round(tubeLengthForHz(midiToHz(midi)) * 10000) / 10 });

const barEntry = (id, name, description, params) => ({ id, name, description, params });

const RACK = [
  barEntry('maple-c5', 'Maple bar', 'A bar of hard maple, cut to the note C5: bright and dry.', barFor(72, 'sugar-maple', 19, 0.3)),
  barEntry('basswood-c4', 'Basswood bar', 'A bar of basswood, a light wood, cut to middle C: warm and soft.', barFor(60, 'american-basswood', 22, 0.6)),
  barEntry('cedar-g4', 'Cedar bar', 'A bar of western redcedar: very light, with a short hollow note. Cut to G4.', barFor(67, 'western-redcedar', 20, 0.3)),
  barEntry('ash-c4', 'Ash bar', 'A bar of white ash, stiff and ringing for a wood. Cut to middle C.', barFor(60, 'white-ash', 22, 0.5)),
  barEntry('steel-c6', 'Steel bar', 'A bar of steel cut to C6, as thick as a glockenspiel\'s: a long, bright ring.', barFor(84, 'steel-music-wire', 9, 0)),
  barEntry('brass-g5', 'Brass bar', 'A bar of brass cut to G5: a little softer than steel, a warm bell.', barFor(79, 'brass', 6, 0)),
];

export const schema = {
  groups: [
    { id: 'bar', label: 'The bar' },
    { id: 'tube', label: 'The tube under it' },
    { id: 'mallet', label: 'The mallet' },
    { id: 'frame', label: 'The frame' },
    { id: 'ring', label: 'How it rings' },
    { id: 'listen', label: 'Listening' },
  ],
  parts: [
    { id: 'bar', role: 'bar', label: 'Bar', min: 1, max: 12, rack: RACK },
  ],
  params: [
    {
      id: 'strikeAt', role: 'strikeAt', type: 'number', layer: 'plain', group: 'mallet', label: 'Where you strike',
      help: 'Distance of the mallet from the end of the bar as a fraction of its length. The middle gives the fullest note; near the end brings out the clangy overtones.',
      unit: 'of bar length', min: 0.03, max: 0.5, step: 0.005, default: 0.38, physical: 'fraction',
    },
    {
      id: 'malletHardness', role: 'malletHardness', type: 'number', layer: 'plain', group: 'mallet', label: 'Soft to hard mallet',
      help: 'A soft yarn mallet gives a round tone with few overtones; a hard plastic or brass mallet gives a bright, bell-like attack.',
      min: 0, max: 1, step: 0.01, default: 0.5, physical: 'hardness', onBench: true,
    },
    {
      id: 'frameWood', role: 'frameWood', type: 'choice', layer: 'plain', group: 'frame', label: 'Frame wood',
      help: 'What the frame the bars lie on is made of. In this basic model it changes how the frame looks, not how the bars sound.',
      options: materialOptions('wood'), default: 'american-basswood', physical: 'material', onBench: true, affectsSound: false,
    },
    {
      id: 'overtoneDamping', type: 'number', layer: 'advanced', group: 'ring', label: 'High overtones fade faster',
      help: 'How much quicker the higher overtones die away than the note. 0 makes every overtone ring as long as the note; 0.6 is a real bar (wood loses the same share of its energy each cycle, so an overtone at four times the pitch dies four times as fast); 1 makes the high ones vanish faster still.',
      min: 0, max: 1, step: 0.01, default: 0.6,
    },
    {
      id: 'listenPosition', type: 'number', layer: 'advanced', group: 'listen', label: 'Listening point',
      help: 'Where along the bar the sound is picked up. Some overtones have a quiet spot that moves with this.',
      unit: 'of bar length', min: 0.02, max: 0.98, step: 0.01, default: 0.25, physical: 'fraction',
    },
    {
      id: 'barMaterial', role: 'barMaterial', type: 'choice', layer: 'plain', group: 'bar', part: 'bar', label: 'Bar material',
      help: 'What the bar is made of. Stiff, light materials ring higher for the same size; dense, soft ones ring lower. Drop a swatch on the bar, or pick Custom to type your own density and stiffness.',
      options: materialOptions(['wood', 'metal', 'polymer']), default: 'sugar-maple', physical: 'material', onBench: true,
    },
    ...customMaterialParams({ group: 'bar', idParam: 'barMaterial', prefix: 'bar', layer: 'plain', density: 700, modulusGPa: 13 })
      .map((p) => ({ ...p, part: 'bar', role: p.id })),
    {
      id: 'barLengthMm', role: 'barLengthMm', type: 'number', layer: 'plain', group: 'bar', part: 'bar', label: 'Length',
      help: 'The length of the bar. A longer bar sounds lower: halve the length and the note rises two octaves.',
      unit: 'mm', min: 40, max: 1500, step: 0.1, default: 320, physical: 'length', onBench: true,
    },
    {
      id: 'barThicknessMm', role: 'barThicknessMm', type: 'number', layer: 'plain', group: 'bar', part: 'bar', label: 'Thickness',
      help: 'How thick the bar is. A thicker bar sounds higher: double the thickness and the note rises an octave.',
      unit: 'mm', min: 2, max: 60, step: 0.1, default: 19, physical: 'thickness', onBench: true,
    },
    {
      id: 'barUndercut', role: 'barUndercut', type: 'number', layer: 'plain', group: 'bar', part: 'bar', label: 'Carved arch',
      help: 'How deep the arch under the bar is cut. A plain bar has clangorous overtones. A marimba maker carves the middle of the underside away until the first overtone is exactly two octaves above the note, so it sounds clear (full arch). Carving also lowers the note, so the bar is cut to length afterwards. 0 is a plain bar; 1 is the full arch.',
      min: 0, max: 1, step: 0.01, default: 0, physical: 'depth', onBench: true,
    },
    {
      id: 'tubeFit', role: 'tubeFit', type: 'toggle', layer: 'plain', group: 'tube', part: 'bar', label: 'Tube under the bar',
      help: 'A tube, closed at the bottom, hung under the bar. Its column of air rings at its own pitch, which is set by its length. When that is the note of the bar the note comes out louder and fades sooner.',
      default: false, physical: 'other', onBench: true,
    },
    {
      id: 'tubeLengthMm', role: 'tubeLengthMm', type: 'number', layer: 'plain', group: 'tube', part: 'bar', label: 'Tube length',
      help: 'The length of the tube. The air in it rings at a quarter of a wavelength: about 190 mm for the A above middle C, and longer for lower notes.',
      unit: 'mm', min: 30, max: 1500, step: 1, default: 250, physical: 'length', onBench: true, visibleWhen: { tubeFit: [true] },
    },
    {
      id: 'barRingTime', type: 'number', layer: 'advanced', group: 'ring', part: 'bar', label: 'How long it rings',
      help: 'Time for the note to fade by 60 dB. 0 means what is usual for the material and the pitch: a metal bar rings for seconds, a wooden one for a second or two when low and a fraction of a second when high. These usual times are from a marimba and a vibraphone, not measurements of this bar.',
      unit: 'seconds', min: 0, max: 12, step: 0.01, default: 0,
    },
  ],
};

export const gallery = [
  {
    id: 'maple-xylophone', name: 'Maple xylophone',
    description: 'Eight bars of hard maple, a scale from C5, with a little arch cut under each so the first overtone sits at three times the note, and a short tube hung under each. Bright and dry; struck with a hard mallet.',
    params: { strikeAt: 0.42, malletHardness: 0.7, frameWood: 'sitka-spruce' },
    parts: { bar: [72, 74, 76, 77, 79, 81, 83, 84].map((m) => withTube(m, 'sugar-maple', 19, 0.3)) },
  },
  {
    id: 'basswood-marimba', name: 'Tuned marimba bars with tubes',
    description: 'Eight bars of hard maple (a dense wood like the rosewood of a real marimba), a scale up from C3, each carved with the full arch and hung over a tube cut to its note. Warm and round; struck with a yarn mallet.',
    params: { strikeAt: 0.44, malletHardness: 0.2, frameWood: 'red-alder' },
    parts: { bar: [48, 50, 52, 53, 55, 57, 59, 60].map((m) => withTube(m, 'sugar-maple', 22, 1)) },
  },
  {
    id: 'steel-glockenspiel', name: 'Steel glockenspiel',
    description: 'Eight plain bars of steel 9 mm thick (as on a concert glockenspiel), a scale up from C6. Bright and ringing; struck with a brass mallet.',
    params: { strikeAt: 0.42, malletHardness: 0.95, frameWood: 'white-ash' },
    parts: { bar: [84, 86, 88, 89, 91, 93, 95, 96].map((m) => barFor(m, 'steel-music-wire', 9, 0, { barRingTime: GLOCKENSPIEL_RING_S })) },
  },
  {
    id: 'four-materials', name: 'One note, four materials',
    description: 'Four bars all cut to C5: cedar, maple, brass and steel. The same pitch, but each is a different length. The two woods die away within a second (the cedar sooner); the two metals ring for many seconds, and in this model brass and steel ring alike.',
    params: { strikeAt: 0.38, malletHardness: 0.55, frameWood: 'american-basswood' },
    parts: { bar: [barFor(72, 'western-redcedar', 18, 0.2), barFor(72, 'sugar-maple', 18, 0.2), barFor(72, 'brass', 6, 0), barFor(72, 'steel-music-wire', 6, 0)] },
  },
  {
    id: 'single-maple-bar', name: 'A single maple bar',
    description: 'One plain bar of hard maple, cut to middle C. A place to start: stretch it, carve it, hang a tube under it.',
    params: { strikeAt: 0.38, malletHardness: 0.45, frameWood: 'american-basswood' },
    parts: { bar: [barFor(60, 'sugar-maple', 20, 0)] },
  },
];

export const limits = { minDurationS: 0.2, maxDurationS: 8 };

function barSpec(p) {
  const { densityKgM3, youngModulusPa } = resolveMaterial(p.barMaterial, p.barCustomDensity, p.barCustomModulus);
  const frequencies = barFrequencies({ densityKgM3, youngModulusPa, lengthM: p.barLengthMm / 1000, thicknessM: p.barThicknessMm / 1000, undercut: p.barUndercut });
  return { densityKgM3, youngModulusPa, frequencies, hz: frequencies[0] };
}

function checkSounds(hz) {
  if (hz >= MIN_HZ && hz <= MAX_HZ) return;
  const error = new Error(`this bar would sound at ${hz < MIN_HZ ? 'under 20' : 'over 12000'} Hz: it is ${hz < MIN_HZ ? 'too long and thin' : 'too short and thick'} to use`);
  error.unplayable = true;
  throw error;
}

/** One bar's range is its own nearest note. A bar too small or too large to sound is unplayable. */
export function describe(p) {
  const { hz } = barSpec(p);
  checkSounds(hz);
  const midi = Math.round(hzToMidi(hz));
  return { lowMidi: midi, highMidi: midi };
}

// The host levels loudness once per bar, not once per blow, so where the bar is struck and with what must not
// start a new measurement. The tube is left in: a tuned tube is meant to make the bar louder.
export function levelling(p) {
  return { params: { ...p, strikeAt: 0.38, malletHardness: 0.5 } };
}

// Roots of the free-free bar and the shape of each mode along it, for the strike and the listening point.
const ROOTS = BAR_ROOTS.slice(0, 6);
function modeShape(x) {
  const s = (Math.cosh(x) - Math.cos(x)) / (Math.sinh(x) - Math.sin(x));
  const shape = (u) => Math.cosh(x * u) + Math.cos(x * u) - s * (Math.sinh(x * u) + Math.sin(x * u));
  const n = 800;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += shape((i + 0.5) / n) ** 2;
  const norm = Math.sqrt(sum / n);
  return (u) => shape(u) / norm;
}
const SHAPES = ROOTS.map(modeShape);

// How a bar of this kind rings, by default, is the loss law of its family of material (see bar-voice.mjs): the library
// holds no loss factors of its own, so these are from the family, measured on a marimba and a vibraphone, not on this bar.
const familyOf = (materialId) => byId(materialId)?.family ?? 'wood';

/**
 * Render one blow on one bar. `note.midi` is the bar's own nearest note (the page asks for that note); the pitch
 * the bar sounds at comes from its size, not from the note. Returns { pcm: Float32Array, sampleRate }.
 */
export function render(p, note) {
  const spec = barSpec(p);
  checkSounds(spec.hz);
  const sigmas = modeSigmas(spec.frequencies, familyOf(p.barMaterial), { ringTimeS: p.barRingTime, overtoneDamping: p.overtoneDamping, densityKgM3: spec.densityKgM3 });
  const tube = p.tubeFit ? tubeHz(p.tubeLengthMm / 1000, TUBE_RADIUS_M) : null;

  const pulse = malletPulse(contactTimeS(p.malletHardness, note.velocity), contactPower(p.malletHardness));
  const total = Math.round(note.durationS * SAMPLE_RATE);
  const out = new Float64Array(total);
  const nyquistLimit = 0.45 * SAMPLE_RATE;

  for (let m = 0; m < ROOTS.length; m++) {
    const f = spec.frequencies[m];
    if (f > nyquistLimit) break;
    const drive = SHAPES[m](p.strikeAt) * note.velocity;
    const listen = SHAPES[m](p.listenPosition);
    if (m === 0 && tube !== null) addTubedMode(out, { f, sigma: sigmas[0], tubeHzValue: tube, drive, listen, mouth: SHAPES[0](0.5), pulse });
    else if (Math.abs(drive * listen) > 1e-9) addModeAcceleration(out, { f, sigma: sigmas[m], gain: drive * listen, pulse });
  }
  return { pcm: Float32Array.from(out), sampleRate: SAMPLE_RATE };
}
