/* history.js — undo, as a stack of grids.
 *
 * The grid is 60 KB and a stroke is the unit of intent, so undo is the
 * simplest thing that works: a snapshot of the grid before every stroke
 * (and before Empty), a stack of a couple of dozen, and one sim.load()
 * to go back. Redo keeps what undo removed until a new stroke forks the
 * timeline. Nothing is stored: undo is for the session, the gallery is
 * for keeps.
 *
 * Pure: bytes in, bytes out. main.js decides when to push and what to
 * do with what comes back.
 */

export const LIMIT = 24;                         // 24 × 60 KB, about 1.4 MB

export function createHistory({ limit = LIMIT } = {}) {
    let past = [];
    let future = [];
    return {
        // The grid as it was before something is about to change it.
        push(grid) {
            past.push(grid);
            if (past.length > limit) past.shift();
            future = [];
        },
        // Step back: hand over the previous grid, keeping `current` for redo.
        undo(current) {
            if (!past.length) return null;
            future.push(current);
            return past.pop();
        },
        redo(current) {
            if (!future.length) return null;
            past.push(current);
            return future.pop();
        },
        canUndo: () => past.length > 0,
        canRedo: () => future.length > 0,
        // A different jar: its past is not this one's.
        clear() { past = []; future = []; },
    };
}
