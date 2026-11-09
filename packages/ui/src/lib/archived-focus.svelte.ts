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
