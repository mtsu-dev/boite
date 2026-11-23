import { tick } from 'svelte';
import { DEFAULT_THREAD_DELETION_RETENTION_DAYS, type ThreadSummary } from '@boite/contracts';
import { archiveThread } from './archive';
import { confirm } from './confirm.svelte';
import { focusComposer } from './focus';
import { fill, strings } from './strings';
import type { Store } from './store.svelte';
import { undo } from './undo.svelte';
import { workspace } from './workspace.svelte';

export function canDeleteThread(thread: ThreadSummary): boolean {
  return !thread.parentThreadId && !thread.agentSessionId;
}

/** Explain the owning machine's retention before moving a conversation to Trash. */
export async function deleteThread(store: Store, thread: ThreadSummary): Promise<boolean> {
  if (!canDeleteThread(thread)) return false;
  if (!thread.incognito) {
    const generation = store.clientGeneration;
    let settings = store.settings;
    if (!settings && store.client) {
      try { settings = await store.client.call('settings.get', {}); }
      catch (error) {
        if (store.clientGeneration === generation) store.error = error instanceof Error ? error.message : String(error);
        return false;
      }
    }
    if (store.clientGeneration !== generation) return false;
    // Offline before the settings arrived: the retention is unknown, so say why nothing was deleted.
    if (!settings) { store.error = strings.connection.unavailable; return false; }
    const days = settings.threadDeletionRetentionDays ?? DEFAULT_THREAD_DELETION_RETENTION_DAYS;
    const s = strings.sidebar;
    const choice = await confirm.choose({
      title: fill(s.deleteThreadTitle, { title: thread.title }),
      body: days === 0 ? s.deleteThreadForever : days === 1 ? s.deleteThreadDay : fill(s.deleteThreadDays, { count: String(days) }),
      confirmLabel: strings.common.delete, cancelLabel: strings.common.cancel, danger: true,
      ...(thread.archived ? {} : { altLabel: s.archive }),
    });
    if (store.clientGeneration !== generation) return false;
    if (choice === 'alt') { await archiveThread(store, thread.id); return false; }
    if (choice !== 'confirm') return false;
  }
  if (!(await store.removeThread(thread.id))) return false;
  // An incognito conversation is erased by the core: there is nothing to bring back.
  if (thread.incognito) { await tick(); focusComposer(); return true; }
  undo.offer(fill(strings.sidebar.deletedToast, { title: thread.title }), async () => {
    if (!(await store.restoreDeletedThread(thread.id))) throw new Error(store.error ?? strings.connection.unavailable);
    await workspace.select(store, thread.id);
  }, { session: store.core ? { store, startedAt: store.core.startedAt } : undefined });
  await tick();
  focusComposer();
  return true;
}
