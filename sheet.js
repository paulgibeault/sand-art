/* sheet.js — a modal panel the app draws itself.
 *
 * The launcher renders confirm dialogs for us (Arcade.ui.confirm), but a
 * list of jars or a photo crop is content, not a question, and the game
 * owns its own DOM, so these are plain in-page panels: a backdrop, a body,
 * Escape and the backdrop to close, focus moved in and given back after.
 */

export function openSheet({ label, className = '', build }) {
    return new Promise((resolve) => {
        const prev = document.activeElement;
        const root = document.createElement('div');
        root.className = 'sheet ' + className;
        root.setAttribute('role', 'dialog');
        root.setAttribute('aria-modal', 'true');
        root.setAttribute('aria-label', label);
        const body = document.createElement('div');
        body.className = 'sheet-body';
        root.appendChild(body);

        let done = false;
        const close = (value) => {
            if (done) return;
            done = true;
            document.removeEventListener('keydown', onKey, true);
            root.remove();
            if (prev && typeof prev.focus === 'function') prev.focus();
            resolve(value === undefined ? null : value);
        };
        const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(null); } };
        document.addEventListener('keydown', onKey, true);
        root.addEventListener('pointerdown', (e) => { if (e.target === root) close(null); });

        build(body, close);
        document.body.appendChild(root);
        const first = body.querySelector('[data-autofocus], button, input, [tabindex]');
        if (first) first.focus();
    });
}

export function el(tag, attrs = {}, ...children) {
    const n = document.createElement(tag);
    for (const k in attrs) {
        const v = attrs[k];
        if (k === 'class') n.className = v;
        else if (k === 'text') n.textContent = v;
        else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
        else if (v !== null && v !== undefined) n.setAttribute(k, v);
    }
    for (const c of children) if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    return n;
}
