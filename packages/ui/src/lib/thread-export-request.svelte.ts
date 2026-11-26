import type { ThreadSummary } from '@boite/contracts';
import type { Store } from './store.svelte';

export const threadExport = $state<{ request: { store: Store; thread: ThreadSummary } | null }>({ request: null });

export function openThreadExport(store: Store, thread: ThreadSummary): void {
  threadExport.request = { store, thread };
}

export function closeThreadExport(): void {
  threadExport.request = null;
}
