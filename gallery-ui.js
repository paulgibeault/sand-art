/* gallery-ui.js — the list of jars.
 *
 * A sheet of cards, newest first: thumbnail, name, when it was last
 * touched. Tap a card to open it. Each card has rename, duplicate and
 * delete; the open jar is marked and cannot be deleted from under itself
 * without the app switching to an empty one (main.js decides that).
 *
 * Names are edited in place — the SDK has no prompt dialog (§7) and a jar's
 * name is not a question the launcher needs to ask for us. Deleting still
 * goes through Arcade.ui.confirm, the one dialog that should look the same
 * in every game.
 */

import { openSheet, el } from './sheet.js';

function when(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const sameYear = d.getFullYear() === new Date().getFullYear();
    return d.toLocaleDateString(undefined, sameYear ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' })
        + ' ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/**
 * Show the gallery. `actions` = { list(), open(id), fresh(), rename(id, name),
 * duplicate(id), remove(id) } — all async, all owned by main.js. Resolves
 * when the sheet closes.
 */
export function openGallerySheet({ openId, actions }) {
    return openSheet({
        label: 'Your jars',
        className: 'gallery',
        async build(body, close) {
            const list = el('ul', { class: 'jars', 'aria-label': 'Saved jars' });
            const empty = el('p', { class: 'sheet-hint', text: 'Nothing saved yet. The jar saves itself as you work.' });

            async function refresh() {
                const items = await actions.list();
                list.replaceChildren();
                empty.hidden = items.length > 0;
                for (const it of items) list.appendChild(card(it));
            }

            function card(it) {
                const isOpen = it.id === openId;
                const thumb = it.thumb
                    ? el('img', { class: 'thumb', src: it.thumb, alt: '' })
                    : el('div', { class: 'thumb blank', 'aria-hidden': 'true' });
                const name = el('button', { type: 'button', class: 'name', text: it.name || 'Untitled jar', title: 'Rename' });
                const meta = el('span', { class: 'meta', text: (isOpen ? 'Open now · ' : '') + when(it.updated) + (it.hasTemplate ? ' · picture' : '') });
                const open = el('button', { type: 'button', class: 'open', 'aria-label': 'Open ' + (it.name || 'jar'), onclick: async () => {
                    if (!isOpen) await actions.open(it.id);
                    close(true);
                } }, thumb);
                const dup = el('button', { type: 'button', class: 'ghost small', text: 'Duplicate', onclick: async () => { await actions.duplicate(it.id); refresh(); } });
                const del = el('button', { type: 'button', class: 'ghost small danger', text: 'Delete', onclick: async () => {
                    const sure = await Arcade.ui.confirm('Delete "' + (it.name || 'this jar') + '"? It is gone for good.', { okLabel: 'Delete', cancelLabel: 'Keep' });
                    if (!sure) return;
                    await actions.remove(it.id);
                    if (isOpen) openId = null;
                    refresh();
                } });
                const li = el('li', { class: 'jar-card' + (isOpen ? ' current' : '') },
                    open,
                    el('div', { class: 'about' }, name, meta, el('div', { class: 'row' }, dup, del)));

                // Rename in place: the name becomes a field until Enter,
                // blur or Escape; an emptied name falls back to "Untitled".
                name.addEventListener('click', () => {
                    const field = el('input', { type: 'text', class: 'name-field', value: it.name || '', maxlength: '60', 'aria-label': 'Jar name' });
                    let settled = false;
                    const finish = async (commit) => {
                        if (settled) return;
                        settled = true;
                        if (commit) {
                            const v = field.value.trim();
                            await actions.rename(it.id, v);
                            it.name = v;
                        }
                        name.textContent = it.name || 'Untitled jar';
                        field.replaceWith(name);
                        name.focus();
                    };
                    field.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter') { e.preventDefault(); finish(true); }
                        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
                    });
                    field.addEventListener('blur', () => finish(true));
                    name.replaceWith(field);
                    field.focus(); field.select();
                });
                return li;
            }

            const fresh = el('button', { type: 'button', class: 'primary', text: 'New jar', 'data-autofocus': '', onclick: async () => { await actions.fresh(); close(true); } });
            const done = el('button', { type: 'button', class: 'ghost', text: 'Close', onclick: () => close(null) });
            body.append(
                el('header', {}, el('h2', { text: 'Your jars' })),
                el('div', { class: 'jars-scroll' }, empty, list),
                el('footer', {}, done, fresh),
            );
            await refresh();
        },
    });
}
