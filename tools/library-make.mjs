/* tools/library-make.mjs — the browser half of the Library jar build.
 *
 * Runs inside the lab page tools/library-build.mjs serves: creates a sim on
 * the real kernel, replays one recipe from tools/library-recipes.mjs
 * through the real tools, then renders what settled — a PNG of the jar
 * with the air transparent (so the Library sheet's own ground shows
 * through in either theme), the gallery's 48×80 thumbnail, and a v2
 * gallery record (persist.js) with the grid in base64. The record is what
 * "Try this jar" copies into the player's gallery.
 */

import { TOOL_BY_ID } from '../tools.js';
import { RECIPES, W, H, runRecipe, seededRng } from './library-recipes.mjs';
import { toBase64 } from '../persist.js';
import { applyPalette, groundCss } from '../palette.js';

export const RECIPE_IDS = Object.keys(RECIPES);

export async function makeJar(id) {
    const sand = window.ArcadeSimSand;
    const recipe = RECIPES[id];
    if (!recipe) throw new Error('no recipe: ' + id);
    const sim = await sand.create({ width: W, height: H, seed: 'sand-art:library:' + id });
    const stats = runRecipe(recipe, { sim, sand, tools: TOOL_BY_ID, rng: seededRng(id) });

    applyPalette(sim, sand, 'dark', { clearEmpty: true });
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(sim.pixels), W, H), 0, 0);
    const png = c.toDataURL('image/png');

    const t = document.createElement('canvas');
    t.width = 48; t.height = 80;
    const tc = t.getContext('2d');
    tc.fillStyle = groundCss('dark');
    tc.fillRect(0, 0, 48, 80);
    tc.imageSmoothingQuality = 'high';
    tc.drawImage(c, 0, 0, 48, 80);
    const thumb = t.toDataURL('image/jpeg', 0.7);

    // Every grain rests on something: the record is the settled jar.
    let floating = 0;
    const g = sim.grid, E = sand.materials.EMPTY;
    for (let i = 0; i < g.length - W; i++) if (g[i] !== E && g[i + W] === E) floating++;

    const record = {
        v: 2, id: 'library-' + id, name: recipe.name, created: 0, updated: 0,
        w: W, h: H, grid: toBase64(sim.grid), thumb, template: null, palette: null,
    };
    sim.dispose();
    return { record, png, stats: { ...stats, floating, quiet: true } };
}
