/* template.js — the picture behind the jar: how it is fitted, and how its
 * colours become sand.
 *
 * Pure functions; the DOM half (the picker sheet, the canvas) is
 * importer.js. Everything here is in cell units against the jar's grid, so
 * the tests can state an image and read back a crop without a browser.
 *
 * The fit is the standard photo-crop model: the picture is placed under a
 * fixed window (the jar) with a scale and an offset, and can never expose
 * the window's edge — the picture always covers the whole jar. Rotation is
 * in quarter turns and applied before the fit, so it just swaps the
 * picture's width and height as far as the fit is concerned.
 *
 * Colour: a jar has a fixed set of tints (the curated swatches plus up to
 * sixteen pulled from the picture — the kernel has 32 sand tints and the
 * swatches use half), and every picture pixel is mapped to the nearest one.
 * The pull is a median cut over the fitted picture: cheap, deterministic,
 * and it finds the picture's big colours rather than its average.
 */

// The largest zoom factor over cover-fit the picker offers.
export const MAX_ZOOM = 4;

// Cover-fit: the smallest scale at which a `iw`×`ih` picture covers a
// `w`×`h` window, centred. `view` = { scale, x, y } where x,y is the
// picture's top-left in window units.
export function coverFit(iw, ih, w, h) {
    const scale = Math.max(w / iw, h / ih);
    return { scale, x: (w - iw * scale) / 2, y: (h - ih * scale) / 2 };
}

// Keep a view legal: never zoomed out past cover, never so far over that
// the window shows past the picture's edge.
export function clampView(view, iw, ih, w, h) {
    const min = Math.max(w / iw, h / ih);
    const scale = Math.max(min, Math.min(min * MAX_ZOOM, view.scale));
    const pw = iw * scale, ph = ih * scale;
    const x = Math.max(w - pw, Math.min(0, view.x));
    const y = Math.max(h - ph, Math.min(0, view.y));
    return { scale, x, y };
}

// Zoom about a window point (px, py) so that point stays under the finger.
export function zoomAt(view, factor, px, py, iw, ih, w, h) {
    const scale = view.scale * factor;
    const k = scale / view.scale;
    return clampView({ scale, x: px - (px - view.x) * k, y: py - (py - view.y) * k }, iw, ih, w, h);
}

// The part of a w×h picture a view shows, in picture units — the source
// rectangle for one drawImage. The jar's own zoom (gestures.js) is a view
// of the grid over itself: the grid is both the picture and the window.
export function viewRect(view, w, h) {
    return { x: (0 - view.x) / view.scale, y: (0 - view.y) / view.scale, w: w / view.scale, h: h / view.scale };
}

// The picture's size after `turns` quarter turns.
export function turned(iw, ih, turns) {
    return (turns & 1) ? { iw: ih, ih: iw } : { iw, ih };
}

// Squared distance in RGB. Not perceptual, and it does not need to be: the
// candidates are a couple of dozen strongly different sands.
function dist2(r, g, b, c) {
    const dr = r - c[0], dg = g - c[1], db = b - c[2];
    return dr * dr + dg * dg + db * db;
}

// Index of the nearest [r, g, b] in `colours`.
export function nearest(r, g, b, colours) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < colours.length; i++) {
        const d = dist2(r, g, b, colours[i]);
        if (d < bd) { bd = d; best = i; }
    }
    return best;
}

// Median cut: up to `n` representative colours of an RGBA buffer. Pixels
// with alpha under 128 are ignored. Returns [[r, g, b], …], fewer than n
// when the picture has fewer distinct colours than that.
export function extractPalette(rgba, n) {
    // Sample: a 192×320 picture is 61k pixels; every fourth is plenty.
    const px = [];
    for (let i = 0; i < rgba.length; i += 16) {
        if (rgba[i + 3] < 128) continue;
        px.push([rgba[i], rgba[i + 1], rgba[i + 2]]);
    }
    if (px.length === 0) return [];
    let boxes = [px];
    while (boxes.length < n) {
        // Split the box with the widest channel range; stop when no box
        // has any spread left (a flat picture yields fewer colours).
        let bi = -1, bc = 0, bw = 0;
        for (let i = 0; i < boxes.length; i++) {
            const box = boxes[i];
            if (box.length < 2) continue;
            for (let c = 0; c < 3; c++) {
                let lo = 255, hi = 0;
                for (const p of box) { if (p[c] < lo) lo = p[c]; if (p[c] > hi) hi = p[c]; }
                if (hi - lo > bw) { bw = hi - lo; bi = i; bc = c; }
            }
        }
        if (bi < 0 || bw === 0) break;
        const box = boxes[bi];
        box.sort((a, b) => a[bc] - b[bc]);
        const mid = box.length >> 1;
        boxes.splice(bi, 1, box.slice(0, mid), box.slice(mid));
    }
    const out = boxes.map((box) => {
        let r = 0, g = 0, b = 0;
        for (const p of box) { r += p[0]; g += p[1]; b += p[2]; }
        const k = box.length;
        return [Math.round(r / k), Math.round(g / k), Math.round(b / k)];
    });
    // Drop exact duplicates (two boxes can average to the same colour).
    const seen = new Set();
    return out.filter((c) => { const k = c.join(','); if (seen.has(k)) return false; seen.add(k); return true; });
}

// Map every pixel to the index of its nearest colour: a Uint8Array with one
// entry per pixel, NONE where the pixel is transparent.
export const NONE = 255;
export function mapToColours(rgba, colours) {
    const n = rgba.length >> 2;
    const out = new Uint8Array(n);
    // Colours repeat a lot in a downscaled photo; a small cache of exact
    // pixel values keeps the search off most pixels.
    const cache = new Map();
    for (let i = 0; i < n; i++) {
        const o = i * 4;
        if (rgba[o + 3] < 128) { out[i] = NONE; continue; }
        const key = (rgba[o] << 16) | (rgba[o + 1] << 8) | rgba[o + 2];
        let idx = cache.get(key);
        if (idx === undefined) {
            idx = nearest(rgba[o], rgba[o + 1], rgba[o + 2], colours);
            if (cache.size < 4096) cache.set(key, idx);
        }
        out[i] = idx;
    }
    return out;
}

// Paint a mapped picture back into an RGBA buffer with the given colours —
// the "as sand" preview.
export function renderMapped(mapped, colours, rgba) {
    for (let i = 0; i < mapped.length; i++) {
        const o = i * 4, m = mapped[i];
        if (m === NONE) { rgba[o] = rgba[o + 1] = rgba[o + 2] = rgba[o + 3] = 0; continue; }
        const c = colours[m];
        rgba[o] = c[0]; rgba[o + 1] = c[1]; rgba[o + 2] = c[2]; rgba[o + 3] = 255;
    }
    return rgba;
}
