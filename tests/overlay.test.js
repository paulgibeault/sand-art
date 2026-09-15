import { test } from "node:test";
import assert from "node:assert";
import { drawTool, DARK, LIGHT } from "../overlay.js";
import { TOOLS, TOOL_BY_ID } from "../tools.js";
import { viewRect } from "../template.js";

const W = 192, H = 320;

// A context that remembers what was asked of it.
function recorder() {
    const calls = [];
    const ctx = new Proxy({}, {
        get(_, name) {
            if (name === 'calls') return calls;
            return (...args) => { calls.push([name, ...args]); };
        },
        set(_, name, value) { calls.push(['set ' + name, value]); return true; },
    });
    return ctx;
}
const arcs = (ctx) => ctx.calls.filter(([n]) => n === 'arc');
const lines = (ctx) => ctx.calls.filter(([n]) => n === 'lineTo');

test("every tool has a shape the overlay can draw", () => {
    for (const t of TOOLS) {
        assert.strictEqual(typeof t.shape, 'function', `${t.id}: no shape`);
        const s = t.shape(t.option ? t.option.value : undefined);
        assert.ok(['rod', 'ring', 'rim'].includes(s.kind), `${t.id}: unknown shape ${s.kind}`);
        const ctx = recorder();
        drawTool(ctx, s, 96, 160, viewRect({ scale: 1, x: 0, y: 0 }, W, H), 384, 640);
        assert.ok(ctx.calls.some(([n]) => n === 'stroke'), `${t.id}: drew nothing`);
        assert.ok(ctx.calls.some(([n, v]) => n === 'set strokeStyle' && v === DARK), `${t.id}: no dark pass`);
        assert.ok(ctx.calls.some(([n, v]) => n === 'set strokeStyle' && v === LIGHT), `${t.id}: no light pass`);
    }
});

test("a disc tool is a ring the size of its disc, through the view", () => {
    const ctx = recorder();
    // 2 device px per cell at fit; brush size 3 → radius 3.5 cells = 7 px
    drawTool(ctx, TOOL_BY_ID.brush.shape(3), 10, 20, viewRect({ scale: 1, x: 0, y: 0 }, W, H), 384, 640);
    const a = arcs(ctx);
    assert.strictEqual(a.length, 2, "one arc per pass");
    assert.deepStrictEqual(a[0].slice(1, 4), [21, 41, 7]);
    // zoomed 2× and panned: the cell moves on screen and the ring doubles
    const ctx2 = recorder();
    drawTool(ctx2, TOOL_BY_ID.brush.shape(3), 60, 120, viewRect({ scale: 2, x: -100, y: -200 }, W, H), 384, 640);
    assert.deepStrictEqual(arcs(ctx2)[0].slice(1, 4), [(60.5 - 50) * 4, (120.5 - 100) * 4, 14]);
});

test("a stick is a rod from the rim to the top of its tip, and a ring for the tip", () => {
    const ctx = recorder();
    drawTool(ctx, TOOL_BY_ID['stick-thick'].shape(), 96, 160, viewRect({ scale: 1, x: 0, y: 0 }, W, H), 384, 640);
    const l = lines(ctx);
    assert.deepStrictEqual(l[0].slice(1), [193, 321 - 9], "the rod stops where the tip's disc begins (r 4.5 cells at 2 px)");
    assert.ok(ctx.calls.some(([n, x, y]) => n === 'moveTo' && x === 193 && y === 0), "it starts at the top of the canvas");
    assert.strictEqual(arcs(ctx)[0][3], 9);
});

test("a pourer is a bracket at the rim as wide as its stream, and a guide down to the finger", () => {
    const ctx = recorder();
    drawTool(ctx, TOOL_BY_ID.pour.shape(8), 96, 200, viewRect({ scale: 1, x: 0, y: 0 }, W, H), 384, 640);
    // spread 1 + (8 >> 2) = 3 → half 3.5 cells = 7 px either side of x
    assert.ok(ctx.calls.some(([n, x, y]) => n === 'lineTo' && x === 193 - 7 && y === 0), "left post to the rim");
    assert.ok(ctx.calls.some(([n, x, y]) => n === 'lineTo' && x === 193 + 7 && y === 0), "across to the right post");
    assert.ok(ctx.calls.some(([n, x, y]) => n === 'lineTo' && x === 193 && y === 401), "the guide reaches the finger");
    // panned so the rim is off-screen: no bracket, still the guide
    const ctx2 = recorder();
    drawTool(ctx2, TOOL_BY_ID.pour.shape(8), 96, 200, viewRect({ scale: 2, x: 0, y: -200 }, W, H), 384, 640);
    assert.ok(!ctx2.calls.some(([n, x, y]) => n === 'lineTo' && y < 0), "nothing drawn above the canvas");
});

test("the funnel is a crosshair and nothing is drawn for no shape", () => {
    const ctx = recorder();
    drawTool(ctx, TOOL_BY_ID.funnel.shape(), 5, 5, viewRect({ scale: 1, x: 0, y: 0 }, W, H), 384, 640);
    assert.strictEqual(arcs(ctx).length, 0);
    assert.ok(lines(ctx).length >= 8, "four arms, two passes");
    const none = recorder();
    drawTool(none, null, 5, 5, viewRect({ scale: 1, x: 0, y: 0 }, W, H), 384, 640);
    assert.deepStrictEqual(none.calls, []);
});
