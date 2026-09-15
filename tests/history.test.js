import { test } from "node:test";
import assert from "node:assert";
import { createHistory, LIMIT } from "../history.js";

const g = (n) => new Uint8Array([n]);

test("undo hands back what was pushed, newest first, and redo returns", () => {
    const h = createHistory();
    assert.strictEqual(h.canUndo(), false);
    assert.strictEqual(h.undo(g(9)), null, "nothing to undo leaves the jar alone");
    h.push(g(1)); h.push(g(2));
    assert.deepStrictEqual(h.undo(g(3)), g(2));
    assert.strictEqual(h.canRedo(), true);
    assert.deepStrictEqual(h.undo(g(2)), g(1));
    assert.strictEqual(h.canUndo(), false);
    assert.deepStrictEqual(h.redo(g(1)), g(2));
    assert.deepStrictEqual(h.redo(g(2)), g(3));
    assert.strictEqual(h.redo(g(3)), null);
    assert.strictEqual(h.canUndo(), true);
});

test("a new stroke after an undo forks the timeline: redo is gone", () => {
    const h = createHistory();
    h.push(g(1));
    h.undo(g(2));
    assert.strictEqual(h.canRedo(), true);
    h.push(g(5));
    assert.strictEqual(h.canRedo(), false);
    assert.deepStrictEqual(h.undo(g(6)), g(5));
});

test("the stack is bounded and drops the oldest", () => {
    const h = createHistory({ limit: 3 });
    for (let i = 1; i <= 5; i++) h.push(g(i));
    assert.deepStrictEqual(h.undo(g(6)), g(5));
    assert.deepStrictEqual(h.undo(g(5)), g(4));
    assert.deepStrictEqual(h.undo(g(4)), g(3));
    assert.strictEqual(h.undo(g(3)), null, "1 and 2 were dropped");
    assert.ok(LIMIT >= 20, "the default keeps at least twenty strokes");
});

test("clear forgets both directions", () => {
    const h = createHistory();
    h.push(g(1)); h.undo(g(2));
    h.clear();
    assert.strictEqual(h.canUndo(), false);
    assert.strictEqual(h.canRedo(), false);
});
