import { test } from "node:test";
import assert from "node:assert";
import { TILTS, ringOr, tiltLabel, isLeaning, nextTilt } from "../tilt.js";

test("any ring direction is kept; anything else is upright", () => {
    assert.deepStrictEqual(ringOr([-1, -1]), [-1, -1]);
    assert.deepStrictEqual(ringOr([1, 0]), [1, 0]);
    for (const bad of [[0, 0], [2, 1], [1], null, undefined, "1,1", [0.5, 1]]) {
        assert.deepStrictEqual(ringOr(bad), [0, 1]);
    }
});

test("the label says how the jar leans, and who is choosing", () => {
    assert.strictEqual(tiltLabel([0, 1], false), "Tilt");
    assert.strictEqual(tiltLabel([-1, 1], false), "Tilt ↙");
    assert.strictEqual(tiltLabel([0, 1], true), "Phone");
    assert.strictEqual(tiltLabel([1, -1], true), "Phone ↗");
    assert.strictEqual(tiltLabel([1, -1], false), "Tilt ↗", "a jar saved while the phone held it");
    assert.ok(!isLeaning([0, 1], false) && isLeaning([1, 1], false) && isLeaning([0, 1], true));
});

test("by hand the chip walks upright, left, right and round again", () => {
    let s = { gravity: [0, 1], phone: false };
    const seen = [];
    for (let i = 0; i < 4; i++) { s = nextTilt(s.gravity, s.phone, false); seen.push(s.gravity.join()); }
    assert.deepStrictEqual(seen, ["-1,1", "1,1", "0,1", "-1,1"]);
    assert.ok(TILTS.length === 3);
});

test("where motion is offered, Phone comes after the last hand tilt, then upright", () => {
    const toPhone = nextTilt([1, 1], false, true);
    assert.deepStrictEqual(toPhone, { gravity: [0, 1], phone: true });
    assert.deepStrictEqual(nextTilt([-1, 0], true, true), { gravity: [0, 1], phone: false },
        "leaving Phone stands the jar up, wherever the phone had it");
    assert.deepStrictEqual(nextTilt([0, 1], false, true).gravity, [-1, 1], "Phone is never the first stop");
});

test("a direction only the phone could choose steps to the hand cycle's start", () => {
    assert.deepStrictEqual(nextTilt([0, -1], false, false), { gravity: [0, 1], phone: false });
});
