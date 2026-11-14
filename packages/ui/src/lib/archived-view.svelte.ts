import type { Store } from './store.svelte';
import { archivedFocus } from './archived-focus.svelte';

/**
 * The archive's place in the thread list: the list column turns to the
 * archived threads, with the way back in its first line (Sidebar.svelte). A
 * phone has no such column: there the archive is a page of its own.
 */
export const archivedView = $state({ open: false });

/** Opens the archive where this screen keeps it, on one project's threads or on every project's. */
export function openArchived(owner: Store, projectId: string | null = null): void {
  archivedFocus.store = projectId ? owner : null;
  archivedFocus.projectId = projectId;
  if (typeof matchMedia === 'function' && matchMedia('(max-width: 720px)').matches) owner.showSettings('general', 'archived');
  else archivedView.open = true;
}

export function closeArchived(): void {
  archivedView.open = false;
}
