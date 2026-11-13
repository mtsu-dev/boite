/**
 * The way to the Contacts' screens: the page, the column, the rows, the
 * notices and the shared thread dialog. The shared project rows and their
 * dialog are deferred parts (`lib/deferred-parts.ts`) and carry the same flag
 * there. The flag is written in full because a bundler folds nothing less
 * direct (`packages/contracts/src/experiments.ts`): in a build below the
 * Contacts' tag it is `false`, this is `null`, the imports are dropped and no
 * chunk holds these screens. From source and in tests it is not defined.
 *
 * What stays in every build is small and drawn whatever the switch says: the
 * column's fold (`contacts-rail.svelte.ts`), the remote chip and the ask row
 * of a thread (`contact-asks.ts`), the bots host (`operator.ts`).
 */
export const contactsParts = typeof __BOITE_HAS_CONTACTS__ === 'undefined' || __BOITE_HAS_CONTACTS__
  ? {
      HomePage: () => import('../components/home/HomePage.svelte'),
      ContactsRail: () => import('../components/home/ContactsRail.svelte'),
      ContactRows: () => import('../components/home/ContactRows.svelte'),
      ContactRequestNotice: () => import('../components/home/ContactRequestNotice.svelte'),
      ContactInboxRows: () => import('../components/home/ContactInboxRows.svelte'),
      SidebarContacts: () => import('../components/home/SidebarContacts.svelte'),
      SharedThreadDialog: () => import('../components/shared/SharedThreadDialog.svelte')
    }
  : null;
