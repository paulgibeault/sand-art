/* tools.js — the ways sand gets into the jar, and the ways it gets moved.
 *
 * Every tool is data plus up to three hooks, all pure functions of the
 * pointer state and the sim:
 *
 *   down(p)   the finger landed          — a tap, a poke
 *   move(p)   the finger moved a cell     — strokes, sticks
 *   frame(p)  once per sim step while held — sources (pour, sprinkle, water)
 *
 * p = { sim, sand, tint, rng, x, y, lx, ly, opt, state } in CELL units: x,y
 * where the finger is now, lx,ly where it was at the previous move, opt the
 * tool's slider value, state a scratch object that lives for one stroke. The hooks call the kernel and nothing else — no DOM, no
 * timing — so a recorded (tool, pointer) script replays exactly, which is the
 * property the kernel exists for.
 *
 * Only the sources draw from `rng` (Arcade.rng, seeded): the kernel's own
 * stream is untouched by paint(), so jitter here is the host's business. A
 * source that painted the same cell twice in one frame would merge two
 * grains into one, which is why pour spreads over a few rows, not one.
 */

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
        frame(p) { p.sim.paint(p.tint, p.x, p.y, 0); },
    },
    {
        id: 'brush', label: 'Brush',
        hint: 'Paint sand directly',
        option: { label: 'Size', min: 1, max: 8, value: 3 },
        ...stroke((p) => p.tint),
    },
    {
        id: 'wall', label: 'Wall',
        hint: 'Draw a divider or a stencil the sand piles against',
        option: { label: 'Size', min: 0, max: 5, value: 1 },
        ...stroke((p) => p.sand.materials.WALL),
    },
    {
        id: 'unwall', label: 'Unwall',
        hint: 'Erase walls only; the sand stays',
        option: { label: 'Size', min: 1, max: 6, value: 2 },
        ...stencil((p) => p.sand.materials.WALL, (p) => p.sand.materials.EMPTY),
    },
    {
        id: 'recolour', label: 'Recolour',
        hint: 'Change the colour under your finger to the chosen one',
        option: { label: 'Size', min: 1, max: 8, value: 3 },
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
        ...stroke((p) => p.sand.materials.EMPTY),
    },
    {
        id: 'stick', label: 'Stick',
        hint: 'A thin stick: drag to shove grains, tap to poke',
        ...stick(1),
    },
    {
        id: 'stick-thick', label: 'Stick+',
        hint: 'A thick stick: moves a whole pile at once',
        ...stick(4),
    },
    {
        id: 'stir', label: 'Stir',
        hint: 'Shuffle the grains under your finger',
        option: { label: 'Size', min: 2, max: 10, value: 5 },
        frame(p) { p.sim.stir(p.x, p.y, p.opt); },
    },
    {
        id: 'water', label: 'Water',
        hint: 'Pour water; sand sinks through it',
        option: { label: 'Flow', min: 1, max: 24, value: 6 },
        frame(p) {
            const spread = 1 + (p.opt >> 2);
            for (let i = 0; i < p.opt; i++) {
                p.sim.paint(p.sand.materials.WATER, p.x + p.rng.int(-spread, spread), p.y + p.rng.int(-1, 1), 0);
            }
        },
    },
];

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
