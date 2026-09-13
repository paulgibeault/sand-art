/* importer.js — pick a picture from the device and fit it to the jar.
 *
 * Sandboxed game frames have no file picker of their own, so the file
 * comes through Arcade.ui.openFile (GAME_INTEGRATION §7): the launcher
 * shows its consent dialog, then the OS picker, and the File is cloned
 * across. Standalone, the SDK opens a plain picker itself.
 *
 * Then the fit sheet: the picture under a jar-shaped window, cover-fitted
 * and centred, so the common case is one tap on "Use picture". Drag to
 * move, pinch or the slider to zoom, a button to turn it. "As sand" shows
 * the picture the way the jar can actually make it — every pixel snapped
 * to the nearest tint — so there are no surprises about what a photo of a
 * sunset turns into with two dozen sands.
 *
 * The result is the picture at exactly the grid's size (one pixel per
 * cell): its RGBA, a PNG data URL for the record, the colours pulled from
 * it, and one material id per cell for the Trace tool. The maths is in
 * template.js; this file is the canvas and the fingers.
 */

import { coverFit, clampView, zoomAt, turned, MAX_ZOOM, extractPalette, mapToColours, renderMapped, NONE } from './template.js';
import { openSheet, el } from './sheet.js';

const WORKING_MAX = 1280;      // long side of the decoded picture we keep around
const EXTRACTED = 16;          // tints pulled from the picture (the kernel's spare half)

// Decode a File to something drawImage accepts. createImageBitmap honours
// EXIF orientation and is the fast path; an <img> over an object URL is the
// fallback for browsers that cannot decode the file that way.
async function decode(file) {
    if (typeof createImageBitmap === 'function') {
        try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); }
        catch (e) { /* fall through */ }
    }
    const url = URL.createObjectURL(file);
    try {
        const img = new Image();
        await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('decode')); img.src = url; });
        // Copy it out so the object URL can go.
        const c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        c.getContext('2d').drawImage(img, 0, 0);
        return c;
    } finally { URL.revokeObjectURL(url); }
}

// Halve until close, then one final draw: the two-step downscale that keeps
// a photo from aliasing into speckle when it shrinks twentyfold.
function downscale(src, sw, sh, dw, dh) {
    let cur = src, cw = sw, ch = sh;
    while (cw / 2 >= dw && ch / 2 >= dh) {
        const c = document.createElement('canvas');
        c.width = Math.floor(cw / 2); c.height = Math.floor(ch / 2);
        const ctx = c.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(cur, 0, 0, cw, ch, 0, 0, c.width, c.height);
        cur = c; cw = c.width; ch = c.height;
    }
    const out = document.createElement('canvas');
    out.width = dw; out.height = dh;
    const ctx = out.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(cur, 0, 0, cw, ch, 0, 0, dw, dh);
    return out;
}

// The picture turned by `turns` quarter turns, as a canvas.
function turn(src, turns) {
    const sw = src.width, sh = src.height;
    if (!(turns & 3)) return src;
    const { iw, ih } = turned(sw, sh, turns);
    const c = document.createElement('canvas');
    c.width = iw; c.height = ih;
    const ctx = c.getContext('2d');
    ctx.translate(iw / 2, ih / 2);
    ctx.rotate((turns & 3) * Math.PI / 2);
    ctx.drawImage(src, -sw / 2, -sh / 2);
    return c;
}

// Draw `pic` through `view` into a w×h canvas at `k` device pixels per cell.
function project(ctx, pic, view, k, smooth = true) {
    ctx.save();
    ctx.imageSmoothingEnabled = smooth;
    ctx.imageSmoothingQuality = 'high';
    ctx.scale(k, k);
    ctx.translate(view.x, view.y);
    ctx.scale(view.scale, view.scale);
    ctx.drawImage(pic, 0, 0);
    ctx.restore();
}

// Fit a picture to the grid: the crop, the palette pull and the tint map.
// `colours` are the curated swatches as [r, g, b]; `materialFor(i)` names
// the kernel material for candidate i (swatches first, then the extracted).
export function fitPicture(pic, view, w, h, colours, materialFor) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    // The projected picture at the cell size straight from the working copy
    // would alias; go through a downscaled copy of just the visible part.
    const vw = w / view.scale, vh = h / view.scale;
    const crop = document.createElement('canvas');
    crop.width = Math.max(1, Math.round(vw)); crop.height = Math.max(1, Math.round(vh));
    crop.getContext('2d').drawImage(pic, -view.x / view.scale, -view.y / view.scale, vw, vh, 0, 0, crop.width, crop.height);
    ctx.drawImage(downscale(crop, crop.width, crop.height, w, h), 0, 0);
    const rgba = ctx.getImageData(0, 0, w, h).data;
    const extracted = extractPalette(rgba, EXTRACTED);
    const all = colours.concat(extracted);
    const mapped = mapToColours(rgba, all);
    const map = new Uint8Array(w * h);
    for (let i = 0; i < map.length; i++) map[i] = mapped[i] === NONE ? 0 : materialFor(mapped[i]);
    return { canvas: c, rgba, extracted, all, mapped, map };
}

/**
 * Pick and fit a picture. Resolves { png, canvas, opacity, extracted, map } or
 * null when the player cancels. `file` skips the picker (tests, dev hook).
 */
export async function importPicture({ w, h, colours, materialFor, file = null, opacity = 0.6 }) {
    if (!file) {
        file = await Arcade.ui.openFile({ accept: 'image/*' });
        if (!file) return null;
    }
    let bitmap;
    try { bitmap = await decode(file); }
    catch (e) {
        Arcade.ui.toast('That picture could not be read', { kind: 'error' });
        return null;
    }
    const bw = bitmap.width, bh = bitmap.height;
    const k0 = Math.min(1, WORKING_MAX / Math.max(bw, bh));
    const working = downscale(bitmap, bw, bh, Math.max(1, Math.round(bw * k0)), Math.max(1, Math.round(bh * k0)));
    if (bitmap.close) bitmap.close();

    return openSheet({
        label: 'Fit the picture',
        className: 'importer',
        build(body, close) {
            let turns = 0;
            let pic = working;
            let view = coverFit(pic.width, pic.height, w, h);
            let asSand = false;
            let fit = null;                          // the last fitPicture(), for the preview

            const canvas = el('canvas', { class: 'crop-view', 'aria-label': 'The picture under the jar' });
            const ctx = canvas.getContext('2d');
            const zoom = el('input', { type: 'range', min: '0', max: '100', step: '1', value: '0', 'aria-label': 'Zoom' });
            const hint = el('p', { class: 'sheet-hint', text: 'Drag to move, pinch or slide to zoom. This sits behind the sand, one pixel per grain.' });

            let k = 1;                               // device pixels per cell on the crop canvas
            function size() {
                const box = canvas.parentElement.getBoundingClientRect();
                const dpr = Math.min(window.devicePixelRatio || 1, 3);
                let cw = Math.min(box.width, box.height * w / h);
                if (!(cw > 0)) cw = w;
                canvas.style.width = cw + 'px';
                canvas.style.height = (cw * h / w) + 'px';
                k = cw * dpr / w;
                canvas.width = Math.round(w * k); canvas.height = Math.round(h * k);
                draw();
            }
            let raf = 0;
            function draw() {
                if (raf) return;
                raf = requestAnimationFrame(() => {
                    raf = 0;
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    if (asSand) {
                        fit = fitPicture(pic, view, w, h, colours, materialFor);
                        const out = document.createElement('canvas');
                        out.width = w; out.height = h;
                        const rgba = new Uint8ClampedArray(w * h * 4);
                        renderMapped(fit.mapped, fit.all, rgba);
                        out.getContext('2d').putImageData(new ImageData(rgba, w, h), 0, 0);
                        ctx.imageSmoothingEnabled = false;
                        ctx.drawImage(out, 0, 0, canvas.width, canvas.height);
                    } else {
                        project(ctx, pic, view, k);
                    }
                });
            }
            function setView(v) {
                view = clampView(v, pic.width, pic.height, w, h);
                const min = Math.max(w / pic.width, h / pic.height);
                zoom.value = String(Math.round(100 * Math.log(view.scale / min) / Math.log(MAX_ZOOM)));
                draw();
            }

            // Fingers: one drags, two pinch. Deltas arrive in CSS px and are
            // turned into cells through the canvas's displayed size.
            const fingers = new Map();
            let pinch = null;
            const cell = (e) => {
                const r = canvas.getBoundingClientRect();
                return { x: (e.clientX - r.left) / r.width * w, y: (e.clientY - r.top) / r.height * h };
            };
            canvas.addEventListener('pointerdown', (e) => {
                if (fingers.size >= 2) return;
                try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* stylus edge cases */ }
                fingers.set(e.pointerId, cell(e));
                if (fingers.size === 2) {
                    const [a, b] = [...fingers.values()];
                    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
                }
                e.preventDefault();
            });
            canvas.addEventListener('pointermove', (e) => {
                if (!fingers.has(e.pointerId)) return;
                const now = cell(e), was = fingers.get(e.pointerId);
                fingers.set(e.pointerId, now);
                if (fingers.size === 2 && pinch) {
                    const [a, b] = [...fingers.values()];
                    const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
                    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
                    // Zoom about the midpoint, then follow it.
                    const factor = d / pinch.d;
                    pinch.d = d;
                    setView(zoomAt(view, factor, mid.x, mid.y, pic.width, pic.height, w, h));
                } else if (fingers.size === 1) {
                    setView({ scale: view.scale, x: view.x + (now.x - was.x), y: view.y + (now.y - was.y) });
                }
            });
            const lift = (e) => { fingers.delete(e.pointerId); if (fingers.size < 2) pinch = null; };
            canvas.addEventListener('pointerup', lift);
            canvas.addEventListener('pointercancel', lift);
            canvas.addEventListener('contextmenu', (e) => e.preventDefault());

            zoom.addEventListener('input', () => {
                const min = Math.max(w / pic.width, h / pic.height);
                const target = min * Math.pow(MAX_ZOOM, Number(zoom.value) / 100);
                setView(zoomAt(view, target / view.scale, w / 2, h / 2, pic.width, pic.height, w, h));
            });

            const rotate = el('button', { type: 'button', class: 'ghost', text: 'Turn', onclick: () => {
                turns = (turns + 1) & 3;
                pic = turn(working, turns);
                setView(coverFit(pic.width, pic.height, w, h));
            } });
            const preview = el('button', { type: 'button', class: 'ghost toggle', text: 'As sand', 'aria-pressed': 'false', onclick: () => {
                asSand = !asSand;
                preview.setAttribute('aria-pressed', asSand ? 'true' : 'false');
                preview.classList.toggle('on', asSand);
                draw();
            } });
            const use = el('button', { type: 'button', class: 'primary', text: 'Use picture', 'data-autofocus': '', onclick: () => {
                const f = fitPicture(pic, view, w, h, colours, materialFor);
                close({ png: f.canvas.toDataURL('image/png'), canvas: f.canvas, opacity, extracted: f.extracted, map: f.map });
            } });
            const cancel = el('button', { type: 'button', class: 'ghost', text: 'Cancel', onclick: () => close(null) });

            body.append(
                el('header', {}, el('h2', { text: 'Fit the picture' }), hint),
                el('div', { class: 'crop' }, canvas),
                el('div', { class: 'crop-controls' }, el('label', {}, el('span', { text: 'Zoom' }), zoom), rotate, preview),
                el('footer', {}, cancel, use),
            );
            new ResizeObserver(size).observe(canvas.parentElement);
            requestAnimationFrame(size);
        },
    });
}
