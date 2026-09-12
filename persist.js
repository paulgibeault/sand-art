/* persist.js — the picture survives a reload.
 *
 * The grid is 60 KB, which is too big for Arcade.state (it shares the
 * origin's ~5 MB localStorage with every game), so it goes through
 * Arcade.store (GAME_INTEGRATION §3a) — async, per-app, and carried in the
 * launcher's save bundle. The bundle stringifies store values as JSON, so a
 * raw Uint8Array would round-trip through IndexedDB fine and then come out of
 * an export as `{"0":16,"1":16,…}`; base64 is the honest encoding.
 *
 * Restoring is one sim.load(bytes): the kernel validates the length and every
 * material id before it writes a byte, marks every chunk active and repaints,
 * so a corrupt record leaves the jar untouched rather than half-restored.
 */

const KEY = 'current';
const VERSION = 1;

function toBase64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 8192) {
        s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    }
    return btoa(s);
}

function fromBase64(s) {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

export function openPictureStore() {
    const store = Arcade.store.open('picture');
    return {
        async save(sim) {
            await store.set(KEY, { v: VERSION, w: sim.width, h: sim.height, grid: toBase64(sim.grid) });
        },
        // Resolves true when a picture was loaded back in.
        async restore(sim) {
            let rec;
            try { rec = await store.get(KEY); } catch (e) { return false; }
            if (!rec || rec.v !== VERSION || rec.w !== sim.width || rec.h !== sim.height) return false;
            let grid;
            try { grid = fromBase64(rec.grid); } catch (e) { return false; }
            try { sim.load(grid); } catch (e) { return false; }   // RangeError: bad length or id
            return true;
        },
        async forget() {
            await store.del(KEY);
        },
    };
}
