/**
 * The way to the Contacts' screens: the page, the column, the rows, the
 * notices and the shared thread dialog, each a chunk fetched when it is
 * first drawn. The shared project rows and their dialog are deferred parts
 * (`lib/deferred-parts.ts`).
 *
 * What stays in the main chunk is small: the column's fold
 * (`contacts-rail.svelte.ts`), the remote chip and the ask row of a thread
 * (`contact-asks.ts`), the bots host (`operator.ts`).
 */
export const contactsParts = {
  HomePage: () => import('../components/home/HomePage.svelte'),
  ContactsRail: () => import('../components/home/ContactsRail.svelte'),
  ContactRows: () => import('../components/home/ContactRows.svelte'),
  ContactRequestNotice: () => import('../components/home/ContactRequestNotice.svelte'),
  ContactInboxRows: () => import('../components/home/ContactInboxRows.svelte'),
  SidebarContacts: () => import('../components/home/SidebarContacts.svelte'),
  SharedThreadDialog: () => import('../components/shared/SharedThreadDialog.svelte')
};
