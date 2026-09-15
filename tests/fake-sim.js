/* A recording stand-in for the sand kernel. Tools and the palette only ever
 * call the sim and read `sand.materials`; every call lands in `calls` so a
 * test can state a pointer situation and read back exactly what the kernel
 * would have been asked to do. Nothing here simulates anything.
 */

// The kernel's material layout (arcade-sim-sand.js): EMPTY 0, SAND 1, WALL 2,
// WATER 3, then 32 tints at 16..47.
export const materials = { EMPTY: 0, SAND: 1, WALL: 2, WATER: 3, SAND_BASE: 16, SAND_COUNT: 32 };

export const sand = {
    materials,
    tint: (t) => materials.SAND_BASE + t,
};

export function fakeSim({ width = 192, height = 320, cell = materials.EMPTY } = {}) {
    const calls = [];
    const rec = (name) => (...args) => { calls.push([name, ...args]); };
    return {
        calls,
        width, height,
        grid: new Uint8Array(width * height),
        paint: rec("paint"),
        replace: rec("replace"),
        nudge: rec("nudge"),
        stir: rec("stir"),
        setPalette: rec("setPalette"),
        clear: rec("clear"),
        load(bytes) {
            if (bytes.length !== width * height) throw new RangeError("bad length");
            this.grid.set(bytes);
            calls.push(["load", bytes.length]);
        },
        get: () => cell,
        // A recipe replay (tools/library-recipes.mjs) steps and waits for
        // quiet; here nothing moves, so it is quiet at once.
        step() { calls.push(["step"]); },
        quiet: () => true,
        activeCells: () => 0,
    };
}

/** A deterministic rng in Arcade.rng's shape: int(lo, hi) inclusive. */
export function fakeRng(seed = 1) {
    let s = seed >>> 0;
    return {
        int(lo, hi) {
            s = (s * 1664525 + 1013904223) >>> 0;
            return lo + (s % (hi - lo + 1));
        },
    };
}
