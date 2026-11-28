import type { Store } from './store.svelte';

/**
 * The project Settings' archive was opened for, from its card's menu: the list shows that project's threads until
 * the user asks for every project, or the archive closes.
 */
export const archivedFocus = $state<{ store: Store | null; projectId: string | null }>({ store: null, projectId: null });

export function clearArchivedFocus(): void {
  archivedFocus.store = null;
  archivedFocus.projectId = null;
}

const cards = new Map<Store, number>();

/**
 * Called by each archive card as it mounts; the returned function, as it goes. Once no card shows the machine's
 * archive, Settings closed or moved off it, the next opening shows every project again. The check waits a microtask:
 * a window crossing the phone width swaps one layout's card for the other's in the same update.
 */
export function holdArchivedFocus(store: Store): () => void {
  cards.set(store, (cards.get(store) ?? 0) + 1);
  return () => {
    const left = (cards.get(store) ?? 1) - 1;
    if (left) cards.set(store, left);
    else cards.delete(store);
    queueMicrotask(() => { if (!cards.has(store) && archivedFocus.store === store) clearArchivedFocus(); });
  };
}
