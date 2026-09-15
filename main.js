/* main.js — Sand Art: a jar you pour coloured sand into.
 *
 * The test bed for the fleet's first compiled kernel (Arcade.sim.sand,
 * plans/compiled-kernels-2026-09.md WP3). Everything the kernel does not do
 * lives here, and it is deliberately little: turn a finger into cell
 * coordinates, hand the tool a (sim, pointer) pair each step, blit the
 * framebuffer, and — the part that matters for battery — stop asking for
 * frames the moment the kernel says nothing can move.
 *
 *   • Arcade.loop is the only frame source (GAME_INTEGRATION §6a). It runs
 *     at the display rate; the sim runs at a fixed 60 Hz through an
 *     accumulator so a 120 Hz phone does not pour twice as fast.
 *   • wake()/rest() is Shui Guo Tan's pattern: rest when sim.quiet() and no
 *     finger is down; wake on any input. Reduced motion changes nothing —
 *     falling sand is the content, not decoration — and power saver only
 *     halves the blit rate (the sim keeps its 60 Hz; the picture is the same).
 *   • sim.pixels is re-read every blit, never held (the view can detach when
 *     wasm memory grows — see the kernel wrapper's header).
 *   • Persistence goes through Arcade.store (persist.js) and small prefs
 *     through Arcade.state; nothing here touches localStorage (§9).
 *   • Fingers go through gestures.js: one is the tool, two are the view
 *     (pinch to zoom 1×–4× and pan, double tap to toggle 3×). The blit is
 *     still one drawImage — with a source rectangle — and toCell maps
 *     through the same view, so the tool lands where the finger is.
 *   • Undo is a snapshot of the grid before every stroke (history.js) and
 *     one sim.load() back; the kernel repaints and re-settles from there.
 *
 * A jar can have a picture behind it (importer.js): the framebuffer's air
 * is made transparent and the picture is drawn under it, one pixel per
 * cell, as a template to build towards. The Trace tool paints the picture's
 * colours, Match paints whatever settled sand is under the finger, and the
 * landing overlay (hints.js) shows where a grain can rest right now. Every
 * jar is a record in the gallery (persist.js, gallery-ui.js); the open one
 * saves itself as it settles. Behind the gallery is the Library
 * (library.json, library-ui.js): where the tools come from, each entry
 * with a sample jar that copies into the gallery on a tap.
 */

import { TOOLS, TOOL_BY_ID } from './tools.js';
import { SWATCHES, EXTRA_BASE, EXTRA_COUNT, applyPalette, swatchCss, groundCss } from './palette.js';
import { openGallery, newId } from './persist.js';
import { importPicture } from './importer.js';
import { openGallerySheet } from './gallery-ui.js';
import { openLibrarySheet } from './library-ui.js';
import { landingMask } from './hints.js';
import { mapToColours, NONE, viewRect, zoomAt } from './template.js';
import { createGestures } from './gestures.js';
import { createHistory } from './history.js';

// 192×320 is chunk-aligned (12×20 of the kernel's 16×16 chunks) and small
// enough that a full-grid step is well under a millisecond on a phone; the
// blit — one putImageData plus one scaled drawImage — dominates, and that is
// fixed by the display size, not the grid.
const W = 192, H = 320;
const FIXED_MS = 1000 / 60;
const MAX_STEPS_PER_FRAME = 3;      // a stalled tab catches up a little, not all at once
const SAVE_DEBOUNCE_MS = 3000;
const THUMB_W = 48, THUMB_H = 80;

const $ = (id) => document.getElementById(id);
const els = {
    stage: $('stage'), jar: $('jar'), view: $('view'),
    status: $('status'), clear: $('clear'), photo: $('photo'), gallery: $('gallery'), fit: $('fit'),
    undo: $('undo'), redo: $('redo'),
    options: $('options'), option: $('option'), optionLabel: $('option-label'), optionValue: $('option-value'),
    picture: $('picture'), opacity: $('opacity'), showPicture: $('show-picture'), landing: $('landing'), removePicture: $('remove-picture'),
    palette: $('palette'), toolbar: $('toolbar'),
};

const sand = Arcade.sim && Arcade.sim.sand;
let sim = null;
let tool = TOOL_BY_ID.pour;
let tint = sand ? sand.tint(1) : 17;           // Ochre
const opts = {};                                 // tool id → slider value
for (const t of TOOLS) if (t.option) opts[t.id] = t.option.value;

// The stroke the tool sees: one finger, in grid cells, with per-stroke
// scratch in `state`. gestures.js decides when a finger is a stroke and
// when a pair of them is the view.
const pointer = { active: false, x: 0, y: 0, lx: 0, ly: 0, state: {} };
const jitter = Arcade.rng('sand-art:jitter');

let settings = { theme: 'dark', powerSaver: false };
function pullSettings() {
    settings = {
        theme: Arcade.settings.theme(),
        // GUARDED: powerSaver() arrived in SDK 3.13.0 and is undefined on
        // anything older, where calling it throws — inside onSettingsChange
        // that would be a throw on every launcher settings write.
        powerSaver: Arcade.settings.powerSaver ? Arcade.settings.powerSaver() : false,
    };
}

// ── the open jar ───────────────────────────────────────────────────────────
// What the gallery record holds besides the grid. `template` is the picture
// behind the jar: its PNG (kept as given, never re-encoded per save), the
// drawable, the opacity, and one material id per cell for Trace. `extra`
// is the colours pulled from it, on the kernel's spare tints.
let openId = null;
let openMeta = { name: '', created: 0 };
let template = null;                             // { png, img, opacity, map } | null
let showPicture = true;
let showLanding = false;
let extra = null;                                // [[r, g, b], …] | null

const swatchColours = SWATCHES.map(([, r, g, b]) => [r, g, b]);
const materialFor = (i) => sand.tint(i < SWATCHES.length ? i : EXTRA_BASE + (i - SWATCHES.length));

// The colour a sand material is drawn in, from our own tables (the kernel
// keeps its palette to itself). null for anything that is not sand.
function colourOf(m) {
    const { SAND, SAND_BASE } = sand.materials;
    if (m === SAND) return swatchColours[0];
    const t = m - SAND_BASE;
    if (t >= 0 && t < SWATCHES.length) return swatchColours[t];
    if (extra && t >= EXTRA_BASE && t - EXTRA_BASE < extra.length) return extra[t - EXTRA_BASE];
    return null;
}

function repalette() {
    applyPalette(sim, sand, settings.theme, { extra, clearEmpty: !!(template && showPicture) });
}

// ── rendering ──────────────────────────────────────────────────────────────
// The framebuffer goes onto an offscreen canvas of the grid's size, then is
// drawn scaled with smoothing off, so every cell is a crisp square of
// display pixels and the picture reads as grains rather than a blur. With a
// picture behind the jar the air is transparent (palette.js) and the picture
// goes down first, so the framebuffer is still the only thing the sand is
// ever drawn through — no per-cell compositing here.
const off = document.createElement('canvas');
off.width = W; off.height = H;
const offCtx = off.getContext('2d');
const hint = document.createElement('canvas');
hint.width = W; hint.height = H;
const hintCtx = hint.getContext('2d');
const hintImg = new ImageData(W, H);
let mask = new Uint8Array(W * H);
const viewCtx = els.view.getContext('2d', { alpha: false });
let img = null;

// Every layer is drawn through the same source rectangle — the part of
// the grid the view shows — so zooming costs nothing extra: it is the one
// blit, cropped.
function blit() {
    const px = sim.pixels;                       // re-read: the view may have been replaced
    if (!img || img.data !== px) img = new ImageData(px, W, H);
    offCtx.putImageData(img, 0, 0);
    const vw = els.view.width, vh = els.view.height;
    const r = viewRect(gestures.view, W, H);
    viewCtx.imageSmoothingEnabled = false;
    if (template && showPicture) {
        viewCtx.fillStyle = groundCss(settings.theme);
        viewCtx.fillRect(0, 0, vw, vh);
        viewCtx.globalAlpha = template.opacity;
        viewCtx.drawImage(template.img, r.x, r.y, r.w, r.h, 0, 0, vw, vh);
        viewCtx.globalAlpha = 1;
    }
    viewCtx.drawImage(off, r.x, r.y, r.w, r.h, 0, 0, vw, vh);
    if (showLanding) {
        drawLanding();
        viewCtx.drawImage(hint, r.x, r.y, r.w, r.h, 0, 0, vw, vh);
    }
}

// The landing overlay: every cell a grain could rest on right now, in the
// picture's colour for that cell when there is a picture (so the strip
// reads as "lay this here next"), with a contrasting mark in the cell
// above it so the strip stands out from the ghosted picture in either
// theme and is visible at two device pixels per cell.
function drawLanding() {
    mask = landingMask(sim.grid, W, H, sand.materials, mask);
    const d = hintImg.data;
    d.fill(0);
    const map = template && template.map;
    const mk = settings.theme === 'light' ? [40, 30, 20] : [255, 255, 255];
    for (let i = 0; i < mask.length; i++) {
        if (!mask[i]) continue;
        const m = map ? map[i] : 0;
        const c = (m && colourOf(m)) || mk;
        const o = i * 4;
        d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 235;
        if (i >= W) {
            const u = (i - W) * 4;
            d[u] = mk[0]; d[u + 1] = mk[1]; d[u + 2] = mk[2]; d[u + 3] = 130;
        }
    }
    hintCtx.putImageData(hintImg, 0, 0);
}

// The largest 3:5 box that fits inside the stage's padding, in CSS px; the
// backing store is scaled by devicePixelRatio so the grains stay square on a
// 3× phone. When a whole number of device pixels per cell costs less than a
// tenth of the jar, the box snaps to it: every grain is then the same crisp
// square instead of a mix of 3- and 4-pixel ones. The stage learns the jar's
// height through --jar-h so the CSS can set its shelf under the jar's foot.
function fit() {
    const cs = getComputedStyle(els.stage);
    const availW = Math.max(60, els.stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
    const availH = Math.max(100, els.stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)
        - parseFloat(getComputedStyle(els.jar).marginBottom));
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    let cw = Math.min(availW, availH * W / H);
    const perCell = Math.floor(cw * dpr / W);
    if (perCell >= 1 && perCell * W >= cw * dpr * 0.9) cw = perCell * W / dpr;
    cw = Math.floor(cw * dpr) / dpr;             // whole device pixels either way
    const ch = cw * H / W;
    els.jar.style.width = cw + 'px';
    els.jar.style.height = ch + 'px';
    els.stage.style.setProperty('--jar-h', ch + 'px');
    els.stage.dataset.fit = '1';
    els.view.width = Math.round(cw * dpr);
    els.view.height = Math.round(ch * dpr);
    if (sim) blit();
}

// A strip that scrolls sideways tells its CSS which edges hide more (the
// fade hint is drawn only there), and keeps the chosen item in view.
function watchStrip(el) {
    const mark = () => {
        const more = (el.scrollLeft > 1 ? 'l' : '') + (el.scrollLeft + el.clientWidth < el.scrollWidth - 1 ? 'r' : '');
        if (el.dataset.more !== more) el.dataset.more = more;
    };
    el.addEventListener('scroll', mark, { passive: true });
    new ResizeObserver(mark).observe(el);
    mark();
}
function reveal(el, item) {
    if (!item || el.scrollWidth <= el.clientWidth) return;
    const pad = parseFloat(getComputedStyle(el).scrollPaddingLeft) || 0;
    const left = item.offsetLeft - el.offsetLeft, right = left + item.offsetWidth;
    if (left < el.scrollLeft + pad || right > el.scrollLeft + el.clientWidth - pad) {
        // Land on the item's own snap position (its start, or the strip's
        // end for the last one) so the snap cannot pull it back under the fade.
        el.scrollLeft = item === el.lastElementChild ? el.scrollWidth : left - pad;
    }
}

// A pointer in window units: cells at 1×, before the view. gestures.js
// takes it from there — through the view to a grid cell for a stroke, or
// into a pinch.
function toWindow(e) {
    const r = els.view.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H };
}

// ── undo ───────────────────────────────────────────────────────────────────
// The grid before each stroke, and before Empty. Going back is one
// sim.load(): the kernel validates, repaints and wakes every chunk, so a
// snapshot taken mid-fall simply carries on falling.
const history = createHistory();
function remember() {
    history.push(sim.grid.slice());
    syncHistory();
}
function syncHistory() {
    els.undo.hidden = !history.canUndo();
    els.redo.hidden = !history.canRedo();
}
function travel(back) {
    const grid = back ? history.undo(sim.grid.slice()) : history.redo(sim.grid.slice());
    if (!grid) return;
    try { sim.load(grid); } catch (e) { return; }
    syncHistory();
    markDirty();
    wake();
}

// ── the view ───────────────────────────────────────────────────────────────
// The jar fitted to the stage is scale 1; a pinch or a double tap zooms it
// to 4× at most, and a pan can never show past the grid's edge. The chip
// on the stage says how far in and puts it back.
const gestures = createGestures({
    W, H,
    on: {
        stroke(kind, x, y) {
            if (kind === 'down') {
                remember();
                pointer.active = true;
                pointer.x = pointer.lx = x; pointer.y = pointer.ly = y;
                pointer.state = {};
                markDirty();
                wake();
                if (tool.down) tool.down(toolArgs());
            } else if (kind === 'move') {
                pointer.lx = pointer.x; pointer.ly = pointer.y;
                pointer.x = x; pointer.y = y;
                wake();
                if (tool.move) tool.move(toolArgs());
            } else {
                pointer.active = false;
                wake();                          // one more pass decides whether to rest
            }
        },
        view(v) {
            const zoomed = v.scale > 1.001;
            els.fit.hidden = !zoomed;
            if (zoomed) els.fit.textContent = 'Fit \u00b7 ' + (Math.round(v.scale * 10) / 10) + '\u00d7';
            if (sim) blit();
        },
    },
});

// ── the loop ───────────────────────────────────────────────────────────────
let looping = false;
let acc = 0;
let frameNo = 0;
function wake() { if (!looping) { looping = true; acc = 0; loop.start(); } }
function rest() { if (looping) { looping = false; loop.stop(); } }

function toolArgs() {
    return { sim, sand, tint, rng: jitter, x: pointer.x, y: pointer.y, lx: pointer.lx, ly: pointer.ly,
        opt: opts[tool.id], state: pointer.state, template: template ? template.map : null };
}

const loop = Arcade.loop((deltaMs) => {
    acc += Math.min(deltaMs, 250);
    let steps = 0;
    while (acc >= FIXED_MS && steps < MAX_STEPS_PER_FRAME) {
        if (pointer.active && tool.frame) tool.frame(toolArgs());
        sim.step();
        acc -= FIXED_MS;
        steps++;
    }
    // Falling sand changes the picture with no finger on it. Without this
    // the debounce could save a grain in mid-air and the settled jar never.
    if (steps && sim.activeCells() > 0) markDirty();
    if (acc > FIXED_MS * MAX_STEPS_PER_FRAME) acc = 0;   // never owe more than a burst
    frameNo++;
    // Power saver: the sim still runs at 60 Hz (the picture must not change),
    // but only every other frame is painted to the screen.
    if (!(settings.powerSaver && (frameNo & 1))) blit();

    // Settled and untouched: this frame drew the final picture, the next
    // would draw it again. Stop, and let a settled picture be the one saved.
    if (!pointer.active && sim.quiet()) {
        rest();
        if (dirty) flushSave();
    }
});

// ── persistence ────────────────────────────────────────────────────────────
const gallery = openGallery();
let dirty = false;
let saving = false;
let saveTimer = null;

function markDirty() {
    dirty = true;
    if (!saveTimer) {
        saveTimer = Arcade.session.setTimeout(() => { saveTimer = null; if (dirty) flushSave(); }, SAVE_DEBOUNCE_MS);
    }
}

// A small render of the sand on the theme's ground, for the gallery list.
// JPEG: a few KB, and the record travels in the launcher's save bundle.
function makeThumb() {
    const c = document.createElement('canvas');
    c.width = THUMB_W; c.height = THUMB_H;
    const ctx = c.getContext('2d');
    ctx.fillStyle = groundCss(settings.theme);
    ctx.fillRect(0, 0, THUMB_W, THUMB_H);
    if (template) { ctx.globalAlpha = 0.35; ctx.drawImage(template.img, 0, 0, THUMB_W, THUMB_H); ctx.globalAlpha = 1; }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(off, 0, 0, THUMB_W, THUMB_H);
    return c.toDataURL('image/jpeg', 0.7);
}

async function flushSave() {
    if (saving || !dirty) return;
    saving = true;
    dirty = false;                               // a change during the write re-dirties
    try {
        if (!openId) openId = newId();
        const rec = await gallery.save(sim, {
            id: openId, name: openMeta.name, created: openMeta.created,
            thumb: makeThumb(),
            template: template ? { png: template.png, opacity: template.opacity } : null,
            palette: extra,
        });
        openMeta.created = rec.created;
        Arcade.state.set('open', openId);
    }
    catch (e) { dirty = true; console.warn('sand-art: save failed', e); }
    finally { saving = false; }
}

function savePrefs() {
    Arcade.state.set('prefs', { tool: tool.id, tint, opts, showLanding });
}

// Decode a record's picture back to a drawable and the Trace map. The map
// is recomputed rather than stored: it is a pure function of the PNG and
// the palette, and 60 KB the record does not need to carry.
function pictureFromPng(png) {
    return new Promise((resolve, reject) => {
        const im = new Image();
        im.onload = () => {
            const c = document.createElement('canvas');
            c.width = W; c.height = H;
            const ctx = c.getContext('2d');
            ctx.drawImage(im, 0, 0, W, H);
            resolve(c);
        };
        im.onerror = () => reject(new Error('picture'));
        im.src = png;
    });
}
function mapFor(canvas, colours) {
    const rgba = canvas.getContext('2d').getImageData(0, 0, W, H).data;
    const mapped = mapToColours(rgba, swatchColours.concat(colours || []));
    const map = new Uint8Array(W * H);
    for (let i = 0; i < map.length; i++) map[i] = mapped[i] === NONE ? 0 : materialFor(mapped[i]);
    return map;
}

async function setTemplate(next, colours) {
    template = next;
    extra = colours && colours.length ? colours : null;
    els.picture.hidden = !template;
    if (template) {
        els.opacity.value = String(Math.round(template.opacity * 100));
        els.showPicture.setAttribute('aria-pressed', showPicture ? 'true' : 'false');
        els.showPicture.textContent = showPicture ? 'Hide' : 'Show';
    }
    buildPalette();
    pickTint(tint - sand.materials.SAND_BASE);
    repalette();
    pickTool(tool.id);                           // Trace's hint depends on there being a picture
    loop.kick();
}

// Bring a gallery record into the jar. Resolves false when the record was
// unusable; the jar is then left as it was.
async function openRecord(rec) {
    if (!gallery.restore(sim, rec)) return false;
    let next = null;
    if (rec.template && typeof rec.template.png === 'string') {
        try {
            const im = await pictureFromPng(rec.template.png);
            next = { png: rec.template.png, img: im, opacity: clamp01(rec.template.opacity, 0.6), map: mapFor(im, rec.palette) };
        } catch (e) { next = null; }
    }
    openId = rec.id;
    openMeta = { name: rec.name || '', created: rec.created || 0 };
    history.clear(); syncHistory();
    dirty = false;
    Arcade.state.set('open', openId);
    await setTemplate(next, rec.palette);
    wake();
    return true;
}
function clamp01(v, d) { return typeof v === 'number' && v >= 0 && v <= 1 ? v : d; }

// An empty jar with no picture. Nothing is written until something happens
// in it, so an unused new jar never clutters the gallery.
async function freshJar() {
    if (dirty) await flushSave();
    sim.clear();
    history.clear(); syncHistory();
    openId = newId();
    const n = (await gallery.list()).length + 1;
    openMeta = { name: 'Jar ' + n, created: 0 };
    dirty = false;
    Arcade.state.set('open', openId);
    await setTemplate(null, null);
    wake();
}

// ── the Library ────────────────────────────────────────────────────────────
// library.json is fetched once, the first time the sheet opens; the sample
// jars are fetched one at a time when asked for, and come into the gallery
// as copies (gallery.add) so the shipped record is never the one edited.
let library = null;
async function showLibrary() {
    if (!library) {
        try { library = await (await fetch('library.json')).json(); }
        catch (e) { Arcade.ui.toast('The Library could not be opened', { kind: 'error' }); return; }
    }
    await openLibrarySheet({
        library,
        framed: !!(Arcade.context && Arcade.context.framed),
        actions: {
            toolLabel: (id) => (TOOL_BY_ID[id] ? TOOL_BY_ID[id].label : id),
            pickTool: (id) => { if (TOOL_BY_ID[id]) { pickTool(id); savePrefs(); } },
            tryJar: async (entry) => {
                if (dirty) await flushSave();
                let rec = null;
                try { rec = await (await fetch(entry.jar)).json(); } catch (e) { rec = null; }
                const copy = rec && await gallery.add(rec, rec.name);
                if (!copy || !(await openRecord(copy))) {
                    Arcade.ui.toast('That jar could not be opened', { kind: 'error' });
                    return false;
                }
                Arcade.ui.toast('\u201c' + copy.name + '\u201d is yours now: it is in the gallery', { kind: 'success' });
                return true;
            },
        },
    });
}

// ── UI ─────────────────────────────────────────────────────────────────────
function pickTool(id) {
    tool = TOOL_BY_ID[id] || TOOL_BY_ID.pour;
    for (const b of els.toolbar.children) {
        const on = b.dataset.id === tool.id;
        b.classList.toggle('on', on);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
        if (on) reveal(els.toolbar, b);
    }
    els.status.textContent = (tool.id === 'trace' && !template) ? 'Trace needs a picture: tap Picture to add one' : tool.hint;
    const o = tool.option;
    els.options.hidden = !o;
    if (o) {
        els.optionLabel.textContent = o.label;
        els.option.min = o.min; els.option.max = o.max;
        els.option.value = opts[tool.id];
        els.optionValue.textContent = opts[tool.id];
    }
}

function pickTint(t) {
    const count = SWATCHES.length + (extra ? extra.length : 0);
    if (t < 0 || t >= count || (t >= SWATCHES.length && !extra)) t = 1;   // a picture colour after its picture went
    tint = sand.tint(t);
    for (const b of els.palette.children) {
        const on = Number(b.dataset.t) === t;
        b.classList.toggle('on', on);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
        if (on) reveal(els.palette, b);
    }
}

function swatch(t, name, css, cls) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch' + (cls ? ' ' + cls : '');
    b.dataset.t = String(t);
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', name);
    b.title = name;
    b.style.setProperty('--c', css);
    b.addEventListener('click', () => { pickTint(t); savePrefs(); });
    return b;
}

// The curated swatches, then the picture's own colours when there is one.
function buildPalette() {
    els.palette.replaceChildren();
    SWATCHES.forEach(([name], t) => els.palette.appendChild(swatch(t, name, swatchCss(t))));
    if (extra) {
        extra.slice(0, EXTRA_COUNT).forEach((c, i) => {
            els.palette.appendChild(swatch(EXTRA_BASE + i, 'Picture colour ' + (i + 1), `rgb(${c[0]} ${c[1]} ${c[2]})`, 'extra'));
        });
    }
}

function setLanding(on) {
    showLanding = on;
    els.landing.setAttribute('aria-pressed', on ? 'true' : 'false');
    els.landing.classList.toggle('on', on);
    if (sim) blit();
}

async function addPicture(file) {
    const r = await importPicture({ w: W, h: H, colours: swatchColours, materialFor, file, opacity: template ? template.opacity : 0.6 });
    if (!r) return;
    await setTemplate({ png: r.png, img: r.canvas, opacity: r.opacity, map: r.map }, r.extracted);
    markDirty();
    if (!showPicture) { showPicture = true; await setTemplate(template, extra); }
    Arcade.ui.toast('Picture set behind the jar', { kind: 'info' });
}

function buildUi() {
    for (const t of TOOLS) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'tool';
        b.dataset.id = t.id;
        b.setAttribute('role', 'radio');
        b.title = t.hint;
        b.textContent = t.label;
        b.addEventListener('click', () => { pickTool(t.id); savePrefs(); });
        els.toolbar.appendChild(b);
    }
    buildPalette();
    els.option.addEventListener('input', () => {
        opts[tool.id] = Number(els.option.value);
        els.optionValue.textContent = els.option.value;
    });
    els.option.addEventListener('change', savePrefs);

    els.clear.addEventListener('click', async () => {
        // Native confirm is a no-op inside the launcher's sandbox; the SDK
        // renders a real dialog framed and falls back to window.confirm
        // standalone (§7).
        const sure = await Arcade.ui.confirm('Empty the jar? Undo brings the sand back.', { okLabel: 'Empty', cancelLabel: 'Keep' });
        if (!sure) return;
        remember();
        sim.clear();
        markDirty();                             // the emptied jar is what the gallery keeps
        loop.kick();
    });

    // The picture behind the jar.
    els.photo.addEventListener('click', () => addPicture(null));
    els.opacity.addEventListener('input', () => {
        if (!template) return;
        template.opacity = Number(els.opacity.value) / 100;
        blit();
    });
    els.opacity.addEventListener('change', markDirty);
    els.showPicture.addEventListener('click', () => {
        showPicture = !showPicture;
        setTemplate(template, extra);
    });
    els.landing.addEventListener('click', () => { setLanding(!showLanding); savePrefs(); });
    els.removePicture.addEventListener('click', async () => {
        const sure = await Arcade.ui.confirm('Take the picture away? The sand stays.', { okLabel: 'Remove', cancelLabel: 'Keep' });
        if (!sure) return;
        await setTemplate(null, null);
        markDirty();
    });

    // The gallery, and the Library behind it.
    els.gallery.addEventListener('click', async () => {
        if (dirty) await flushSave();
        const r = await openGallerySheet({
            openId,
            actions: {
                list: () => gallery.list(),
                open: async (id) => {
                    const rec = await gallery.get(id);
                    if (!rec || !(await openRecord(rec))) Arcade.ui.toast('That jar could not be opened', { kind: 'error' });
                },
                fresh: freshJar,
                rename: async (id, name) => {
                    await gallery.rename(id, name);
                    if (id === openId) openMeta.name = name;
                },
                duplicate: async (id) => { await gallery.duplicate(id); Arcade.ui.toast('Copied', { kind: 'info' }); },
                remove: async (id) => {
                    await gallery.remove(id);
                    if (id === openId) await freshJar();
                },
            },
        });
        if (r === 'library') await showLibrary();
    });

    // Pointers → gestures. touch-action:none is set in CSS so the browser
    // never scrolls or zooms the page under a finger; each pointer is
    // captured so a stroke or a pinch that leaves the jar still ends
    // cleanly. The grace before a stroke commits is a timer here and a
    // tick there.
    const v = els.view;
    v.addEventListener('pointerdown', (e) => {
        if (e.button > 0) return;
        try { v.setPointerCapture(e.pointerId); } catch (err) { /* stylus edge cases */ }
        const w = toWindow(e);
        const wait = gestures.down(e.pointerId, w.x, w.y, performance.now());
        if (wait) Arcade.session.setTimeout(() => gestures.tick(performance.now()), wait + 2);
        e.preventDefault();
    });
    v.addEventListener('pointermove', (e) => {
        const w = toWindow(e);
        gestures.move(e.pointerId, w.x, w.y);
    });
    v.addEventListener('pointerup', (e) => gestures.up(e.pointerId, performance.now()));
    v.addEventListener('pointercancel', (e) => gestures.cancel(e.pointerId));
    v.addEventListener('contextmenu', (e) => e.preventDefault());
    // Desktop: ctrl+wheel (or a trackpad pinch, which arrives the same way)
    // zooms about the cursor; a plain wheel pans once zoomed in.
    v.addEventListener('wheel', (e) => {
        e.preventDefault();
        const w = toWindow(e);
        const cur = gestures.view;
        if (e.ctrlKey || e.metaKey) {
            gestures.setView(zoomAt(cur, Math.exp(-e.deltaY * 0.004), w.x, w.y, W, H, W, H));
        } else if (cur.scale > 1.001) {
            const k = W / v.getBoundingClientRect().width;
            gestures.setView({ scale: cur.scale, x: cur.x - e.deltaX * k, y: cur.y - e.deltaY * k });
        }
    }, { passive: false });
    els.fit.addEventListener('click', () => gestures.setView({ scale: 1, x: 0, y: 0 }));
    els.undo.addEventListener('click', () => travel(true));
    els.redo.addEventListener('click', () => travel(false));
    document.addEventListener('keydown', (e) => {
        if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
        if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
        e.preventDefault();
        travel(!e.shiftKey);
    });

    new ResizeObserver(fit).observe(els.stage);
    watchStrip(els.toolbar);
    watchStrip(els.palette);
}

// ── boot ───────────────────────────────────────────────────────────────────
async function boot() {
    await Arcade.ready;
    if (!sand) {
        els.status.textContent = 'The sand kernel did not load (arcade-sim-sand.js).';
        return;
    }
    pullSettings();
    // The launcher's bar already carries the title: let the CSS drop ours.
    if (Arcade.context && Arcade.context.framed) document.documentElement.dataset.framed = 'true';
    // The seed only decides which diagonal a grain tries first; it is fixed
    // so a saved picture and its replay would agree. Not a daily — a jar is
    // a jar every day.
    sim = await sand.create({ width: W, height: H, seed: 'sand-art' });
    repalette();

    const prefs = Arcade.state.get('prefs');
    if (prefs && typeof prefs === 'object') {
        for (const id in prefs.opts || {}) if (id in opts) opts[id] = Number(prefs.opts[id]) || opts[id];
        if (typeof prefs.tint === 'number') tint = prefs.tint;
    }
    buildUi();
    pickTool(prefs && prefs.tool);
    pickTint(tint - sand.materials.SAND_BASE);
    setLanding(!!(prefs && prefs.showLanding));

    fit();
    // Every chunk is active before the first step, so quiet() is false until
    // one has run: waking here draws the first frame and then rests itself.
    wake();

    // The saved jar comes back after the first frame, not before it: a
    // bridged store waits on the launcher, and an empty jar on screen beats
    // a blank one while it answers. A jar from before the gallery is adopted
    // as its first record.
    const adopted = await gallery.adoptLegacy();
    let rec = adopted;
    if (!rec) {
        const id = Arcade.state.get('open');
        if (typeof id === 'string') rec = await gallery.get(id);
    }
    if (rec && await openRecord(rec)) {
        Arcade.ui.toast('Your jar is where you left it', { kind: 'info' });
    } else {
        await freshJar();
    }

    Arcade.onSettingsChange(() => {
        const was = settings.theme;
        pullSettings();
        if (settings.theme !== was) { repalette(); loop.kick(); }
    });
    Arcade.onSuspend(() => {
        gestures.reset();                        // the browser will not send the ups
        pointer.active = false;
        if (dirty) flushSave();                  // the grace window is enough for one IDB put
    });
    Arcade.onResume(() => { wake(); });          // rests again on its own if nothing moved
    Arcade.onStateReplaced(async () => {
        // A save import replaced the gallery under us: pick the open jar
        // back up from the store, or start clean if it is gone.
        const id = Arcade.state.get('open');
        const r = typeof id === 'string' ? await gallery.get(id) : null;
        if (!r || !(await openRecord(r))) await freshJar();
    });

    // Test hook, dev only: lets the acceptance script see the loop rest
    // without counting rAF ticks (which read 0 whenever the SDK is correctly
    // suspending the frame, and mislead), and feed the importer a File
    // without a picker.
    if (/[?&]dev=1/.test(location.search)) {
        window.__sandArt = {
            running: () => looping, sim, pickTool, pickTint, flushSave,
            importFile: addPicture, gallery, freshJar, openRecord,
            template: () => template, extra: () => extra, openId: () => openId, setLanding,
            showLibrary, gestures, history, travel,
        };
    }
}

boot().catch((e) => {
    console.error('sand-art: boot failed', e);
    els.status.textContent = 'Could not start: ' + (e && e.message || e);
});
