# Open Instrument Lab

Build an instrument with your hands, then play it.

Open Instrument Lab is a local web app for making sounds from simple physical models. The first thing on the bench is a guitar, drawn to scale, seen from above. You work on it the way you would in a workshop: pull the nut or the bridge to change how long the strings are, turn a peg to tune a string, swap a string from the rack, drag a piece of spruce or cedar onto the top, push the edge of the body to reshape it, then touch a string to pluck it. The pitch and the tone come from what you have made: its real lengths, tensions, thicknesses and materials. You do not need to know anything about how the sound is made.

> **Status: early.** This is the fifth working slice: a guitar, a row of bars and a row of drums on the bench, a basic body worked out from its drawing, saving and opening instruments, duplicating and comparing two versions, saving sounds as WAV files. More is planned: techniques, a phrase editor. See [CONTRIBUTING.md](CONTRIBUTING.md) if you want to help.

## Run it

You need [Node.js](https://nodejs.org/) 24 or newer. Nothing else: there is nothing to install.

```
git clone <this repository>
cd open-instrument-lab
npm start
```

Then open <http://localhost:8420/> in Chrome or Edge, which are the ones it is tried in. Firefox and Safari should work for everything except MIDI. If that port is busy, start it on another: `PORT=8421 npm start` (on Windows PowerShell: `$env:PORT=8421; npm start`).

The first note after a change takes a fraction of a second to make; the rest of the keyboard is prepared in the background (the count is at the bottom right) and you can play while it does.

Options, all optional environment variables: `PORT` (default 8420), `HOST` (default `127.0.0.1`, this machine only), `STUDIO_CACHE_MB` (server note cache, default 256), `STUDIO_ENGINE_DIRS` (extra engine folders, see below).

## Working the bench

| To do this | Do this |
| --- | --- |
| Pluck a string | Touch it anywhere. Where you touch is where it is plucked. Pull it sideways before you let go: the further, the harder. |
| Lengthen or shorten the strings | Drag the **nut** (the white bar at the headstock end) or the **bridge**. The ruler measures from the nut, and the note name travels with your hand. |
| Tune a string | Turn its **peg** on the headstock: drag round it. A quarter turn is about a semitone. Or click the string's note tag by the bridge to tune it to the nearest note. |
| Add a string | Drag a coil from the **Strings** rack onto the neck. Drop it between strings to add one (the neck widens), or on a string to swap that one. A click on a coil adds one at the end. |
| Take a string off | Drag its note tag off the guitar and let go. |
| Change what something is made of | Drag a **wood** swatch onto the top, the back (in the side view) or the neck; drag a **metal or nylon** swatch onto a string. A string you swap keeps its note, so its tension changes. *Your own* lets you type a density and stiffness in the drawer. |
| Reshape the body | Drag the round handles on its edge (shoulders, waist, lower bout, tail), the edge of the sound hole to resize it, the hole itself to move it, and the bottom edge of the side view to change the depth. |
| Move, add or take out a fret | Drag a **fret wire** along the neck (it snaps to the nearest place with no wire), or off the guitar to take it out. Drag the **Fret** tile from the right rack onto the neck to put one back. A string can only be stopped where there is a wire; the keyboard follows. Grab a wire between the strings: on a string you pluck it. |
| Fit a pickup | Drag the **Pickup** tile from the right rack onto the strings. The sound is then taken from the strings at that spot, as on an electric guitar, instead of from the body. Drag it along the strings to change the tone (near the bridge is thin and bright, towards the neck is round); past the end of a fretted note it is over the dead part of the string and that note is thin and very quiet, or off the guitar to take it off. |
| Strum | Hold the **right mouse button** and drag across the strings, down or up. Each string sounds as your hand crosses it, in that order, and where it crosses is where that string is plucked. A faster sweep is louder. No menu opens. |
| Pluck with a thumb, finger or pick | Choose from **Hands** on the right. |
| Zoom | Mouse wheel. Drag the background to pan. *Whole guitar* and *Close on the neck* jump between views. |
| Undo | *Undo* or `Ctrl+Z`. |
| Start from another instrument | *Take one off the wall*. |
| Millimetres or inches | The `mm` button. |

While you drag, a plain tone follows your hand so you can hear the pitch change; when you let go the real plucked sound is made. The **tuner** on the right shows the note and how far from it the last string you touched is. The **Maker's drawer** holds finer adjustments (how long the strings ring, how bright they are, how stiff, pick noise) and, for "your own" materials, the numbers.

The sound of the body is an **approximation**: a typical steel-string body is scaled by the size, depth, sound hole and wood you draw, using simple textbook rules (the air in the body against its hole, plates that rise in pitch with stiffness and thickness and fall with area). It follows the right directions; it is not a measured guitar. The **nylon guitar is known to be too bright**: against a recording of a nylon-string guitar its sound from 1 to 8 kHz is about 14 dB too strong (the cause is not found; the string loss law and the strings were set from the recording, the finger and the body were not). The neck wood and the position of the sound hole change how the guitar looks in this model, not how it sounds.

## Playing

| | |
| --- | --- |
| Computer keyboard | `A S D F G H J K L ;` are the white keys, `W E T Y U O P` the black keys. `Z` and `X` move down and up an octave. Hold `Space` to sustain. The note is played on the highest string that can reach it; you see the finger on the fret. |
| On screen | Click or touch the keys. Clicking lower down on a key plays harder. |
| MIDI | Press *Connect a MIDI keyboard* and allow access. Touch (velocity) and the sustain pedal are read. |
| Touch | The slider sets how hard the computer keyboard plays. |
| Note length | Short, medium or long notes. Short notes are made fastest. |

## The bars

Choose *Maple xylophone*, *Tuned marimba bars with tubes* or another bars instrument from **Take one off the wall**.

| To do this | Do this |
| --- | --- |
| Strike a bar | Press on it: the mallet lands where you press. Lift away before you let go for a harder blow. |
| Stretch a bar | Drag either end of it. The bar gets longer both ways, the note goes down, and its name travels with your hand. |
| Make it thicker | In the side view of the selected bar, drag the white dot under its left end. |
| Carve the arch | Drag the **gouge** onto a bar (a quarter of the arch each time), or drag the dot under the middle of the bar in the side view. The full arch tunes the first overtone to two octaves above the note, as on a marimba; carving also lowers the note. |
| Cut a bar to a note | Click its note tag. The bar is made longer or shorter until it is in tune. |
| Hang a tube under a bar | Drag the **tube** onto it: it is cut to ring at the bar's note. Drag the tube's lower end in the side view to change its length, or up into the bar to take it off. |
| Add a bar | Drag a bar from the rack onto the frame, where you want it in the row. Drag a bar's note tag off the frame to take it away. |
| Change what a bar is made of | Drag a swatch onto it. The bar is cut again to the note it had. A wood swatch dropped on the frame changes the frame. |
| Change the mallet | Pick one from **Mallets**, from yarn to brass. |

The note of a bar is worked out from its real length, thickness, material and arch (thin-beam theory). The sound is an approximation, and says so on the page.

## The drums

Choose *Three toms*, *A kettledrum* or another drums instrument from **Take one off the wall**.

| To do this | Do this |
| --- | --- |
| Strike a drum | Press on its head: the stick lands where you press, how far out from the centre and which way round. Lift away before you let go for a harder blow. The middle gives a low boom; towards the rim the higher overtones come in. |
| Tension a head | Drag a **lug** (the small bolts round the rim) round the drum. A quarter turn is about a semitone. Or click the drum's note tag to tune it to the nearest note. |
| Make a drum wider or narrower | Drag its **hoop** (the pale ring round the head), or its walls in the side view. Twice the width and the note falls an octave. |
| Change the depth | In the side view of the selected drum, drag the dot under the shell. It matters when the bottom is closed. |
| Open or close the bottom | Click the bottom of the shell in the side view. Closed, a cushion of air under the head lifts the lowest modes, the more the shallower the drum is: the kettledrum's note is its principal mode, not the lowest one a bare head would have. |
| Make the head thicker | In the side view, drag the dot at the left end of the head. It is drawn 40 times too thick. A thicker head is heavier and sounds lower. |
| Change a head or a shell | Drag **film** onto the head (*Your own* lets you type a density in the drawer), a **wood or metal** swatch onto the shell. The shell is rigid in this basic model, so its material changes how the drum looks, not how it sounds. |
| Add a drum | Drag one from the rack onto the row, where you want it. Drag a drum's note tag off the row to take it away. |
| Change the stick | Pick one from **Sticks and beaters**, from a soft felt mallet to a hard nylon tip. |

The note of a drum is its main tone, the (1,1) mode of its top head (the lowest with a nodal diameter, which is what a tom is heard to sound at), worked out from the head's real size, thickness, tension and the air it moves (the modes of a circular membrane, with the air's added mass and, in a closed shell, its spring). The sound is built from up to two and a half thousand modes of each head; a second head under the shell is tied to the first through the air between them; the stick is a mass on a contact spring, so its crack comes from the stick; the microphone hears the near field of the head, and the second head through the shell with the batter head's sign, so a pair of heads breathing against each other (the lowest coupled mode) cancels at the microphone as a monopole against a dipole would; the head's own swing raises its tension a little, which gives the pitch glide; and snare wires are coil segments that lift off the second head and land on it again, and ring, each at its own few pitches and for a few milliseconds, so that they make a noise and not a chord. The sound is an approximation, and says so on the page: the shell is rigid, the head's own loss and the rim's, which set how long a drum rings, are estimates chosen against recorded toms, the snare is tuned to a recorded muted snare's lowest line (226 Hz) and its wires' level, ring time and span of pitches are fitted to that recording (the Virtuosity drum samples, CC0 1.0; one drum and one take per layer, used for comparing only and not in this repository), whole-hit bands to within about 9 dB rms, but the wires' narrow lines stand 10 to 20 dB prouder of their surroundings than the recording's, the 160 Hz band has no tail after 100 ms, and 200 to 400 ms is light above 4 kHz; each drum also carries a Level (dB) that sets it against the others in a kit and against other instruments, since the player sets every drum to the same peak and the long, low ones come out quieter, and the toms carry a fitted fourth-order microphone low cut at 70 Hz (the Microphone low cut value on the page, 0 for none) because the model still leaves a little low thud that a close microphone would not pass. The bongo and the frame drums carry the same kind of cut (160 Hz and 100 Hz), also fitted and labelled, chosen against recorded hand drums (VCSL, comparing only) so that the 51 Hz mode of the big frame is no longer its strongest line. The bongo's skin keeps its low modes and gives up its high ones in a few milliseconds, which a loss growing as the square of the pitch does (*High-pitch loss in this head*, `headLossQuad`, 150 per second at 1 kHz; fitted against the recorded bongo's narrow lines and falls, not measured): its strongest narrow line is about 23 dB above its surroundings against 18 dB recorded (a bare film head's is near 60 dB), but its tail is short of the recording's (80, 200 and 320 ms to fall 20, 40 and 60 dB against 100, 430 and 720 ms), its 62 and 125 Hz bands are 10 dB over, and it is 12 dB dark at 8 kHz. The *16 in frame drum, hand on the head* is the same drum with a hand resting on the skin (more damping and five times the skin loss): its tone falls 20, 40 and 60 dB in about 170, 430 and 660 ms against 180, 390 and 690 ms recorded. The top two octaves of a drum ring about a third as long as in the recordings it was compared with. A real kettledrum's overtones lie close to 1 : 1.5 : 2 : 2.5 above its note; this model puts them at about 1 : 1.4 : 1.8 : 2.2, so its kettledrum is less in tune with itself than a timpani is.

## Keeping what you make

| To do this | Do this |
| --- | --- |
| Save an instrument | **Save** downloads a small `.instrument.json` file; **Open** reads one back. It keeps every string or bar and the body. See [docs/instrument-file.md](docs/instrument-file.md). |
| Try a change without losing the first | **Duplicate**. The instrument you had is kept on the **Versions** shelf and a copy ("… copy") comes to the bench. Do it again for a third. |
| Hear one against the other | **A/B** (or `Alt+B`) flips between the last two versions, keeping what you did to each, undo included. Notes already made for each are kept, so the flip is quick. Click any version on the shelf to bring it to the bench, or its × to take it off. |
| Save a sound | **Save sound**. Choose a note and save it as a **WAV** (16-bit, mono, at the engine's own sample rate), or save every note on the keys as one zip of WAVs. The files are what you hear: the Touch, the Volume and the note length below the bench. If a loud volume would clip a note it is turned down a little and the page says so. |

The versions live on the page while it is open. They are not saved until you **Save** each one (the one on the bench is what Save keeps), and changing to another kind of instrument closes the bench and the shelf with it (the page asks first).

## Other instruments

*Other instruments* (top right) opens a plainer panel with sliders for engines that do not have a bench yet. It will go once those instruments are on the bench.

## Adding your own engine

> **Plug-ins are code, and they run with your full permissions.** An engine is a JavaScript file that this program loads and runs on your computer, in the server and in its worker threads, with the same access to your files and network that you have. There is no sandbox. Only install or point `STUDIO_ENGINE_DIRS` at engines you wrote or have read and trust, as you would any program you download.

An engine is one folder with an `engine.mjs` that says what controls it has and how to make a note. The page builds its controls from that description, so a new engine appears with no changes to the app. An engine can also describe its parts (its strings, say) and what each number means in the world (a length, a tension, a material, a place on the string), so the bench can put them where a maker expects. Each part and parameter the bench draws carries a `role`, and the bench finds them by that, never by id. Engines can live in this repository, in a git-ignored `plugins/` folder, or anywhere on your machine when named in `STUDIO_ENGINE_DIRS`. See [docs/engines.md](docs/engines.md).

## How it works

- `server/` is a small Node server with no dependencies. It serves the page and renders notes in worker threads, keeps a cache of the notes it has made, and answers `localhost` only.
- `web/` is the page: plain JavaScript modules and SVG, no build step. `web/js/bench/` is the workbench.
- `engines/` holds the engines and the shared description format. `engines/physics.mjs` is the physics both the engine and the bench use, so the pitch you see is the pitch you hear. `engines/string-waveguide/lab/` is a digital-waveguide string model written by this project's author for earlier physical-modelling work and copied in; see the note in that folder. A string can be damped by a palm, a fretting finger or a choke, which are simple passive contacts and basic playing controls; the model has no friction, winding or fret-contact physics.
- `engines/guitar-bench/` is the guitar: a string from real measurements, and a body from the drawing.
- `engines/modal-bar/` is a free-free bar built from textbook beam theory.
- `engines/drum-bench/` is a row of drums: a circular head's modes from its tension, size and thickness, loaded by air, struck where you press.
- `engines/materials.json` is the starter materials list with sources.

Rendering is not real time. The page asks the server for each note, gets back a short audio file, and plays it in the browser. After every change it prepares this guitar's notes in the background, the open strings first.

## Tests

```
npm test
```

## Licence

Open Instrument Lab is free software, released under the **GNU General Public License, version 3** (GPL-3.0-only). The full text is in [LICENSE](LICENSE). You may run it, study it, change it and share it, and share your changes, on the same terms.

Contributions are accepted under the project's Contributor Licence Agreement ([CLA.md](CLA.md)): you keep the copyright in what you write and you give the project owner the right to use it, including in a paid version of the program. How to agree, and why, is in [CONTRIBUTING.md](CONTRIBUTING.md).

The recordings that some presets were compared with are not in this repository; where the code cites one, the citation names it. The materials list in `engines/materials.json` records the source of each value.
