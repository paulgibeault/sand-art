import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { toBase64, fromBase64, openPictureStore } from "../persist.js";
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

// A stand-in for Arcade.store: one in-memory map per opened store.
let stores;
beforeEach(() => {
    stores = new Map();
    globalThis.Arcade = { store: { open(name) {
        const m = new Map(); stores.set(name, m);
        return {
            async get(k) { return m.has(k) ? JSON.parse(JSON.stringify(m.get(k))) : undefined; },
            async set(k, v) { m.set(k, JSON.parse(JSON.stringify(v))); },
            async del(k) { m.delete(k); },
        };
    } } };
});
afterEach(() => { delete globalThis.Arcade; });

test("save then restore hands the kernel back the same grid through JSON", async () => {
    const a = fakeSim();
    for (let i = 0; i < a.grid.length; i++) a.grid[i] = i % 48;
    const pics = openPictureStore();
    await pics.save(a);
    const rec = stores.get("picture").get("current");
    assert.strictEqual(typeof rec.grid, "string", "a raw Uint8Array would export as {\"0\":16,…}");

    const b = fakeSim();
    assert.strictEqual(await pics.restore(b), true);
    assert.deepStrictEqual(b.grid, a.grid);
    assert.deepStrictEqual(b.calls, [["load", a.grid.length]], "restore is one sim.load");
});

test("restore refuses a missing, mismatched or corrupt record and leaves the jar alone", async () => {
    const pics = openPictureStore();
    const sim = fakeSim();
    assert.strictEqual(await pics.restore(sim), false, "nothing saved yet");

    await pics.save(fakeSim({ width: 64, height: 64 }));
    assert.strictEqual(await pics.restore(sim), false, "a different grid size");

    stores.get("picture").set("current", { v: 99, w: 192, h: 320, grid: toBase64(new Uint8Array(192 * 320)) });
    assert.strictEqual(await pics.restore(sim), false, "a future record version");

    stores.get("picture").set("current", { v: 1, w: 192, h: 320, grid: "not base64 !!" });
    assert.strictEqual(await pics.restore(sim), false, "undecodable payload");

    stores.get("picture").set("current", { v: 1, w: 192, h: 320, grid: toBase64(new Uint8Array(10)) });
    assert.strictEqual(await pics.restore(sim), false, "kernel rejects the length");
    assert.deepStrictEqual(sim.calls, [], "no partial load ever reached the kernel");

    await pics.save(fakeSim());
    await pics.forget();
    assert.strictEqual(await pics.restore(sim), false, "forget() clears the record");
});
