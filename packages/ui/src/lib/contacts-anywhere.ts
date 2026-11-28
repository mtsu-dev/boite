import { contactsShown } from './contacts-rail.svelte';
import type { Store } from './store.svelte';
import { workspace } from './workspace.svelte';

/**
 * Whether any listed machine has contacts on for its owner. Requests and
 * letters arrive on the machine that holds the contact, so their notices and
 * inbox rows follow every machine's switch, not only the one in view.
 */
export function contactsShownAnywhere(store: Store): boolean {
  return workspace.machinesOr(store).some(machine => contactsShown(machine.store));
}
