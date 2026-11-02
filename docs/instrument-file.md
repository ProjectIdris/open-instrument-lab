# The instrument file

An instrument is one small JSON file. Anyone with this app (and the engine it names) can open it.

```json
{
  "format": "instrument-lab-studio.instrument",
  "version": 2,
  "name": "Short-scale guitar",
  "engine": "guitar-bench",
  "params": { "scaleLengthMm": 600, "bridgeAtMm": 255, "topWood": "sitka-spruce", "bodyDepthMm": 90 },
  "parts": {
    "string": [
      { "stringMaterial": "phosphor-bronze", "stringDiameterMm": 1.2, "stringWound": true, "tensionN": 83.3 },
      { "stringMaterial": "steel-music-wire", "stringDiameterMm": 0.28, "stringWound": false, "tensionN": 74.7 }
    ]
  },
  "volumeDb": 0
}
```

- `format` and `version` identify the file. This app reads versions 1 and 2 and refuses any other.
- `engine` is the engine's `meta.id`. A file that names an engine you do not have says so; nothing is guessed.
- `params` holds the values that belong to the whole instrument. Missing values take their defaults. Unknown names or out-of-range values are errors, never silently changed.
- `parts` (version 2) holds, for an engine made of parts, one list per part with one entry for each one on the bench (here, each string, in order from the first to the last). The number of entries must be within what the engine allows. Values missing from an entry take their defaults. An engine without parts has no `parts`.
- For the guitar, `parts.fret` lists the fret wires, one entry each with its `fretNumber` (1 to 24). A file with no `fret` list gets frets 1 to 19, the ordinary neck. `pickupFit` (`none` or `magnetic`) and `pickupAtMm` (its distance from the bridge) are ordinary shared values.
- For the bars (`bars-bench`), `parts.bar` lists the bars from left to right, each with its `barMaterial`, `barLengthMm`, `barThicknessMm`, `barUndercut` and the tube (`tubeFit`, `tubeLengthMm`). The note of a bar is not stored: it comes from the numbers. `strikeAt`, `malletHardness` and `frameWood` are ordinary shared values.
- For the drums (`drum-bench`), `parts.drum` lists the drums from left to right, each with its `headMaterial`, `headThicknessUm`, `headDiameterMm`, `headTension` (newtons per metre), `shellMaterial`, `shellDepthMm` and `shellClosed`, and if it has a second head `bottomHead`, `bottomTension` and `bottomThicknessUm` (and its `damping`, per second). The microphone is `micHeightMm`, `micOffset`, `micShadow` (how much of the second head is heard through the shell, 0 to 1) and `micLowCutHz` (a fitted, labelled high-pass on the microphone for the toms and the hand drums, 0 for none) `headLossFactor` (the skin's own loss as a multiple of the film's, 1 to 30: a hand resting on a frame drum takes 5) and `headLossQuad` (a fitted skin loss that grows as the square of the pitch, per second at 1 kHz: 150 on the bongo, 0 for none). `levelDb` is the drum's loudness against the others (the player levels every drum to the same peak and does not see it); it is not part of the sound. The note of a drum is not stored: it comes from the numbers. `strikeAt`, `strikeAngle` and `stickHardness` are ordinary shared values.
- `volumeDb` is the listening volume trim (-30 to 6 dB). It is not part of the sound, only of how loud this instrument is in the player.

Version 1 files (no `parts`) are still read.

Files are saved with **Save** and read with **Open**. The file name ends `.instrument.json`.
