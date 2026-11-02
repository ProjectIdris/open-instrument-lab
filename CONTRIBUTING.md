# Contributing

Thank you for helping. The app is small on purpose, so a good change is usually small too. Please read the next section first: it says how your work is licensed.

A plug-in engine is code that runs with the user's full permissions (there is no sandbox), so say plainly in your pull request what an engine does, and only ever run engines you have read.

## Licence and the CLA

The program is free software under the **GPL-3.0** (see [LICENSE](LICENSE)). Contributions are accepted under the project's [Contributor Licence Agreement](CLA.md): **you keep the copyright in what you write**, and you give the project owner the right to use it, including under other terms such as a paid version of the program. Read it before you start; it is short and written in plain words.

You agree to it by keeping one line in the pull request template, the one that begins "I have read" and links to CLA.md. That line is your signature. There is no form, no account and no bot. A pull request that removes that line cannot be merged. Contributions are open as soon as the repository is public.

## Ground rules

- **Node 24, no dependencies.** If you think a dependency would really help, open an issue first and say what it replaces and what its licence is.
- **Only what you may share.** Do not add recorded audio unless its licence allows redistribution (CC0 is easiest) and the licence is recorded next to it. Do not copy a table, dataset or curve from a book or paper wholesale; individual published facts with their source are fine, which is how `engines/materials.json` is built.
- **No machine details.** No absolute paths, usernames, hostnames, keys or tokens in code, tests or docs.
- **Plain language for players.** Labels and help text are written for someone who has never heard of a waveguide. Technical names go in the help text, not the label.

## The easiest contribution: a new engine

An engine adds instruments without touching the app. Read [docs/engines.md](docs/engines.md), copy the small example, and run `npm test`. A good engine has:

1. A schema where every parameter has a label, a sentence of help, a range and a default, and every parameter of the model is reachable (plain or advanced).
2. A gallery of a few instruments that play at once and sound different from each other.
3. A `describe` that tells the truth about the playable range.
4. A `render` that is deterministic, finite for every point in the parameter ranges, and at the pitch it was asked for.

Add materials to `engines/materials.json` with their source (title, publisher, locator such as a table or page).

## Changing the app

- Server code is in `server/`, page code in `web/js/`; the workbench is `web/js/bench/` (`model.js` the instrument and its arithmetic, `geometry.js` where things are, `draw.js` the picture, `interact.js` the hands, `racks.js` the shelves, `sound.js` getting notes ready). Each file does one thing; keep it that way.
- The pitch and the body arithmetic live in `engines/physics.mjs` and are used by both the engine and the page. Do not copy a formula into page code.
- The page must not hold a hard-coded list of instruments, parameters or engines. If you find yourself writing one, the information probably belongs in an engine's schema.
- Never freeze the page: anything slow belongs on the server, in a worker thread.
- Anything that talks to the network must stay on `localhost`. The server refuses other hosts and other origins; keep it that way.
- Run `npm test` before you send a change. If you fix a bug, add a test that fails without the fix and passes with it.
- Check the page by hand in a real browser as well: pluck, drag the nut and the bridge, turn a peg, drop a string and a wood from the racks, drag the body's handles, play the keyboard, undo.
- The bench is for people who make instruments, not for people who write code. Anything a player must read a number to understand is probably in the wrong place: put a length on the object, a tension on a peg, a material on a swatch.

## Style

Modern JavaScript modules, two-space indent, semicolons, single quotes. Comments say why, not what. Keep names in plain words.

## Proposing bigger things

Open an issue before you start on anything that changes the plug-in contract, the instrument file format, or adds a screen. Both are promises to everyone who has saved an instrument or written an engine.
