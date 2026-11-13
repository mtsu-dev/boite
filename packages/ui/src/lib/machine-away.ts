import type { Store } from './store.svelte';

/**
 * The machine behind a Store is out of reach past its first hello (closed, or
 * trying again after it answered once): nothing it runs can be heard or
 * stopped from here, so the transcript shows its last known state, still, and
 * offers no Stop. The composer's offline notice reads the same condition.
 */
export function machineAway(store: Pick<Store, 'connection' | 'booted'>): boolean {
  return store.connection !== 'ready' && (store.connection === 'closed' || store.booted);
}

/** When a thread last heard from its machine, on the core's clock: its last change or its turn's last activity. */
export function lastHeard(thread: { updatedAt: number; progress?: { at: number } | null } | null | undefined): number | null {
  if (!thread) return null;
  return Math.max(thread.updatedAt, thread.progress?.at ?? 0);
}
