/* tools/library-recipes.mjs — how each Library jar was made.
 *
 * A sample jar is a pointer script: a list of strokes, each naming a tool
 * from tools.js, a tint, the tool's option and a path in cell units. The
 * runner below replays it the way main.js's loop would — down() at the
 * first point, move() for every cell along the path, frame() once per sim
 * step while the finger is held — and lets the sand settle between strokes.
 * The kernel is deterministic, so the same recipe makes the same jar on
 * every machine; tools/library-build.mjs runs these in a real browser
 * against the real kernel and writes the records to library/jars/.
 *
 * Pure data and pure functions: importable under node (the tests read the
 * recipes) and in the browser (the builder runs them). No DOM, no SDK.
 *
 * Tints are the curated swatches (palette.js): 0 Sand, 1 Ochre,
 * 2 Terracotta, 3 Umber, 4 Cream, 5 Charcoal, 6 Crimson, 7 Coral,
 * 8 Sunflower, 9 Lime, 10 Forest, 11 Teal, 12 Sky, 13 Indigo, 14 Violet,
 * 15 Pink.
 */

export const W = 192, H = 320;
const SAND = 0, OCHRE = 1, TERRA = 2, UMBER = 3, CREAM = 4, CHAR = 5, CRIMSON = 6,
    CORAL = 7, SUN = 8, LIME = 9, FOREST = 10, TEAL = 11, SKY = 12, INDIGO = 13,
    VIOLET = 14, PINK = 15;

// ── a stroke, and the shapes strokes are built from ────────────────────────
// stroke(tool, tint, opt, path, { hold }) — `hold` is how many sim steps the
// finger stays at each point (sources pour that many times); the default
// is one step per cell for everything, which is a brisk hand.
export function stroke(tool, tint, opt, path, extra = {}) {
    return { tool, tint, opt, path, ...extra };
}
export const line = (x0, y0, x1, y1) => [[x0, y0], [x1, y1]];
export function circle(cx, cy, r, n = 48) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI * 2;
        pts.push([Math.round(cx + r * Math.cos(a)), Math.round(cy + r * Math.sin(a))]);
    }
    return pts;
}
// A zigzag between x0 and x1 at height y, teeth `amp` tall every `period` cells.
export function zigzag(x0, x1, y, amp, period) {
    const pts = [];
    let up = false;
    for (let x = x0; x <= x1; x += period / 2) { pts.push([Math.round(x), up ? y - amp : y]); up = !up; }
    return pts;
}
// Brush the rows y0..y1 (inclusive) solid in `tint`: full-width strokes,
// each as tall as the brush allows, laid bottom-up so every cell painted
// has support under it and nothing falls.
export function fill(tint, y0, y1) {
    const out = [];
    let bottom = y1;
    while (bottom >= y0) {
        const h = Math.min(17, bottom - y0 + 1);
        const r = Math.max(1, (h - 1) >> 1);
        out.push(stroke('brush', tint, r, line(0, bottom - r, W - 1, bottom - r)));
        bottom -= 2 * r + 1;
    }
    return out;
}
// A solid triangle with its apex at (ax, ay) and its base on row `by`,
// `half` cells either side, laid row by row. With `tool` 'recolour' only
// the colour under the first touch is changed — a hill painted into the
// sky that way stays behind whatever stood in front of the sky already.
export function triangle(tint, ax, ay, by, half, r = 2, tool = 'brush') {
    const out = [];
    for (let y = by - r; y > ay; y -= 2 * r + 1) {
        const k = (y - ay) / (by - ay);
        out.push(stroke(tool, tint, r, line(Math.round(ax - half * k), y, Math.round(ax + half * k), y)));
    }
    out.push(stroke(tool, tint, r, [[ax, ay + r]]));
    return out;
}
// A disc: one brush press. Bigger than the brush allows is several presses.
export function disc(tint, cx, cy, r) {
    if (r <= 8) return [stroke('brush', tint, r, [[cx, cy]])];
    const out = [];
    for (let rr = r - 8; rr > 0; rr -= 8) out.push(stroke('brush', tint, 8, circle(cx, cy, rr, Math.max(12, rr * 2))));
    out.push(stroke('brush', tint, 8, [[cx, cy]]));
    return out;
}
// Pour from the rim, sweeping the finger across the width and back `times`
// times: the way a level layer is laid by hand.
export function pour(tint, flow, times = 1, x0 = 0, x1 = W - 1) {
    const path = [];
    for (let i = 0; i < times; i++) path.push([x0, 0], [x1, 0]);
    path.push([x0, 0]);
    return stroke('pour', tint, flow, path, { hold: 1 });
}
// Pour held at one spot: a cone.
export const cone = (tint, flow, x, steps) => stroke('pour', tint, flow, [[x, 0]], { hold: steps });
// Fill the jar with one colour and trim the top level: poured past the
// rim, then the surplus erased from the top down so nothing above is left
// to fall. The surface lands on row 61, a little air under the rim.
export function ground(tint, sweeps = 11) {
    return [
        pour(tint, 24, sweeps),
        stroke('erase', SAND, 10, line(0, 10, W - 1, 10)),
        stroke('erase', SAND, 10, line(0, 30, W - 1, 30)),
        stroke('erase', SAND, 10, line(0, 50, W - 1, 50)),
    ];
}

// ── the recipes ────────────────────────────────────────────────────────────
export const RECIPES = {
    // Andrew Clemens: flat bands of many colours, and geometry laid on them
    // one grain-row at a time. Everything is brushed — placed, not poured —
    // the way his sand was pressed into place with a stick.
    clemens: {
        name: 'Bands, after Clemens',
        steps: [
            ...fill(CREAM, 296, 319),
            ...fill(UMBER, 290, 295),
            ...fill(TERRA, 276, 289),
            ...fill(CREAM, 272, 275),
            ...fill(CHAR, 250, 271),
            // a row of cream diamonds on the charcoal band
            ...[24, 72, 120, 168].flatMap((cx) => [
                stroke('brush', CREAM, 2, [[cx, 252], [cx + 9, 261], [cx, 270], [cx - 9, 261], [cx, 252]]),
                stroke('brush', TERRA, 1, [[cx, 261]]),
            ]),
            ...fill(CREAM, 246, 249),
            ...fill(OCHRE, 232, 245),
            ...fill(UMBER, 228, 231),
            ...fill(SAND, 196, 227),
            // a saw-tooth of umber across the sand band
            stroke('brush', UMBER, 2, zigzag(0, W - 1, 222, 18, 24)),
            stroke('brush', TERRA, 1, zigzag(0, W - 1, 214, 10, 24)),
            ...fill(UMBER, 192, 195),
            ...fill(CRIMSON, 180, 191),
            ...fill(CREAM, 176, 179),
            ...fill(INDIGO, 150, 175),
            // a chain of cream rings on the indigo band
            ...[32, 96, 160].flatMap((cx) => [
                stroke('brush', CREAM, 2, circle(cx, 162, 8, 24)),
                stroke('brush', SUN, 2, [[cx, 162]]),
            ]),
            ...fill(CREAM, 146, 149),
            ...fill(TERRA, 132, 145),
            ...fill(UMBER, 128, 131),
            ...fill(SAND, 100, 127),
            stroke('brush', CHAR, 2, zigzag(0, W - 1, 122, 16, 32)),
            stroke('brush', CHAR, 2, zigzag(16, W - 1, 106, -16, 32)),
            ...fill(UMBER, 96, 99),
            ...fill(CREAM, 84, 95),
            ...fill(TERRA, 78, 83),
            ...fill(CHAR, 56, 77),
            ...[48, 144].flatMap((cx) => [
                stroke('brush', CREAM, 2, [[cx, 58], [cx + 9, 67], [cx, 76], [cx - 9, 67], [cx, 58]]),
                stroke('brush', CRIMSON, 1, [[cx, 67]]),
            ]),
            ...fill(CREAM, 50, 55),
            ...fill(OCHRE, 40, 49),
            ...fill(UMBER, 36, 39),
            ...fill(CREAM, 26, 35),
        ],
    },

    // Petra: layers poured with the bottle tilted so they slope, then the
    // scene drawn down into them — a camel on the dunes, a palm, the sun.
    petra: {
        name: 'Camel at Petra',
        steps: [
            ...fill(UMBER, 300, 319),
            ...fill(TERRA, 284, 299),
            ...fill(OCHRE, 270, 283),
            // dunes: two poured cones and a drift of sand between them
            cone(SAND, 12, 44, 330),
            cone(OCHRE, 10, 152, 220),
            pour(SAND, 16, 2, 30, 160),
            // the sky, poured over the dunes past the rim and trimmed level
            ...ground(SKY, 8),
            // far hills, recoloured into the sky so the dunes stay in front
            ...triangle(TERRA, 138, 118, 236, 58, 2, 'recolour'),
            ...triangle(TERRA, 22, 134, 250, 48, 2, 'recolour'),
            ...disc(SUN, 64, 98, 13),
            // the camel, standing on the drift between the dunes
            stroke('brush', UMBER, 6, line(74, 200, 112, 200)),
            stroke('brush', UMBER, 5, [[92, 191]]),
            stroke('brush', UMBER, 2, line(112, 197, 124, 176)),
            stroke('brush', UMBER, 3, [[126, 174]]),
            stroke('brush', UMBER, 1, line(127, 174, 135, 178)),
            stroke('brush', UMBER, 1, line(78, 206, 77, 219)),
            stroke('brush', UMBER, 1, line(86, 206, 87, 221)),
            stroke('brush', UMBER, 1, line(100, 206, 99, 225)),
            stroke('brush', UMBER, 1, line(108, 206, 110, 225)),
            // a palm on the small dune
            stroke('brush', UMBER, 1, line(160, 235, 157, 190)),
            stroke('brush', FOREST, 1, [[157, 190], [141, 184], [131, 190]]),
            stroke('brush', FOREST, 1, [[157, 190], [169, 178], [181, 180]]),
            stroke('brush', FOREST, 1, [[157, 190], [151, 174], [141, 172]]),
            stroke('brush', FOREST, 1, [[157, 190], [173, 192], [183, 200]]),
            stroke('brush', FOREST, 1, [[157, 190], [145, 198], [135, 206]]),
        ],
    },

    // A Tibetan sand mandala: rings of colour around a centre, laid a grain
    // at a time, and fine dots from the funnel where the chak-pur would be.
    mandala: {
        name: 'Rings, after a mandala',
        steps: [
            ...ground(CHAR),
            ...disc(CRIMSON, 96, 180, 88),
            ...disc(SUN, 96, 180, 72),
            ...disc(TEAL, 96, 180, 56),
            ...disc(CREAM, 96, 180, 40),
            ...disc(INDIGO, 96, 180, 24),
            ...disc(CORAL, 96, 180, 8),
            // petals: eight spokes and a dot at the end of each
            ...Array.from({ length: 8 }, (_, i) => {
                const a = i * Math.PI / 4;
                const px = (r) => Math.round(96 + r * Math.cos(a)), py = (r) => Math.round(180 + r * Math.sin(a));
                return [
                    stroke('brush', CREAM, 1, line(px(26), py(26), px(84), py(84))),
                    stroke('brush', CRIMSON, 3, [[px(64), py(64)]]),
                    stroke('brush', SUN, 3, [[px(48), py(48)]]),
                ];
            }).flat(),
            // grain-dots from the funnel around the outer ring
            ...Array.from({ length: 24 }, (_, i) => {
                const a = i * Math.PI / 12;
                return stroke('funnel', CREAM, 1, [[Math.round(96 + 80 * Math.cos(a)), Math.round(180 + 80 * Math.sin(a))]], { hold: 1 });
            }),
            stroke('brush', CREAM, 1, circle(96, 180, 92, 64)),
        ],
    },

    // Alum Bay: the cliff's own colours, poured one on another; each layer
    // leans a little, the way a poured layer does in a tilted bottle.
    'alum-bay': {
        name: 'Alum Bay stripes',
        steps: [
            pour(OCHRE, 24, 1),
            pour(CREAM, 20, 1, 0, 120),
            pour(TERRA, 24, 1),
            pour(SAND, 20, 1, 60, 191),
            pour(UMBER, 16, 1),
            pour(CORAL, 24, 1, 0, 100),
            pour(CREAM, 24, 1),
            pour(OCHRE, 20, 1, 80, 191),
            pour(PINK, 16, 1),
            pour(SUN, 20, 1, 0, 110),
            pour(UMBER, 24, 1),
            pour(CREAM, 24, 1, 40, 191),
            pour(TERRA, 20, 1),
            pour(OCHRE, 24, 1, 0, 130),
            pour(SAND, 24, 1),
            pour(CORAL, 16, 1, 60, 191),
            pour(CREAM, 24, 1),
            // trimmed from the top down, so nothing above is left to fall
            stroke('erase', SAND, 10, line(0, 10, W - 1, 10)),
            stroke('erase', SAND, 10, line(0, 26, W - 1, 26)),
            stroke('erase', SAND, 10, line(0, 40, W - 1, 40)),
        ],
    },

    // Navajo sandpainting's public, commercial form: sand trickled between
    // the fingers onto a tan ground. A stylised pattern of stepped bands and
    // lightning lines — geometry, not a ceremonial design.
    navajo: {
        name: 'Sprinkled bands',
        steps: [
            ...ground(SAND),
            // trickled bands: the sprinkle's scatter, top and bottom
            stroke('sprinkle', TERRA, 2, line(16, 292, 176, 292), { hold: 2 }),
            stroke('sprinkle', CHAR, 1, line(16, 274, 176, 274), { hold: 2 }),
            stroke('sprinkle', TEAL, 2, line(16, 90, 176, 90), { hold: 2 }),
            stroke('sprinkle', CHAR, 1, line(16, 108, 176, 108), { hold: 2 }),
            // stepped terraces, one rising from below and one hanging from above
            ...[
                [[32, 250], [32, 236], [52, 236], [52, 222], [72, 222], [72, 208], [92, 208], [100, 208], [120, 208], [120, 222], [140, 222], [140, 236], [160, 236], [160, 250]],
                [[32, 130], [32, 144], [52, 144], [52, 158], [72, 158], [72, 172], [92, 172], [100, 172], [120, 172], [120, 158], [140, 158], [140, 144], [160, 144], [160, 130]],
            ].flatMap((p) => [stroke('brush', TERRA, 2, p), stroke('brush', CHAR, 1, p.map(([x, y]) => [x, y + (y > 190 ? 5 : -5)]))]),
            // a diamond between them, and lightning to either side
            stroke('brush', CREAM, 3, [[96, 176], [110, 190], [96, 204], [82, 190], [96, 176]]),
            stroke('brush', TERRA, 1, [[96, 184], [102, 190], [96, 196], [90, 190], [96, 184]]),
            stroke('brush', CHAR, 1, [[16, 212], [40, 200], [30, 192], [56, 180], [46, 172], [70, 160]]),
            stroke('brush', CHAR, 1, [[176, 212], [152, 200], [162, 192], [136, 180], [146, 172], [122, 160]]),
            // corner marks
            ...[[24, 250], [168, 250], [24, 130], [168, 130]].map(([x, y]) => stroke('brush', CHAR, 1, [[x - 6, y], [x, y - 6], [x + 6, y], [x, y + 6], [x - 6, y]])),
        ],
    },

    // Bonseki: white sand on a black tray. A moon, mountains and a shore,
    // and the edges softened with the stir where a feather would sweep.
    bonseki: {
        name: 'Moon over the sea',
        steps: [
            ...ground(CHAR),
            ...disc(CREAM, 132, 100, 16),
            ...triangle(CREAM, 60, 136, 204, 72, 2),
            ...triangle(CREAM, 132, 154, 204, 62, 2),
            ...triangle(CHAR, 60, 146, 204, 46, 2),
            ...triangle(CHAR, 132, 164, 204, 38, 2),
            // the shore and the raked sea below it
            ...fill(CREAM, 204, 210),
            ...Array.from({ length: 9 }, (_, i) => stroke('funnel', CREAM, 1, line(10 + (i % 2) * 12, 226 + i * 10, 182 - (i % 2) * 12, 226 + i * 10), { hold: 1 })),
            // a soft edge along the shore, and a haze around the moon
            stroke('stir', CREAM, 5, line(0, 210, W - 1, 210), { hold: 1 }),
            stroke('stir', CREAM, 6, circle(132, 100, 17, 24), { hold: 1 }),
            // a pine on a rock at the shore
            ...disc(CREAM, 32, 204, 6),
            stroke('brush', CREAM, 1, line(32, 200, 32, 178)),
            stroke('brush', CREAM, 1, [[32, 180], [20, 186]]),
            stroke('brush', CREAM, 1, [[32, 180], [44, 188]]),
            stroke('brush', CREAM, 1, [[32, 188], [22, 196]]),
        ],
    },
};

// ── the runner ─────────────────────────────────────────────────────────────
// A small seeded rng in Arcade.rng's shape, so the sources' jitter is the
// same on every build.
export function seededRng(seed) {
    let s = 2166136261 >>> 0;
    for (let i = 0; i < seed.length; i++) { s ^= seed.charCodeAt(i); s = Math.imul(s, 16777619) >>> 0; }
    return {
        int(lo, hi) { s = (s * 1664525 + 1013904223) >>> 0; return lo + (s % (hi - lo + 1)); },
    };
}

// Let the sand come to rest, within reason.
export function settle(sim, cap = 8000) {
    let n = 0;
    while (n < cap && !sim.quiet()) { sim.step(); n++; }
    return n;
}

// Every cell along a path, one per step of the longer axis.
function* walk(path) {
    let [px, py] = path[0];
    yield [px, py];
    for (let i = 1; i < path.length; i++) {
        const [x, y] = path[i];
        const n = Math.max(Math.abs(x - px), Math.abs(y - py));
        for (let k = 1; k <= n; k++) yield [Math.round(px + (x - px) * k / n), Math.round(py + (y - py) * k / n)];
        px = x; py = y;
    }
}

/**
 * Replay a recipe on a sim. `tools` is tools.js's TOOL_BY_ID; `rng` is the
 * sources' jitter. Returns { strokes, steps } for the log.
 */
export function runRecipe(recipe, { sim, sand, tools, rng }) {
    let steps = 0;
    for (const s of recipe.steps) {
        const tool = tools[s.tool];
        if (!tool) throw new Error('recipe names no such tool: ' + s.tool);
        const p = {
            sim, sand, rng, tint: sand.tint(s.tint), template: null, state: {},
            opt: s.opt !== undefined ? s.opt : (tool.option ? tool.option.value : undefined),
            x: 0, y: 0, lx: 0, ly: 0,
        };
        const hold = s.hold !== undefined ? s.hold : (tool.frame ? 1 : 0);
        let first = true;
        for (const [x, y] of walk(s.path)) {
            p.lx = p.x; p.ly = p.y; p.x = x; p.y = y;
            if (first) { p.lx = x; p.ly = y; if (tool.down) tool.down(p); first = false; }
            else if (tool.move) tool.move(p);
            for (let k = 0; k < hold; k++) { if (tool.frame) tool.frame(p); sim.step(); steps++; }
            if (!hold) { sim.step(); steps++; }
        }
        if (s.settle !== false) steps += settle(sim);
    }
    steps += settle(sim);
    return { strokes: recipe.steps.length, steps };
}
