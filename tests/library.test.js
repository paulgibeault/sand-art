/* The Library (issue #4): every entry has its parts, every sample jar opens,
 * and every recipe replays through the real tools.
 */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../tools/stage.mjs";
import { TOOL_BY_ID } from "../tools.js";
import { openGallery, fromBase64 } from "../persist.js";
import { RECIPES, runRecipe, seededRng, W, H } from "../tools/library-recipes.mjs";
import { fakeSim, sand } from "./fake-sim.js";

const library = JSON.parse(fs.readFileSync(path.join(ROOT, "library.json"), "utf8"));
const entries = library.entries;
const words = (paras) => paras.join(" ").split(/\s+/).filter(Boolean).length;

test("library.json: every entry has a write-up, sources, the tools it inspired, and its sample", () => {
    assert.ok(typeof library.about === "string" && library.about, "the sheet's one-line introduction");
    assert.ok(Array.isArray(entries) && entries.length >= 6, "the initial set of influences");
    const ids = new Set();
    for (const e of entries) {
        assert.match(e.id, /^[a-z][a-z-]*$/, `${e.id}: ids are kebab-case`);
        assert.ok(!ids.has(e.id), `${e.id}: duplicate id`);
        ids.add(e.id);
        for (const k of ["title", "place", "period", "lead"]) assert.ok(typeof e[k] === "string" && e[k], `${e.id}: needs ${k}`);
        assert.ok(Array.isArray(e.body) && e.body.every((p) => typeof p === "string" && p), `${e.id}: body is paragraphs`);
        const n = words(e.body);
        assert.ok(n >= 120 && n <= 200, `${e.id}: write-up is ${n} words, wanted 120–200`);
        assert.ok(e.body.some((p) => p.includes("Sand Art")), `${e.id}: says what Sand Art took from it`);
        assert.ok(Array.isArray(e.tools) && e.tools.length > 0, `${e.id}: names the tools it inspired`);
        for (const t of e.tools) assert.ok(TOOL_BY_ID[t], `${e.id}: no such tool "${t}"`);
        assert.ok(Array.isArray(e.sources) && e.sources.length >= 2 && e.sources.length <= 3, `${e.id}: two or three sources`);
        for (const s of e.sources) {
            assert.ok(typeof s.title === "string" && s.title, `${e.id}: a source needs a title`);
            assert.match(s.url, /^https:\/\/[^\s]+$/, `${e.id}: ${s.url} is not an https link`);
        }
        if (e.image) {
            assert.ok(typeof e.image.src === "string" && typeof e.image.alt === "string" && e.image.alt, `${e.id}: a picture needs alt text`);
            assert.match(e.image.src, /^library\/[\w-]+\.(png|jpe?g)$/, `${e.id}: pictures live in library/`);
            assert.ok(fs.existsSync(path.join(ROOT, e.image.src)), `${e.id}: ${e.image.src} is missing`);
        }
        if (e.jar) {
            assert.match(e.jar, /^library\/jars\/[\w-]+\.json$/, `${e.id}: jars live in library/jars/`);
            assert.ok(fs.existsSync(path.join(ROOT, e.jar)), `${e.id}: ${e.jar} is missing`);
        }
    }
    assert.strictEqual(entries.filter((e) => e.jar).length, Object.keys(RECIPES).length, "every recipe is an entry's jar");
});

// The kernel's real material ids (arcade-sim-sand.js): the jars were made on
// the real kernel, so they are checked against it rather than the fake.
const KERNEL = { EMPTY: 0, SAND: 1, WATER: 2, WALL: 3, SAND_BASE: 16, SAND_COUNT: 32 };
const isMaterial = (m) => (m >= 0 && m <= KERNEL.WALL) || (m >= KERNEL.SAND_BASE && m < KERNEL.SAND_BASE + KERNEL.SAND_COUNT);

let stores;
beforeEach(() => {
    stores = new Map();
    globalThis.Arcade = { store: { open(name) {
        if (!stores.has(name)) stores.set(name, new Map());
        const m = stores.get(name);
        return {
            async get(k) { return m.has(k) ? JSON.parse(JSON.stringify(m.get(k))) : null; },
            async set(k, v) { m.set(k, JSON.parse(JSON.stringify(v))); },
            async del(k) { m.delete(k); },
            async each(fn) { for (const [k, v] of m) fn(JSON.parse(JSON.stringify(v)), k); },
        };
    } } };
});
afterEach(() => { delete globalThis.Arcade; });

test("every sample jar is a settled v2 record that opens through the gallery's restore", () => {
    const g = openGallery();
    for (const e of entries.filter((x) => x.jar)) {
        const rec = JSON.parse(fs.readFileSync(path.join(ROOT, e.jar), "utf8"));
        assert.strictEqual(rec.v, 2, `${e.id}: persist.js v2`);
        assert.strictEqual(rec.w, W); assert.strictEqual(rec.h, H);
        assert.strictEqual(rec.name, RECIPES[e.id].name, `${e.id}: the jar is named as its recipe names it`);
        assert.match(rec.thumb, /^data:image\/jpeg;base64,/, `${e.id}: carries a thumbnail for the gallery list`);
        assert.strictEqual(rec.template, null); assert.strictEqual(rec.palette, null);
        assert.strictEqual(rec.gravity, null, `${e.id}: a sample ships upright`);
        const sim = fakeSim();
        assert.strictEqual(g.restore(sim, rec), true, `${e.id}: restore refused it`);
        assert.deepStrictEqual(sim.calls, [["load", W * H]], `${e.id}: restore is one load`);
        const grid = fromBase64(rec.grid);
        let filled = 0;
        for (let i = 0; i < grid.length; i++) {
            assert.ok(isMaterial(grid[i]), `${e.id}: byte ${grid[i]} at ${i} is not a kernel material`);
            if (grid[i] !== KERNEL.EMPTY) filled++;
            // Settled: nothing rests on air or water. A record saved mid-fall
            // would replay its fall the moment it opened.
            if (grid[i] !== KERNEL.EMPTY && i + W < grid.length) {
                const below = grid[i + W];
                assert.ok(below !== KERNEL.EMPTY && below !== KERNEL.WATER, `${e.id}: a grain in mid-air at ${i}`);
            }
        }
        assert.ok(filled > W * H / 2, `${e.id}: the jar is mostly full (${filled} cells)`);
    }
});

test("a shipped record comes into the gallery as the player's own jar", async () => {
    const g = openGallery();
    const rec = JSON.parse(fs.readFileSync(path.join(ROOT, entries.find((x) => x.jar).jar), "utf8"));
    const copy = await g.add(rec, rec.name);
    assert.ok(copy && copy.id !== rec.id, "a new id of its own");
    assert.strictEqual(copy.name, rec.name);
    assert.strictEqual(copy.grid, rec.grid, "the same sand");
    assert.ok(copy.created > 0 && copy.updated === copy.created);
    assert.deepStrictEqual((await g.list()).map((r) => r.id), [copy.id], "listed, as the newest");
    assert.strictEqual(await g.get(rec.id), null, "the shipped record itself was never stored");
    assert.strictEqual(await g.add({ hello: "world" }), null, "junk is refused");
    assert.strictEqual(await g.add(null), null);
});

test("every recipe replays through the real tools and asks the kernel only for known materials", () => {
    for (const [id, recipe] of Object.entries(RECIPES)) {
        assert.ok(recipe.name && recipe.steps.length > 0, `${id}: a name and some strokes`);
        const sim = fakeSim();
        const out = runRecipe(recipe, { sim, sand, tools: TOOL_BY_ID, rng: seededRng(id) });
        assert.strictEqual(out.strokes, recipe.steps.filter((s) => !s.tilt).length);
        const asked = sim.calls.filter(([n]) => n === "paint" || n === "replace");
        assert.ok(asked.length > 0, `${id}: never painted`);
        for (const c of asked) {
            const mats = c[0] === "paint" ? [c[1]] : [c[1], c[2]];
            for (const m of mats) assert.ok(isMaterial(m), `${id}: ${c[0]} with material ${m}`);
        }
        for (const s of recipe.steps) {
            if (s.tilt) { assert.ok(s.tilt.every((v) => v >= -1 && v <= 1), `${id}: a tilt off the ring`); continue; }
            assert.ok(s.tint >= 0 && s.tint < 16, `${id}: tint ${s.tint} is not a curated swatch`);
            const o = TOOL_BY_ID[s.tool].option;
            if (o && s.opt !== undefined) assert.ok(s.opt >= o.min && s.opt <= o.max, `${id}: ${s.tool} option ${s.opt} outside [${o.min}, ${o.max}]`);
        }
    }
});
