import { test } from "node:test";
import assert from "node:assert";
import { createGestures, GRACE_MS, DOUBLE_TAP_ZOOM } from "../gestures.js";
import { viewRect, MAX_ZOOM } from "../template.js";

const W = 192, H = 320;
function harness(opts = {}) {
    const log = [];
    const views = [];
    const g = createGestures({ W, H, on: { stroke: (k, x, y) => log.push(k === 'up' ? ['up'] : [k, x, y]), view: (v) => views.push(v) }, ...opts });
    return { g, log, views };
}

test("a quick tap lands as a down and an up at the cell under the finger", () => {
    const { g, log } = harness();
    assert.strictEqual(g.down(1, 10.4, 20.9, 0), GRACE_MS, "asks the host to wait the grace");
    assert.deepStrictEqual(log, [], "nothing committed inside the grace");
    g.up(1, 30);
    assert.deepStrictEqual(log, [["down", 10, 20], ["up"]]);
});

test("a finger held past the grace commits on tick, then strokes", () => {
    const { g, log } = harness();
    g.down(1, 50, 50, 0);
    g.tick(40);
    assert.deepStrictEqual(log, [], "not yet");
    g.tick(80);
    assert.deepStrictEqual(log, [["down", 50, 50]]);
    g.move(1, 52, 50);
    g.move(1, 52, 50.4);                          // same cell: no move
    g.move(1, 60, 55);
    g.up(1, 500);
    assert.deepStrictEqual(log, [["down", 50, 50], ["move", 52, 50], ["move", 60, 55], ["up"]]);
});

test("a drag inside the grace commits at once, from where it landed", () => {
    const { g, log } = harness();
    g.down(1, 50, 50, 0);
    g.move(1, 52, 51);                            // within the slop: still waiting
    assert.deepStrictEqual(log, []);
    g.move(1, 70, 50);
    assert.deepStrictEqual(log, [["down", 50, 50], ["move", 70, 50]]);
});

test("a second finger inside the grace makes a pinch and never leaves a dot", () => {
    const { g, log, views } = harness();
    g.down(1, 80, 100, 0);
    g.down(2, 120, 100, 20);
    g.tick(200);
    assert.deepStrictEqual(log, [], "no stroke at all");
    g.move(1, 60, 100);
    g.move(2, 140, 100);                           // twice as far apart: 2×
    assert.ok(views.length > 0);
    const v = g.view;
    assert.ok(Math.abs(v.scale - 2) < 1e-9, `scale ${v.scale}`);
    g.up(1, 300); g.up(2, 310);
    assert.deepStrictEqual(log, [], "lifting out of a pinch strokes nothing");
    assert.ok(Math.abs(g.view.scale - 2) < 1e-9, "the view stays where the pinch left it");
});

test("a second finger during a committed stroke ends it and takes over the view", () => {
    const { g, log } = harness();
    g.down(1, 50, 50, 0);
    g.tick(100);
    g.move(1, 55, 50);
    g.down(2, 100, 100, 200);
    assert.deepStrictEqual(log, [["down", 50, 50], ["move", 55, 50], ["up"]]);
    g.move(1, 40, 50);
    assert.strictEqual(log.length, 3, "the first finger no longer strokes");
});

test("the view never zooms out past fit, never past MAX_ZOOM, never past the grid's edge", () => {
    const { g } = harness();
    g.down(1, 80, 100, 0); g.down(2, 120, 100, 1);
    g.move(1, 90, 100); g.move(2, 110, 100);       // pinching in at 1×
    assert.strictEqual(g.view.scale, 1);
    assert.deepStrictEqual([g.view.x, g.view.y], [0, 0]);
    g.move(1, 0, 100); g.move(2, 192, 100);        // a huge pinch out
    assert.ok(g.view.scale <= MAX_ZOOM + 1e-9);
    const r = viewRect(g.view, W, H);
    assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= W + 1e-9 && r.y + r.h <= H + 1e-9, "the shown rectangle lies inside the grid");
});

test("strokes map through the view: zoomed in, a window point is a different cell", () => {
    const { g, log } = harness();
    g.setView({ scale: 2, x: -100, y: -200 });    // showing cells 50.. across, 100.. down
    g.down(1, 20, 40, 0);
    g.up(1, 10);
    assert.deepStrictEqual(log, [["down", 60, 120], ["up"]]);
    assert.deepStrictEqual(g.toCell(0, 0), { x: 50, y: 100 });
});

test("a double tap zooms to 3× about the point, and again fits", () => {
    const { g, views } = harness();
    g.down(1, 96, 160, 0); g.up(1, 50);
    assert.strictEqual(views.length, 0, "one tap does nothing to the view");
    g.down(1, 97, 161, 200); g.up(1, 250);
    assert.ok(Math.abs(g.view.scale - DOUBLE_TAP_ZOOM) < 1e-9);
    // the tapped cell is still under the finger
    assert.deepStrictEqual(g.toCell(97, 161), { x: 97, y: 161 });
    g.down(1, 30, 30, 1000); g.up(1, 1040);
    g.down(1, 30, 30, 1100); g.up(1, 1140);
    assert.deepStrictEqual(g.view, { scale: 1, x: 0, y: 0 }, "the second double tap fits again");
    // two taps too far apart in time are not a double tap
    g.down(1, 30, 30, 2000); g.up(1, 2040);
    g.down(1, 30, 30, 2500); g.up(1, 2540);
    assert.strictEqual(g.view.scale, 1);
});

test("a cancelled finger lands nothing and forgets the tap", () => {
    const { g, log } = harness();
    g.down(1, 50, 50, 0);
    g.cancel(1);
    g.tick(100);
    assert.deepStrictEqual(log, []);
    assert.strictEqual(g.active(), false);
});
