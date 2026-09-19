/* persist.js — the gallery: every jar the player has made, and the one
 * that is open.
 *
 * Each creation is one record in Arcade.store (GAME_INTEGRATION §3a) —
 * async, per-app, carried in the launcher's save bundle. A record is the
 * grid plus everything needed to pick the jar up again: the picture behind
 * it, the colours pulled from that picture, and a thumbnail for the list.
 * The grid is 60 KB, far too big for Arcade.state (it shares the origin's
 * ~5 MB localStorage with every game), and the bundle stringifies store
 * values as JSON, so a raw Uint8Array would come out of an export as
 * `{"0":16,"1":16,…}`; base64 is the honest encoding.
 *
 * Restoring is one sim.load(bytes): the kernel validates the length and
 * every material id before it writes a byte, marks every chunk active and
 * repaints, so a corrupt record leaves the jar untouched rather than
 * half-restored.
 *
 * Record (v2):
 *   { v: 2, id, name, created, updated, w, h,
 *     grid: base64,                        the cells
 *     thumb: dataURL | null,               a small render of the sand
 *     template: { png: dataURL, opacity } | null,   the picture behind the jar
 *     palette: [[r, g, b], …] | null,      the tints pulled from that picture
 *     gravity: [gx, gy] | null,            the jar's tilt as a ring direction, null when upright
 *     lean: degrees | null }               the same tilt as an angle (SDK 3.18's sim.lean); wins when present
 *
 * `gravity` arrived with the kernel's tilt() and is optional: a record
 * without it is upright, and a reader that predates it ignores it.
 *
 * Before the gallery there was one record, 'current', in a store named
 * 'picture' (v1). The first boot after the upgrade adopts it as the first
 * creation and removes it, so nobody loses the jar they had.
 */

const STORE = 'gallery';
const VERSION = 2;
const LEGACY_STORE = 'picture';
const LEGACY_KEY = 'current';

export function toBase64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 8192) {
        s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    }
    return btoa(s);
}

export function fromBase64(s) {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

// Ids never collide across devices (a save import merges two galleries)
// and sort by when they were made: the time part is fixed-width base36.
export function newId(now = Date.now()) {
    const r = Math.floor(Math.random() * 0xffffffff).toString(36);
    return now.toString(36).padStart(9, '0') + '-' + r;
}

function isRecord(rec) {
    return !!rec && typeof rec === 'object' && rec.v === VERSION
        && typeof rec.id === 'string' && typeof rec.grid === 'string'
        && Number.isInteger(rec.w) && Number.isInteger(rec.h);
}

// A tilt worth saving: one of the eight ring directions other than upright.
export function isTilt(g) {
    return Array.isArray(g) && g.length === 2 && g.every((v) => Number.isInteger(v) && v >= -1 && v <= 1)
        && !(g[0] === 0 && g[1] === 0) && !(g[0] === 0 && g[1] === 1);
}

// A lean worth saving: a finite angle in −180…180 other than upright.
export function isLean(d) {
    return typeof d === 'number' && isFinite(d) && d >= -180 && d <= 180 && Math.abs(d) >= 0.05;
}

// What the list shows: everything but the bulky fields.
function summary(rec) {
    return {
        id: rec.id,
        name: typeof rec.name === 'string' ? rec.name : '',
        created: rec.created || 0,
        updated: rec.updated || 0,
        thumb: typeof rec.thumb === 'string' ? rec.thumb : null,
        hasTemplate: !!rec.template,
    };
}

export function openGallery() {
    const store = Arcade.store.open(STORE);

    return {
        // Newest first.
        async list() {
            const out = [];
            await store.each((value) => { if (isRecord(value)) out.push(summary(value)); });
            out.sort((a, b) => b.updated - a.updated);
            return out;
        },

        // The full record, or null when it is missing or not one of ours.
        async get(id) {
            let rec;
            try { rec = await store.get(id); } catch (e) { return null; }
            return isRecord(rec) ? rec : null;
        },

        // Write a creation: `fields` is everything but the grid, which is
        // read from the sim so the settled picture is what lands.
        async save(sim, fields) {
            const now = Date.now();
            const rec = {
                v: VERSION,
                id: fields.id,
                name: fields.name || '',
                created: fields.created || now,
                updated: now,
                w: sim.width, h: sim.height,
                grid: toBase64(sim.grid),
                thumb: fields.thumb || null,
                template: fields.template ? { png: fields.template.png, opacity: fields.template.opacity } : null,
                palette: fields.palette || null,
                gravity: isTilt(fields.gravity) ? [fields.gravity[0], fields.gravity[1]] : null,
                lean: isLean(fields.lean) ? Math.round(fields.lean * 10) / 10 : null,
            };
            await store.set(rec.id, rec);
            return rec;
        },

        // Put a record's grid into the sim. Resolves true when it went in;
        // a bad record leaves the jar as it was.
        restore(sim, rec) {
            if (!isRecord(rec) || rec.w !== sim.width || rec.h !== sim.height) return false;
            let grid;
            try { grid = fromBase64(rec.grid); } catch (e) { return false; }
            try { sim.load(grid); } catch (e) { return false; }   // RangeError: bad length or id
            return true;
        },

        async rename(id, name) {
            const rec = await this.get(id);
            if (!rec) return null;
            rec.name = String(name || '').trim().slice(0, 60);
            await store.set(id, rec);
            return rec;
        },

        // A copy under a new id, listed as the newest.
        async duplicate(id) {
            const rec = await this.get(id);
            if (!rec) return null;
            const now = Date.now();
            const copy = { ...rec, id: newId(now), name: (rec.name || 'Jar') + ' copy', created: now, updated: now };
            await store.set(copy.id, copy);
            return copy;
        },

        async remove(id) {
            await store.del(id);
        },

        // A record from outside the gallery — a sample the app ships — comes
        // in as a new jar of the player's own, listed as the newest. The
        // shipped record is never touched, so it can be opened again fresh.
        async add(rec, name) {
            if (!isRecord(rec)) return null;
            const now = Date.now();
            const copy = { ...rec, id: newId(now), name: String(name || rec.name || 'Jar').trim().slice(0, 60), created: now, updated: now };
            await store.set(copy.id, copy);
            return copy;
        },

        // The pre-gallery single record becomes the first creation. Resolves
        // the adopted record, or null when there was nothing to adopt.
        async adoptLegacy() {
            const old = Arcade.store.open(LEGACY_STORE);
            let rec;
            try { rec = await old.get(LEGACY_KEY); } catch (e) { return null; }
            if (!rec || rec.v !== 1 || typeof rec.grid !== 'string') return null;
            const now = Date.now();
            const adopted = {
                v: VERSION, id: newId(now), name: 'Jar 1', created: now, updated: now,
                w: rec.w, h: rec.h, grid: rec.grid, thumb: null, template: null, palette: null,
            };
            await store.set(adopted.id, adopted);
            try { await old.del(LEGACY_KEY); } catch (e) { /* adopted anyway; a stale copy is harmless */ }
            return adopted;
        },
    };
}
