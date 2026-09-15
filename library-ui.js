/* library-ui.js — the Library: where the tools come from.
 *
 * A sheet of influences, one entry per tradition Sand Art borrows from.
 * The index is a list of cards; an entry is a write-up with a sample jar
 * made in that style, the tools it inspired, and where to read more. The
 * text is data (library.json), so an entry can be corrected without
 * touching this file; this file only lays it out.
 *
 * Two things a player can do from an entry. "Try this jar" copies the
 * shipped sample into the gallery as a jar of their own and opens it —
 * main.js does the copying, so the sample itself is never changed. A tool
 * chip picks that tool up and closes the sheet, so the hint under the top
 * bar says what it does.
 *
 * Sources are links. Standalone they open in a new tab; inside the
 * launcher a game frame cannot open windows (GAME_INTEGRATION §9), so
 * there a tap copies the address to the clipboard and says so.
 */

import { openSheet, el } from './sheet.js';

/**
 * Show the Library. `library` is library.json's object; `actions` =
 * { tryJar(entry) → Promise<boolean>, pickTool(id), toolLabel(id) → string }.
 * `framed` says whether links can open at all. Resolves when the sheet
 * closes.
 */
export function openLibrarySheet({ library, actions, framed = false }) {
    const entries = Array.isArray(library.entries) ? library.entries : [];
    return openSheet({
        label: 'Library',
        className: 'library',
        build(body, close) {
            const jarPic = (entry, cls) => entry.image && entry.image.src
                ? el('img', { class: 'jar-pic ' + cls, src: entry.image.src, alt: entry.image.alt || '' })
                : null;

            function showIndex(focusId) {
                const list = el('ul', { class: 'influences', 'aria-label': 'Influences' });
                let focus = null;
                for (const entry of entries) {
                    const card = el('button', { type: 'button', class: 'influence', onclick: () => showEntry(entry) },
                        jarPic(entry, 'small') || el('span', { class: 'jar-pic small blank', 'aria-hidden': 'true' }),
                        el('span', { class: 'about' },
                            el('span', { class: 'name', text: entry.title }),
                            el('span', { class: 'meta', text: [entry.place, entry.period].filter(Boolean).join(' · ') }),
                            el('span', { class: 'lead', text: entry.lead || '' })));
                    if (entry.id === focusId) focus = card;
                    list.appendChild(el('li', {}, card));
                }
                body.replaceChildren(
                    el('header', {}, el('h2', { text: 'Library' }), el('p', { class: 'sheet-hint', text: library.about || '' })),
                    el('div', { class: 'library-scroll' }, list),
                    el('footer', {}, el('button', { type: 'button', class: 'ghost', text: 'Close', onclick: () => close(null) })),
                );
                (focus || body.querySelector('button')).focus();
            }

            function showEntry(entry) {
                const back = el('button', { type: 'button', class: 'ghost small', text: 'Library', 'aria-label': 'Back to the Library', onclick: () => showIndex(entry.id) });
                const pic = jarPic(entry, 'large');
                const figure = pic ? el('figure', {}, pic,
                    el('figcaption', {}, el('span', { class: 'lead', text: entry.lead || '' }), el('span', { class: 'meta', text: entry.image.caption || '' })))
                    : el('p', { class: 'lead', text: entry.lead || '' });
                const paragraphs = (entry.body || []).map((t) => el('p', { text: t }));

                // The tools it inspired: a tap picks one up.
                const chips = el('div', { class: 'chips', role: 'group', 'aria-label': 'Tools it inspired' });
                for (const id of entry.tools || []) {
                    chips.appendChild(el('button', { type: 'button', class: 'chip', text: actions.toolLabel(id), onclick: () => { actions.pickTool(id); close(true); } }));
                }
                const tools = chips.childElementCount
                    ? el('div', { class: 'took' }, el('h3', { text: 'Made with' }), chips, el('p', { class: 'sheet-hint', text: 'Tap a tool to pick it up.' }))
                    : null;

                const sources = el('ul', { class: 'sources' });
                for (const src of entry.sources || []) {
                    const a = el('a', { href: src.url, target: '_blank', rel: 'noopener', text: src.title || src.url });
                    if (framed) {
                        a.addEventListener('click', async (e) => {
                            e.preventDefault();
                            const ok = await Arcade.ui.copy(src.url);
                            Arcade.ui.toast(ok ? 'Link copied. Paste it in your browser.' : src.url, { kind: 'info', duration: 4000 });
                        });
                    }
                    sources.appendChild(el('li', {}, a));
                }
                const reading = sources.childElementCount ? el('div', { class: 'reading' }, el('h3', { text: 'Read more' }), sources) : null;

                const done = el('button', { type: 'button', class: 'ghost', text: 'Close', onclick: () => close(null) });
                const tryIt = entry.jar ? el('button', { type: 'button', class: 'primary', text: 'Try this jar', onclick: async () => {
                    tryIt.disabled = true;
                    const ok = await actions.tryJar(entry);
                    if (ok) close(true); else tryIt.disabled = false;
                } }) : null;

                body.replaceChildren(
                    el('header', {}, back,
                        el('div', { class: 'titles' }, el('h2', { text: entry.title }),
                            el('p', { class: 'meta', text: [entry.place, entry.period].filter(Boolean).join(' · ') }))),
                    el('div', { class: 'library-scroll' }, el('article', {}, figure, ...paragraphs, tools, reading)),
                    el('footer', {}, done, tryIt),
                );
                back.focus();
            }

            showIndex();
        },
    });
}
