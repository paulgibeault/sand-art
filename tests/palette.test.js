import { test } from "node:test";
import assert from "node:assert";
import { SWATCHES, EXTRA_BASE, EXTRA_COUNT, applyPalette, swatchCss } from "../palette.js";
import { fakeSim, sand, materials } from "./fake-sim.js";

test("the swatch table is sixteen named RGB colours", () => {
    assert.strictEqual(SWATCHES.length, 16);
    for (const s of SWATCHES) {
        assert.strictEqual(s.length, 4);
        assert.ok(typeof s[0] === "string" && s[0], "every swatch has a name");
        for (const c of s.slice(1)) assert.ok(Number.isInteger(c) && c >= 0 && c <= 255, `${s[0]}: channel ${c}`);
    }
    assert.strictEqual(new Set(SWATCHES.map((s) => s[0])).size, SWATCHES.length, "names are unique");
});

test("applyPalette sets every tint id within the kernel's [16, 48) range, in one batch", () => {
    for (const theme of ["dark", "light", "nonsense"]) {
        const sim = fakeSim();
        applyPalette(sim, sand, theme);
        assert.strictEqual(sim.calls.length, 1, `${theme}: one setPalette call, not one per entry`);
        const [name, entries] = sim.calls[0];
        assert.strictEqual(name, "setPalette");
        const ids = entries.map((e) => e[0]);
        assert.deepStrictEqual(ids.slice(0, 2), [materials.EMPTY, materials.WALL]);
        const tints = ids.slice(2);
        assert.strictEqual(tints.length, SWATCHES.length - 1, "tint 0 stays the kernel's own sand");
        for (const id of tints) {
            assert.ok(id >= materials.SAND_BASE && id < materials.SAND_BASE + materials.SAND_COUNT,
                `${theme}: tint id ${id} outside [16, 48)`);
            assert.notStrictEqual(id, materials.SAND_BASE, "tint 0 is never overwritten");
        }
        for (const e of entries) {
            assert.ok(e.length === 4 || (e.length === 5 && e[0] === materials.EMPTY), "rgb, plus alpha only for the air");
            for (const c of e.slice(1)) assert.ok(c >= 0 && c <= 255);
        }
        assert.strictEqual(entries[0][4], 255, "the air is opaque without a picture");
        // The curated colour rides through untouched.
        const ochre = entries.find((e) => e[0] === sand.tint(1));
        assert.deepStrictEqual(ochre.slice(1), SWATCHES[1].slice(1));
    }
});

test("dark and light grounds differ, and an unknown theme falls back to dark", () => {
    const at = (theme) => { const s = fakeSim(); applyPalette(s, sand, theme); return s.calls[0][1].slice(0, 2); };
    assert.notDeepStrictEqual(at("dark"), at("light"));
    assert.deepStrictEqual(at("nonsense"), at("dark"));
});

test("swatchCss renders a CSS colour for every swatch", () => {
    for (let t = 0; t < SWATCHES.length; t++) {
        const [, r, g, b] = SWATCHES[t];
        assert.strictEqual(swatchCss(t), `rgb(${r} ${g} ${b})`);
    }
});

test("applyPalette can make the air transparent and add a picture's colours on the spare tints", () => {
    const sim = fakeSim();
    applyPalette(sim, sand, "dark", { clearEmpty: true, extra: [[1, 2, 3], [4, 5, 6]] });
    const [, entries] = sim.calls[0];
    assert.strictEqual(entries[0][0], materials.EMPTY);
    assert.strictEqual(entries[0][4], 0, "alpha 0: the picture under the framebuffer shows through");
    const a = entries.find((e) => e[0] === sand.tint(EXTRA_BASE));
    const b = entries.find((e) => e[0] === sand.tint(EXTRA_BASE + 1));
    assert.deepStrictEqual(a.slice(1), [1, 2, 3]);
    assert.deepStrictEqual(b.slice(1), [4, 5, 6]);
    assert.ok(EXTRA_BASE + EXTRA_COUNT === materials.SAND_COUNT, "the extras end exactly at the kernel's last tint");

    // More colours than spare tints: the surplus is dropped, never a bad id.
    const many = Array.from({ length: 40 }, (_, i) => [i, i, i]);
    const sim2 = fakeSim();
    applyPalette(sim2, sand, "dark", { extra: many });
    for (const e of sim2.calls[0][1]) assert.ok(e[0] < materials.SAND_BASE + materials.SAND_COUNT);
});
