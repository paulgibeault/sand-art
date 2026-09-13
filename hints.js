/* hints.js — where sand can come to rest right now.
 *
 * A grain poured into the jar falls until something holds it up, so the
 * cells a player can fill next are exactly the empty cells sitting on a
 * settled grain, a wall, or the floor. That set is the landing mask, and it
 * is what the overlay draws so the player knows which part of the picture
 * they can lay this moment and which must wait for the sand beneath it.
 *
 * "Settled" is judged from the grid alone: a cell is settled when the cell
 * under it is neither empty nor water (water lets sand sink through, so it
 * holds nothing). The kernel keeps a moved-this-step flag per cell, but it
 * is not exported and this test is the same one the brush uses (tools.js
 * settledTintBelow), so the two agree. A grain in mid-air is not settled,
 * and the cell above it is not a landing cell.
 *
 * Pure: (grid, w, h, materials) in, a Uint8Array out — 1 where a grain
 * would land. O(cells), and cheap enough to run every painted frame.
 */

export function landingMask(grid, w, h, materials, out) {
    const { EMPTY, WATER, WALL } = materials;
    const mask = out && out.length === w * h ? out : new Uint8Array(w * h);
    mask.fill(0);
    for (let x = 0; x < w; x++) {
        // The floor holds anything, so the bottom row's empty cells land.
        for (let y = h - 1; y >= 0; y--) {
            const i = y * w + x;
            if (grid[i] !== EMPTY) continue;
            const below = y + 1 < h ? grid[i + w] : null;
            if (below === null) { mask[i] = 1; continue; }            // on the floor
            if (below === EMPTY || below === WATER) continue;         // nothing to stand on
            if (below === WALL) { mask[i] = 1; continue; }            // walls never move
            // A grain is under it: it holds only if it is itself settled.
            const under = y + 2 < h ? grid[i + 2 * w] : null;
            if (under === null || (under !== EMPTY && under !== WATER)) mask[i] = 1;
        }
    }
    return mask;
}
