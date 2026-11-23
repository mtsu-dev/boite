import { contactsOn, type Settings } from '@boite/contracts';

/*
 * The contacts column on the window's right edge: whether it is folded, kept
 * on this device. The column itself loads through `contacts-entry.ts`; the Contacts
 * side of the list column holds its fold (Sidebar.svelte).
 */

/**
 * The rail is available to the owner of a machine whose contacts are on
 * (`contacts` in its settings, off unless turned on). A paired device can send
 * a human reply from a shared conversation.
 */
export function contactsShown(store: { owner: boolean; settings: Pick<Settings, 'contacts'> | null }): boolean {
  return store.owner && contactsOn(store.settings ?? {});
}

/** The column's width; the right panel leaves it this much room. */
export const CONTACTS_RAIL_WIDTH = 240;
const FOLDED = 'boite.contacts-rail-folded';

/** Folded until the owner unfolds it: what waits is counted in Activity meanwhile. */
function readFolded(): boolean {
  try { return localStorage.getItem(FOLDED) !== '0'; } catch { return true; }
}

class ContactsRail {
  folded = $state(readFolded());

  /** Unfolded for this machine's owner; App draws it only on a desktop-wide window. */
  shown(store: Parameters<typeof contactsShown>[0]): boolean {
    return contactsShown(store) && !this.folded;
  }

  toggle(): void {
    this.folded = !this.folded;
    try { localStorage.setItem(FOLDED, this.folded ? '1' : '0'); } catch { /* A private window keeps it for the session. */ }
  }
}

export const contactsRail = new ContactsRail();
