import type { Store } from './store.svelte';

/**
 * Whether the desktop draws no list column at all: before the first project exists, on every machine shown, the
 * column would hold nothing but its head. Waits for each machine to answer, so a slow connection never hides a
 * list it is about to fill, and a draft (a chat with no folder) keeps it. A phone keeps its drawer.
 */
export function listAbsent(stores: readonly Pick<Store, 'connection' | 'projects' | 'draftEntries'>[], phone: boolean): boolean {
  return !phone && stores.length > 0
    && stores.every(store => store.connection === 'ready' && store.projects.length === 0 && store.draftEntries.length === 0);
}
