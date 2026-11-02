// SPDX-License-Identifier: GPL-3.0-only
// Plucked-string engine: a digital waveguide string with a physical pick, a
// pickup or a body, driven through the digital-waveguide modules in ./lab.
// Everything the UI shows comes from `schema` and `gallery` below.
import { renderNote } from './lab/model.mjs';
import { instruments } from './lab/data.mjs';
import { byId, materialOptions, resolveMaterial, customMaterialParams } from '../materials.mjs';
import { LOSS_LAWS, partialT60s } from '../string-loss.mjs';
import { pluckWidthM } from '../pluck.mjs';

const REFERENCE_MATERIAL = 'steel-music-wire';

export const meta = {
  id: 'string-waveguide',
  order: 10,
  name: 'Plucked strings',
  description: 'A string that rings and fades the way a real one does, plucked by a finger or a pick, heard through a guitar body or a pickup.',
};

const BASES = {
  acoustic: { label: 'Steel-string acoustic', low: 40, high: 88 },
  electric: { label: 'Electric guitar', low: 40, high: 88 },
  bass: { label: 'Bass guitar', low: 28, high: 67 },
};

const LAB_NOTE_CEILING = 4;
const SAMPLE_RATE = 44100;
const REFERENCE_RADIATION_HZ = 200;
const midiToHz = (midi) => 440 * 2 ** ((midi - 69) / 12);

export const schema = {
  groups: [
    { id: 'instrument', label: 'Instrument' },
    { id: 'pluck', label: 'How it is played' },
    { id: 'string', label: 'The strings' },
    { id: 'pickup', label: 'Pickup' },
  ],
  params: [
    {
      id: 'base', type: 'choice', layer: 'plain', group: 'instrument', label: 'Instrument type',
      help: 'The family of instrument: string lengths, thicknesses and how the sound leaves the instrument.',
      options: Object.entries(BASES).map(([value, b]) => ({ value, label: b.label })), default: 'electric',
    },
    {
      id: 'pluckPosition', type: 'number', layer: 'plain', group: 'pluck', label: 'Where you pluck',
      help: 'Distance of the pluck from the bridge as a fraction of the string. Near the bridge sounds thin and bright; towards the middle sounds round and soft.',
      unit: 'of string length', min: 0.05, max: 0.5, step: 0.005, default: 0.2,
    },
    {
      id: 'pickHardness', type: 'number', layer: 'plain', group: 'pluck', label: 'Soft finger to hard pick',
      help: 'How sharp the pluck is. A soft fingertip leaves out the highest overtones; a hard pick lets them through.',
      min: 0, max: 1, step: 0.01, default: 0.55,
    },
    {
      id: 'ringTime', type: 'number', layer: 'plain', group: 'string', label: 'How long it rings',
      help: 'Scales how long the string keeps sounding. Below 1 is a damped, short note; above 1 sustains longer.',
      unit: '× normal', min: 0.25, max: 4, scale: 'log', step: 0.01, default: 1,
    },
    {
      id: 'brightness', type: 'number', layer: 'plain', group: 'string', label: 'Bright to dark',
      help: 'How quickly the high overtones die away compared with the low ones. Bright keeps the sparkle; dark gives a mellow, muted tone.',
      min: 0, max: 1, step: 0.01, default: 0.5,
    },
    {
      id: 'stringMaterial', type: 'choice', layer: 'plain', group: 'string', label: 'String material',
      help: 'What the strings are made of. Heavier and stiffer materials change the weight and the tension needed for the same pitch, and the overtones with them. The presets are steel strings; pick Custom to type your own density and stiffness.',
      options: materialOptions('metal'), default: REFERENCE_MATERIAL,
    },
    ...customMaterialParams({ group: 'string', idParam: 'stringMaterial', prefix: 'string', layer: 'plain', density: 7750, modulusGPa: 206.84 }),
    {
      id: 'gauge', type: 'number', layer: 'plain', group: 'string', label: 'String thickness',
      help: 'Thickness of the strings compared with the preset. Thicker strings are heavier and stiffer and ring with a fuller, less bendy sound.',
      unit: '× normal', min: 0.6, max: 1.5, scale: 'log', step: 0.01, default: 1,
    },
    {
      id: 'pickupPosition', type: 'number', layer: 'plain', group: 'pickup', label: 'Pickup position',
      help: 'Where the pickup listens along the string, measured from the bridge. Close to the bridge is twangy and sharp; towards the neck is warm and full.',
      unit: 'm from bridge', min: 0.03, max: 0.3, step: 0.005, default: 0.12, visibleWhen: { base: ['electric', 'bass'] },
    },
    {
      id: 'stiffness', type: 'number', layer: 'advanced', group: 'string', label: 'String stiffness',
      help: 'Resistance of the string to bending. Real strings are slightly stiff, which stretches the overtones sharp and gives a bell-like edge; raise it for a metallic, piano-like colour.',
      unit: '× normal', min: 0.1, max: 10, scale: 'log', step: 0.01, default: 1,
    },
    {
      id: 'pickNoise', type: 'number', layer: 'advanced', group: 'pluck', label: 'Pick noise',
      help: 'Amount of random noise in the moment of the pluck: the click and scrape of the pick.',
      min: 0, max: 0.2, step: 0.002, default: 0.012,
    },
    {
      id: 'pluckAngle', type: 'number', layer: 'advanced', group: 'pluck', label: 'Pluck angle',
      help: 'Direction of the pluck across the string. 0° pushes straight in the main direction of vibration; larger angles also excite the sideways vibration, which adds a slow beating between the two.',
      unit: 'degrees', min: 0, max: 90, step: 1, default: 23,
    },
    {
      id: 'pickupLoadHz', type: 'number', layer: 'advanced', group: 'pickup', label: 'Pickup treble roll-off',
      help: 'The frequency above which the pickup stops passing high overtones, set by its electrical load.',
      unit: 'Hz', min: 1000, max: 20000, scale: 'log', step: 10, default: 12000, visibleWhen: { base: ['electric', 'bass'] },
    },
  ],
};

// Each gallery entry is a complete set of parameter values that plays at once.
export const gallery = [
  {
    id: 'steel-acoustic', name: 'Steel-string acoustic',
    description: 'A six-string steel acoustic, plucked with a medium pick near the soundhole.',
    params: { base: 'acoustic', pluckPosition: 0.17, pickHardness: 0.55, ringTime: 1, brightness: 0.5 },
  },
  {
    id: 'electric-clean', name: 'Electric guitar',
    description: 'A six-string electric guitar heard through a pickup in the middle position.',
    params: { base: 'electric', pluckPosition: 0.2, pickHardness: 0.6, ringTime: 1, brightness: 0.55, pickupPosition: 0.12, pickupLoadHz: 1500 },
  },
  {
    id: 'bass-fingers', name: 'Bass guitar',
    description: 'A four-string bass played with the fingertip.',
    params: { base: 'bass', pluckPosition: 0.24, pickHardness: 0.25, ringTime: 1.2, brightness: 0.4, pickupPosition: 0.14, pickupLoadHz: 1500 },
  },
  {
    id: 'glass-harp', name: 'Glassy long-ringing strings',
    description: 'Very stiff, bright strings that ring for a long time: a taste of what the advanced layer can do.',
    params: { base: 'acoustic', pluckPosition: 0.1, pickHardness: 0.9, ringTime: 3, brightness: 0.95, stiffness: 6, pickNoise: 0.002 },
  },
];

export function describe(params) {
  const { low, high } = BASES[params.base];
  return { lowMidi: low, highMidi: high };
}

export const limits = { minDurationS: 0.2, maxDurationS: LAB_NOTE_CEILING };

function hardnessToContactS(h) {
  const soft = 0.0035;
  const hard = 0.0003;
  return soft * (hard / soft) ** h;
}

// Length of string that sounds for a note: the string model plays each note on the
// highest string that can reach it, so a high note is a short length.
function soundingLength(model, midi) {
  const candidates = model.strings.filter((s) => midi >= s.openMidi && midi <= s.openMidi + model.fretCount);
  const string = candidates.at(-1);
  return string ? model.scaleLengthM * 2 ** (-(midi - string.openMidi) / 12) : model.scaleLengthM;
}

function buildModel(params, midi) {
  const model = structuredClone(instruments[params.base]);
  const brightnessFactor = 2 ** (1 - 2 * params.brightness);
  const ref = byId(REFERENCE_MATERIAL);
  const mat = resolveMaterial(params.stringMaterial, params.stringCustomDensity, params.stringCustomModulus);
  const densityRatio = mat.densityKgM3 / ref.densityKgM3;
  const modulusRatio = mat.youngModulusPa / ref.youngModulusPa;
  const g = params.gauge;
  // How fast each partial of the played note dies away: the law measured on the recording of this kind of instrument (../string-loss.mjs).
  const partialT60S = partialT60s(LOSS_LAWS[params.base], midiToHz(midi), SAMPLE_RATE, { ringTime: params.ringTime, brightnessFactor });
  for (const s of model.strings) {
    s.loss = { ...s.loss, t60LowS: partialT60S[0], highLoss: s.loss.highLoss * brightnessFactor, partialT60S };
    s.linearDensityKgM *= densityRatio * g * g;
    s.axialStiffnessN *= modulusRatio * g * g;
    s.effectiveBendingStiffnessNm2 *= params.stiffness * modulusRatio * g ** 4;
  }
  if (model.kind === 'acoustic') {
    // The body is small beside the wavelength, so the pressure follows the rate of change of the air it moves; the gain is kept
    // where it was at 200 Hz so that only the tilt changes.
    model.bodyRadiation = { type: 'acceleration' };
    model.outputGain /= 2 * Math.PI * REFERENCE_RADIATION_HZ;
  } else {
    model.pickup = { ...model.pickup, positionM: Math.min(params.pickupPosition, 0.9 * soundingLength(model, midi)), loadHz: params.pickupLoadHz };
  }
  return model;
}

/**
 * Render one note. Returns { pcm: Float32Array, sampleRate }.
 * `note` is already validated: { midi, velocity, durationS }.
 */
export function render(params, note) {
  const model = buildModel(params, note.midi);
  const sampleRate = SAMPLE_RATE;
  const { lowMidi, highMidi } = describe(params);
  if (note.midi < lowMidi || note.midi > highMidi) throw new Error(`this instrument plays notes ${lowMidi} to ${highMidi}`);
  const recipe = {
    note: { midi: note.midi, velocity: note.velocity, gateS: note.durationS },
    pluck: {
      positionRatio: params.pluckPosition,
      contactTimeS: hardnessToContactS(params.pickHardness),
      contactWidthM: pluckWidthM(params.pickHardness),
      noise: params.pickNoise,
      directionRad: (params.pluckAngle * Math.PI) / 180,
    },
    output: { sampleRate, durationS: note.durationS },
  };
  const result = renderNote(model, recipe);
  return { pcm: Float32Array.from(result.pcm), sampleRate };
}
