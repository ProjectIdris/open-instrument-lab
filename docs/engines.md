# Writing an engine (plug-in)

> **An engine is code, and it runs with your full permissions.** The server imports `engine.mjs` and runs it, and its worker threads run `render`, with the same access to your files and network that you have. Nothing is sandboxed. Only add engines you wrote or have read and trust.

An *engine* is a way of making a family of instruments: plucked strings, struck bars, drums, anything that turns "a note, a touch and some settings" into sound. The app knows nothing about any particular engine. Drop an engine in, restart the server, and its instruments, its controls and its descriptions appear in the page. No UI code to edit.

## Where engines live

The server looks for a folder containing `engine.mjs` in three places:

1. `engines/` in this repository (the built-in engines).
2. `plugins/` next to it. It is ignored by git, so it is the place for engines you keep to yourself.
3. Every folder listed in the `STUDIO_ENGINE_DIRS` environment variable, separated the way `PATH` is (`;` on Windows, `:` elsewhere).

An engine that fails to load, or breaks the rules below, is reported at start-up and in the page and skipped. The others still load.

```
STUDIO_ENGINE_DIRS=/path/to/my/engines npm start
```

## The contract

`engine.mjs` is an ES module that exports:

| Export | What it is |
| --- | --- |
| `meta` | `{ id, name, description, order?, apiVersion? }`. `id` is lowercase letters, digits and dashes and must be unique. `order` sorts engines in the gallery (smaller first). `apiVersion` is the plug-in API version you wrote for; this build speaks `1`. |
| `schema` | The controls. See below. |
| `gallery` | A list of `{ id, name, description, params, parts? }`: instruments that play at once. Every entry must be valid for the schema; the server checks. At least one. `parts` is for engines made of parts (below). |
| `describe(params)` | Returns `{ lowMidi, highMidi }`, the notes this instrument can play with these settings. |
| `render(params, note)` | Returns `{ pcm, sampleRate }`: a `Float32Array` of mono samples. `note` is `{ midi, velocity, durationS }` and is already checked. May be `async`. |
| `limits` (optional) | `{ minDurationS, maxDurationS }` for a note (defaults 0.2 and 8). |
| `levelling(params)` (optional) | Returns `{ params, note? }`: the values and note the host should measure to set this instrument's loudness. Use it when some values (where a string is plucked, say) change a note's sound but should not change how loud the instrument is made; without it the host measures the parameters as they are. |
| `bench` (optional) | Asks for the workbench. See below. |

`describe` may throw an `Error` with `unplayable: true` when these values cannot make a sound at all (a string so tight and thin it would sound above hearing). The message is shown to the player in plain words, so write it for them. Everything else it throws is a bug.

`render` runs in a worker thread, so it can take its time without freezing the page, and it must not depend on state outside its own module. It must be deterministic for the same `params` and `note`: results are cached on exactly that.

Leave loudness to the host. The server measures a reference note for each set of parameters and scales everything from that instrument by one fixed amount, so different instruments sit at about the same volume. Render in whatever units are natural to your model. One reference note sets the level (`levelling` can choose it), so a note much louder than the reference is turned down just enough to stay under full scale rather than clip.

## The schema

```js
export const schema = {
  groups: [{ id: 'pluck', label: 'How it is played' }],
  params: [
    {
      id: 'pluckPosition',          // letters and digits, unique
      type: 'number',               // 'number' | 'choice' | 'toggle'
      layer: 'plain',               // 'plain' shows by default; 'advanced' is under "Advanced"
      group: 'pluck',               // one of the groups above
      label: 'Where you pluck',     // what a musician would call it
      help: 'Near the bridge is thin and bright; towards the middle is round and soft.',
      unit: 'of string length',     // optional, shown beside the value
      min: 0.05, max: 0.5, step: 0.005, default: 0.2,
      scale: 'linear',              // or 'log' (needs min > 0); optional
      integer: false,               // optional
      visibleWhen: { base: ['electric'] },   // optional: only shown when another parameter has one of these values
    },
  ],
};
```

- A `choice` has `options: [{ value, label }]` and a `default` that is one of the values.
- A `toggle` has a boolean `default`.
- `label` and `help` are required for every parameter. Write them for a curious player who has never heard of a waveguide; put the technical name in `help` if it matters.
- Put the everyday controls in the `plain` layer and everything else in `advanced`. **Every parameter your model has should be reachable**: the advanced layer is where an expert expects to find it.
- Values arrive in `render` already filled in with defaults and checked against `min`, `max`, `options` and `integer`. Unknown names are an error.

`engines/schema.mjs` has `validateSchema`, `normalizeParams` and `isVisible`; the same file is served to the browser, so the page and the server agree.

## Materials

`engines/materials.json` lists starter materials with published density and Young's modulus, each with its source. `engines/materials.mjs` gives you `materialOptions()` for a choice parameter, `customMaterialParams()` for the two "type your own" numbers that appear when the choice is `custom`, and `resolveMaterial()` to turn the values into SI units. Add a material to the JSON (with a source) and every engine that uses the helpers lists it.

## Engines made of parts, and the workbench

Some instruments are a handful of the same thing: six strings, eight bars. An engine can say so, and can say what each number *is* in the world, so the workbench (the page you see first) can draw it and let a hand work it without any page code written for that engine.

Add `parts` to the schema, and mark each parameter that belongs to a part:

```js
export const schema = {
  groups: [...],
  parts: [{ id: 'string', label: 'String', min: 1, max: 8, rack: [ /* things on the rack, below */ ] }],
  params: [
    { id: 'scaleLengthMm', ..., physical: 'length', onBench: true },            // one for the whole instrument
    { id: 'tensionN', ..., part: 'string', physical: 'tension', onBench: true },  // one for each string
    ...
  ],
};
```

- `parts` lists the kinds of part, each with how few and how many there may be (`min`, `max`) and an optional `rack`: ready-made things (`{ id, name, description, params }`) a player drags from the rack onto the instrument. For strings, `params` is that string's own values.
- `part: 'string'` on a parameter means each string has its own. The others are shared by the whole instrument.
- `physical` says what a number is: `length`, `tension`, `material`, `diameter`, `thickness`, `depth`, `place`, `hardness`, `time`, `fraction`, `angle` or `other`. A bench uses it to decide where the control lives: a length is dragged along the object, a tension is a peg, a material is a swatch.
- `onBench: true` means the bench handles that parameter by hand. The ones that are not marked (and are `advanced`) go in the *Maker's drawer*, closed by default.
- `role` says what a part or a parameter *is* to a bench (`tensionN`, `fret`…), so the bench can find it whatever its id. A bench engine needs them: see *What the bench requires* below.
- `affectsSound: false` marks a parameter that only changes how the instrument looks (the neck's wood, here). The page leaves it out of the notes it asks for, so changing it never makes a note again.

A gallery entry or a saved instrument then gives `params` for the whole instrument and `parts: { string: [ {...}, {...} ] }` with one entry per string. The server renders one part at a time: `render` always receives the shared values and one string's values merged into a single flat `params`, so an engine author writes a single-string `render` and never sees a list. `engines/schema.mjs` has `normalizeInstrument` for checking a whole instrument.

Then export `bench` to ask for the workbench:

```js
export const bench = {
  kind: 'plucked-strings',                    // which bench to draw; the only kind this build can draw so far
  hands: [{ id: 'pick', name: 'Pick', params: { pickHardness: 0.85 } }],   // the hand tools; each sets these values, named by role
  strum: true,                                // optional; `false` turns off strumming with the right button
};
```

Any instrument drawn as `plucked-strings` can be strummed with the mouse: hold the right button and sweep across the strings. Each string sounds as the hand crosses it, in that order, down or up. Where the hand crosses is where that string is plucked, and a faster sweep is louder. It needs nothing from the engine beyond the strings it already has.

### What the bench requires

The bench finds the parts and parameters it draws **by their `role`, never by their id**. A `role` is a name written on a part or a parameter in the schema (`{ id: 'pull', role: 'tensionN', part: 'course', ... }`); the ids can be anything. An engine that sets `bench` is checked when it is loaded, and one that is missing a role, gives a role to something of the wrong kind, or uses a role the bench does not know is refused with a message that names them. (An engine that does not set `bench` is not held to this; it appears on the plain panel.)

Rules for a `role`: it is written like `tensionN` (a letter, then letters and digits); it is given once in its place (once among the parts, once among the shared parameters, once among the parameters of one part); and a parameter with no role whose id is the name of a role the bench uses is refused, because it would look as if it had one.

**The bench kinds.** `bench.kind` is one of `plucked-strings`, `struck-bars` and `struck-membranes`; each has its own roles, below. A page shows the engine named in its address (`?engine=<id>`); the menu of instruments lists the instruments of every bench engine, and choosing one of another engine brings that bench up.

For the `plucked-strings` bench:

**Parts.**

| role | required | what it is |
| --- | --- | --- |
| `string` | yes | The strings: one entry for each. |
| `fret` | no | The fret wires: one entry for each wire. It may also say `standard` (a whole number, from its `min` to its `max`): how many wires 1, 2, 3… a file that lists none gets (with no `standard`, it gets as many as the part's `max`, or as many places as there are). The places between the `fretNumber` `min` and `max` must be at least as many as the part's `min`, or the engine is refused. |

**Shared by the whole instrument** (no `part`), all `type: 'number'` unless said:

| role | what the bench does with it |
| --- | --- |
| `scaleLengthMm`, `bridgeAtMm` | The vibrating length, and where the bridge is. Dragging the nut or the bridge sets them. |
| `bodyLengthMm`, `upperBoutMm`, `waistMm`, `lowerBoutMm`, `waistAt`, `bodyDepthMm`, `topThicknessMm` | The drawn body: its outline, depth and top. |
| `holeDiameterMm`, `holeAtMm` | The sound hole. |
| `pluckDistanceMm`, `pickHardness` | Where the string is touched, measured from the bridge, and how hard the pick or finger is. The bench sets them on every touch and strum. The `hands` set `pickHardness` and the like by role. |
| `topWood`, `backWood`, `neckWood` (`choice`) | The surfaces a swatch is dropped on. Their options are the ids in `engines/materials.json` plus `custom`. |
| `topCustomDensity`, `topCustomModulus`, `backCustomDensity`, `backCustomModulus` (optional) | The "type your own" numbers for a custom wood. |
| `stiffness` (optional) | A string's bending stiffness, as the engine models it. |

**On each string:**

| role | type | what the bench does with it |
| --- | --- | --- |
| `stringMaterial` | `choice`, with the ids in `engines/materials.json` plus `custom` | What the string is made of: the swatch dropped on it. |
| `stringCustomDensity`, `stringCustomModulus` | `number` (kg/m³, GPa) | Used when the material is `custom`. |
| `stringDiameterMm` | `number` | Thickness. |
| `stringWound` | `toggle` | Wound strings are lighter for their thickness. |
| `tensionN` | `number` | What the peg sets, in newtons. Its `min` and `max` are the peg's limits. |

**On each fret wire** (the part with the role `fret`):

| role | type | what the bench does with it |
| --- | --- | --- |
| `fretNumber` | `number`, `integer: true`, whole `min` 1 or more and whole `max` | The wire's place in semitones (fret 12 is half way along the string). The bench draws the wires, lets a hand drag one along the neck or off it, and has a rack tile for adding one. A string can only be stopped where there is a wire (the open string always sounds), so the keyboard and its range follow them. Set `affectsSound: false` on it: `render` is given the open string's note plus a fret and is not told where the wires are. |

**The pickup** (optional, both together):

| role | type | what the bench does with it |
| --- | --- | --- |
| `pickupFit` | `choice` with the options `none` and `magnetic` | A pickup tile on the rack and a pickup drawn across the strings that can be dragged along them or off the guitar. The bench sets it to `magnetic` or `none`. The engine decides what that sounds like. The guitar's takes the sound from the string at that place, in place of the body's. A pickup further from the bridge than a fretted note's sounding length is over the dead part of the string: the bench says so on the status line when such a note is played, and an engine should make it thin and very quiet (the guitar's does, and the further along, the quieter). |
| `pickupAtMm` | `number`, millimetres | The pickup's distance from the bridge. |

For the `struck-bars` bench (any number of bars on a frame, each with its own material, size, arch and tube; `engines/bars-bench/engine.mjs` is the worked example):

**Parts.**

| role | required | what it is |
| --- | --- | --- |
| `bar` | yes | The bars: one entry for each. Their `rack` is the bars on the rack, each with its own values (a bar cut to a note, say). |

**Shared by the whole instrument** (no `part`):

| role | type | what the bench does with it |
| --- | --- | --- |
| `strikeAt` | `number`, a fraction of a bar's length from its nearer end | Where the mallet lands. The bench sets it on every blow, from where the hand pressed; the keyboard uses the value in the instrument. |
| `malletHardness` | `number`, 0 to 1 | How hard the mallet is. The `hands` set it (they are the mallets on the rack); a hand may also say `glyph: 'mallet'`. |
| `frameWood` (optional) | `choice`, the ids in `engines/materials.json` plus `custom` | The wood of the frame the bars lie on: a wood swatch dropped on the frame sets it. Set `affectsSound: false` if it only changes the look. |

**On each bar:**

| role | type | what the bench does with it |
| --- | --- | --- |
| `barMaterial` | `choice`, with the ids in `engines/materials.json` plus `custom` | What the bar is made of: the swatch dropped on it. The bar is cut again to the note it had. |
| `barCustomDensity`, `barCustomModulus` | `number` (kg/m³, GPa) | Used when the material is `custom`. |
| `barLengthMm` | `number` | The bar's length, stretched by its ends. |
| `barThicknessMm` | `number` | Its thickness, dragged in the side view. |
| `barUndercut` | `number`, 0 to 1 | The carved arch under it: 0 plain, 1 the full arch that tunes the first overtone to two octaves above the note. Carved with the gouge, or by the dot under the bar in the side view. |
| `tubeFit` | `toggle` | Whether a resonator tube hangs under the bar. |
| `tubeLengthMm` | `number` | The tube's length, dragged in the side view. |

The note a bar sounds is worked out in `engines/physics.mjs` (`barFrequencies`: thin-beam theory, with the arch worked out by Rayleigh–Ritz) from these numbers, in the browser as the hand moves and in the engine when it renders. An engine whose bars should agree with the bench has to sound at that pitch: `describe` and `render` should agree with `barFrequencies` there. One render is one bar: the shared values and that bar's, merged. `note.midi` is the bar's own nearest note; the pitch comes from its size, not from the note. A bar too small or too large to sound should throw an error with `unplayable: true` in `describe`, as a string does.

The saved file, the gallery and the notes the page asks the engine to render are in **your** ids; the bench translates at the edge and nothing else about your engine is known to it. The pitch the bench shows is worked out in `engines/physics.mjs` from these numbers, so an engine whose strings should agree with the bench has to sound at that pitch: `describe` and `render` should agree with `stringPhysics` there.

For the `struck-membranes` bench (any number of drums in a row, each a head of a given film, size and tension over a shell of a given depth; `engines/drum-bench/engine.mjs` is the worked example):

**Parts.**

| role | required | what it is |
| --- | --- | --- |
| `drum` | yes | The drums: one entry for each. Their `rack` is the drums on the rack, each with its own values (a drum tuned to a note, say). |

**Shared by the whole instrument** (no `part`; all three required):

| role | type | what the bench does with it |
| --- | --- | --- |
| `strikeAt` | `number`, a fraction of the head's radius from its centre | Where the stick lands. The bench sets it on every blow, from where the hand pressed; the keyboard uses the value in the instrument. |
| `strikeAngle` | `number`, degrees round the head | Which way round: 0 is the side nearest the listener, drawn to the right of the row. The bench sets it on every blow too. It decides which modes with a nodal diameter a blow excites and the listener hears. |
| `stickHardness` | `number`, 0 to 1 | How hard the stick is. The `hands` set it (they are the sticks and beaters on the rack); a hand may also say `glyph: 'mallet'`, `'beater'` or `'stick'`. |

**On each drum:**

| role | type | what the bench does with it |
| --- | --- | --- |
| `headMaterial` | `choice`, with the ids in `engines/materials.json` plus `custom` | What the head is made of: a film swatch (family `film`) dropped on it. The tension stays, so the note moves with the head's weight. |
| `headCustomDensity` | `number`, kg/m³ | Used when the head is `custom`. A head's pitch comes from its mass per area and its tension, so no stiffness is asked for. |
| `headThicknessUm` | `number`, micrometres | The head's thickness, dragged in the side view. With the density it makes the head's mass per area. |
| `headDiameterMm` | `number` | The head's width, dragged at the hoop (top view) or the walls (side view). |
| `headTension` | `number`, newtons per metre of rim | How hard the head is pulled: dragging round a lug turns it (a quarter turn is about a semitone). The note tag, clicked, sets it so the drum sounds its nearest note. |
| `shellMaterial` | `choice`, the ids in `engines/materials.json` plus `custom` | A wood or metal swatch dropped on the shell. Set `affectsSound: false` if it only changes the look (the worked example's does). |
| `shellDepthMm` | `number` | The shell's depth, dragged in the side view. It matters to the sound when the bottom is closed. |
| `shellClosed` | `toggle` | Whether the bottom is closed (a bowl, a fixed bottom): clicking the bottom of the shell in the side view steps it through open, a second head (if the engine has the roles below) and closed. |
| `bottomHead` (optional) | `toggle` | Whether a second head closes the bottom instead (a tom, a snare, a bass drum). Drawn as a thin second head across the bottom. With it the engine should couple the two heads through the air between them. |
| `bottomTension` (optional) | `number`, newtons per metre | The second head's tension. |
| `bottomThicknessUm` (optional) | `number`, micrometres | The second head's thickness, dragged in the side view with the first. |

The note a drum sounds is its main tone, the (1,1) mode of its top head (the lowest with a nodal diameter, which is what a tom is heard to sound at; the whole-head mode below it is a thump), worked out in `engines/physics.mjs` (`membraneModes`: the modes of a circular membrane from its tension, mass per area and radius, loaded by the air it moves, with an air spring in a closed shell; `headTensionForHz` is its inverse, for the lowest mode or for a mode you name), in the browser as the hand moves and in the engine when it renders. An engine whose drums should agree with the bench has to sound at that pitch: `describe` and `render` should agree with `membraneModes` there (the worked example's render also builds a few thousand modes of each head in `engines/drum-bench/modes.mjs`, with the stick as a Hertz contact, but its pitch is `membraneModes`'). One render is one blow on one drum: the shared values and that drum's, merged. `note.midi` is the drum's own nearest note; the pitch comes from its head, not from the note. A drum too slack or too tight to sound should throw an error with `unplayable: true` in `describe`, as a string does.

**Snare wires (the worked example's own; the bench asks for nothing here).** A drum with a second head can carry snare wires. They are two ordinary engine parameters on the drum (`part: 'drum'`), not bench roles, so an engine without wires omits them and the bench neither knows nor minds: `snareWires` (`toggle`, shown only when `bottomHead` is on) and `wirePull` (`number`, newtons per wire segment, `advanced` layer, shown only when the wires are on; range 0.001 to 0.3; the parameter's default is 0.028, which a drum gets if it does not set its own, and the snare preset sets 0.0175, the value its fit used). The model is in `engines/drum-bench/modes.mjs` (`hit`) with its numbers in the `WIRE` set in `engines/drum-bench/engine.mjs`:

- Twenty coil segments lie on the second head. Each is a mass on a contact spring pressed by its pull; the strainer holds the outermost wires `pullEnds` times harder than the middle one. The head is started bent to rest under that pull.
- A wire leaves the head where the head moves away faster than the pull can follow, and rings only once it has left the head and landed again. Each wire has `coilCount` ring pitches of its own between `coilLowHz` and `coilHighHz`, a few milliseconds each, so the wires make a noise and not a chord. The tight end wires land at once and are the crack; the loose middle ones keep rattling. A soft touch leaves them quiet, a hard one throws them off, and a wire that has not left the head does not ring.
- The wires push back on the second head (their force enters its modes). The head's own loss (`damping`) and the wires' ring decay are the muting. The `longGain` and `tailGain` rings of an earlier fit stay in the code at gain 0.

What is estimated and what is fitted: the wire's mass, the contact stiffness and damping ratio, and the wire count (20) are round numbers for a strainer, estimates that no refit changed. The rest of `WIRE` (`gain`, `pullEnds`, the number, span, spread and tilt of the ring pitches), the preset's `wirePull` and the snare preset's tuning were adjusted against one recorded drum over the refit passes, so they are FITTED, not measured: the Virtuosity muted snare (a CC0 recording: one drum, one take per layer, no held-out layer). The fit compared in absolute level in 1/3-octave bands from 160 Hz to 6.3 kHz over windows from 5 to 400 ms, each Studio hit matched to the recording on its first 50 ms of energy, over four layers. The head is tuned so the strongest line in 150 to 330 Hz sits at the recording's 226 Hz (a Studio buffer is 44.1 kHz; a check that assumed 48 kHz put it at 207 Hz and misled the first fit). Whole-hit bands agree to within about 9 dB rms. Still wrong, and said so: the narrow lines stand 10 to 20 dB prouder of their surroundings than the recording's; the 160 Hz band has no tail after 100 ms where the recording has one; 200 to 400 ms is 5 to 15 dB light above 4 kHz; and 20 to 50 ms is 10 to 25 dB hot at 160 to 400 Hz. The recording was used to compare and is not in the repository.

`engines/guitar-bench/engine.mjs`, `engines/bars-bench/engine.mjs` and `engines/drum-bench/engine.mjs` are the worked examples. `test/bench-contract.test.mjs` and `test/drum-contract.test.mjs` have engines that give no roles (and are refused, with what to add), and ones that carry every role under ids of their own and play the same notes. A new `kind` is a new drawing in `web/js/bench/` and an entry in `BENCH_KINDS` in `engines/registry.mjs`: open an issue first (see CONTRIBUTING).

For a bench engine, one note is one string. `note.midi` is the open string's nearest note plus the fret, and `describe` reports that string's range, so the page asks for notes the string can really play.

## A complete small engine

```js
// plugins/test-tone/engine.mjs
export const meta = { id: 'test-tone', name: 'Test tone', description: 'A decaying sine wave.' };
export const schema = {
  groups: [{ id: 'tone', label: 'Tone' }],
  params: [{ id: 'detune', type: 'number', layer: 'plain', group: 'tone', label: 'Detune',
    help: 'Cents sharp or flat.', unit: 'cents', min: -100, max: 100, default: 0 }],
};
export const gallery = [{ id: 'plain', name: 'Plain tone', description: 'A sine.', params: {} }];
export const describe = () => ({ lowMidi: 36, highMidi: 96 });
export function render(params, note) {
  const sampleRate = 44100;
  const pcm = new Float32Array(Math.round(note.durationS * sampleRate));
  const hz = 440 * 2 ** ((note.midi - 69 + params.detune / 100) / 12);
  for (let i = 0; i < pcm.length; i++) pcm[i] = 0.5 * Math.sin((2 * Math.PI * hz * i) / sampleRate) * Math.exp((-3 * i) / sampleRate);
  return { pcm, sampleRate };
}
```

Restart the server and "Test tone" is in the gallery with its Detune slider.

## Keeping an engine private

Nothing in the app needs the engines to be in this repository. Keep a private engine in its own folder, outside the checkout, and point `STUDIO_ENGINE_DIRS` at its parent. The public app and your private engines run together, and the public repository never sees them.

## Checking your engine

`npm test` loads every engine it can find, so a plug-in in `plugins/` is held to the same checks as the built-in ones: its gallery plays, every parameter works at both ends of its range, and notes sound at the pitch asked for.
