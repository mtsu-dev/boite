import type { Store } from './store.svelte';

/**
 * The thread whose "Communication between conversations" dialog is open. The
 * panel selector asks for it; the thread header, which knows the thread on
 * screen, draws it. The store goes with the id: ids can collide between machines.
 */
export const coordinationRequest = $state<{ store: Store | null; threadId: string | null }>({ store: null, threadId: null });

export function openCoordination(store: Store, threadId: string): void {
  coordinationRequest.store = store;
  coordinationRequest.threadId = threadId;
}

export function closeCoordination(): void {
  coordinationRequest.store = null;
  coordinationRequest.threadId = null;
}
