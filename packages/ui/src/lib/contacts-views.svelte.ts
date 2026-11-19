/*
 * The Contacts page and the contacts column on the right, as App draws them.
 * Each loads once something shows it, so the boot bundle carries neither.
 */

import { untrack } from 'svelte';
import { contactsRail, contactsShown } from './contacts-rail.svelte';
import { contactsParts } from './contacts-entry';
import { operatorOnOpen } from './operator';
import { strings } from './strings';
import type { Store } from './store.svelte';

export { contactsShown };

/**
 * Loads the page while a machine shows it and the column on a desktop-wide
 * window, gives the group its Operator the first time either opens
 * (`operatorOnOpen`), and sends a machine whose contacts went away (a paired
 * device) from their page back to the chat. Call it while the component
 * starts: its effects live as long as the component.
 */
export function contactsViews(current: () => Store, machines: () => readonly { store: Store }[], narrow: () => boolean) {
  const views = $state<{
    HomePage?: typeof import('../components/home/HomePage.svelte').default;
    ContactsRail?: typeof import('../components/home/ContactsRail.svelte').default;
    homeError: string;
  }>({ homeError: '' });
  $effect(() => {
    if (current().page !== 'home' || !contactsShown(current()) || views.HomePage) return;
    void contactsParts?.HomePage().then(module => { views.HomePage = module.default; })
      .catch(() => { views.homeError = strings.contacts.loadFailed; });
  });
  $effect(() => {
    if (!contactsShown(current()) || narrow() || views.ContactsRail) return;
    void contactsParts?.ContactsRail().then(module => { views.ContactsRail = module.default; }).catch(() => {});
  });
  $effect(() => {
    const store = current();
    const open = contactsShown(store) && (store.page === 'home' || (contactsRail.shown(store) && !narrow()));
    if (open && store.connection === 'ready') untrack(() => operatorOnOpen(store, machines().map(machine => machine.store)));
  });
  $effect(() => {
    for (const machine of machines()) if (machine.store.page === 'home' && !contactsShown(machine.store)) machine.store.showChat();
    const store = current();
    if (store.page === 'home' && !contactsShown(store)) store.showChat();
  });
  return views;
}
