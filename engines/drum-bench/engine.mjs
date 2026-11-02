// SPDX-License-Identifier: GPL-3.0-only
// Struck drums on the workbench: any number of drums, each a head of a given film, thickness, size and tension over
// a shell of a given depth (open at the back, closed, or with a second head), hit by a stick or beater where you press.
//
// The sound comes from what the drum is. Each head is a circular membrane with its modes (m nodal diameters, n−1
// nodal circles) up to several thousand of them; the air it moves adds mass, the air between two heads is a spring
// that ties their modes together, and the sound that leaves is what a microphone near the head hears of its surface
// acceleration. The stick is a mass on a contact spring (a Hertz contact), so the crack of the attack, its length and
// its brightness come from the stick and not from a filter; the swing of the head adds to the film's tension, which
// is the pitch glide. All of it is worked from the geometry in physics.mjs and modes.mjs, with no fitted pitches.
// One render is one blow on one drum: the shared values (the stick, where it lands) plus that drum's own.
// The shell is treated as rigid: its material changes how the drum looks, not how it sounds.
import { materialOptions, resolveMaterial } from '../materials.mjs';
import { headTensionForHz, hzToMidi, membraneModes, midiToHz } from '../physics.mjs';
import { buildDrum, contactStiffness, hit, REF_SPEED, stickOf, stickSpeed, strikeDrum } from './modes.mjs';

export const meta = {
  id: 'drum-bench',
  order: 7,
  name: 'Drums workbench',
  description: 'A row of drums you build by hand: tension a head, change its size and depth, put a second head under it, choose its film, strike it where you like with a stick or a beater. The sound is an approximation worked out from the heads, the air between them and the stick.',
};

export const bench = {
  // The parts and parameters the bench draws are found by their `role` in the schema below, not by id.
  kind: 'struck-membranes',
  hands: [
    { id: 'felt-mallet', name: 'Soft felt mallet', glyph: 'mallet', params: { stickHardness: 0.08 } },
    { id: 'beater', name: 'Felt beater', glyph: 'beater', params: { stickHardness: 0.28 } },
    { id: 'wood-stick', name: 'Wooden stick', glyph: 'stick', params: { stickHardness: 0.8 } },
    { id: 'nylon-tip', name: 'Hard nylon tip', glyph: 'stick', params: { stickHardness: 0.97 } },
  ],
};

const MIN_HZ = 20;
const MAX_HZ = 12000;
const MAX_MODES = 2500; // the lowest 2500 modes of a head are kept; a big slack head has more below 12 kHz than this
const SAMPLE_RATE = 44100;
// What the host levels is the sound in these units, and it can scale a set by 0.001 to 1000: this keeps a drum at
// about 1, where the raw pressure of a head struck at 0.1 m would be some hundreds.
const OUTPUT_SCALE = 0.01;
const PET_MODULUS_PA = 3.8e9;
// The snare wires, as a set of coil segments lying on the second head. Mass, count and the contact damping are round numbers for a
// strainer. FITTED, not measured, to the Virtuosity muted snare (a CC0 recording: one drum, one take per layer, no held-out layer),
// compared in absolute level: 1/3-octave bands from 160 Hz to 6.3 kHz in windows from 5 to 400 ms, each Studio hit matched to the
// recorded hit on its first 50 ms of energy, over four layers. The head is tuned so the strongest line in 150 to 330 Hz sits at the
// recording's 226 Hz (a Studio buffer is 44.1 kHz; a check that assumed 48 kHz put it at 207 Hz and misled the first fit). The
// muting is the head's own loss (damping) and the wires' ring decay: each wire rings at coilCount pitches of its own between
// coilLowHz and coilHighHz; with coilTilt 1 the ring output (which falls as 1/f for an impulse) comes out flat across the
// band, and coilSigmaTilt lets the high ones die a little sooner. The long and tail rings of an earlier fit stay in the code at
// gain 0. The strainer pulls the wires on the head (wirePull, held harder at the ends by pullEnds); the head starts bent to rest
// under that pull, and a wire rings only once it has left the head and landed, so a soft touch leaves them quiet and a hard one
// throws them off. Still wrong: the narrow lines stand 10 to 20 dB prouder of their surroundings than the recording's, the 160 Hz
// band has no tail after 100 ms (the recording has one), 200 to 400 ms is 5 to 15 dB light above 4 kHz, and 20 to 50 ms is 10 to
// 25 dB hot at 160 to 400 Hz.
const WIRE_COUNT = 20;
const WIRE = { massKg: 3e-4, stiffness: 2e6, dampingRatio: 0.3, gain: 0.264, pullEnds: 13.6, coilCount: 40, coilLowHz: 500, coilHighHz: 9000, coilSigma: 27.5, coilSigmaTilt: 0.308, coilTilt: 1, longHz: 950, longSpread: 0.102, longSigma: 13.44, longGain: 0, longCount: 4, tailGain: 0, tailSigma: 2.5, tailCount: 12 };
// FITTED, like the toms': the model leaves a low thud under a hand drum's tone (the lowest modes of a small head, which a close
// microphone does not pass), and the cut is a labelled fourth-order high-pass on the microphone that takes it out. It is chosen
// against the recorded bongo's octave bands (low skirt within about 10 dB), not a claim that the recording was filtered. The
// bongo's skin keeps its low modes and gives up its high ones in a few milliseconds, which a loss that grows as the
// square of the pitch does (the "ping" of the clean high modes goes, the tone stays). FITTED against the recorded bongo's
// strongest narrow line (about 20 dB, a bare film head's is near 60) and its falls, not measured.
const HAND_DRUM_LOW_CUT = 160;
const BONGO_LOSS_QUAD = 150; // per second at 1 kHz, FITTED
const TOM_LOW_CUT = 70; // FITTED, not physical: a labelled microphone cut that takes out the low thud the model leaves under a tom (fourth order)
const BARE_HEAD_RATE = 5; // the second head has no pillow or tape on it: what the rim takes, as an estimate

const MAIN_TONE = { m: 1, n: 1 }; // what a tom is heard to sound at
const cavityOf = (p) => p.shellClosed || p.bottomHead;

/**
 * A drum with this head tuned so its main tone (the (1,1) mode) sits at a note, the tension to a newton per metre.
 * `bottom` is 'open', 'head' (a second head, tuned `bottomRatio` times as tight) or 'closed' (a bowl).
 */
function drumFor(midi, diameterMm, depthMm, { bottom = 'open', thicknessUm = 190, bottomThicknessUm = 125, bottomRatio = 1, damping = 5, wires = false, material = 'pet-film', shell = 'sugar-maple', lowCutHz = 0, levelDb = 0, lossFactor = 1, lossQuad = 0 } = {}) {
  const arealKgM2 = resolveMaterial(material).densityKgM3 * thicknessUm * 1e-6;
  const tension = headTensionForHz(midiToHz(midi), { arealKgM2, radiusM: diameterMm / 2000, depthM: depthMm / 1000, closed: bottom !== 'open', mode: MAIN_TONE });
  const params = {
    shellMaterial: shell, shellDepthMm: depthMm, shellClosed: bottom === 'closed', bottomHead: bottom === 'head',
    headMaterial: material, headThicknessUm: thicknessUm, headDiameterMm: diameterMm, headTension: Math.round(tension),
    bottomTension: Math.round(tension * bottomRatio), bottomThicknessUm, damping, snareWires: wires, wirePull: 0.0175, micLowCutHz: lowCutHz, levelDb, headLossFactor: lossFactor, headLossQuad: lossQuad,
  };
  return params;
}

const entry = (id, name, description, params) => ({ id, name, description, params });

const RACK = [
  entry('tom-12', '12 in tom', 'A rack tom: a 12 in shell 9 in deep with a head on each end, the top tuned to the D below middle C and the bottom the same.', drumFor(50, 305, 230, { levelDb: 3.5, bottom: 'head', shell: 'sugar-maple', lowCutHz: TOM_LOW_CUT })),
  entry('floor-tom-16', '16 in floor tom', 'A floor tom, 16 in across and 16 in deep with a head on each end, tuned low.', drumFor(42, 406, 406, { levelDb: 4, bottom: 'head', shell: 'american-basswood', lowCutHz: TOM_LOW_CUT })),
  entry('kick-22', '22 in bass drum', 'A bass drum: 22 in across and 18 in deep, a head each end, both loose and left to ring (raise Damping to put a pillow against the batter head), struck with a felt beater. The thump is the two heads breathing in and out against the air between them.', drumFor(45, 559, 457, { levelDb: 4, bottom: 'head', bottomThicknessUm: 190, damping: 5, shell: 'sugar-maple' })),
  // The snare is tuned so that its strongest line between 150 and 330 Hz sits at 226 Hz, the recorded muted snare's (Virtuosity, CC0), about half a semitone above the note the drum was first built for (A below middle C, 220 Hz).
  entry('snare-14', '14 in snare drum', 'A 14 in drum 5½ in deep, tuned high, with a thin head under it and twenty snare wires lying on that head. Where the head moves away from them faster than their pull can follow they lift off and land again, and their coils rattle: that is the sizzle. Turn the wires off to hear the drum alone.', drumFor(57.46, 356, 140, { levelDb: 5.5, bottom: 'head', bottomThicknessUm: 75, bottomRatio: 1.15, wires: true, shell: 'sugar-maple', damping: 19.3 })),
  entry('bongo-7', 'Bongo', 'A small 7 in head on a short shell open at the bottom, tuned high.', drumFor(78, 178, 180, { levelDb: 6, shell: 'white-ash', thicknessUm: 125, damping: 0, lossQuad: BONGO_LOSS_QUAD, lowCutHz: HAND_DRUM_LOW_CUT })),
  entry('kettle-26', '26 in kettledrum', 'A closed bowl under a 26 in head, as a timpani, the bowl taken as a cylinder of the same volume. The air in the bowl lifts the lowest mode, and the pitch you hear is the next one down.', drumFor(41, 660, 220, { levelDb: 4, bottom: 'closed', damping: 0.6, shell: 'brass' })),
  entry('frame-16', '16 in frame drum', 'A broad shallow frame, open at the back, tuned low and held by the rim.', drumFor(45, 406, 50, { levelDb: 5, shell: 'western-redcedar', damping: 3, lowCutHz: 100 })),
  entry('frame-16-muted', '16 in frame drum, hand on the head', 'The same frame drum with the flat of a hand resting on the skin: the tone is stopped almost as soon as it starts.', drumFor(45, 406, 50, { levelDb: 5, shell: 'western-redcedar', damping: 6, lossFactor: 5, lowCutHz: 100 })),
];

export const schema = {
  groups: [
    { id: 'head', label: 'The head' },
    { id: 'shell', label: 'The shell' },
    { id: 'stick', label: 'The stick' },
    { id: 'ring', label: 'How it rings' },
    { id: 'listen', label: 'Listening' },
  ],
  parts: [
    { id: 'drum', role: 'drum', label: 'Drum', min: 1, max: 8, rack: RACK },
  ],
  params: [
    {
      id: 'strikeAt', role: 'strikeAt', type: 'number', layer: 'plain', group: 'stick', label: 'Where you strike',
      help: 'Distance of the stick from the centre as a fraction of the head\'s radius. The middle gives a low boom and little else; near the rim brings out the higher, thinner overtones.',
      unit: 'of radius', min: 0, max: 0.95, step: 0.005, default: 0.5, physical: 'fraction',
    },
    {
      id: 'strikeAngle', role: 'strikeAngle', type: 'number', layer: 'plain', group: 'stick', label: 'Strike angle round the head',
      help: 'Which way round the head you strike, in degrees from the side nearest the microphone. It does not matter for the middle of the head; further out it decides which overtones with a nodal line across the head you excite.',
      unit: '°', min: 0, max: 360, step: 1, default: 0, physical: 'angle',
    },
    {
      id: 'stickHardness', role: 'stickHardness', type: 'number', layer: 'plain', group: 'stick', label: 'Soft to hard stick',
      help: 'A soft felt mallet is heavy and broad and touches the head for several milliseconds, which gives a deep, round tone; a wooden stick or a nylon tip is light and small and touches for a millisecond or two, which gives a bright, cracking attack.',
      min: 0, max: 1, step: 0.01, default: 0.5, physical: 'hardness', onBench: true,
    },
    {
      id: 'headLoss', type: 'number', layer: 'advanced', group: 'ring', label: 'Loss in the head',
      help: 'How much of the head\'s motion turns to heat in a cycle (its loss factor). The sound that leaves the drum also takes energy, and that is worked out on its own. A default for film heads, chosen against the decay of recorded toms: an estimate and not a measurement.',
      min: 0.0005, max: 0.3, step: 0.0005, scale: 'log', default: 0.002,
    },
    {
      id: 'micHeightMm', type: 'number', layer: 'advanced', group: 'listen', label: 'Microphone height',
      help: 'How far above the head the microphone is. Close, it hears the head\'s own motion, with its thump and overtones; further away it hears less of the overtones and more of the room-sized tone. A close drum microphone is 50 to 150 mm. The sound is the near field of the head, without the delay across it, so it is an estimate that is best near the head.',
      unit: 'mm', min: 20, max: 1000, step: 1, scale: 'log', default: 120,
    },
    {
      id: 'micOffset', type: 'number', layer: 'advanced', group: 'listen', label: 'Microphone out from the middle',
      help: 'How far from the centre of the head, as a fraction of its radius, the microphone is. Over the middle it hears only the modes that move the whole head together; out near the rim it hears the ones with a nodal diameter.',
      unit: 'of radius', min: 0, max: 1.2, step: 0.01, default: 0.65,
    },
    {
      id: 'damping', type: 'number', layer: 'plain', group: 'ring', part: 'drum', label: 'Damping',
      help: 'What the rim, the lugs, tape or a pillow against the top head take from every mode of that head, as a rate: how quickly each mode would die with nothing else to take its energy. A bare, well-tuned drum is a few per second; a bass drum with a pillow against its batter head is tens. A second head is taken as bare.',
      unit: '/s', min: 0, max: 400, step: 0.5, default: 5, physical: 'other',
    },
    {
      id: 'headLossQuad', type: 'number', layer: 'advanced', group: 'ring', part: 'drum', label: 'High-pitch loss in this head (fitted)',
      help: 'A loss in the skin that grows as the square of the pitch: this many per second at 1 kHz, four times that at 2 kHz, almost nothing near the tone of the drum. The skin of a hand drum rings its low modes for a long time and loses its high ones in a few milliseconds, which a loss that grows only in step with the pitch cannot do. A FITTED value, not a measurement; 0 for none.',
      unit: '/s at 1 kHz', min: 0, max: 5000, step: 10, default: 0,
    },
    {
      id: 'headLossFactor', type: 'number', layer: 'advanced', group: 'ring', part: 'drum', label: 'Extra loss in this head',
      help: 'Times the loss in the head. A rawhide head, a hand resting on the skin or damping tape take more from every overtone, and most from the high ones (this is a loss in the skin, which grows with pitch, not the steady rate of Damping), so the ping of the clean high modes dies at once. 1 is a bare film head.',
      min: 1, max: 30, step: 0.5, scale: 'log', default: 1,
    },
    {
      id: 'levelDb', type: 'number', layer: 'plain', group: 'listen', part: 'drum', label: 'Level',
      help: 'How loud this drum is against the others, in decibels. The player sets every drum to the same peak, which leaves the long, low ones quieter than a snare; this puts a kit in balance and a lone drum at the level of other instruments. It is not part of the sound of the drum.',
      unit: 'dB', min: -24, max: 12, step: 0.5, default: 0,
    },
    {
      id: 'micLowCutHz', type: 'number', layer: 'advanced', group: 'listen', label: 'Microphone low cut (fitted)', part: 'drum',
      help: 'A fourth-order high-pass on what the microphone hears, 0 for none. It is a FITTED value, not physics: the model leaves a little low thud under a tom or a hand drum that a close microphone would not pass, and this takes it out (70 Hz for toms, 160 Hz for the bongo, 100 Hz for the frame drum). Off for bass drum, snare and the rest.',
      unit: 'Hz', min: 0, max: 200, step: 1, default: 0,
    },
    {
      id: 'micShadow', type: 'number', layer: 'advanced', group: 'listen', label: 'Second head heard through the shell',
      help: 'How much of the sound of the second head reaches the microphone, as a fraction (1 = in full, as if the shell were not there; 0 = not at all). It enters with the opposite sign and from further away, so a pair of heads moving against each other cancel at the microphone, as a monopole and a dipole do, and a pair moving together do not.',
      min: 0, max: 1, step: 0.01, default: 1,
    },
    {
      id: 'shellMaterial', role: 'shellMaterial', type: 'choice', layer: 'plain', group: 'shell', part: 'drum', label: 'Shell material',
      help: 'What the shell is made of. In this basic model the shell is rigid, so this changes how the drum looks, not how it sounds.',
      options: materialOptions(['wood', 'metal']), default: 'sugar-maple', physical: 'material', onBench: true, affectsSound: false,
    },
    {
      id: 'shellDepthMm', role: 'shellDepthMm', type: 'number', layer: 'plain', group: 'shell', part: 'drum', label: 'Shell depth',
      help: 'How deep the shell is. With a second head or a closed bottom, the air in the shell is a spring and a shallow shell makes it stiffer, which raises the lowest modes; on an open drum the depth changes only how the back of the head sounds.',
      unit: 'mm', min: 10, max: 900, step: 1, default: 230, physical: 'depth', onBench: true,
    },
    {
      id: 'shellClosed', role: 'shellClosed', type: 'toggle', layer: 'plain', group: 'shell', part: 'drum', label: 'Closed at the bottom',
      help: 'A kettledrum\'s bowl, or any drum with a fixed bottom, holds a cushion of air under the head. Open, the air moves freely on both sides of the head.',
      default: false, physical: 'other', onBench: true,
    },
    {
      id: 'bottomHead', role: 'bottomHead', type: 'toggle', layer: 'plain', group: 'shell', part: 'drum', label: 'Second head underneath',
      help: 'A tom, a snare or a bass drum has a second head under the shell. The two heads share the air between them, so the lowest sound is the two heads moving together against it, and the pitches of the modes the heads share shift. Not on a closed bowl.',
      default: false, physical: 'other', visibleWhen: { shellClosed: [false] },
    },
    {
      id: 'bottomTension', role: 'bottomTension', type: 'number', layer: 'plain', group: 'head', part: 'drum', label: 'Tension of the second head',
      help: 'How hard the second head is pulled, as force per length of rim. A bottom head tuned the same as the top gives the fullest, longest note; a different tension gives a tone that glides.',
      unit: 'N/m', min: 50, max: 40000, scale: 'log', step: 10, default: 3000, physical: 'tension', visibleWhen: { bottomHead: [true] },
    },
    {
      id: 'snareWires', type: 'toggle', layer: 'plain', group: 'shell', part: 'drum', label: 'Snare wires',
      help: 'Twenty snare wires lying on the second head. They lift off it where it moves away faster than their pull can follow and land on it again, and each coil rings when it lands again, which is the sizzle of a snare drum. The level, the pitches and the ring times are fitted to one recorded muted snare (a CC0 recording, used to compare only).',
      default: false, physical: 'other', visibleWhen: { bottomHead: [true] },
    },
    {
      id: 'wirePull', type: 'number', layer: 'advanced', group: 'shell', part: 'drum', label: 'Snare wire pull',
      help: 'How hard each segment of wire is pressed on the head, in newtons. A tight strainer holds the wires down and they only buzz on the loudest hits; a loose one buzzes at the softest touch and for longer.',
      unit: 'N', min: 0.001, max: 0.3, scale: 'log', step: 0.001, default: 0.028, physical: 'other', visibleWhen: { snareWires: [true] },
    },
    {
      id: 'bottomThicknessUm', role: 'bottomThicknessUm', type: 'number', layer: 'plain', group: 'head', part: 'drum', label: 'Thickness of the second head',
      help: 'How thick the second head is. Bottom heads are usually thinner than the top: 75 to 190 microns.',
      unit: 'µm', min: 20, max: 800, scale: 'log', step: 1, default: 125, physical: 'thickness', visibleWhen: { bottomHead: [true] },
    },
    {
      id: 'headMaterial', role: 'headMaterial', type: 'choice', layer: 'plain', group: 'head', part: 'drum', label: 'Head material',
      help: 'What the head is made of. The pitch depends on the mass of the head per area and how hard it is pulled, not on how stiff the material is. Drop a swatch on the head, or pick Custom to type your own density.',
      options: materialOptions('film'), default: 'pet-film', physical: 'material', onBench: true,
    },
    {
      id: 'headCustomDensity', role: 'headCustomDensity', type: 'number', layer: 'plain', group: 'head', part: 'drum', label: 'Density of your own head',
      help: 'Mass per volume of the head you typed. Water is 1000, polyester film 1390, leather about 1000 to 1200.',
      unit: 'kg/m³', min: 200, max: 12000, scale: 'log', step: 10, default: 1390, physical: 'other', visibleWhen: { headMaterial: ['custom'] },
    },
    {
      id: 'headThicknessUm', role: 'headThicknessUm', type: 'number', layer: 'plain', group: 'head', part: 'drum', label: 'Head thickness',
      help: 'How thick the head is. A thicker head is heavier, so for the same tension it sounds lower and rings a little shorter. Common film heads are 125 to 250 microns.',
      unit: 'µm', min: 20, max: 800, scale: 'log', step: 1, default: 190, physical: 'thickness', onBench: true,
    },
    {
      id: 'headDiameterMm', role: 'headDiameterMm', type: 'number', layer: 'plain', group: 'head', part: 'drum', label: 'Diameter',
      help: 'How wide the head is. A wider head sounds lower: double the width and, with the same tension, the note falls an octave.',
      unit: 'mm', min: 60, max: 1100, step: 1, default: 356, physical: 'diameter', onBench: true,
    },
    {
      id: 'headTension', role: 'headTension', type: 'number', layer: 'plain', group: 'head', part: 'drum', label: 'Tension',
      help: 'How hard the head is pulled, as force per length of rim. Four times the tension raises the note an octave. The lugs share it evenly in this model.',
      unit: 'N/m', min: 50, max: 40000, scale: 'log', step: 10, default: 3000, physical: 'tension', onBench: true,
    },
  ],
};

export const gallery = [
  {
    id: 'drum-kit', name: 'A drum kit',
    description: 'A bass drum, a snare drum with its wires on, and a 10, a 12 and a 16 in tom, each a shell with a head at each end. Struck with a wooden stick (pick the felt beater for the bass drum).',
    params: { strikeAt: 0.5, strikeAngle: 0, stickHardness: 0.8 },
    parts: { drum: [drumFor(45, 559, 457, { levelDb: 6, bottom: 'head', bottomThicknessUm: 190, damping: 5 }), drumFor(57.46, 356, 140, { levelDb: 5.5, bottom: 'head', bottomThicknessUm: 75, bottomRatio: 1.15, wires: true, damping: 19.3 }), drumFor(54, 254, 200, { levelDb: 5.5, bottom: 'head', lowCutHz: TOM_LOW_CUT }), drumFor(50, 305, 230, { levelDb: 3, bottom: 'head', lowCutHz: TOM_LOW_CUT }), drumFor(42, 406, 406, { levelDb: 2, bottom: 'head', shell: 'american-basswood', lowCutHz: TOM_LOW_CUT })] },
  },
  {
    id: 'tom-trio', name: 'Three toms',
    description: 'A 10, a 12 and a 14 in tom, each with a head at each end, tuned a fourth apart. The wide one is the low one. Struck with a wooden stick.',
    params: { strikeAt: 0.55, strikeAngle: 0, stickHardness: 0.8 },
    parts: { drum: [drumFor(57, 254, 200, { levelDb: 3.5, bottom: 'head', lowCutHz: TOM_LOW_CUT }), drumFor(52, 305, 230, { levelDb: 3.5, bottom: 'head', lowCutHz: TOM_LOW_CUT }), drumFor(47, 356, 270, { levelDb: 4, bottom: 'head', lowCutHz: TOM_LOW_CUT })] },
  },
  {
    id: 'kettledrum', name: 'A kettledrum',
    description: 'One 26 in kettledrum with a closed brass bowl, tuned to the pitch of its principal mode, as a timpanist tunes it. Struck about a fifth of the radius in from the rim with a soft mallet. The overtones are flatter than a real timpani\'s, whose bowl and rim are not modelled.',
    params: { strikeAt: 0.78, strikeAngle: 0, stickHardness: 0.1 },
    parts: { drum: [drumFor(41, 660, 220, { levelDb: 6, bottom: 'closed', damping: 0.6, shell: 'brass' })] },
  },
  {
    id: 'one-drum-three-heads', name: 'One drum, three tensions',
    description: 'Three 14 in drums, open at the back, that differ only in how hard the head is pulled: loose, medium and tight. Same size, same film, and a clear step in pitch and in how long it rings.',
    params: { strikeAt: 0.5, strikeAngle: 0, stickHardness: 0.6 },
    parts: { drum: [drumFor(43, 356, 230, { levelDb: 3.5 }), drumFor(50, 356, 230, { levelDb: 3 }), drumFor(57, 356, 230, { levelDb: 2.5 })] },
  },
  {
    id: 'bongos', name: 'Bongos',
    description: 'A pair of small drums, a larger one and a smaller one a fourth up, with thin heads. Played with a hard tip.',
    params: { strikeAt: 0.7, strikeAngle: 0, stickHardness: 0.95 },
    parts: { drum: [drumFor(75, 190, 180, { levelDb: 6, thicknessUm: 125, shell: 'white-ash', damping: 0, lossQuad: BONGO_LOSS_QUAD, lowCutHz: HAND_DRUM_LOW_CUT }), drumFor(80, 165, 180, { levelDb: 10, thicknessUm: 125, shell: 'white-ash', damping: 0, lossQuad: BONGO_LOSS_QUAD, lowCutHz: HAND_DRUM_LOW_CUT })] },
  },
  {
    id: 'single-tom', name: 'A single tom',
    description: 'One 12 in tom with a head on each end, to start from. Change its tension, size and depth, or hang a different head on it.',
    params: { strikeAt: 0.5, strikeAngle: 0, stickHardness: 0.6 },
    parts: { drum: [drumFor(50, 305, 230, { levelDb: 3, bottom: 'head', lowCutHz: TOM_LOW_CUT })] },
  },
];

export const limits = { minDurationS: 0.2, maxDurationS: 8 };

const modulusOf = (p) => (p.headMaterial === 'custom' ? PET_MODULUS_PA : resolveMaterial(p.headMaterial).youngModulusPa ?? PET_MODULUS_PA);
const densityOf = (p) => (p.headMaterial === 'custom' ? p.headCustomDensity : resolveMaterial(p.headMaterial).densityKgM3);

function checkSounds(hz) {
  if (hz >= MIN_HZ && hz <= MAX_HZ) return;
  const error = new Error(`this drum would sound at ${hz < MIN_HZ ? 'under 20' : 'over 12000'} Hz: its head is ${hz < MIN_HZ ? 'too slack and heavy' : 'too tight and small'} to use`);
  error.unplayable = true;
  throw error;
}

/** The pitch of the drum's main tone: the (1,1) mode of the top head (the lowest mode with a nodal diameter), which is what a tom is heard to sound at. */
function toneHz(p) {
  return membraneModes({
    tensionNPerM: p.headTension, arealKgM2: densityOf(p) * p.headThicknessUm * 1e-6, radiusM: p.headDiameterMm / 2000, depthM: p.shellDepthMm / 1000, closed: cavityOf(p),
  }).find((m) => m.m === MAIN_TONE.m && m.n === MAIN_TONE.n).hz;
}

/** One drum's range is its own nearest note: its main tone. A drum too slack or too tight to sound is unplayable. */
export function describe(p) {
  const hz = toneHz(p);
  checkSounds(hz);
  const midi = Math.round(hzToMidi(hz));
  return { lowMidi: midi, highMidi: midi };
}

// The host levels loudness once per drum and stick, not once per blow, so where the head is struck must not start a
// new measurement. The stick does count: a hard tip puts far more into the high modes than a soft mallet does, so the
// same impulse peaks several times higher, and each stick is levelled to its own.
export function levelling(p) {
  return { params: { ...p, strikeAt: 0.5, strikeAngle: 0, levelDb: 0 } };
}

const built = new Map();
/** A drum's modes depend on everything but where it is struck, so a drum is built once and struck many times. */
function drumOf(p) {
  const d = {
    radiusM: p.headDiameterMm / 2000, depthM: p.shellDepthMm / 1000, bottom: p.shellClosed ? 'closed' : p.bottomHead ? 'head' : 'open',
    batter: { tension: p.headTension, areal: densityOf(p) * p.headThicknessUm * 1e-6 },
    resonant: p.bottomHead ? { tension: p.bottomTension, areal: densityOf(p) * p.bottomThicknessUm * 1e-6 } : null,
    wires: p.bottomHead && p.snareWires ? { count: WIRE_COUNT } : null,
    loss: { eta: p.headLoss * p.headLossFactor, rate: p.damping, quad: p.headLossQuad }, resonantRate: BARE_HEAD_RATE, mic: { heightM: p.micHeightMm / 1000, offset: p.micOffset, shadow: p.micShadow },
    maxHz: Math.min(MAX_HZ, 0.45 * SAMPLE_RATE), maxModes: MAX_MODES,
  };
  const key = JSON.stringify(d);
  if (!built.has(key)) {
    if (built.size >= 6) built.delete(built.keys().next().value);
    built.set(key, buildDrum(d));
  } else {
    const drum = built.get(key);
    built.delete(key);
    built.set(key, drum);
  }
  return built.get(key);
}

/**
 * Render one blow on one drum. `note.midi` is the drum's own nearest note (the page asks for that note); the pitch
 * the drum sounds at comes from its heads, not from the note. Returns { pcm: Float32Array, sampleRate }.
 *
 * The stick arrives at a speed that goes with the velocity and meets the head through a contact spring; while it
 * touches, the head's modes and the stick move together, and afterwards the modes ring and fade by the sound they
 * send out and the loss in the film. What is heard is the near-field pressure of the head's acceleration at the
 * microphone. The head's own swing raises its tension a little, so the pitch starts high and settles.
 */
/** Fourth-order Butterworth high-pass, in place: two biquads (Q 0.5412 and 1.3066), direct form II transposed. */
function highpass4(x, hz, fs) {
  for (const q of [0.5412, 1.3066]) {
    const w = (2 * Math.PI * hz) / fs; const cw = Math.cos(w); const al = Math.sin(w) / (2 * q); const a0 = 1 + al;
    const b0 = (1 + cw) / 2 / a0; const b1 = -(1 + cw) / a0; const a1 = (-2 * cw) / a0; const a2 = (1 - al) / a0;
    let z1 = 0; let z2 = 0;
    for (let i = 0; i < x.length; i++) { const y = b0 * x[i] + z1; z1 = b1 * x[i] - a1 * y + z2; z2 = b0 * x[i] - a2 * y; x[i] = y; }
  }
}

export function render(p, note) {
  checkSounds(toneHz(p));
  const drum = drumOf(p);
  const stickKind = stickOf(p.stickHardness);
  const speed = stickSpeed(note.velocity);
  const kappa = contactStiffness({ massKg: stickKind.massKg, speed, p: stickKind.p, timeS: stickKind.contactTimeS * (REF_SPEED / speed) ** 0.2 });
  const struck = strikeDrum(drum, { strikeR: p.strikeAt, strikeAngleRad: (p.strikeAngle * Math.PI) / 180, tipRadiusM: stickKind.tipRadiusM });
  const radiusM = p.headDiameterMm / 2000;
  const tension = p.headTension;
  const glideBeta = (modulusOf(p) * p.headThicknessUm * 1e-6) / (2 * tension * tension * Math.PI * radiusM * radiusM);
  const wires = p.bottomHead && p.snareWires
    ? { ...WIRE, preloadN: p.wirePull, damping: 2 * WIRE.dampingRatio * Math.sqrt(WIRE.stiffness * WIRE.massKg) }
    : null;
  const pcm = hit({ drum: struck, stick: { massKg: stickKind.massKg, p: stickKind.p, kappa, speed }, glideBeta, fs: SAMPLE_RATE, seconds: note.durationS, wires });
  const out = new Float32Array(pcm.length);
  const level = OUTPUT_SCALE * 10 ** (p.levelDb / 20);
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] * level;
  if (p.micLowCutHz > 0) highpass4(out, p.micLowCutHz, SAMPLE_RATE);
  return { pcm: out, sampleRate: SAMPLE_RATE };
}
