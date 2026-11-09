import type { Store } from './store.svelte';

interface Box { store: Store; key: string; queued: number; sendNow: string | null; busy: boolean }

/**
 * A message sent while a permission waits declines and redirects (the
 * composer's placeholder says so): the message joins the queue, the thread's
 * waiting permissions are denied, and once the turn runs again the queue's
 * Send now stops it and sends the message as the next turn. When the turn
 * ends on its own first, the queue sends the message as it always does. Call
 * it while the composer starts; it returns what to call once the message is
 * queued.
 */
export function permissionRedirect(box: () => Box, sendQueuedNow: () => void): (store: Store, key: string) => Promise<void> {
  let held = $state.raw<{ store: Store; key: string } | null>(null);
  $effect(() => {
    if (!held) return;
    const now = box();
    if (held.store !== now.store || held.key !== now.key || !now.queued) { held = null; return; }
    if (now.sendNow === 'steer') { held = null; sendQueuedNow(); }
    else if (!now.busy) held = null;
  });
  return async (store, key) => {
    const asks = store.pendingPermissions.filter((request) => request.threadId === key);
    const denied = await Promise.all(asks.map((request) => store.answer(request.id, 'deny')));
    if (denied.some(Boolean)) held = { store, key };
  };
}
