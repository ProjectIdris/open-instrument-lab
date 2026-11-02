# Digital-waveguide string model

These modules are a digital-waveguide string, pickup and body model, written by this project's author for earlier physical-modelling work and copied here so the studio runs from a clean clone. They are part of this project and under its licence (GPL-3.0-only, see the `LICENSE` file at the top).

- Files: `model.mjs` (`renderNote`), `data.mjs` (starter instrument data and recipe checking), `string.mjs` (the waveguide), `loss.mjs`, `dsp.mjs`, `body.mjs`.
- Only the plucked-string, pickup and body path is kept. There is no hammer-collision code, no amplifier or cabinet, and no friction, winding or fret-contact model. A string is plucked by a pick or a finger and loses energy in its ends, its stiffness and its air. It can also be damped by a palm, a fretting finger or a choke: these are simple, passive shunt contacts (`contactGain` and the contact junctions in `string.mjs`), the basic playing controls of a plucked string, and they stay.

The starter instrument data in `data.mjs` is a textbook-and-manufacturer-typical policy, not a measurement of any instrument. The adapter in `../engine.mjs` is the only code that talks to these modules.

The guitar workbench engine (`../../guitar-bench/`) reuses these modules for its string; it builds the string and the body from the drawing instead of from the starter instrument data.
