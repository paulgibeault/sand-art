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
`pickTint`, `flushSave`) for driving it from a script.

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
| Brush | Paints sand cells directly | Size |
| Wall | Draws dividers and stencils the sand piles against | Size |
| Unwall | Erases walls only; sand stays (`sim.replace(WALL, EMPTY, …)`) | Size |
| Recolour | Swaps the tint under your finger at touch-down for the chosen one, along the stroke (`sim.replace`) | Size |
| Erase | Removes anything | Size |
| Stick | Thin stick (r=1): drag to shove grains, tap to poke | — |
| Stick+ | Thick stick (r=4): moves a whole pile | — |
| Stir | Seeded shuffle under the finger (`sim.stir`) | Size |
| Water | Pours water; sand sinks through it | Flow |

Sixteen colours: the kernel's own sand plus fifteen curated tints set through
the batch `sim.setPalette([...])` on ids 17..31 (`palette.js`); the remaining tints keep the
kernel defaults.

**Empty jar** asks first (`Arcade.ui.confirm`, a real dialog inside the
launcher where native `confirm` is a no-op).

## Files

| File | Purpose |
|------|---------|
| `index.html` | Loads the SDK and the kernel, calls `Arcade.init`, registers the SW. |
| `main.js` | Boot, the `Arcade.loop` wake/rest loop, pointer → cells, the blit, UI wiring. |
| `tools.js` | The tool table: data plus `down`/`move`/`frame` hooks that only touch the sim. |
| `palette.js` | The curated tints, and empty/wall colours per theme. |
| `persist.js` | Save/restore through `Arcade.store` (grid as base64; restore is one `sim.load`). |
| `style.css` | Font-scale and theme aware chrome; no animations. |
| `sw.js` | The fleet's reference worker, scoped to `/sand-art/`. |

## What the picture is made of

- The grid is 192×320 cells (chunk-aligned to the kernel's 16×16 chunks).
- The sim steps at a fixed 60 Hz through an accumulator; the display draws at
  its own rate. Under power saver only every other frame is blitted.
- The picture autosaves a few seconds after the last change, when the sand
  settles, and on suspend; it comes back on the next boot.
- Reduced motion changes nothing: falling sand is the content.
