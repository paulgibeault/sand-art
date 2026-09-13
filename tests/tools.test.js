import { test } from "node:test";
import assert from "node:assert";
import { TOOLS, TOOL_BY_ID } from "../tools.js";
import { fakeSim, fakeRng, sand, materials } from "./fake-sim.js";

function pointer(sim, over = {}) {
    return { sim, sand, tint: sand.tint(1), rng: fakeRng(), x: 96, y: 160, lx: 96, ly: 160,
        opt: 1, state: {}, ...over };
}

test("the tool table is sound: unique ids, labels, hints, a hook each, sane options", () => {
    const ids = new Set();
    for (const t of TOOLS) {
        assert.match(t.id, /^[a-z][a-z-]*$/, `${t.id}: ids are kebab-case`);
        assert.ok(!ids.has(t.id), `${t.id}: duplicate id`);
        ids.add(t.id);
        assert.ok(t.label && t.hint, `${t.id}: needs a label and a hint`);
        assert.ok(["down", "move", "frame"].some((h) => typeof t[h] === "function"),
            `${t.id}: a tool with no hook does nothing`);
        if (t.option) {
            const { label, min, max, value } = t.option;
            assert.ok(label, `${t.id}: option needs a label`);
            assert.ok(Number.isInteger(min) && Number.isInteger(max) && Number.isInteger(value));
            assert.ok(min <= value && value <= max, `${t.id}: default ${value} outside [${min}, ${max}]`);
        }
    }
    assert.strictEqual(Object.keys(TOOL_BY_ID).length, TOOLS.length);
    for (const t of TOOLS) assert.strictEqual(TOOL_BY_ID[t.id], t);
});

test("stroke tools paint their material in a solid line, never skipping cells", () => {
    const sim = fakeSim();
    const p = pointer(sim, { opt: 3, lx: 10, ly: 10, x: 15, y: 12 });
    TOOL_BY_ID.brush.move(p);
    const painted = sim.calls.filter(([n]) => n === "paint");
    assert.strictEqual(painted.length, 5, "one paint per cell along the longer axis");
    assert.deepStrictEqual(painted.at(-1), ["paint", sand.tint(1), 15, 12, 3], "ends exactly at the finger");
    for (const [, mat, , , r] of painted) { assert.strictEqual(mat, sand.tint(1)); assert.strictEqual(r, 3); }

    sim.calls.length = 0;
    TOOL_BY_ID.wall.down(pointer(sim, { opt: 1 }));
    assert.deepStrictEqual(sim.calls, [["paint", materials.WALL, 96, 160, 1]]);
    sim.calls.length = 0;
    TOOL_BY_ID.erase.down(pointer(sim, { opt: 4 }));
    assert.deepStrictEqual(sim.calls, [["paint", materials.EMPTY, 96, 160, 4]]);
});

test("sources only ever paint the chosen tint (or water) near the finger, radius 0", () => {
    // Each source's own spread rule at opt 8: pour and water widen by
    // 1 + (opt >> 2) = 3 cells, sprinkle by opt * 3 = 24, funnel not at all.
    const opt = 8;
    for (const [id, expect, dx, dy, top] of [
        ["pour", sand.tint(1), 3, 0, true],
        ["sprinkle", sand.tint(1), 24, 24, false],
        ["funnel", sand.tint(1), 0, 0, false],
        ["water", materials.WATER, 3, 1, false],
    ]) {
        const sim = fakeSim();
        const p = pointer(sim, { opt });
        TOOL_BY_ID[id].frame(p);
        const painted = sim.calls.filter(([n]) => n === "paint");
        assert.ok(painted.length >= 1, `${id}: painted nothing`);
        assert.strictEqual(sim.calls.length, painted.length, `${id}: called something other than paint`);
        for (const [, mat, x, y, r] of painted) {
            assert.strictEqual(mat, expect, `${id}: wrong material`);
            assert.strictEqual(r, 0, `${id}: sources place single grains`);
            assert.ok(Math.abs(x - p.x) <= dx, `${id}: x ${x} outside the finger's spread of ${dx}`);
            if (top) assert.ok(y >= 0 && y <= 2, `${id}: pour starts at the rim, got y=${y}`);
            else assert.ok(Math.abs(y - p.y) <= dy, `${id}: y ${y} outside the finger's spread of ${dy}`);
        }
    }
});

test("sticks shove by a clamped delta and poke upward on a tap", () => {
    const sim = fakeSim();
    TOOL_BY_ID.stick.down(pointer(sim));
    assert.deepStrictEqual(sim.calls, [["nudge", 96, 160, 1, 0, -2]]);
    sim.calls.length = 0;
    TOOL_BY_ID["stick-thick"].move(pointer(sim, { lx: 50, ly: 100, x: 96, y: 160 }));
    assert.deepStrictEqual(sim.calls, [["nudge", 96, 160, 4, 3, 3]], "a long drag is clamped to 3 cells");
    sim.calls.length = 0;
    TOOL_BY_ID.stick.move(pointer(sim, { lx: 96, ly: 160 }));
    assert.deepStrictEqual(sim.calls, [], "no movement, no nudge");
});

test("recolour swaps only the tint under the finger at touch-down, and never air", () => {
    const from = sand.tint(5), to = sand.tint(1);
    const sim = fakeSim({ cell: from });
    const p = pointer(sim, { tint: to, opt: 2 });
    TOOL_BY_ID.recolour.down(p);
    assert.strictEqual(p.state.from, from, "the stroke remembers what it started on");
    assert.deepStrictEqual(sim.calls, [["replace", from, to, 96, 160, 2]]);

    const air = fakeSim({ cell: materials.EMPTY });
    TOOL_BY_ID.recolour.down(pointer(air, { tint: to }));
    assert.deepStrictEqual(air.calls, [], "pressing on air must not turn air into sand");

    const same = fakeSim({ cell: to });
    TOOL_BY_ID.recolour.down(pointer(same, { tint: to }));
    assert.deepStrictEqual(same.calls, [], "recolouring to the same tint is a no-op");
});

test("unwall erases walls only and stir shuffles under the finger", () => {
    const sim = fakeSim();
    TOOL_BY_ID.unwall.down(pointer(sim, { opt: 2 }));
    assert.deepStrictEqual(sim.calls, [["replace", materials.WALL, materials.EMPTY, 96, 160, 2]]);
    sim.calls.length = 0;
    TOOL_BY_ID.stir.frame(pointer(sim, { opt: 5 }));
    assert.deepStrictEqual(sim.calls, [["stir", 96, 160, 5]]);
});

// ── Match and Trace ─────────────────────────────────────────────────────────

import { settledTintBelow } from "../tools.js";

// A sim whose get() answers from a real grid, still recording paints.
function gridSim(rows) {
    const h = rows.length, w = rows[0].length;
    const sim = fakeSim({ width: w, height: h });
    const T = (n) => sand.tint(n);
    rows.forEach((row, y) => [...row].forEach((ch, x) => {
        sim.grid[y * w + x] = ch === "." ? materials.EMPTY : ch === "~" ? materials.WATER
            : ch === "#" ? materials.WALL : T(Number(ch));
    }));
    sim.get = (x, y) => sim.grid[y * w + x];
    return sim;
}

test("settledTintBelow finds the first grain that has something under it", () => {
    const sim = gridSim([
        "....",
        ".2..",     // falling: air under it
        "....",
        ".5..",     // resting on the pile
        ".77.",
        "3333",
    ]);
    assert.strictEqual(settledTintBelow(sim, 1, 0, materials), sand.tint(5), "skips the falling 2");
    assert.strictEqual(settledTintBelow(sim, 2, 0, materials), sand.tint(7));
    assert.strictEqual(settledTintBelow(sim, 0, 0, materials), sand.tint(3), "floor holds the bottom row");
    assert.strictEqual(settledTintBelow(sim, 1, 4, materials), sand.tint(7), "starting inside the pile");
});

test("settledTintBelow answers null over a bare column, past water, or when a wall comes first", () => {
    const sim = gridSim([
        "...",
        ".#.",
        "~.4",
        "~.4",
    ]);
    assert.strictEqual(settledTintBelow(sim, 0, 0, materials), null, "water all the way down");
    assert.strictEqual(settledTintBelow(sim, 1, 0, materials), null, "a wall in the way");
    assert.strictEqual(settledTintBelow(sim, 2, 0, materials), sand.tint(4));
});

test("Match paints in the settled tint under each stroke cell, and nothing over bare air", () => {
    const sim = gridSim([
        "......",
        "......",
        "111...",
        "111222",
    ]);
    const p = pointer(sim, { opt: 2, x: 1, y: 0, lx: 1, ly: 0 });
    TOOL_BY_ID.match.down(p);
    assert.deepStrictEqual(sim.calls, [["paint", sand.tint(1), 1, 0, 2]]);
    sim.calls.length = 0;
    TOOL_BY_ID.match.move({ ...p, lx: 1, ly: 0, x: 5, y: 0 });
    const tints = sim.calls.map(([, m, x]) => [x, m]);
    assert.deepStrictEqual(tints, [[2, sand.tint(1)], [3, sand.tint(2)], [4, sand.tint(2)], [5, sand.tint(2)]]);

    sim.calls.length = 0;
    const bare = gridSim(["...", "...", "..."]);
    TOOL_BY_ID.match.down(pointer(bare, { x: 1, y: 1 }));
    assert.deepStrictEqual(bare.calls, [], "no colour to match");
});

test("Trace paints each cell of the disc in the picture's colour for that cell, and nothing without a picture", () => {
    const sim = fakeSim({ width: 5, height: 5 });
    const template = new Uint8Array(25);
    for (let i = 0; i < 25; i++) template[i] = (i % 5) < 2 ? sand.tint(8) : (i % 5) === 2 ? 0 : sand.tint(9);
    const p = pointer(sim, { opt: 1, x: 2, y: 2, lx: 2, ly: 2, template });
    TOOL_BY_ID.trace.down(p);
    // radius 1 around (2,2): (2,1) (1,2) (2,2) (3,2) (2,3); column 2 is "none"
    const painted = sim.calls.map(([, m, x, y, r]) => [x, y, m, r]).sort();
    assert.deepStrictEqual(painted, [[1, 2, sand.tint(8), 0], [3, 2, sand.tint(9), 0]]);

    sim.calls.length = 0;
    TOOL_BY_ID.trace.down(pointer(sim, { opt: 3, template: null }));
    assert.deepStrictEqual(sim.calls, []);
});
