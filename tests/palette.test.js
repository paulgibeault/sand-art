import { test } from "node:test";
import assert from "node:assert";
import { SWATCHES, applyPalette, swatchCss } from "../palette.js";
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
            assert.strictEqual(e.length, 4);
            for (const c of e.slice(1)) assert.ok(c >= 0 && c <= 255);
        }
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
