import { test } from "node:test";
import assert from "node:assert";
import { normDeg, leanFromVector, snapDeg, follow, holdFloor, createPhoneLean, leanFromRing, ringFromLean, tiltLabel, isLeaning } from "../tilt.js";

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test("degrees fold into −180…180, and garbage is upright", () => {
    assert.strictEqual(normDeg(190), -170);
    assert.strictEqual(normDeg(-180), -180);
    assert.strictEqual(normDeg(540), -180);
    for (const bad of [NaN, Infinity, "x", undefined, null]) assert.strictEqual(normDeg(bad), 0);
});

test("a drag is gravity: down is upright, right is +90, and a tap is nothing", () => {
    assert.ok(near(leanFromVector(0, 40), 0));
    assert.ok(near(leanFromVector(40, 0), 90));
    assert.ok(near(leanFromVector(-40, 0), -90));
    assert.ok(near(leanFromVector(30, 30), 45));
    assert.ok(near(leanFromVector(-10, 40), -14.036243467926479));
    assert.ok(near(Math.abs(leanFromVector(0, -40)), 180), "up is upside down");
    assert.strictEqual(leanFromVector(2, 3, 6), null, "shorter than the minimum is not a direction");
    assert.strictEqual(leanFromVector(0, 0), null);
});

test("near an axis is the axis; elsewhere the angle is kept", () => {
    assert.strictEqual(snapDeg(2.4), 0);
    assert.strictEqual(snapDeg(-2.9), 0);
    assert.strictEqual(snapDeg(88), 90);
    assert.strictEqual(snapDeg(-178.5), -180);
    assert.strictEqual(snapDeg(12.5), 12.5);
    assert.strictEqual(snapDeg(44), 44, "45 is not an axis");
});

test("a still hand changes nothing; a moving one lands on whole degrees", () => {
    assert.strictEqual(follow(10, 10.9), 10);
    assert.strictEqual(follow(10, 8.8), 10);
    assert.strictEqual(follow(10, 11.6), 12);
    assert.strictEqual(follow(10, 3.2), 3);
    assert.strictEqual(follow(179, -179.8), 179, "1.2° across the seam is still 1.2°");
    assert.strictEqual(follow(179, -176), -176);
    let lean = 0, changes = 0;
    for (let i = 0; i < 300; i++) { const next = follow(lean, 20 + Math.sin(i * 1.7) * 0.9); if (next !== lean) { changes++; lean = next; } }
    assert.strictEqual(changes, 1, "±0.9° of jitter around 20° is one change, then rest");
});

test("the floor does not flip under a hand hovering at 45°", () => {
    assert.strictEqual(holdFloor(40, 43), 43, "same floor: through");
    assert.strictEqual(holdFloor(43, 47), 44.5, "2° past the boundary: held just short");
    assert.strictEqual(holdFloor(44.5, 49), 44.5);
    assert.strictEqual(holdFloor(44.5, 51), 51, "clearly past: the wall is the floor now");
    assert.strictEqual(holdFloor(51, 43), 45.5, "and it does not flip straight back");
    assert.strictEqual(holdFloor(45.5, 38), 38);
    assert.strictEqual(holdFloor(-43, -47), -44.5, "mirrored");
    assert.strictEqual(holdFloor(10, 170), 170, "a jump across the jar is a jump");
});

test("the phone's vector is smoothed, and a flat phone holds the last lean", () => {
    const p = createPhoneLean({ alpha: 0.5 });
    assert.ok(near(p.update({ x: 0, y: 1 }), 0), "the first sample primes it");
    const a = p.update({ x: 1, y: 1 });
    assert.ok(a > 20 && a < 30, "half way towards 45° after one sample at alpha 0.5");
    for (let i = 0; i < 40; i++) p.update({ x: 1, y: 1 });
    assert.ok(near(p.update({ x: 1, y: 1 }), 45, 1e-3), "and it converges");
    assert.ok(near(p.update({ x: 0, y: 0.01, flat: true }), 45, 1e-3), "flat: held");
    assert.ok(near(p.update(null), 45, 1e-3) && near(p.update({ x: "a" }), 45, 1e-3), "garbage: held");
    p.reset();
    assert.ok(near(p.update({ x: -1, y: 0 }), -90));
});

test("older jars and older kernels: the ring maps both ways", () => {
    assert.strictEqual(leanFromRing([0, 1]), 0);
    assert.strictEqual(leanFromRing([1, 1]), 45);
    assert.strictEqual(leanFromRing([-1, 1]), -45);
    assert.strictEqual(leanFromRing([1, 0]), 90);
    assert.strictEqual(Math.abs(leanFromRing([0, -1])), 180);
    for (const bad of [[0, 0], [2, 1], null, "1,1", [1]]) assert.strictEqual(leanFromRing(bad), 0);
    assert.deepStrictEqual(ringFromLean(0), [0, 1]);
    assert.deepStrictEqual(ringFromLean(20), [0, 1]);
    assert.deepStrictEqual(ringFromLean(30), [1, 1]);
    assert.deepStrictEqual(ringFromLean(-100), [-1, 0]);
    for (let k = -180; k < 180; k += 45) assert.strictEqual(normDeg(leanFromRing(ringFromLean(k))), normDeg(k));
});

test("the chip says how far the jar leans, and who is choosing", () => {
    assert.strictEqual(tiltLabel(0, null), "Tilt");
    assert.strictEqual(tiltLabel(12.4, null), "Tilt 12°");
    assert.strictEqual(tiltLabel(-30, null), "Tilt 30°");
    assert.strictEqual(tiltLabel(0, "phone"), "Phone");
    assert.strictEqual(tiltLabel(18, "phone"), "Phone 18°");
    assert.strictEqual(tiltLabel(18, "drag"), "Drag on the jar");
    assert.ok(!isLeaning(0.3) && isLeaning(-4));
});
