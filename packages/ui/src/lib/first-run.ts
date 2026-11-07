import type { Store } from './store.svelte';
import { LazyComponent } from './lazy-component.svelte';

/**
 * A machine with no AI to start a thread on: the providers are read and none
 * offers a signed-in account. The draft then shows one action, Connect an AI,
 * and the tour waits until there is something to show (App.svelte).
 */
export function needsAnAI(store: Store): boolean {
  return store.connection === 'ready' && store.providers.length > 0 && store.defaultChoice() === null;
}

/** The screen is seen once per machine at most: its own chunk, fetched when drawn and never prefetched. */
export const firstRunScreen = new LazyComponent(() => import('../components/FirstRun.svelte'));
