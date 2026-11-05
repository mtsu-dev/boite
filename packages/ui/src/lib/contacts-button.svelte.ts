import { untrack } from 'svelte';

/**
 * How many Contacts buttons with a count are on screen (the phone Bots
 * header's). The contact notice draws its own button only while none is, so a
 * header never shows two Contacts buttons with the same count.
 */
export const contactsButtons = $state({ shown: 0 });

/** Registers one shown button; the returned function takes it back. */
export function showContactsButton(): () => void {
  // Called from an effect: the count it bumps must not become that effect's dependency.
  untrack(() => { contactsButtons.shown += 1; });
  return () => untrack(() => { contactsButtons.shown -= 1; });
}
