import { test } from "node:test";
import assert from "node:assert";
import { landingMask } from "../hints.js";
import { materials, sand } from "./fake-sim.js";

const { EMPTY, WATER, WALL } = materials;
const T = sand.tint(3);

// A tiny jar written as rows, top first.
function jar(rows) {
    const h = rows.length, w = rows[0].length;
    const grid = new Uint8Array(w * h);
    rows.forEach((row, y) => [...row].forEach((ch, x) => {
        grid[y * w + x] = ch === "." ? EMPTY : ch === "~" ? WATER : ch === "#" ? WALL : T;
    }));
    return { grid, w, h };
}
function rows(mask, w, h) {
    const out = [];
    for (let y = 0; y < h; y++) out.push([...mask.subarray(y * w, (y + 1) * w)].map((v) => v ? "x" : ".").join(""));
    return out;
}

test("empty cells on the floor land; anything above air does not", () => {
    const { grid, w, h } = jar([
        "...",
        "...",
    ]);
    assert.deepStrictEqual(rows(landingMask(grid, w, h, materials), w, h), [
        "...",
        "xxx",
    ]);
});

test("a settled pile's top surface lands; the air above the surface does not", () => {
    const { grid, w, h } = jar([
        ".....",
        "..s..",
        ".sss.",
        "sssss",
    ]);
    assert.deepStrictEqual(rows(landingMask(grid, w, h, materials), w, h), [
        "..x..",
        ".x.x.",
        "x...x",
        ".....",
    ]);
});

test("a grain in mid-air holds nothing up, and neither does water", () => {
    const { grid, w, h } = jar([
        "....",
        ".s..",
        "....",    // the grain above is falling: the cell over it is not a landing
        "..~.",
        "ss~s",
    ]);
    assert.deepStrictEqual(rows(landingMask(grid, w, h, materials), w, h), [
        "....",
        "....",
        "....",
        "xx.x",
        "....",
    ]);
});

test("walls hold sand even with air under them", () => {
    const { grid, w, h } = jar([
        "....",
        ".##.",
        "....",
        "....",
    ]);
    assert.deepStrictEqual(rows(landingMask(grid, w, h, materials), w, h), [
        ".xx.",
        "....",
        "....",
        "xxxx",
    ]);
});

test("a caller-supplied buffer of the right size is reused", () => {
    const { grid, w, h } = jar(["..", ".."]);
    const buf = new Uint8Array(4).fill(9);
    const out = landingMask(grid, w, h, materials, buf);
    assert.strictEqual(out, buf);
    assert.deepStrictEqual([...out], [0, 0, 1, 1]);
});
