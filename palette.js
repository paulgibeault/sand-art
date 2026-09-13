/* palette.js — the curated sand colours, and what "empty" and "wall" look
 * like in each theme.
 *
 * The kernel ships 32 sand tints (ids 16..47) with a hue sweep as the
 * default. A sweep is fine for a test fixture and wrong for a picture: real
 * sand-bottle art is mostly earth tones with a few brights, so the first
 * sixteen tints are replaced with a hand-picked set and the rest are left at
 * the kernel default. Tint 0 is kept as the kernel's own plain sand — it is a
 * good ochre and it is also what SAND (id 1) looks like, so a picture drawn
 * with either id matches.
 *
 * setPalette() repaints the whole framebuffer (O(cells) — R11); the batch
 * form does it once for all entries. This runs at boot and on a theme
 * change, never per frame.
 */

// [name, r, g, b] for tints 1..15; tint 0 stays the kernel default.
export const SWATCHES = [
    ['Sand', 214, 178, 92],           // tint 0 — the kernel's own, listed so it is pickable
    ['Ochre', 199, 134, 52],
    ['Terracotta', 176, 84, 52],
    ['Umber', 110, 70, 40],
    ['Cream', 240, 228, 200],
    ['Charcoal', 58, 58, 62],
    ['Crimson', 200, 40, 60],
    ['Coral', 245, 120, 90],
    ['Sunflower', 250, 200, 50],
    ['Lime', 140, 200, 60],
    ['Forest', 40, 120, 70],
    ['Teal', 40, 170, 170],
    ['Sky', 90, 170, 235],
    ['Indigo', 70, 70, 180],
    ['Violet', 150, 80, 190],
    ['Pink', 240, 140, 190],
];

// The first sixteen tints are the swatches; the kernel's other sixteen are
// left for the colours pulled from a picture (template.js), applied here
// with the rest so one call sets the whole palette.
export const EXTRA_BASE = SWATCHES.length;
export const EXTRA_COUNT = 32 - EXTRA_BASE;

// The jar's air and its dividers, per theme. A dark ground makes the colours
// glow; a light one reads like sand on paper. Both are applied through the
// kernel's palette so the framebuffer IS the picture — no compositing.
const GROUND = {
    dark: { empty: [18, 18, 26], wall: [96, 96, 104] },
    light: { empty: [238, 234, 226], wall: [120, 116, 108] },
};

// `extra` is the picture's colours ([[r, g, b], …], up to EXTRA_COUNT) for
// tints EXTRA_BASE..; `clearEmpty` makes the air transparent so a picture
// drawn under the framebuffer shows through (main.js blit()).
export function applyPalette(sim, sand, theme, { extra = null, clearEmpty = false } = {}) {
    const g = GROUND[theme] || GROUND.dark;
    const entries = [
        [sand.materials.EMPTY, ...g.empty, clearEmpty ? 0 : 255],
        [sand.materials.WALL, ...g.wall],
    ];
    // Tint 0 is deliberately skipped (see the header); 1.. are ours.
    for (let t = 1; t < SWATCHES.length; t++) {
        const [, r, g2, b] = SWATCHES[t];
        entries.push([sand.tint(t), r, g2, b]);
    }
    if (extra) {
        for (let i = 0; i < Math.min(extra.length, EXTRA_COUNT); i++) {
            entries.push([sand.tint(EXTRA_BASE + i), extra[i][0], extra[i][1], extra[i][2]]);
        }
    }
    sim.setPalette(entries);                     // the batch form: one repaint
}

export function groundCss(theme) {
    const g = (GROUND[theme] || GROUND.dark).empty;
    return `rgb(${g[0]} ${g[1]} ${g[2]})`;
}

export function swatchCss(t) {
    const [, r, g, b] = SWATCHES[t];
    return `rgb(${r} ${g} ${b})`;
}
