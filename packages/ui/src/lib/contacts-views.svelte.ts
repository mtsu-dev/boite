/*
 * The Contacts page and the contacts column on the right, as App draws them.
 * Each loads once something shows it, so the boot bundle carries neither.
 */

import { untrack } from 'svelte';
import { contactsRail, contactsShown } from './contacts-rail.svelte';
import { homePage as lazyHomePage, contactsRail as lazyContactsRail } from './navigation-views';
import { groupLoading, operatorHost, operatorOnOpen } from './operator';
import { strings } from './strings';
import type { Store } from './store.svelte';

export { contactsShown };

/**
 * Loads the page while a machine shows it and the column on a desktop-wide
 * window, gives the group its Operator the first time either opens
 * (`operatorOnOpen`), and sends a machine whose contacts went away
 * from their page back to the chat. Call it while the component
 * starts: its effects live as long as the component.
 */
export function contactsViews(current: () => Store, machines: () => readonly { store: Store }[], narrow: () => boolean) {
  let homeError = $state('');
  $effect(() => {
    if (!lazyHomePage || current().page !== 'home' || !contactsShown(current()) || lazyHomePage.current) return;
    homeError = '';
    void lazyHomePage.load().catch(() => { homeError = strings.contacts.loadFailed; });
  });
  $effect(() => {
    if (!lazyContactsRail || !contactsShown(current()) || narrow() || lazyContactsRail.current) return;
    void lazyContactsRail.load().catch(() => undefined);
  });
  // Waits for the group's answer, which names the machine that holds the
  // Operator, and follows that machine: reached again while Contacts stay
  // open, it gets the Operator then.
  $effect(() => {
    const store = current();
    const open = contactsShown(store) && (store.page === 'home' || (contactsRail.shown(store) && !narrow()));
    if (!open || store.connection !== 'ready' || !store.groupKnown) return;
    const stores = machines().map(machine => machine.store);
    // A machine whose group is still loading may hold the Operator: wait for it, then ask.
    if (groupLoading(store, stores)) return;
    const host = operatorHost(store, stores);
    if (host && contactsShown(host)) untrack(() => operatorOnOpen(store, stores));
  });
  $effect(() => {
    for (const machine of machines()) if (machine.store.page === 'home' && !contactsShown(machine.store)) machine.store.showChat();
    const store = current();
    if (store.page === 'home' && !contactsShown(store)) store.showChat();
  });
  return {
    get HomePage() { return lazyHomePage?.current; },
    get ContactsRail() { return lazyContactsRail?.current; },
    get homeError() { return homeError; }
  };
}
