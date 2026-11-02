// SPDX-License-Identifier: GPL-3.0-only
// Guitar workbench engine: a plucked string whose pitch comes from its real
// length, tension, thickness and material, heard through a basic guitar body
// worked out from the drawn outline, depth, sound hole and wood.
//
// It is made for the workbench (see `bench` below), where one render is one
// string: the shared instrument values plus the values of that string.
// The string itself is the digital waveguide in ../string-waveguide/lab.
import { renderNote } from '../string-waveguide/lab/model.mjs';
import { LOSS_LAWS, NYLON_LAW, NYLON_WOUND_LAW, partialT60s } from '../string-loss.mjs';
import { pluckWidthM } from '../pluck.mjs';
import { byId, materialOptions, resolveMaterial, customMaterialParams } from '../materials.mjs';
import {
  bodyOutline, nearestNote, stringPhysics, tensionForHz, frettedLengthM, midiToHz,
} from '../physics.mjs';

export const meta = {
  id: 'guitar-bench',
  order: 5,
  name: 'Guitar workbench',
  description: 'A guitar-like instrument you build by hand: strings of real length, tension and material over a body you draw. The sound of the body is an approximation worked out from its size, depth, sound hole and wood.',
};

const MAX_FRET = 24;
const MIN_HZ = 16;
const MAX_HZ = 1400;
const WOOD_OPTIONS = materialOptions('wood');
const STRING_OPTIONS = materialOptions(['metal', 'polymer']);

export const bench = {
  // The parts and parameters the bench draws are found by their `role` in the schema below, not by id.
  kind: 'plucked-strings',
  // Hands set values by role: a thumb is a soft touch, a pick a hard one.
  hands: [
    { id: 'thumb', name: 'Thumb', params: { pickHardness: 0.15 } },
    { id: 'finger', name: 'Fingertip', params: { pickHardness: 0.4 } },
    { id: 'pick', name: 'Pick', params: { pickHardness: 0.85 } },
  ],
};

const stringEntry = (id, name, description, params) => ({ id, name, description, params });

const RACK = [
  stringEntry('steel-plain', 'Plain steel', 'A bare steel string, medium thin.', { stringMaterial: 'steel-music-wire', stringDiameterMm: 0.33, stringWound: false }),
  stringEntry('steel-thin', 'Thin plain steel', 'A very thin bare steel string for the highest notes.', { stringMaterial: 'steel-music-wire', stringDiameterMm: 0.25, stringWound: false }),
  stringEntry('steel-wound', 'Wound steel', 'Steel wire wrapped round a core: heavier for the same thickness, so it sounds lower at the same tension.', { stringMaterial: 'steel-music-wire', stringDiameterMm: 0.9, stringWound: true }),
  stringEntry('steel-wound-heavy', 'Heavy wound steel', 'A thick wound string for deep notes.', { stringMaterial: 'steel-music-wire', stringDiameterMm: 1.35, stringWound: true }),
  stringEntry('bronze-wound', 'Bronze wound', 'Phosphor bronze wire wrapped round a core: warm and heavy.', { stringMaterial: 'phosphor-bronze', stringDiameterMm: 0.9, stringWound: true }),
  stringEntry('nylon-plain', 'Nylon', 'A bare nylon string: soft and round.', { stringMaterial: 'nylon-66', stringDiameterMm: 0.7, stringWound: false }),
  stringEntry('nylon-thick', 'Thick nylon', 'A thick bare nylon string for lower notes.', { stringMaterial: 'nylon-66', stringDiameterMm: 1.1, stringWound: false }),
];

export const schema = {
  groups: [
    { id: 'neck', label: 'Neck and strings' },
    { id: 'body', label: 'Body' },
    { id: 'string', label: 'The string' },
    { id: 'hand', label: 'The hand' },
    { id: 'drawer', label: 'Finer adjustments' },
  ],
  parts: [
    { id: 'string', role: 'string', label: 'String', min: 1, max: 8, rack: RACK },
    { id: 'fret', role: 'fret', label: 'Fret', min: 1, max: 24, standard: 19 },
  ],
  params: [
    {
      id: 'scaleLengthMm', role: 'scaleLengthMm', type: 'number', layer: 'plain', group: 'neck', label: 'Scale length', physical: 'length', onBench: true,
      help: 'The length of string that sounds when it is not pressed down: from the nut to the bridge. A longer string at the same tension sounds lower.',
      unit: 'mm', min: 250, max: 1100, step: 1, default: 645,
    },
    {
      id: 'bridgeAtMm', role: 'bridgeAtMm', type: 'number', layer: 'plain', group: 'neck', label: 'Bridge position', physical: 'place', onBench: true,
      help: 'How far the bridge sits from where the neck meets the body, measured along the body.',
      unit: 'mm', min: 150, max: 600, step: 1, default: 300,
    },
    {
      id: 'neckWood', role: 'neckWood', type: 'choice', layer: 'plain', group: 'neck', label: 'Neck wood', physical: 'material', onBench: true, affectsSound: false,
      help: 'What the neck and fingerboard are made of. In this basic model it changes how the guitar looks, not how it sounds.',
      options: WOOD_OPTIONS.filter((o) => o.value !== 'custom'), default: 'sugar-maple',
    },
    {
      id: 'bodyLengthMm', role: 'bodyLengthMm', type: 'number', layer: 'plain', group: 'body', label: 'Body length', physical: 'length', onBench: true,
      help: 'From where the neck joins the body to the tail end.',
      unit: 'mm', min: 250, max: 650, step: 1, default: 500,
    },
    {
      id: 'upperBoutMm', role: 'upperBoutMm', type: 'number', layer: 'plain', group: 'body', label: 'Upper bout width', physical: 'length', onBench: true,
      help: 'Width of the body across its upper, shoulder end.',
      unit: 'mm', min: 150, max: 420, step: 1, default: 290,
    },
    {
      id: 'waistMm', role: 'waistMm', type: 'number', layer: 'plain', group: 'body', label: 'Waist width', physical: 'length', onBench: true,
      help: 'Width of the body at its narrowest point.',
      unit: 'mm', min: 110, max: 380, step: 1, default: 245,
    },
    {
      id: 'lowerBoutMm', role: 'lowerBoutMm', type: 'number', layer: 'plain', group: 'body', label: 'Lower bout width', physical: 'length', onBench: true,
      help: 'Width of the body across its lower, tail end.',
      unit: 'mm', min: 180, max: 500, step: 1, default: 390,
    },
    {
      id: 'waistAt', role: 'waistAt', type: 'number', layer: 'plain', group: 'body', label: 'Waist position', physical: 'fraction', onBench: true,
      help: 'Where the waist sits along the body, as a fraction of its length from the neck.',
      min: 0.35, max: 0.65, step: 0.005, default: 0.5,
    },
    {
      id: 'bodyDepthMm', role: 'bodyDepthMm', type: 'number', layer: 'plain', group: 'body', label: 'Body depth', physical: 'depth', onBench: true,
      help: 'How deep the body is, from the top to the back. A deeper body holds more air and has a lower air resonance.',
      unit: 'mm', min: 40, max: 160, step: 1, default: 105,
    },
    {
      id: 'holeDiameterMm', role: 'holeDiameterMm', type: 'number', layer: 'plain', group: 'body', label: 'Sound hole size', physical: 'length', onBench: true,
      help: 'Diameter of the sound hole. A bigger hole raises the pitch of the air resonance inside the body.',
      unit: 'mm', min: 20, max: 140, step: 1, default: 100,
    },
    {
      id: 'holeAtMm', role: 'holeAtMm', type: 'number', layer: 'plain', group: 'body', label: 'Sound hole position', physical: 'place', onBench: true,
      help: 'How far the centre of the sound hole is from where the neck meets the body. In this basic model it changes how the guitar looks, not how it sounds.',
      unit: 'mm', min: 40, max: 300, step: 1, default: 110,
    },
    {
      id: 'topWood', role: 'topWood', type: 'choice', layer: 'plain', group: 'body', label: 'Top wood', physical: 'material', onBench: true,
      help: 'What the top (the face with the sound hole) is made of. A stiffer, lighter top vibrates at a higher pitch.',
      options: WOOD_OPTIONS, default: 'sitka-spruce',
    },
    ...customMaterialParams({ group: 'body', idParam: 'topWood', prefix: 'top', layer: 'plain', density: 450, modulusGPa: 12 }).map((p) => ({ ...p, role: p.id, onBench: true })),
    {
      id: 'topThicknessMm', role: 'topThicknessMm', type: 'number', layer: 'plain', group: 'body', label: 'Top thickness', physical: 'thickness', onBench: true,
      help: 'Thickness of the top. A thicker top is stiffer, which raises its resonances.',
      unit: 'mm', min: 1.5, max: 5, step: 0.1, default: 2.8,
    },
    {
      id: 'backWood', role: 'backWood', type: 'choice', layer: 'plain', group: 'body', label: 'Back and sides wood', physical: 'material', onBench: true,
      help: 'What the back and sides are made of.',
      options: WOOD_OPTIONS, default: 'american-basswood',
    },
    ...customMaterialParams({ group: 'body', idParam: 'backWood', prefix: 'back', layer: 'plain', density: 450, modulusGPa: 12 }).map((p) => ({ ...p, role: p.id, onBench: true })),
    {
      id: 'pluckDistanceMm', role: 'pluckDistanceMm', type: 'number', layer: 'plain', group: 'hand', label: 'Where the string is plucked', physical: 'place', onBench: true,
      help: 'Distance of the pluck from the bridge. Near the bridge sounds thin and bright; towards the middle of the string sounds round and soft.',
      unit: 'mm', min: 5, max: 600, step: 1, default: 110,
    },
    {
      id: 'pickHardness', role: 'pickHardness', type: 'number', layer: 'plain', group: 'hand', label: 'Soft finger to hard pick', physical: 'hardness', onBench: true,
      help: 'How sharp the pluck is. A soft thumb leaves out the highest overtones; a hard pick lets them through.',
      min: 0, max: 1, step: 0.01, default: 0.4,
    },
    {
      id: 'pickupFit', role: 'pickupFit', type: 'choice', layer: 'plain', group: 'body', label: 'Pickup', physical: 'other', onBench: true,
      help: 'A magnetic pickup under the strings. With one fitted the sound is taken from the strings at the pickup, as on an electric guitar, instead of from the body.',
      options: [{ value: 'none', label: 'No pickup' }, { value: 'magnetic', label: 'Magnetic pickup' }], default: 'none',
    },
    {
      id: 'pickupAtMm', role: 'pickupAtMm', type: 'number', layer: 'plain', group: 'body', label: 'Pickup position', physical: 'place', onBench: true,
      help: 'How far the pickup is from the bridge. Close to the bridge it is thin and bright; towards the neck it is round and full. Only matters when a pickup is fitted.',
      unit: 'mm', min: 15, max: 450, step: 1, default: 110,
    },
    // ---- per fret (one for each fret wire on the neck) ----
    {
      id: 'fretNumber', role: 'fretNumber', type: 'number', layer: 'plain', group: 'neck', part: 'fret', label: 'Fret', physical: 'place', onBench: true, affectsSound: false,
      help: 'Which semitone this fret wire stands at: fret 12 is half way along the string. A string can only be stopped where there is a fret.',
      integer: true, min: 1, max: 24, step: 1, default: 1,
    },
    // ---- per string (one set for each string on the bench) ----
    {
      id: 'stringMaterial', role: 'stringMaterial', type: 'choice', layer: 'plain', group: 'string', part: 'string', label: 'String material', physical: 'material', onBench: true,
      help: 'What this string is made of. The presets are bought-in materials with published density and stiffness; pick Custom to type your own.',
      options: STRING_OPTIONS, default: 'steel-music-wire',
    },
    ...customMaterialParams({ group: 'string', idParam: 'stringMaterial', prefix: 'string', layer: 'plain', density: 7750, modulusGPa: 206.84 }).map((p) => ({ ...p, part: 'string', role: p.id, onBench: true })),
    {
      id: 'stringDiameterMm', role: 'stringDiameterMm', type: 'number', layer: 'plain', group: 'string', part: 'string', label: 'String thickness', physical: 'diameter', onBench: true,
      help: 'Thickness of the string. A thicker string is heavier, so at the same tension it sounds lower.',
      unit: 'mm', min: 0.1, max: 3.5, scale: 'log', step: 0.01, default: 0.33,
    },
    {
      id: 'stringWound', role: 'stringWound', type: 'toggle', layer: 'plain', group: 'string', part: 'string', label: 'Wound string', onBench: true,
      help: 'A wound string is a thin core with wire wrapped round it. It is lighter for its thickness than a solid one, and bends more easily than a solid one of the same thickness.',
      default: false,
    },
    {
      id: 'tensionN', role: 'tensionN', type: 'number', layer: 'plain', group: 'string', part: 'string', label: 'Tension', physical: 'tension', onBench: true,
      help: 'How hard the string is pulled between the nut and the bridge. More tension raises the pitch. A steel guitar string carries about 70 to 130 newtons (7 to 13 kilograms of pull).',
      unit: 'N', min: 3, max: 300, scale: 'log', step: 0.1, default: 80,
    },
    // ---- finer adjustments ----
    {
      id: 'ringTime', type: 'number', layer: 'advanced', group: 'drawer', label: 'How long the strings ring', physical: 'time',
      help: 'Scales how long the strings keep sounding. Below 1 is a damped, short note; above 1 sustains longer.',
      unit: '× normal', min: 0.25, max: 4, scale: 'log', step: 0.01, default: 1,
    },
    {
      id: 'brightness', type: 'number', layer: 'advanced', group: 'drawer', label: 'Bright to dark', physical: 'other',
      help: 'How quickly the high overtones die away compared with the low ones. Bright keeps the sparkle; dark gives a mellow, muted tone.',
      min: 0, max: 1, step: 0.01, default: 0.5,
    },
    {
      id: 'stiffness', role: 'stiffness', type: 'number', layer: 'advanced', group: 'drawer', label: 'String stiffness', physical: 'other',
      help: 'Resistance of the string to bending, as a multiple of the real value for its thickness and material. A stiffer string has overtones that stretch sharp and a bell-like edge.',
      unit: '× normal', min: 0.1, max: 10, scale: 'log', step: 0.01, default: 1,
    },
    {
      id: 'pickNoise', type: 'number', layer: 'advanced', group: 'drawer', label: 'Pick noise', physical: 'other',
      help: 'Amount of random noise in the moment of the pluck: the click and scrape of the pick.',
      min: 0, max: 0.2, step: 0.002, default: 0.012,
    },
    {
      id: 'pluckAngle', type: 'number', layer: 'advanced', group: 'drawer', label: 'Pluck angle', physical: 'angle',
      help: 'Direction of the pluck across the string. 0° pushes straight in the main direction of vibration; larger angles also excite the sideways vibration, which adds a slow beating between the two.',
      unit: 'degrees', min: 0, max: 90, step: 1, default: 23,
    },
  ],
};

// ------------------------------------------------------------------ starting instruments

const baseBody = { bodyLengthMm: 500, upperBoutMm: 290, waistMm: 245, lowerBoutMm: 390, waistAt: 0.5, bodyDepthMm: 105, holeDiameterMm: 100, holeAtMm: 110 };

/** The frets of an ordinary guitar neck: one for each semitone, 1 to 19. */
const standardFrets = () => Array.from({ length: 19 }, (_, k) => ({ fretNumber: k + 1 }));

/** Strings for a gallery entry, each tuned to the note it is meant for. */
function tunedStrings(scaleLengthMm, list) {
  return list.map(([midi, diameter, wound, material = 'steel-music-wire', ownDensity, ownModulusGPa]) => {
    const mat = material === 'custom' ? { densityKgM3: ownDensity, youngModulusPa: ownModulusGPa * 1e9 } : byId(material);
    const facts = stringFacts({ scaleLengthMm, stringMaterial: material, stringDiameterMm: diameter, stringWound: wound, stringCustomDensity: mat.densityKgM3, stringCustomModulus: mat.youngModulusPa / 1e9, tensionN: 1, stiffness: 1 });
    const tension = tensionForHz({ lengthM: scaleLengthMm / 1000, hz: midiToHz(midi), linearDensityKgM: facts.mu, bendingNm2: facts.bending });
    return {
      stringMaterial: material, stringDiameterMm: diameter, stringWound: wound, tensionN: Math.round(tension * 10) / 10,
      ...(material === 'custom' ? { stringCustomDensity: ownDensity, stringCustomModulus: ownModulusGPa } : {}),
    };
  });
}

// A classical guitar set, in the gauges makers print for normal tension: three plain nylon strings
// (G 1.0 mm, B 0.83 mm, E 0.70 mm, material data from the nylon 6/6 sheet) and three wound strings
// (E 1.10 mm, A 0.90 mm, D 0.76 mm): silver-plated copper wire over a soft floss core. The materials list has
// no wound nylon string, so the three wound ones are 'your own material' with an effective density and
// stiffness: the density (7300, 6150 and 4850 kg/m³, for the wound-string rule that the wrap fills 85% of the
// circle) is the one that makes the string carry about 7 kg of pull when tuned, which is what a classical
// string does, and the stiffness is the core's (3 GPa, nylon). They are estimates, not measurements.
const NYLON_STRINGS = [
  [40, 1.1, true, 'custom', 7300, 3], [45, 0.9, true, 'custom', 6150, 3], [50, 0.76, true, 'custom', 4850, 3],
  [55, 1.0, false, 'nylon-66'], [59, 0.83, false, 'nylon-66'], [64, 0.7, false, 'nylon-66'],
];

export const gallery = [
  {
    id: 'steel-guitar', name: 'Steel-string guitar',
    description: 'Six steel strings, 645 mm scale, over a full-size body with a spruce top.',
    params: { ...baseBody, scaleLengthMm: 645, bridgeAtMm: 300 },
    parts: { fret: standardFrets(), string: tunedStrings(645, [[40, 1.346, true], [45, 1.067, true], [50, 0.813, true], [55, 0.61, true], [59, 0.406, false], [64, 0.305, false]]) },
  },
  {
    id: 'parlour-guitar', name: 'Small parlour guitar',
    description: 'A short-scale guitar with a smaller body and lighter strings: quieter, with less bass.',
    params: { scaleLengthMm: 600, bridgeAtMm: 255, bodyLengthMm: 430, upperBoutMm: 245, waistMm: 200, lowerBoutMm: 325, waistAt: 0.5, bodyDepthMm: 85, holeDiameterMm: 82, holeAtMm: 95, topThicknessMm: 2.5, backWood: 'red-alder' },
    parts: { fret: standardFrets(), string: tunedStrings(600, [[40, 1.2, true, 'phosphor-bronze'], [45, 0.95, true, 'phosphor-bronze'], [50, 0.72, true, 'phosphor-bronze'], [55, 0.53, true, 'phosphor-bronze'], [59, 0.355, false], [64, 0.28, false]]) },
  },
  {
    id: 'acoustic-bass', name: 'Acoustic bass',
    description: 'Four heavy wound strings on a long 864 mm scale over a large, deep body. There is no recording of an acoustic bass here to check it against, only the picked electric bass.',
    params: { scaleLengthMm: 864, bridgeAtMm: 360, bodyLengthMm: 560, upperBoutMm: 330, waistMm: 275, lowerBoutMm: 430, waistAt: 0.5, bodyDepthMm: 125, holeDiameterMm: 95, holeAtMm: 120, topThicknessMm: 3, backWood: 'sugar-maple', neckWood: 'white-ash' },
    parts: { fret: standardFrets(), string: tunedStrings(864, [[28, 2.54, true], [33, 2.03, true], [38, 1.65, true], [43, 1.14, true]]) },
  },
  {
    id: 'nylon-guitar', name: 'Nylon-strung guitar',
    description: 'Soft nylon strings on a cedar-topped body: gentle attack and a round tone. The top three are plain nylon, the bottom three are wire wound round a soft core; their weight and stiffness are estimates (see the notes in the engine), because the materials list has no wound nylon string.',
    params: { ...baseBody, scaleLengthMm: 650, bridgeAtMm: 300, topWood: 'western-redcedar', backWood: 'red-alder', topThicknessMm: 2.4, neckWood: 'american-basswood' },
    parts: { fret: standardFrets(), string: tunedStrings(650, NYLON_STRINGS) },
  },
];

// ------------------------------------------------------------------ the physics of one render

/**
 * The partial decay law of a string. A nylon string, plain or wound, has a soft core, which is what sets how it rings: a string of
 * 'your own material' is taken as nylon when its stiffness is a polymer's (under 20 GPa), as the wound strings of the classical
 * set are. (They used to fall to the steel law because 'your own material' has no family.)
 */
export function lossLawFor(params) {
  const known = byId(params.stringMaterial);
  const soft = known ? known.family === 'polymer' : params.stringMaterial === 'custom' && params.stringCustomModulus < 20;
  if (soft) return params.stringWound ? NYLON_WOUND_LAW : NYLON_LAW;
  return params.pickupFit === 'magnetic' ? LOSS_LAWS.electric : LOSS_LAWS.acoustic;
}

/** What a string's values say about the string itself: mass, stiffness, pitch. */
export function stringFacts(p) {
  const mat = resolveMaterial(p.stringMaterial, p.stringCustomDensity, p.stringCustomModulus);
  return { mat, ...stringPhysics({ ...mat, diameterMm: p.stringDiameterMm, wound: p.stringWound, tensionN: p.tensionN, scaleLengthMm: p.scaleLengthMm, stiffness: p.stiffness ?? 1 }) };
}

export function describe(params) {
  const { hz, midi } = stringFacts(params);
  if (!(hz >= MIN_HZ && hz <= MAX_HZ)) throw Object.assign(new Error(`this string would sound at ${hz.toFixed(0)} Hz, outside what can be played here (${MIN_HZ} to ${MAX_HZ} Hz): change its tension, thickness or length`), { unplayable: true });
  const low = nearestNote(midi).midi;
  return { lowMidi: low, highMidi: Math.min(127, low + MAX_FRET) };
}

export const limits = { minDurationS: 0.2, maxDurationS: 4 };

// The host levels loudness once per string and body, not once per pluck, so
// where the string is plucked must not trigger a new measurement. A touch or a
// strum plays the open string, so that is the note the host measures: then the
// open strings sit at the same level, whatever each one's gauge and pitch do
// against the body's resonances.
export function levelling(params) {
  const { lowMidi } = describe(params);
  return { params: { ...params, pluckDistanceMm: Math.round(params.scaleLengthMm * 0.17), pickHardness: 0.55 }, note: { midi: lowMidi } };
}

// ---- the body: four resonances, scaled from a typical steel-string guitar.
// The typical steel-string body has four modes (about 105, 205, 395 and 710 Hz).
// Here each is moved by the size and wood of the drawn body with simple scaling
// laws: the air in the body against its sound hole (a Helmholtz resonator), and
// plates whose pitch rises with thickness and stiffness and falls with area.
// It is an approximation and says so on the bench.
const REFERENCE_MODES = [
  { frequencyHz: 105, t60S: 0.32, massKg: 0.45, coupling: 0.3, radiationGain: 0.7 },
  { frequencyHz: 205, t60S: 0.42, massKg: 0.22, coupling: 0.25, radiationGain: 1 },
  { frequencyHz: 395, t60S: 0.24, massKg: 0.12, coupling: 0.2, radiationGain: 0.6 },
  { frequencyHz: 710, t60S: 0.15, massKg: 0.08, coupling: 0.12, radiationGain: 0.4 },
];

function bodyFeatures(p) {
  const outline = bodyOutline({ lengthM: p.bodyLengthMm / 1000, upperM: p.upperBoutMm / 1000, waistM: p.waistMm / 1000, lowerM: p.lowerBoutMm / 1000, waistAt: p.waistAt });
  const top = resolveMaterial(p.topWood, p.topCustomDensity, p.topCustomModulus);
  const back = resolveMaterial(p.backWood, p.backCustomDensity, p.backCustomModulus);
  const topT = p.topThicknessMm / 1000;
  const hole = p.holeDiameterMm / 1000;
  const volume = outline.areaM2 * (p.bodyDepthMm / 1000) * 0.8;
  const holeArea = Math.PI * (hole / 2) ** 2;
  const neck = topT + 0.85 * hole;
  return {
    air: Math.sqrt(holeArea / (volume * neck)),
    top: (topT / outline.areaM2) * Math.sqrt(top.youngModulusPa / top.densityKgM3),
    back: (0.0025 / outline.areaM2) * Math.sqrt(back.youngModulusPa / back.densityKgM3),
    topMass: top.densityKgM3 * topT * outline.areaM2,
  };
}

const referenceBody = bodyFeatures(Object.fromEntries(schema.params.map((p) => [p.id, p.default])));

export function bodyModes(p) {
  const f = bodyFeatures(p);
  const ratios = [f.air / referenceBody.air, f.top / referenceBody.top, f.top / referenceBody.top, f.back / referenceBody.back];
  const mass = f.topMass / referenceBody.topMass;
  return REFERENCE_MODES.map((m, i) => ({
    ...m,
    frequencyHz: Math.min(1600, Math.max(30, m.frequencyHz * ratios[i])),
    massKg: m.massKg * (i === 0 ? 1 : mass),
  }));
}

// A body that is small beside the wavelength puts out a pressure that follows the rate of change of the air it
// moves (a monopole), so the sound is the body's vibration speed times its frequency. The gain is kept where
// it was at this frequency, so that only the tilt changes.
const REFERENCE_RADIATION_HZ = 200;

function hardnessToContactS(h) {
  const soft = 0.0035;
  const hard = 0.0003;
  return soft * (hard / soft) ** h;
}


/**
 * Render one note of one string. `note.midi` is the open string's note plus the
 * fret (0 to 24). Returns { pcm: Float32Array, sampleRate }.
 */
export function render(params, note) {
  const { lowMidi, highMidi } = describe(params);
  if (note.midi < lowMidi || note.midi > highMidi) throw new Error(`this string plays notes ${lowMidi} to ${highMidi}`);
  const fret = note.midi - lowMidi;
  const facts = stringFacts(params);
  const sampleRate = 44100;
  const magnetic = params.pickupFit === 'magnetic';
  // How fast each partial dies: measured on the recordings for steel under the body or a pickup and for nylon, plain and wound (see ../string-loss.mjs).
  const law = lossLawFor(params);
  const brightnessFactor = 2 ** (1 - 2 * params.brightness);
  const partialT60S = partialT60s(law, midiToHz(facts.midi + fret), sampleRate, { ringTime: params.ringTime, brightnessFactor });
  const soundingM = frettedLengthM(facts.lengthM, fret);
  const ratio = Math.min(0.9, Math.max(0.03, params.pluckDistanceMm / 1000 / soundingM));
  // A slack string must not be pulled so far that the small-slope string model breaks.
  const forceN = Math.min(0.65, (0.02 * params.tensionN) / (ratio * (1 - ratio)));
  const model = {
    id: 'bench', name: 'bench', family: 'plucked', scaleLengthM: facts.lengthM, fretCount: MAX_FRET, kind: magnetic ? 'electric' : 'acoustic',
    dataStatus: 'approximation from the drawn geometry; not a measured instrument',
    strings: [{
      id: 's1', openMidi: facts.midi, linearDensityKgM: facts.mu, diameterM: params.stringDiameterMm / 1000,
      axialStiffnessN: facts.axialN, effectiveBendingStiffnessNm2: facts.bending,
      loss: { t60LowS: partialT60S[0], highLoss: 2 * brightnessFactor, partialT60S },
    }],
    // A pickup is measured from the bridge, like the pluck, and the string model wants half its 12 mm aperture clear of the far end.
    // Without one the sound comes from the body.
    pickup: { positionM: magnetic ? Math.min(params.pickupAtMm / 1000, soundingM - 0.007) : Math.min(0.12, soundingM / 2), apertureM: 0.012, loadHz: 12000, resonanceHz: 5500, resonanceQ: 0.707 },
    bodyModes: magnetic ? [] : bodyModes(params),
    outputGain: magnetic ? 0.32 : 4 / (2 * Math.PI * REFERENCE_RADIATION_HZ),
    ...(magnetic ? {} : { bodyRadiation: { type: 'acceleration' } }),
  };
  const overM = magnetic ? params.pickupAtMm / 1000 - soundingM : -1;
  const result = renderNote(model, {
    note: { midi: facts.midi + fret, velocity: note.velocity, gateS: note.durationS },
    pluck: { positionRatio: ratio, forceN, contactTimeS: hardnessToContactS(params.pickHardness), contactWidthM: pluckWidthM(params.pickHardness), noise: params.pickNoise, directionRad: (params.pluckAngle * Math.PI) / 180 },
    output: { sampleRate, durationS: note.durationS },
  });
  const pcm = Float32Array.from(result.pcm);
  return { pcm: magnetic ? overDeadString(pcm, overM, sampleRate) : pcm, sampleRate };
}

// A pickup past the fretted note is over the part of the string behind the finger: it does not vibrate, so the
// pickup hears almost nothing, and what it hears is thin (a little of the high partials that cross the finger,
// less the further the pickup is from it). `overM` is how far the pickup is beyond the sounding length, in metres:
// it is fully on the live string when its 12 mm aperture is clear of the finger, and fully over the dead part
// 6 mm beyond.
const DEAD_LEVEL = 0.03; // amplitude of what leaks past a finger, right next to it
const DEAD_FALL_M = 0.12; // and how fast that dies away along the dead string
const DEAD_HIGHPASS_HZ = 1200;
export function overDeadString(pcm, overM, sampleRate) {
  const live = Math.min(1, Math.max(0, 0.5 - overM / 0.012));
  if (live >= 1) return pcm;
  const level = DEAD_LEVEL * Math.exp(-Math.max(0, overM) / DEAD_FALL_M);
  const rc = 1 / (2 * Math.PI * DEAD_HIGHPASS_HZ);
  const a = rc / (rc + 1 / sampleRate);
  const out = new Float32Array(pcm.length);
  let prevIn = 0;
  let prevOut = 0;
  for (let i = 0; i < pcm.length; i++) {
    const high = a * (prevOut + pcm[i] - prevIn);
    prevIn = pcm[i];
    prevOut = high;
    out[i] = live * pcm[i] + (1 - live) * level * high;
  }
  return out;
}
