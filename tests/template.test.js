import { test } from "node:test";
import assert from "node:assert";
import { coverFit, clampView, zoomAt, turned, MAX_ZOOM, nearest, extractPalette, mapToColours, renderMapped, NONE } from "../template.js";

const W = 192, H = 320;

test("cover-fit covers the whole jar and centres the excess", () => {
    const wide = coverFit(1000, 500, W, H);       // a landscape photo: height rules
    assert.strictEqual(wide.scale, H / 500);
    assert.strictEqual(wide.y, 0);
    assert.ok(wide.x < 0, "the excess width hangs off both sides");
    assert.ok(Math.abs((W - 1000 * wide.scale) / 2 - wide.x) < 1e-9);

    const tall = coverFit(300, 1000, W, H);       // a very tall one: width rules
    assert.strictEqual(tall.scale, W / 300);
    assert.strictEqual(tall.x, 0);
    assert.ok(tall.y < 0);
});

test("clampView never shows past the picture's edge or below cover", () => {
    const min = Math.max(W / 1000, H / 500);
    let v = clampView({ scale: min / 2, x: 50, y: 50 }, 1000, 500, W, H);
    assert.strictEqual(v.scale, min, "cannot zoom out past cover");
    assert.strictEqual(v.x, 0, "cannot drag the left edge into view");
    assert.strictEqual(v.y, 0);
    v = clampView({ scale: min * 100, x: -1e9, y: -1e9 }, 1000, 500, W, H);
    assert.strictEqual(v.scale, min * MAX_ZOOM, "capped zoom");
    assert.strictEqual(v.x, W - 1000 * v.scale, "cannot drag the right edge into view");
    assert.strictEqual(v.y, H - 500 * v.scale);
});

test("zoomAt keeps the point under the finger where it was", () => {
    const v0 = coverFit(1000, 1000, W, H);
    const px = 60, py = 200;
    // the picture point under (px, py) before…
    const ix = (px - v0.x) / v0.scale, iy = (py - v0.y) / v0.scale;
    const v1 = zoomAt(v0, 2, px, py, 1000, 1000, W, H);
    assert.ok(Math.abs(v1.scale - v0.scale * 2) < 1e-9);
    // …is still under it after
    assert.ok(Math.abs((px - v1.x) / v1.scale - ix) < 1e-6);
    assert.ok(Math.abs((py - v1.y) / v1.scale - iy) < 1e-6);
});

test("turned swaps the sides on odd quarter turns", () => {
    assert.deepStrictEqual(turned(30, 40, 0), { iw: 30, ih: 40 });
    assert.deepStrictEqual(turned(30, 40, 1), { iw: 40, ih: 30 });
    assert.deepStrictEqual(turned(30, 40, 2), { iw: 30, ih: 40 });
    assert.deepStrictEqual(turned(30, 40, 3), { iw: 40, ih: 30 });
});

test("nearest picks by RGB distance", () => {
    const cols = [[0, 0, 0], [255, 0, 0], [0, 0, 255]];
    assert.strictEqual(nearest(200, 30, 30, cols), 1);
    assert.strictEqual(nearest(10, 10, 60, cols), 0);
    assert.strictEqual(nearest(0, 0, 200, cols), 2);
});

function picture(fill) {
    const rgba = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) {
        const [r, g, b, a = 255] = fill(i % W, Math.floor(i / W));
        rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; rgba[i * 4 + 3] = a;
    }
    return rgba;
}

test("extractPalette finds a two-colour picture's two colours, no more", () => {
    const rgba = picture((x) => x < W / 2 ? [200, 40, 40] : [30, 30, 220]);
    const pal = extractPalette(rgba, 16);
    assert.strictEqual(pal.length, 2);
    const keys = pal.map((c) => c.join(",")).sort();
    assert.deepStrictEqual(keys, ["200,40,40", "30,30,220"]);
});

test("extractPalette caps at n, ignores transparent pixels, and is empty for an empty picture", () => {
    const rgba = picture((x, y) => [(x * 7) & 255, (y * 3) & 255, ((x + y) * 5) & 255]);
    const pal = extractPalette(rgba, 16);
    assert.ok(pal.length > 8 && pal.length <= 16, `a busy picture yields many colours, got ${pal.length}`);
    for (const c of pal) for (const v of c) assert.ok(Number.isInteger(v) && v >= 0 && v <= 255);

    const clear = picture(() => [255, 0, 0, 0]);
    assert.deepStrictEqual(extractPalette(clear, 8), []);
    const half = picture((x) => x < W / 2 ? [255, 0, 0, 0] : [0, 255, 0, 255]);
    assert.deepStrictEqual(extractPalette(half, 8), [[0, 255, 0]]);
});

test("mapToColours maps every pixel to its nearest and marks transparent ones NONE", () => {
    const cols = [[255, 0, 0], [0, 0, 255]];
    const rgba = picture((x, y) => y === 0 ? [0, 0, 0, 0] : (x < W / 2 ? [250, 10, 10] : [5, 5, 240]));
    const m = mapToColours(rgba, cols);
    assert.strictEqual(m.length, W * H);
    assert.strictEqual(m[0], NONE);
    assert.strictEqual(m[W + 0], 0);
    assert.strictEqual(m[W + W - 1], 1);
    const out = renderMapped(m, cols, new Uint8ClampedArray(W * H * 4));
    assert.deepStrictEqual([...out.subarray(0, 4)], [0, 0, 0, 0]);
    assert.deepStrictEqual([...out.subarray(W * 4, W * 4 + 4)], [255, 0, 0, 255]);
});
