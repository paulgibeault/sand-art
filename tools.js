/* tools.js — the ways sand gets into the jar, and the ways it gets moved.
 *
 * Every tool is data plus up to three hooks, all pure functions of the
 * pointer state and the sim:
 *
 *   down(p)   the finger landed          — a tap, a poke
 *   move(p)   the finger moved a cell     — strokes, sticks
 *   frame(p)  once per sim step while held — sources (pour, sprinkle, water)
 *
 * p = { sim, sand, tint, rng, x, y, lx, ly, opt, state, template } in CELL
 * units: x,y where the finger is now, lx,ly where it was at the previous
 * move, opt the tool's slider value, state a scratch object that lives for
 * one stroke, template the picture behind the jar as one material id per
 * cell (or null). The hooks call the kernel and nothing else — no DOM, no
 * timing — so a recorded (tool, pointer) script replays exactly, which is the
 * property the kernel exists for.
 *
 * Only the sources draw from `rng` (Arcade.rng, seeded): the kernel's own
 * stream is untouched by paint(), so jitter here is the host's business. A
 * source that painted the same cell twice in one frame would merge two
 * grains into one, which is why pour spreads over a few rows, not one.
 *
 * Every tool also says what it looks like — shape(opt) — so the jar can
 * draw it under the finger (overlay.js): a rod from the rim to the tip for
 * the sticks, the way a real tool looks in a bottle and the way the shove
 * direction reads; a ring the size of the disc for the disc tools; a
 * bracket at the rim, as wide as the stream, for the pourers.
 */

// The shapes overlay.js knows how to draw, in cell units.
const rod = (r, width) => ({ kind: 'rod', r, width });     // from the rim down to a tip of radius r
const ring = (r, dashed = false) => ({ kind: 'ring', r, dashed });
const rim = (spread) => ({ kind: 'rim', spread });

// Walk the cells on the segment (x0,y0)→(x1,y1) so a fast stroke leaves a
// solid line instead of dots. Fires at the end point at minimum.
function alongStroke(x0, y0, x1, y1, fn) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    if (n === 0) { fn(x1, y1); return; }
    for (let i = 1; i <= n; i++) {
        fn(Math.round(x0 + (x1 - x0) * i / n), Math.round(y0 + (y1 - y0) * i / n));
    }
}

// Drag delta clamped to a few cells: a nudge further than that skips grains
// over their neighbours and looks like teleporting, not shoving.
const MAX_SHOVE = 3;
function clampDelta(d) { return Math.max(-MAX_SHOVE, Math.min(MAX_SHOVE, d)); }

// The stick, thin or thick. Dragging shoves; a stationary press lifts the
// grains under the tip a little (nudge only moves into EMPTY, so a downward
// poke into a pile does nothing — up makes a visible puff that resettles).
function stick(r) {
    return {
        down(p) { p.sim.nudge(p.x, p.y, r, 0, -2); },
        move(p) {
            const dx = clampDelta(p.x - p.lx), dy = clampDelta(p.y - p.ly);
            if (dx || dy) p.sim.nudge(p.x, p.y, r, dx, dy);
        },
    };
}

// A stroke tool: paints `material(p)` in a disc along the finger's path.
function stroke(material) {
    const at = (p, x, y) => p.sim.paint(material(p), x, y, p.opt);
    return {
        down(p) { at(p, p.x, p.y); },
        move(p) { alongStroke(p.lx, p.ly, p.x, p.y, (x, y) => at(p, x, y)); },
    };
}

export const TOOLS = [
    {
        id: 'pour', label: 'Pour',
        hint: 'Sand falls from the top of the jar at your finger',
        option: { label: 'Flow', min: 1, max: 24, value: 8 },
        shape: (opt) => rim(1 + (opt >> 2)),
        frame(p) {
            // Grains appear in a strip along the rim whose width grows with
            // the flow, so more flow means a wider, denser stream rather
            // than the same cells overwritten harder.
            const spread = 1 + (p.opt >> 2);
            for (let i = 0; i < p.opt; i++) {
                p.sim.paint(p.tint, p.x + p.rng.int(-spread, spread), p.rng.int(0, 2), 0);
            }
        },
    },
    {
        id: 'sprinkle', label: 'Sprinkle',
        hint: 'Sand appears around your finger',
        option: { label: 'Spread', min: 1, max: 3, value: 2 },
        shape: (opt) => ring(opt * 3, true),
        frame(p) {
            const spread = p.opt * 3;
            for (let i = 0; i < p.opt * 2; i++) {
                p.sim.paint(p.tint, p.x + p.rng.int(-spread, spread), p.y + p.rng.int(-spread, spread), 0);
            }
        },
    },
    {
        id: 'funnel', label: 'Funnel',
        hint: 'One grain at a time, exactly where you point',
        shape: () => ring(0),
        frame(p) { p.sim.paint(p.tint, p.x, p.y, 0); },
    },
    {
        // Andrew Clemens's tin cup on a stick: about a quarter teaspoon of
        // sand set down at a spot. One measure per tap; it settles where
        // it lands, so a few taps make a heap and a row of taps a ridge.
        id: 'cup', label: 'Cup',
        hint: 'A tap sets down a measure of sand where you point',
        option: { label: 'Measure', min: 1, max: 4, value: 2 },
        shape: (opt) => ring(opt),
        down(p) { p.sim.paint(p.tint, p.x, p.y, p.opt); },
    },
    {
        id: 'brush', label: 'Brush',
        hint: 'Paint sand directly',
        option: { label: 'Size', min: 1, max: 8, value: 3 },
        shape: (opt) => ring(opt),
        ...stroke((p) => p.tint),
    },
    {
        id: 'match', label: 'Match',
        hint: 'Paint in the colour of the settled sand under your finger',
        option: { label: 'Size', min: 1, max: 8, value: 3 },
        shape: (opt) => ring(opt),
        down(p) { matchAt(p, p.x, p.y); },
        move(p) { alongStroke(p.lx, p.ly, p.x, p.y, (x, y) => matchAt(p, x, y)); },
    },
    {
        id: 'trace', label: 'Trace',
        hint: 'Paint the picture\u2019s colours where you touch',
        option: { label: 'Size', min: 0, max: 8, value: 3 },
        shape: (opt) => ring(opt),
        down(p) { traceAt(p, p.x, p.y); },
        move(p) { alongStroke(p.lx, p.ly, p.x, p.y, (x, y) => traceAt(p, x, y)); },
    },
    {
        id: 'wall', label: 'Wall',
        hint: 'Draw a divider or a stencil the sand piles against',
        option: { label: 'Size', min: 0, max: 5, value: 1 },
        shape: (opt) => ring(opt),
        ...stroke((p) => p.sand.materials.WALL),
    },
    {
        id: 'unwall', label: 'Unwall',
        hint: 'Erase walls only; the sand stays',
        option: { label: 'Size', min: 1, max: 6, value: 2 },
        shape: (opt) => ring(opt),
        ...stencil((p) => p.sand.materials.WALL, (p) => p.sand.materials.EMPTY),
    },
    {
        id: 'recolour', label: 'Recolour',
        hint: 'Change the colour under your finger to the chosen one',
        option: { label: 'Size', min: 1, max: 8, value: 3 },
        shape: (opt) => ring(opt),
        // The material under the finger at touch-down is the one that gets
        // replaced for the whole stroke, so dragging across a boundary keeps
        // recolouring the layer you started on, not whatever comes next.
        down(p) {
            p.state.from = p.sim.get(p.x, p.y);
            recolourAt(p, p.x, p.y);
        },
        move(p) { alongStroke(p.lx, p.ly, p.x, p.y, (x, y) => recolourAt(p, x, y)); },
    },
    {
        id: 'erase', label: 'Erase',
        hint: 'Take sand out',
        option: { label: 'Size', min: 1, max: 10, value: 4 },
        shape: (opt) => ring(opt),
        ...stroke((p) => p.sand.materials.EMPTY),
    },
    {
        id: 'stick', label: 'Stick',
        hint: 'A thin stick: drag to shove grains, tap to poke',
        shape: () => rod(1, 1),
        ...stick(1),
    },
    {
        id: 'stick-thick', label: 'Stick+',
        hint: 'A thick stick: moves a whole pile at once',
        shape: () => rod(4, 3),
        ...stick(4),
    },
    {
        // The Petra needle: a long thin tool pushed down the inside of the
        // glass. It opens a channel one grain wide along its path, and the
        // sand above falls into it, so an upper colour is drawn down
        // through the layers below — a spike, a camel's leg, a trunk. No
        // new physics: an erase of radius zero, and the kernel's own fall.
        id: 'needle', label: 'Needle',
        hint: 'Draw down through the layers: the sand above follows the needle',
        shape: () => rod(0, 0.6),
        down(p) { p.sim.paint(p.sand.materials.EMPTY, p.x, p.y, 0); },
        move(p) { alongStroke(p.lx, p.ly, p.x, p.y, (x, y) => p.sim.paint(p.sand.materials.EMPTY, x, y, 0)); },
    },
    {
        id: 'stir', label: 'Stir',
        hint: 'Shuffle the grains under your finger',
        option: { label: 'Size', min: 2, max: 10, value: 5 },
        shape: (opt) => ring(opt, true),
        frame(p) { p.sim.stir(p.x, p.y, p.opt); },
    },
    {
        id: 'water', label: 'Water',
        hint: 'Pour water; sand sinks through it',
        option: { label: 'Flow', min: 1, max: 24, value: 6 },
        shape: (opt) => rim(1 + (opt >> 2)),
        frame(p) {
            const spread = 1 + (p.opt >> 2);
            for (let i = 0; i < p.opt; i++) {
                p.sim.paint(p.sand.materials.WATER, p.x + p.rng.int(-spread, spread), p.y + p.rng.int(-1, 1), 0);
            }
        },
    },
];

// The settled grain under (x, y): walk down the column past air, water and
// anything still falling, and answer the first grain that has something
// under it (a grain, a wall or the floor). null when a wall is reached first
// or the column is empty to the floor. A cell painted in mid-air a moment ago
// is skipped like any other falling grain, which is what lets the brush keep
// matching the pile rather than its own fresh stroke.
export function settledTintBelow(sim, x, y, materials) {
    const { EMPTY, WATER, WALL, SAND, SAND_BASE, SAND_COUNT } = materials;
    const isSand = (m) => m === SAND || (m >= SAND_BASE && m < SAND_BASE + SAND_COUNT);
    for (let yy = y; yy < sim.height; yy++) {
        const m = sim.get(x, yy);
        if (m === EMPTY || m === WATER) continue;
        if (!isSand(m)) return null;                                  // a wall, or something new
        const under = yy + 1 < sim.height ? sim.get(x, yy + 1) : WALL;   // the floor holds like a wall
        if (under === EMPTY || under === WATER) continue;             // falling: look further down
        return m;
    }
    return null;
}

// Every cell within r of (x, y), on the grid.
function forDisc(sim, x, y, r, fn) {
    const rr = r * r;
    for (let dy = -r; dy <= r; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= sim.height) continue;
        for (let dx = -r; dx <= r; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= sim.width || dx * dx + dy * dy > rr) continue;
            fn(xx, yy);
        }
    }
}

// Match: a brush whose colour is whatever settled grain is under the
// finger, sampled again at every cell of the stroke. Over a bare column it
// paints nothing — there is no colour to match.
function matchAt(p, x, y) {
    const m = settledTintBelow(p.sim, x, y, p.sand.materials);
    if (m !== null) p.sim.paint(m, x, y, p.opt);
}

// Trace: paint each cell of the disc in the picture's colour for that cell
// (p.template: one material id per cell, 0 where the picture has none).
// Without a picture the tool does nothing.
function traceAt(p, x, y) {
    const t = p.template;
    if (!t) return;
    forDisc(p.sim, x, y, p.opt, (xx, yy) => {
        const m = t[yy * p.sim.width + xx];
        if (m) p.sim.paint(m, xx, yy, 0);
    });
}

// A stencil stroke: every `from` cell in the disc along the path becomes
// `to` (sim.replace, R16) — nothing else in the disc is touched.
function stencil(from, to) {
    const at = (p, x, y) => p.sim.replace(from(p), to(p), x, y, p.opt);
    return {
        down(p) { at(p, p.x, p.y); },
        move(p) { alongStroke(p.lx, p.ly, p.x, p.y, (x, y) => at(p, x, y)); },
    };
}

// Recolour only ever swaps one sand tint for another: a press on air, water
// or wall is a no-op rather than turning the jar's air into sand.
function recolourAt(p, x, y) {
    const from = p.state.from, { SAND_BASE, SAND_COUNT } = p.sand.materials;
    const isTint = from >= SAND_BASE && from < SAND_BASE + SAND_COUNT;
    if (isTint && from !== p.tint) p.sim.replace(from, p.tint, x, y, p.opt);
}

export const TOOL_BY_ID = Object.fromEntries(TOOLS.map((t) => [t.id, t]));
