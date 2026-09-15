/* gestures.js — fingers on the jar: one is the tool, two are the view.
 *
 * There is no mode to switch. One finger strokes with the chosen tool;
 * the moment a second finger lands the pair is a pinch that zooms the jar
 * about their midpoint and pans with it, and the tool is not involved.
 * The subtlety is that the second finger of a pinch lands a few
 * milliseconds after the first has already begun a stroke, so a stroke
 * does not commit at once: the first finger waits a short grace (80 ms),
 * and commits early only if it lifts (a tap) or moves more than a few
 * cells (a drag). A pinch begun inside the grace never leaves a dot.
 *
 * A double tap toggles between the jar fitted to the stage and 3× about
 * the tapped point — fast precise placement without a pinch. The view is
 * template.js's photo-crop model with the grid as both picture and window
 * (scale 1 is fit; MAX_ZOOM caps it; it can never show past the grid's
 * edge), so the maths is shared with the picture importer and tested once.
 *
 * Pure: positions come in as window units (cells at 1×), time as a
 * number, and the callbacks get grid cells and views. main.js turns
 * pointer events into calls here and schedules tick() for the grace.
 */

import { clampView, zoomAt } from './template.js';

export const GRACE_MS = 80;
export const DOUBLE_TAP_MS = 300;
export const TAP_SLOP = 6;                       // cells at 1×: a tap moves less than this
export const DOUBLE_TAP_ZOOM = 3;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * `on` = { stroke(kind, x, y), view(v) }: `stroke` gets 'down' and 'move'
 * with a grid cell and 'up' with none; `view` gets the new view whenever
 * the fingers change it. `W`, `H` is the grid.
 */
export function createGestures({ W, H, on, grace = GRACE_MS, doubleTap = DOUBLE_TAP_MS, slop = TAP_SLOP }) {
    let view = { scale: 1, x: 0, y: 0 };
    const fingers = new Map();                   // id → { wx, wy } in window units
    let pending = null;                          // the first finger, inside the grace
    let stroke = null;                           // { id, x, y, t0, wx, wy } a committed stroke
    let pinch = null;                            // { d, mx, my } the last pair
    let lastTap = null;                          // { t, wx, wy } for the double tap

    const toCell = (wx, wy) => ({
        x: clamp(Math.floor((wx - view.x) / view.scale), 0, W - 1),
        y: clamp(Math.floor((wy - view.y) / view.scale), 0, H - 1),
    });
    function setView(v) {
        view = clampView(v, W, H, W, H);
        on.view(view);
    }
    function commit() {
        const p = pending;
        pending = null;
        const c = toCell(p.wx, p.wy);
        stroke = { id: p.id, x: c.x, y: c.y, t0: p.t, wx: p.wx, wy: p.wy };
        on.stroke('down', c.x, c.y);
    }
    function endStroke() {
        stroke = null;
        on.stroke('up');
    }
    // A tap is a short touch that barely moved. Two in a row toggle the zoom.
    function tapped(t, wx, wy) {
        if (lastTap && t - lastTap.t <= doubleTap && Math.hypot(wx - lastTap.wx, wy - lastTap.wy) <= slop * 2) {
            lastTap = null;
            toggleZoom(wx, wy);
        } else {
            lastTap = { t, wx, wy };
        }
    }
    function toggleZoom(wx, wy) {
        if (view.scale > 1.001) setView({ scale: 1, x: 0, y: 0 });
        else setView(zoomAt(view, DOUBLE_TAP_ZOOM, wx, wy, W, H, W, H));
    }
    function pair() {
        const [a, b] = fingers.values();
        return { d: Math.hypot(a.wx - b.wx, a.wy - b.wy) || 1, mx: (a.wx + b.wx) / 2, my: (a.wy + b.wy) / 2 };
    }

    return {
        get view() { return view; },
        setView,
        toCell,
        // A finger landed. Returns the grace to wait before tick(), or 0.
        down(id, wx, wy, t) {
            if (fingers.size >= 2 || fingers.has(id)) return 0;   // a third finger is ignored
            fingers.set(id, { wx, wy });
            if (fingers.size === 1) {
                if (stroke) return 0;                // cannot happen: one finger, one stroke
                pending = { id, wx, wy, t };
                return grace;
            }
            // The second finger: this is a pinch. Whatever the first finger
            // was doing is over — a pending stroke never starts, a committed
            // one ends here.
            pending = null;
            if (stroke) endStroke();
            lastTap = null;
            pinch = pair();
            return 0;
        },
        move(id, wx, wy) {
            const f = fingers.get(id);
            if (!f) return;
            f.wx = wx; f.wy = wy;
            if (pinch) {
                if (fingers.size < 2) return;
                const now = pair();
                // Zoom about the last midpoint, then follow the midpoint.
                const v = zoomAt(view, now.d / pinch.d, pinch.mx, pinch.my, W, H, W, H);
                setView({ scale: v.scale, x: v.x + (now.mx - pinch.mx), y: v.y + (now.my - pinch.my) });
                pinch = now;
                return;
            }
            if (pending && pending.id === id) {
                // Inside the grace: a real drag commits at once (the stroke
                // starts where the finger landed, then follows it).
                if (Math.hypot(wx - pending.wx, wy - pending.wy) > slop) { commit(); this.move(id, wx, wy); }
                return;
            }
            if (stroke && stroke.id === id) {
                const c = toCell(wx, wy);
                if (c.x === stroke.x && c.y === stroke.y) return;
                stroke.x = c.x; stroke.y = c.y;
                on.stroke('move', c.x, c.y);
            }
        },
        up(id, t) {
            const f = fingers.get(id);
            if (!f) return;
            fingers.delete(id);
            if (pinch) {                             // lifting out of a pinch: no stroke, no tap
                if (fingers.size < 2) pinch = null;
                return;
            }
            if (pending && pending.id === id) {      // a quick tap: it still lands
                commit();
                endStroke();
                tapped(t, f.wx, f.wy);
                return;
            }
            if (stroke && stroke.id === id) {
                const short = t - stroke.t0 <= doubleTap && Math.hypot(f.wx - stroke.wx, f.wy - stroke.wy) <= slop;
                endStroke();
                if (short) tapped(t, f.wx, f.wy); else lastTap = null;
            }
        },
        // The finger was taken away (the browser cancelled): nothing lands.
        cancel(id) {
            if (!fingers.has(id)) return;
            fingers.delete(id);
            if (pinch) { if (fingers.size < 2) pinch = null; return; }
            if (pending && pending.id === id) pending = null;
            if (stroke && stroke.id === id) endStroke();
            lastTap = null;
        },
        // The grace ran out with the finger still down: the stroke starts.
        tick(t) {
            if (pending && t - pending.t >= grace) commit();
        },
        // Whether a finger is down at all — the loop keeps running while one is.
        active: () => fingers.size > 0,
        // Every finger forgotten without a word: the app was suspended and
        // the browser will not send the ups.
        reset() {
            fingers.clear();
            pending = null; pinch = null; lastTap = null;
            if (stroke) endStroke();
        },
    };
}
