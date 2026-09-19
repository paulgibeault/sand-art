/* tilt.js — the Tilt chip's states, as a pure module.
 *
 * Petra's sloped layers: the jar tilted while pouring. The chip cycles
 * upright, leaning left, leaning right — and, where the arcade offers motion
 * (Arcade.motion, SDK 3.17+), a fourth state, Phone, in which the jar's
 * gravity follows the way the phone is actually held, in any of the kernel's
 * eight ring directions (sim.tilt, R17).
 *
 * Gravity is a property of the jar and is saved with it; Phone is a way of
 * choosing it, like a finger, and is not. What is saved is what motion
 * DECIDED — never the samples.
 */

// The 8-ring, as the kernel has it: x right, y down.
const ARROW = {
    '1,0': '→', '1,1': '↘', '0,1': '', '-1,1': '↙',
    '-1,0': '←', '-1,-1': '↖', '0,-1': '↑', '1,-1': '↗',
};
// What the chip steps through by hand.
export const TILTS = [[0, 1], [-1, 1], [1, 1]];
export const UPRIGHT = [0, 1];

const key = (g) => g[0] + ',' + g[1];

/** Any ring direction, or upright for anything else (an old or damaged save). */
export function ringOr(g) {
    return Array.isArray(g) && g.length === 2 && key(g) in ARROW ? [g[0], g[1]] : [0, 1];
}

export function tiltLabel(g, phone) {
    const arrow = ARROW[key(ringOr(g))];
    return (phone ? 'Phone' : 'Tilt') + (arrow ? ' ' + arrow : '');
}

export function isLeaning(g, phone) {
    return phone || key(ringOr(g)) !== '0,1';
}

/**
 * The chip's next state: { gravity, phone }. By hand it walks TILTS; after
 * the last of them comes Phone (when offered); after Phone, or from any
 * direction only the phone could have chosen, upright again.
 */
export function nextTilt(g, phone, canPhone) {
    if (phone) return { gravity: [0, 1], phone: false };
    const i = TILTS.findIndex((t) => key(t) === key(ringOr(g)));
    if (i === TILTS.length - 1 && canPhone) return { gravity: [0, 1], phone: true };
    return { gravity: TILTS[(i + 1) % TILTS.length].slice(), phone: false };
}
