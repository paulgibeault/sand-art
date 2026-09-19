# Sand Art

A jar you pour coloured sand into to make a picture, then poke and shape with
sticks — sand-bottle art, on a phone. It is the test bed for the fleet's first
compiled simulation kernel, `Arcade.sim.sand` (the WP3 consumer in the
launcher's `plans/compiled-kernels-2026-09.md`): every grain is a cell in a
WebAssembly falling-sand automaton, and this app is deliberately thin around
it — a finger becomes cell coordinates, a tool calls the kernel, one blit puts
the framebuffer on screen, and the frame loop stops the moment the kernel says
nothing can move.

No framework, no build step, no runtime dependencies.

## Run it

The kernel lives in the launcher, so run this through the launcher's dev
staging, from a launcher checkout that has `sdk/v3/arcade-sim-sand.js`:

```sh
./dev.sh ../sand-art          # from the launcher repo root
# then open http://127.0.0.1:4791/sand-art/
./dev.sh stop
```

Re-run `./dev.sh` after editing — it copies the app into `.dev-stage`.

Add `?dev=1` to get `window.__sandArt` (`running()`, `sim`, `pickTool`,
`pickTint`, `flushSave`, `showLibrary`, `gestures`, …) for driving it from a script.

## CI / deploy

This repo follows the fleet CI/CD standard (launcher `GAME_INTEGRATION.md`
§13a). `.github/workflows/pages.yml` is a thin caller of the launcher's
`fleet-ci.yml`: every push to `main` runs the contract gates and `npm test`,
stages `dist/` with `tools/stage.mjs`, bumps the patch version (`package.json`,
`sw.js`'s `APP_VERSION`) and deploys to GitHub Pages at
`https://paulgibeault.github.io/sand-art/`. Pull requests test and smoke, and
never deploy.

- `npm test` — `tools/verify-artifact.mjs` stages into a temp dir and proves
  every file `index.html` and `manifest.json` name is published and precached,
  then `node --test tests/`.
- `npm run stage` — writes the deploy artifact to `dist/` (git-ignored).
- `node tools/library-build.mjs [id …]` — remakes the Library's sample jars
  from `tools/library-recipes.mjs` on the real kernel (needs a launcher
  checkout beside this one, or `ARCADE_FLEET_ROOT`, with Playwright
  installed there).
- `tools/verify-artifact.mjs` and `tools/inject-precache.mjs` are byte-identical
  fleet copies: never edit them here, re-copy from the launcher.
- `sw.js`'s precache list is generated at stage time; leave a published file
  out of it by naming it in `PRECACHE_EXCLUDE` in `tools/stage.mjs`.
- The kernel (`/sdk/v3/arcade-sim-sand.js` + `.wasm`) is served by the
  launcher origin and is never vendored or precached here.

## Tools

| Tool | What it does | Option |
|------|--------------|--------|
| Pour | Sand falls from the top of the jar at your finger's x, with a little seeded jitter | Flow (grains per step) |
| Sprinkle | Sand appears around the finger | Spread |
| Funnel | One grain per step, exactly where you point | — |
| Cup | A tap sets down one measure of sand (a disc of the chosen size) that settles where it lands; Clemens's tin cup on a stick | Measure |
| Brush | Paints sand cells directly | Size |
| Match | Paints sand in the colour of the settled grain under the finger, sampled at every cell of the stroke; grains still falling are skipped (`settledTintBelow`) | Size |
| Trace | Paints each cell in the picture's colour for that cell (the template's tint map); does nothing without a picture | Size |
| Wall | Draws dividers and stencils the sand piles against | Size |
| Unwall | Erases walls only; sand stays (`sim.replace(WALL, EMPTY, …)`) | Size |
| Recolour | Swaps the tint under your finger at touch-down for the chosen one, along the stroke (`sim.replace`) | Size |
| Erase | Removes anything | Size |
| Stick | Thin stick (r=1): drag to shove grains, tap to poke | — |
| Stick+ | Thick stick (r=4): moves a whole pile | — |
| Needle | Opens a channel one grain wide along its path; the sand above falls into it, so an upper colour is drawn down through the layers below (the Petra needle) | — |
| Stir | Seeded shuffle under the finger (`sim.stir`) | Size |
| Water | Pours water; sand sinks through it | Flow |

Sixteen colours: the kernel's own sand plus fifteen curated tints set through
the batch `sim.setPalette([...])` on ids 17..31 (`palette.js`); the remaining tints keep the
kernel defaults.

**Empty** asks first (`Arcade.ui.confirm`, a real dialog inside the
launcher where native `confirm` is a no-op). The picture stays, and undo
brings the sand back.

## The hand

Two fingers are always the view and one finger is always the tool; there
is no mode to switch. Pinch to zoom the jar from fit to 4× and pan it
(never past the grid's edge), double-tap to toggle 3× about the tap,
ctrl+wheel on a desktop; a **Fit** chip on the stage says how far in you
are and puts the jar back. Rendering stays one crisp blit: the same
source rectangle crops the picture, the sand and the landing overlay,
and `toCell` maps a finger through the same view, so the tool lands
where the finger is. The one subtlety is in `gestures.js`: the second
finger of a pinch lands a few milliseconds after the first, so a stroke
waits an 80 ms grace before it commits (a tap or a drag commits at once)
and a pinch never leaves a dot.

**Tilt** is the jar's gravity, stepped by hand: upright, leaning left,
leaning right. Inside the arcade on a phone the chip has a fourth stop,
**Phone**, where the jar follows the way the phone is really held, through
all eight of the kernel's directions (`Arcade.motion.compass(8)` →
`sim.tilt()`; `tilt.js` has the chip's states). The launcher asks once
before any game may sense motion and can take it back from its menu; the
sensor runs only while the chip says Phone; and what a jar saves is the lean
the phone chose, never the samples. Without motion the chip is exactly what
it was.

**Undo** is a snapshot of the grid before every stroke, and before
**Empty**: two dozen of them, 60 KB each, and one `sim.load()` to go back
(`history.js`). The kernel repaints and wakes every chunk on a load, so a
snapshot taken mid-fall simply carries on falling. **Redo** keeps what undo
removed until a new stroke forks the timeline; both are chips on the
stage that appear when there is somewhere to go, and Ctrl/Cmd+Z and
Shift+Z on a keyboard. Undo is for the session; the gallery is for keeps.

The tool is drawn where it acts (`overlay.js`, one shape per tool in
`tools.js`): a rod from the rim of the jar down to the tip for the
sticks, the way the real tool looks in a bottle and the way a shove
reads; a ring the size of the disc for every disc tool; a bracket at the
rim as wide as the stream for Pour and Water, with a guide down to the
finger; a crosshair for the Funnel. It shows under a finger during a
stroke and under the mouse on a desktop, dark then light so it reads on
any sand. **Lift**, at the end of the options row, moves the acting
point a little above a finger so the tip is never under the fingertip;
it pairs with zoom rather than replacing it, and a mouse is never lifted.

Three tools come straight from the traditions in the Library. The
**Needle** is Petra's long thin tool pushed down the inside of the glass:
it opens a channel one grain wide along its path and the sand above
falls into it, so an upper colour is drawn down through the layers below
into a spike, a leg, a trunk. No new physics: an erase of radius zero
and the kernel's own fall. The **Cup** is Clemens's tin cup on a stick:
a tap sets down one measure that settles where it lands. And the flow
slider is the chak-pur's rasp: it stays live while a finger pours, so a
thumb can change the rate mid-stream.

**Tilt** is Petra's sloped layers: the chip above the jar's rim cycles
upright, leaning left and leaning right (the arrow says which way the
sand slides), and what is poured next settles on a slope. It is the
kernel's own gravity — `sim.tilt(gx, gy)`, any of the eight directions,
rule R17 in the launcher's `tools/sim/sand-reference.mjs` — so the sand
that has already settled stays settled until the jar is levelled again,
when only surfaces steeper than the sand's own angle of rest slump. The
tilt is saved beside the grid (`gravity` in the record) and comes back
with the jar. The chip is there when the kernel can tilt.

## A picture behind the jar

**Picture** opens a photo from the device (`Arcade.ui.openFile` — sandboxed
frames have no picker of their own, so the launcher brokers a consent
dialog and the OS picker) and fits it to the jar: cover-fitted and centred
by default so one tap on **Use picture** is the whole flow, or drag to
move, pinch or slide to zoom, **Turn** for quarter turns, and **As sand**
to see the picture snapped to the tints the jar can actually make. The
result is exactly the grid's size — one picture pixel per cell — and is
drawn under the framebuffer with the air made transparent
(`applyPalette(..., { clearEmpty })`), so the sand is still one blit.

The picture's own colours are pulled out by a median cut (`template.js`)
onto the kernel's sixteen spare tints (ids 32..47) and appear as extra
swatches after the curated ones. The picture bar sets its strength, hides
it, removes it, and toggles **Landing**: an overlay of every empty cell a
grain could rest on right now (`hints.js` — on the floor, on a wall, or on
a grain that itself has something under it), drawn in the picture's colour
for that cell so it reads as "lay this here next".

The sand settles the way sand settles, so the picture comes out distorted.
That is the point.

## The gallery

Every jar is a record in `Arcade.store` (`persist.js`): the grid, the
picture's PNG and opacity, its colours, its tilt, and a thumbnail. The open jar
saves itself as it settles. **Gallery** lists them newest first: tap to
open, tap the name to rename in place, **Duplicate**, **Delete**
(confirmed), **New jar**. A new jar is not written until something happens
in it. The pre-gallery single record is adopted as "Jar 1" on first boot.

## The library

Sand Art's tools come from real traditions, and the **Library** (behind the
Gallery, so the top bar stays three buttons wide on a phone) says which:
Andrew Clemens's hickory sticks and tin cup, the funnels and long tools of
the Petra sand bottles, the chak-pur of the Tibetan sand mandala, the
Alum Bay souvenir jar and its cliff colours, the trickle of Navajo
sandpainting in its public form, the feathers and spoons of bonseki, and
the lit table of sand animation. Each entry is a short write-up, where to
read more, a sample jar made in that style, and chips for the tools it
inspired: tap a chip to pick the tool up, tap **Try this jar** to get a
copy of the sample in the gallery, open, and yours to change.

The text is data, not code: `library.json` holds every entry and
`library-ui.js` only lays it out. The sample jars are ordinary gallery
records (`persist.js` v2) in `library/jars/`, and they really were made in
the app: `tools/library-recipes.mjs` is the pointer script for each — a
list of strokes naming a tool, a tint and a path — and
`tools/library-build.mjs` replays them through the real tools on the real
kernel in a headless browser and writes the record and a picture of it
(`library/<id>.png`, air transparent, drawn over the theme's ground in the
sheet). The kernel is deterministic, so unchanged recipes rebuild to
identical bytes. `library/SOURCES.md` lists every shipped picture's origin
and licence, and the repo gates fail on one it does not name.

Inside the launcher a game frame cannot open windows, so a source link
there copies its address to the clipboard and says so; standalone it opens
a tab.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Loads the SDK and the kernel, calls `Arcade.init`, registers the SW. |
| `main.js` | Boot, the `Arcade.loop` wake/rest loop, pointers → gestures, the blit through the view (picture under, landing overlay over), the open jar, UI wiring. |
| `gestures.js` | Pure: one finger strokes, two pinch the view; the grace, the double tap, the clamped view. |
| `history.js` | Pure: the undo stack of grids, bounded, with redo. |
| `overlay.js` | Pure drawing: the tool's shape on the jar, through the view. |
| `template.js` | Pure: cover-fit and clamped pan/zoom, median-cut palette pull, nearest-tint mapping. |
| `importer.js` | The fit sheet: file decode, the crop canvas, fingers, the "As sand" preview. |
| `hints.js` | Pure: the landing mask. |
| `persist.js` | The gallery store: records, list, rename, duplicate, remove, legacy adoption. |
| `gallery-ui.js` | The gallery sheet. |
| `library-ui.js` | The Library sheet: the index of influences, and one entry at a time. |
| `library.json` | The Library's entries: text, sources, tools, picture, sample jar. |
| `library/` | The sample jars (`jars/*.json`), their pictures, and `SOURCES.md`. |
| `sheet.js` | The in-page modal panel the three sheets use. |
| `tools.js` | The tool table: data plus `down`/`move`/`frame` hooks that only touch the sim. |
| `palette.js` | The curated tints, and empty/wall colours per theme. |
| `style.css` | Font-scale and theme aware chrome; no animations. |
| `sw.js` | The fleet's reference worker, scoped to `/sand-art/`. |

## What the picture is made of

- The grid is 192×320 cells (chunk-aligned to the kernel's 16×16 chunks).
- The sim steps at a fixed 60 Hz through an accumulator; the display draws at
  its own rate. Under power saver only every other frame is blitted.
- The open jar autosaves a few seconds after the last change, when the sand
  settles, and on suspend; it comes back on the next boot.
- Reduced motion changes nothing: falling sand is the content.
