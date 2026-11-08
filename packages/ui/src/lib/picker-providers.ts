import type { ProviderSummary } from '@boite/contracts';
import { connected } from './provider-setup';
import type { Choice, Store } from './store.svelte';

/**
 * The providers the model picker offers, in the order the core listed them:
 * those the user can run (a signed-in account, or the one the choice is on).
 * With nothing connected at all every offered provider shows, so the list is
 * never empty. Its rows and its search across providers read the same list.
 */
export function listedProviders(store: Store, choice: Choice | null): ProviderSummary[] {
  // A provider turned off is offered nowhere, the one an open thread sits on included.
  const offered = store.offeredProviders;
  const usable = offered.filter((entry) => connected(entry, store.accountsOf(entry.id)) || entry.id === choice?.providerId);
  return usable.some((entry) => connected(entry, store.accountsOf(entry.id))) ? usable : offered;
}
