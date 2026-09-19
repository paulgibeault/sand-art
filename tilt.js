/* tilt.js — the jar's lean, as a pure module.
 *
 * Petra's sloped layers: the jar tilted while pouring. The lean is an ANGLE —
 * degrees gravity swings from straight down, positive towards the jar's
 * right — handed to the kernel's sim.lean() (R18, SDK 3.18+), which rests a
 * pile's downhill face at 45° less the lean and lets a stream fall at it. Two
 * hands set it:
 *
 *   drag   Tilt arms the jar; the next one-finger drag is the lean. Where
 *          the finger lands is the reference point and the vector from it is
 *          gravity, live, until the finger lifts. A tap stands the jar up.
 *   phone  the jar follows the way the phone is really held (Arcade.motion,
 *          SDK 3.17+), smoothed, until Phone is tapped off.
 *
 * The lean is a property of the jar and is saved with it; which hand set it
 * is not. What is saved is what motion DECIDED — never the samples.
 *
 * Everything here is arithmetic on numbers: main.js owns the DOM, the sensor
 * and the kernel.
 */

const DEG = 180 / Math.PI;

/** Any number of degrees → −180 ≤ d < 180; anything else → 0 (upright). */
export function normDeg(d) {
    d = Number(d);
    if (!isFinite(d)) return 0;
    return ((d + 180) % 360 + 360) % 360 - 180;
}

/**
 * A vector on the screen (x right, y down) → the lean it points at, or null
 * when it is shorter than `minLen` (a tap, a twitch). Straight down is 0,
 * to the right +90.
 */
export function leanFromVector(dx, dy, minLen = 0) {
    if (!(Math.hypot(dx, dy) >= minLen) || (dx === 0 && dy === 0)) return null;
    return normDeg(Math.atan2(dx, dy) * DEG);
}

/** Within `snap` degrees of an axis (0, ±90, 180) is that axis: upright is easy to find, and an axis lets the sand truly rest. */
export function snapDeg(d, snap = 3) {
    d = normDeg(d);
    const axis = Math.round(d / 90) * 90;
    return Math.abs(d - axis) <= snap ? normDeg(axis) : d;
}

/**
 * Follow a jittery target without chasing it: the lean moves only when the
 * target is `dead` degrees away, and then lands on a whole degree. Every
 * change of lean wakes the whole jar, so a still hand must produce NO
 * changes — that is what lets the screen rest (GAME_INTEGRATION §6d).
 */
export function follow(current, target, dead = 1.5) {
    current = normDeg(current); target = normDeg(target);
    if (Math.abs(normDeg(target - current)) < dead) return current;
    return normDeg(Math.round(target));
}

/**
 * At 45° the kernel changes which wall is the floor, and the pile falls
 * across the jar. A hand hovering there must not flip it back and forth: the
 * lean is held just short of the boundary until the target is `margin` past.
 */
export function holdFloor(current, target, margin = 5) {
    current = normDeg(current); target = normDeg(target);
    const floor = (d) => Math.round(d / 90);
    if (floor(current) === floor(target) || Math.abs(normDeg(target - current)) > 90) return target;
    const dir = Math.sign(normDeg(target - current)) || 1;
    const boundary = normDeg((floor(current) * 90) + dir * 45);
    return Math.abs(normDeg(target - boundary)) < margin ? normDeg(boundary - dir * 0.5) : target;
}

/**
 * Smooth the phone's gravity vector (an exponential moving average on x, y)
 * and turn it into a lean. A phone lying flat has no "down" in the plane of
 * the screen worth following, so the last lean holds.
 */
export function createPhoneLean({ alpha = 0.25 } = {}) {
    let sx = 0, sy = 1, last = 0, primed = false;
    return {
        reset() { sx = 0; sy = 1; last = 0; primed = false; },
        update(m) {
            if (!m || typeof m.x !== 'number' || typeof m.y !== 'number' || m.flat) return last;
            if (!primed) { sx = m.x; sy = m.y; primed = true; }
            else { sx += (m.x - sx) * alpha; sy += (m.y - sy) * alpha; }
            const d = leanFromVector(sx, sy);
            if (d !== null) last = d;
            return last;
        },
    };
}

// ── older kernels and older jars ────────────────────────────────────────────
// Before sim.lean() a jar's tilt was one of the ring's eight directions, and
// jars saved then carry `gravity: [gx, gy]`.
const RING = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

/** A saved ring direction → its lean; anything else → upright. */
export function leanFromRing(g) {
    if (!Array.isArray(g) || g.length !== 2) return 0;
    const k = RING.findIndex((r) => r[0] === g[0] && r[1] === g[1]);
    return k < 0 ? 0 : normDeg(90 - k * 45);
}

/** The ring direction nearest a lean — what a kernel without lean() can do, and what an older build can read. */
export function ringFromLean(d) {
    const k = ((Math.round((90 - normDeg(d)) / 45) % 8) + 8) % 8;
    return RING[k].slice();
}

// ── the chip ────────────────────────────────────────────────────────────────
export function tiltLabel(deg, mode) {
    const d = Math.round(normDeg(deg));
    const name = mode === 'phone' ? 'Phone' : 'Tilt';
    if (mode === 'drag') return 'Drag on the jar';
    return d === 0 ? name : name + ' ' + Math.abs(d) + '°';
}
export function isLeaning(deg) { return Math.round(normDeg(deg)) !== 0; }
