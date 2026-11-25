import type { Store } from './store.svelte';
import { archivedFocus } from './archived-focus.svelte';
import { workspace } from './workspace.svelte';

/**
 * The machine whose archive Settings shows next: SettingsShell.svelte picks it
 * in its machine bar, then lets go. A project's menu names a machine other
 * than the window's.
 */
export const archivedMachine = $state<{ store: Store | null }>({ store: null });

/**
 * Opens the archive's card in Settings, General on a desktop and its own page
 * on a phone, on one project's threads or on every project's. Settings offers
 * another machine only while it answers and this user owns it
 * (SettingsShell.svelte's `choices`); otherwise the window moves to that
 * machine first, as a project's menu does, rather than show this one's archive.
 */
export async function openArchived(owner: Store, projectId: string | null = null): Promise<void> {
  const shown = workspace.active ?? owner;
  if (owner !== shown && !(owner.connection === 'ready' && owner.owner)) await workspace.select(owner);
  archivedFocus.store = projectId ? owner : null;
  archivedFocus.projectId = projectId;
  archivedMachine.store = owner;
  (workspace.active ?? owner).showSettings('general', 'archived');
}
