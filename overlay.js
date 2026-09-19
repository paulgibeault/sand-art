/* overlay.js — the tool, drawn on the jar.
 *
 * The finger hides the tip, and the sticks are otherwise invisible, so
 * the tool is drawn where it acts: a rod from the rim of the jar down to
 * the tip for the sticks (how the real tool looks in a bottle, and it
 * shows which way a shove goes), a ring the size of the disc for every
 * disc tool, a bracket at the rim as wide as the stream for the pourers,
 * a crosshair for the funnel. Every shape is drawn twice, dark then
 * light, so it reads on any sand in either theme.
 *
 * Pure drawing: a 2D context, a shape from tools.js (cell units), the
 * cell it acts at, the view's source rectangle (template.js viewRect) and
 * the canvas size in. Nothing is read from the DOM, so the tests can hand
 * it a recording context.
 */

export const DARK = 'rgba(0, 0, 0, 0.55)';
export const LIGHT = 'rgba(255, 255, 255, 0.92)';

/**
 * Draw `shape` acting at grid cell (x, y). `rect` is what the canvas
 * shows of the grid; `vw`×`vh` the canvas in device pixels.
 */
export function drawTool(ctx, shape, x, y, rect, vw, vh) {
    if (!shape) return;
    const cs = vw / rect.w;                      // device pixels per cell
    const sx = (x + 0.5 - rect.x) * cs;
    const sy = (y + 0.5 - rect.y) * cs;
    const passes = [[DARK, 3], [LIGHT, 1.5]];
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const [colour, extra] of passes) {
        ctx.strokeStyle = colour;
        ctx.setLineDash(shape.dashed ? [cs, cs] : []);
        if (shape.kind === 'rod') {
            // The rod comes down from above the tip — from the rim when it
            // is in view — and ends at the top of the tip's disc.
            const tipR = (shape.r + 0.5) * cs;
            ctx.lineWidth = Math.max(1.5, shape.width * cs * 0.5) + extra - 1.5;
            ctx.beginPath();
            ctx.moveTo(sx, 0);
            ctx.lineTo(sx, sy - tipR);
            ctx.stroke();
            ctx.lineWidth = extra;
            ctx.beginPath();
            ctx.arc(sx, sy, tipR, 0, Math.PI * 2);
            ctx.stroke();
        } else if (shape.kind === 'ring') {
            ctx.lineWidth = extra;
            ctx.beginPath();
            if (shape.r > 0) {
                ctx.arc(sx, sy, (shape.r + 0.5) * cs, 0, Math.PI * 2);
            } else {
                // A single cell: a crosshair around it.
                const a = cs * 0.75, b = cs * 2;
                ctx.moveTo(sx - b, sy); ctx.lineTo(sx - a, sy);
                ctx.moveTo(sx + a, sy); ctx.lineTo(sx + b, sy);
                ctx.moveTo(sx, sy - b); ctx.lineTo(sx, sy - a);
                ctx.moveTo(sx, sy + a); ctx.lineTo(sx, sy + b);
            }
            ctx.stroke();
        } else if (shape.kind === 'rim') {
            // A bracket at the rim as wide as the stream, and a dotted
            // guide down to the finger. Off-screen rim (zoomed and panned
            // down): just the guide.
            const ry = (0 - rect.y) * cs;
            ctx.lineWidth = extra;
            ctx.beginPath();
            if (ry >= 0) {
                const half = (shape.spread + 0.5) * cs;
                ctx.moveTo(sx - half, ry + cs); ctx.lineTo(sx - half, ry);
                ctx.lineTo(sx + half, ry); ctx.lineTo(sx + half, ry + cs);
            }
            ctx.stroke();
            ctx.setLineDash([cs * 0.5, cs * 1.5]);
            ctx.beginPath();
            ctx.moveTo(sx, Math.max(0, ry + cs * 1.5));
            ctx.lineTo(sx, sy);
            ctx.stroke();
        }
    }
    ctx.restore();
}

/**
 * The tilt drag: a dot where the finger landed (the reference point), a line
 * to where it is now, and an arrowhead along the lean the jar actually took
 * (which snaps near an axis and may hold at 45°) — so the arrow is gravity.
 * `drag` is { x0, y0, x, y, moved } in cells; `lean` degrees from straight
 * down, + to the right.
 */
export function drawTilt(ctx, drag, lean, rect, vw, vh) {
    const cs = vw / rect.w;
    const px = (x) => (x + 0.5 - rect.x) * cs, py = (y) => (y + 0.5 - rect.y) * cs;
    const x0 = px(drag.x0), y0 = py(drag.y0);
    const len = Math.max(6 * cs, Math.hypot(px(drag.x) - x0, py(drag.y) - y0));
    const a = lean * Math.PI / 180;
    const x1 = x0 + Math.sin(a) * len, y1 = y0 + Math.cos(a) * len;
    const head = Math.max(8, 3 * cs);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const [colour, width] of [[DARK, 5], [LIGHT, 2.5]]) {
        ctx.strokeStyle = colour; ctx.fillStyle = colour; ctx.lineWidth = width;
        ctx.beginPath(); ctx.arc(x0, y0, Math.max(3, cs), 0, Math.PI * 2); ctx.stroke();
        if (drag.moved) {
            ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x1 - Math.sin(a - 0.45) * head, y1 - Math.cos(a - 0.45) * head);
            ctx.moveTo(x1, y1);
            ctx.lineTo(x1 - Math.sin(a + 0.45) * head, y1 - Math.cos(a + 0.45) * head);
            ctx.stroke();
        }
    }
    ctx.restore();
}
