import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { toBase64, fromBase64, openGallery, newId, isTilt } from "../persist.js";
import { fakeSim } from "./fake-sim.js";

test("the grid codec round-trips every byte value, across the 8 KB chunk seam", () => {
    const bytes = new Uint8Array(192 * 320);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7 + (i >> 8)) & 0xff;
    const s = toBase64(bytes);
    assert.match(s, /^[A-Za-z0-9+/]+=*$/, "plain base64, JSON-safe");
    assert.deepStrictEqual(fromBase64(s), bytes);
    assert.deepStrictEqual(fromBase64(toBase64(new Uint8Array(0))), new Uint8Array(0));
    const odd = new Uint8Array([0, 255, 16, 47, 1]);
    assert.deepStrictEqual(fromBase64(toBase64(odd)), odd);
});

test("ids are distinct and sort by time", () => {
    const a = newId(1000), b = newId(1000), c = newId(2000);
    assert.notStrictEqual(a, b);
    assert.ok(c > a, "a later id sorts after an earlier one");
});

// A stand-in for Arcade.store: one in-memory map per opened store, with
// the JSON round-trip the bridge and the save bundle impose.
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
            async keys() { return [...m.keys()]; },
            async each(fn) { for (const [k, v] of m) fn(JSON.parse(JSON.stringify(v)), k); },
        };
    } } };
});
afterEach(() => { delete globalThis.Arcade; });

function filled(seed = 0) {
    const s = fakeSim();
    for (let i = 0; i < s.grid.length; i++) s.grid[i] = (i + seed) % 48;
    return s;
}

test("save then restore hands the kernel back the same grid through JSON", async () => {
    const a = filled();
    const g = openGallery();
    const rec = await g.save(a, { id: "j1", name: "First", template: { png: "data:image/png;base64,AAAA", opacity: 0.5 }, palette: [[1, 2, 3]] });
    const stored = stores.get("gallery").get("j1");
    assert.strictEqual(typeof stored.grid, "string", "a raw Uint8Array would export as {\"0\":16,…}");
    assert.strictEqual(stored.v, 2);
    assert.ok(rec.created > 0 && rec.updated >= rec.created);
    assert.deepStrictEqual(stored.template, { png: "data:image/png;base64,AAAA", opacity: 0.5 });
    assert.deepStrictEqual(stored.palette, [[1, 2, 3]]);

    const b = fakeSim();
    const back = await g.get("j1");
    assert.strictEqual(g.restore(b, back), true);
    assert.deepStrictEqual(b.grid, a.grid);
    assert.deepStrictEqual(b.calls, [["load", a.grid.length]], "restore is one sim.load");
});

test("a second save keeps `created` and moves `updated`", async () => {
    const g = openGallery();
    const first = await g.save(filled(), { id: "j1", name: "x" });
    const again = await g.save(filled(1), { id: "j1", name: "x", created: first.created });
    assert.strictEqual(again.created, first.created);
    assert.ok(again.updated >= first.updated);
});

test("restore refuses a missing, mismatched or corrupt record and leaves the jar alone", async () => {
    const g = openGallery();
    const sim = fakeSim();
    assert.strictEqual(await g.get("nope"), null, "nothing saved yet");
    assert.strictEqual(g.restore(sim, null), false);

    await g.save(fakeSim({ width: 64, height: 64 }), { id: "small" });
    assert.strictEqual(g.restore(sim, await g.get("small")), false, "a different grid size");

    stores.get("gallery").set("future", { v: 99, id: "future", w: 192, h: 320, grid: toBase64(new Uint8Array(192 * 320)) });
    assert.strictEqual(await g.get("future"), null, "a future record version is not ours");

    stores.get("gallery").set("bad", { v: 2, id: "bad", w: 192, h: 320, grid: "not base64 !!" });
    assert.strictEqual(g.restore(sim, await g.get("bad")), false, "undecodable payload");

    stores.get("gallery").set("short", { v: 2, id: "short", w: 192, h: 320, grid: toBase64(new Uint8Array(10)) });
    assert.strictEqual(g.restore(sim, await g.get("short")), false, "kernel rejects the length");
    assert.deepStrictEqual(sim.calls, [], "no partial load ever reached the kernel");
});

test("the list is newest first, carries only the light fields, and skips junk", async () => {
    const g = openGallery();
    await g.save(filled(), { id: "old", name: "Old" });
    await new Promise((r) => setTimeout(r, 2));
    await g.save(filled(), { id: "new", name: "New", thumb: "data:image/jpeg;base64,BBBB", template: { png: "x", opacity: 1 } });
    stores.get("gallery").set("junk", { hello: "world" });
    const list = await g.list();
    assert.deepStrictEqual(list.map((r) => r.id), ["new", "old"]);
    assert.strictEqual(list[0].thumb, "data:image/jpeg;base64,BBBB");
    assert.strictEqual(list[0].hasTemplate, true);
    assert.strictEqual(list[1].hasTemplate, false);
    assert.ok(!("grid" in list[0]), "the list never carries the grid");
});

test("rename, duplicate and remove", async () => {
    const g = openGallery();
    await g.save(filled(), { id: "j1", name: "One" });
    await g.rename("j1", "  Renamed  ");
    assert.strictEqual((await g.get("j1")).name, "Renamed");
    assert.strictEqual(await g.rename("missing", "x"), null);

    const copy = await g.duplicate("j1");
    assert.notStrictEqual(copy.id, "j1");
    assert.strictEqual(copy.name, "Renamed copy");
    assert.strictEqual(copy.grid, (await g.get("j1")).grid, "same sand");
    assert.strictEqual((await g.list())[0].id, copy.id, "the copy lists as newest");

    await g.remove("j1");
    assert.strictEqual(await g.get("j1"), null);
    assert.deepStrictEqual((await g.list()).map((r) => r.id), [copy.id]);
});

test("a tilt is saved beside the grid, and only a real one", async () => {
    const g = openGallery();
    await g.save(filled(), { id: "up", name: "Upright" });
    assert.strictEqual((await g.get("up")).gravity, null, "upright is the absence of a tilt");
    await g.save(filled(), { id: "t", name: "Tilted", gravity: [1, 1] });
    assert.deepStrictEqual((await g.get("t")).gravity, [1, 1]);
    await g.save(filled(), { id: "bad", name: "x", gravity: [2, 0] });
    assert.strictEqual((await g.get("bad")).gravity, null, "off the ring is not a tilt");
    const copy = await g.add(await g.get("t"), "Copy");
    assert.deepStrictEqual(copy.gravity, [1, 1], "a copy keeps the tilt");
    await g.save(filled(), { id: "lean", name: "Leaning", lean: 12.34, gravity: [0, 1] });
    assert.strictEqual((await g.get("lean")).lean, 12.3, "a lean is an angle, kept to a tenth of a degree");
    for (const bad of [0, 0.01, NaN, 200, "12", null]) {
        await g.save(filled(), { id: "l" + String(bad), name: "x", lean: bad });
        assert.strictEqual((await g.get("l" + String(bad))).lean, null, "upright or not an angle is no lean: " + bad);
    }
    assert.strictEqual(isTilt([0, 1]), false); assert.strictEqual(isTilt([0, 0]), false);
    assert.strictEqual(isTilt([-1, 1]), true); assert.strictEqual(isTilt("1,1"), false);
});

test("the pre-gallery record is adopted once as the first jar", async () => {
    const g = openGallery();
    assert.strictEqual(await g.adoptLegacy(), null, "nothing to adopt");
    const grid = toBase64(filled().grid);
    stores.get("picture").set("current", { v: 1, w: 192, h: 320, grid });
    const adopted = await g.adoptLegacy();
    assert.ok(adopted && adopted.v === 2 && adopted.grid === grid);
    assert.strictEqual(adopted.name, "Jar 1");
    assert.strictEqual(stores.get("picture").has("current"), false, "the old record is gone");
    assert.strictEqual(await g.adoptLegacy(), null, "adoption happens once");
    const sim = fakeSim();
    assert.strictEqual(g.restore(sim, await g.get(adopted.id)), true);
});
