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
 */

import { TOOLS, TOOL_BY_ID } from './tools.js';
import { SWATCHES, applyPalette, swatchCss } from './palette.js';
import { openPictureStore } from './persist.js';

// 192×320 is chunk-aligned (12×20 of the kernel's 16×16 chunks) and small
// enough that a full-grid step is well under a millisecond on a phone; the
// blit — one putImageData plus one scaled drawImage — dominates, and that is
// fixed by the display size, not the grid.
const W = 192, H = 320;
const FIXED_MS = 1000 / 60;
const MAX_STEPS_PER_FRAME = 3;      // a stalled tab catches up a little, not all at once
const SAVE_DEBOUNCE_MS = 3000;

const $ = (id) => document.getElementById(id);
const els = {
    stage: $('stage'), jar: $('jar'), view: $('view'),
    status: $('status'), clear: $('clear'),
    options: $('options'), option: $('option'), optionLabel: $('option-label'), optionValue: $('option-value'),
    palette: $('palette'), toolbar: $('toolbar'),
};

const sand = Arcade.sim && Arcade.sim.sand;
let sim = null;
let tool = TOOL_BY_ID.pour;
let tint = sand ? sand.tint(1) : 17;           // Ochre
const opts = {};                                 // tool id → slider value
for (const t of TOOLS) if (t.option) opts[t.id] = t.option.value;

// One finger. A second pointer while the first is down is ignored rather
// than fought over; multi-touch is not a feature here.
const pointer = { active: false, id: null, x: 0, y: 0, lx: 0, ly: 0, state: {} };   // state: per-stroke scratch
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

// ── rendering ──────────────────────────────────────────────────────────────
// The framebuffer goes onto an offscreen canvas of the grid's size, then is
// drawn scaled with smoothing off, so every cell is a crisp square of
// display pixels and the picture reads as grains rather than a blur.
const off = document.createElement('canvas');
off.width = W; off.height = H;
const offCtx = off.getContext('2d');
const viewCtx = els.view.getContext('2d', { alpha: false });
let img = null;

function blit() {
    const px = sim.pixels;                       // re-read: the view may have been replaced
    if (!img || img.data !== px) img = new ImageData(px, W, H);
    offCtx.putImageData(img, 0, 0);
    viewCtx.imageSmoothingEnabled = false;
    viewCtx.drawImage(off, 0, 0, els.view.width, els.view.height);
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

function toCell(e) {
    const r = els.view.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) / r.width * W);
    const y = Math.floor((e.clientY - r.top) / r.height * H);
    return { x: Math.max(0, Math.min(W - 1, x)), y: Math.max(0, Math.min(H - 1, y)) };
}

// ── the loop ───────────────────────────────────────────────────────────────
let looping = false;
let acc = 0;
let frameNo = 0;
function wake() { if (!looping) { looping = true; acc = 0; loop.start(); } }
function rest() { if (looping) { looping = false; loop.stop(); } }

function toolArgs() {
    return { sim, sand, tint, rng: jitter, x: pointer.x, y: pointer.y, lx: pointer.lx, ly: pointer.ly, opt: opts[tool.id], state: pointer.state };
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
const pictures = openPictureStore();
let dirty = false;
let saving = false;
let saveTimer = null;

function markDirty() {
    dirty = true;
    if (!saveTimer) {
        saveTimer = Arcade.session.setTimeout(() => { saveTimer = null; if (dirty) flushSave(); }, SAVE_DEBOUNCE_MS);
    }
}

async function flushSave() {
    if (saving || !dirty) return;
    saving = true;
    dirty = false;                               // a change during the write re-dirties
    try { await pictures.save(sim); }
    catch (e) { dirty = true; console.warn('sand-art: save failed', e); }
    finally { saving = false; }
}

function savePrefs() {
    Arcade.state.set('prefs', { tool: tool.id, tint, opts });
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
    els.status.textContent = tool.hint;
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
    tint = sand.tint(t);
    for (const b of els.palette.children) {
        const on = Number(b.dataset.t) === t;
        b.classList.toggle('on', on);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
        if (on) reveal(els.palette, b);
    }
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
    SWATCHES.forEach(([name], t) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'swatch';
        b.dataset.t = String(t);
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-label', name);
        b.title = name;
        b.style.setProperty('--c', swatchCss(t));
        b.addEventListener('click', () => { pickTint(t); savePrefs(); });
        els.palette.appendChild(b);
    });
    els.option.addEventListener('input', () => {
        opts[tool.id] = Number(els.option.value);
        els.optionValue.textContent = els.option.value;
    });
    els.option.addEventListener('change', savePrefs);

    els.clear.addEventListener('click', async () => {
        // Native confirm is a no-op inside the launcher's sandbox; the SDK
        // renders a real dialog framed and falls back to window.confirm
        // standalone (§7).
        const sure = await Arcade.ui.confirm('Empty the jar? The picture is gone for good.', { okLabel: 'Empty', cancelLabel: 'Keep' });
        if (!sure) return;
        sim.clear();
        dirty = false;
        pictures.forget().catch(() => { });
        loop.kick();
    });

    // Pointer → cells. touch-action:none is set in CSS so the browser never
    // scrolls or zooms the page under a stroke; the pointer is captured so a
    // stroke that leaves the jar still ends cleanly.
    const v = els.view;
    v.addEventListener('pointerdown', (e) => {
        if (pointer.active || e.button > 0) return;
        try { v.setPointerCapture(e.pointerId); } catch (err) { /* stylus edge cases */ }
        const c = toCell(e);
        pointer.active = true; pointer.id = e.pointerId;
        pointer.x = pointer.lx = c.x; pointer.y = pointer.ly = c.y;
        pointer.state = {};
        markDirty();
        wake();
        if (tool.down) tool.down(toolArgs());
        e.preventDefault();
    });
    v.addEventListener('pointermove', (e) => {
        if (!pointer.active || e.pointerId !== pointer.id) return;
        const c = toCell(e);
        if (c.x === pointer.x && c.y === pointer.y) return;
        pointer.lx = pointer.x; pointer.ly = pointer.y;
        pointer.x = c.x; pointer.y = c.y;
        wake();
        if (tool.move) tool.move(toolArgs());
    });
    const release = (e) => {
        if (!pointer.active || e.pointerId !== pointer.id) return;
        pointer.active = false; pointer.id = null;
        wake();                                  // one more pass decides whether to rest
    };
    v.addEventListener('pointerup', release);
    v.addEventListener('pointercancel', release);
    v.addEventListener('contextmenu', (e) => e.preventDefault());

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
    applyPalette(sim, sand, settings.theme);

    const prefs = Arcade.state.get('prefs');
    if (prefs && typeof prefs === 'object') {
        for (const id in prefs.opts || {}) if (id in opts) opts[id] = Number(prefs.opts[id]) || opts[id];
        if (typeof prefs.tint === 'number') tint = prefs.tint;
    }
    buildUi();
    pickTool(prefs && prefs.tool);
    pickTint(Math.max(0, Math.min(SWATCHES.length - 1, tint - sand.materials.SAND_BASE)));

    fit();
    // Every chunk is active before the first step, so quiet() is false until
    // one has run: waking here draws the first frame and then rests itself.
    wake();

    // The saved picture comes back after the first frame, not before it: a
    // bridged store waits on the launcher, and an empty jar on screen beats
    // a blank one while it answers.
    if (await pictures.restore(sim)) {
        wake();
        Arcade.ui.toast('Your jar is where you left it', { kind: 'info' });
    }

    Arcade.onSettingsChange(() => {
        const was = settings.theme;
        pullSettings();
        if (settings.theme !== was) { applyPalette(sim, sand, settings.theme); loop.kick(); }
    });
    Arcade.onSuspend(() => {
        pointer.active = false; pointer.id = null;
        if (dirty) flushSave();                  // the grace window is enough for one IDB put
    });
    Arcade.onResume(() => { wake(); });          // rests again on its own if nothing moved
    Arcade.onStateReplaced(async () => {
        // A save import replaced the picture under us: repaint from the store.
        sim.clear();
        await pictures.restore(sim);
        wake();
    });

    // Test hook, dev only: lets the acceptance script see the loop rest
    // without counting rAF ticks (which read 0 whenever the SDK is correctly
    // suspending the frame, and mislead).
    if (/[?&]dev=1/.test(location.search)) {
        window.__sandArt = { running: () => looping, sim, pickTool, pickTint, flushSave };
    }
}

boot().catch((e) => {
    console.error('sand-art: boot failed', e);
    els.status.textContent = 'Could not start: ' + (e && e.message || e);
});
