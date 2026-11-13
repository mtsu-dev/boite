<script lang="ts">
  import { markFeature } from '@boite/contracts';
  import { UserPlus } from '@lucide/svelte';
  import { contactRows, initialsOf, openContact, watchContacts } from '../../lib/contacts.svelte';
  import { count } from '../../lib/format';
  import { fill, strings } from '../../lib/strings';
  import type { Store } from '../../lib/store.svelte';
  import { workspace } from '../../lib/workspace.svelte';

  /**
   * One row per contact of every listed machine, a contact several machines
   * of a group hold listed once, with its link and what it asks; a row opens
   * the contact's page in the main card. The right column and the Contacts
   * side of the list column both draw them.
   */
  let { store }: { store: Store } = $props();
  const labels = $derived(strings.contacts);
  const machines = $derived(workspace.machinesOr(store));
  const watched = watchContacts(() => machines);
  const rows = $derived(contactRows(watched()));
  const show = (owner: Store, coreId: string | null) => void openContact(owner, coreId);
  // Marks this module in a bundle: a call no bundler drops (scripts/ci/feature-cut.ts).
  markFeature('boite-feature:contacts');
</script>

  <!-- A row stands for every copy of its contact in the group: it is current on any of them. -->
  {#each rows as { machine, contact, waiting: asks } (`${machine.id}:${contact.coreId}`)}
    {@const current = (machine.store === workspace.active || (!!machine.store.group && machine.store.group.id === workspace.active.group?.id)) && store.page === 'home' && store.contact === contact.coreId}
    <button type="button" class="ghost row" class:current aria-current={current ? 'page' : undefined} data-link={contact.link}
      onclick={() => show(machine.store, contact.coreId)} data-testid="rail-contact" data-core-id={contact.coreId}>
      <span class="avatar" aria-hidden="true">{initialsOf(contact.name)}<span class="dot"></span></span>
      <span class="text">
        <span class="name">{contact.name}</span>
        {#if asks}<span class="state asks">{fill(labels.waiting, { count: count(asks) })}</span>
        {:else}<span class="state">{labels.link[contact.link]}</span>{/if}
      </span>
    </button>
  {:else}
    <button type="button" class="ghost row empty" onclick={() => show(store, null)} data-testid="contacts-rail-empty">
      <span class="avatar add" aria-hidden="true"><UserPlus size={14} /></span>
      <span class="text"><span class="name">{labels.add}</span><span class="state">{labels.tip}</span></span>
    </button>
  {/each}

<style>
  /* A button is one control tall by default: a row grows with its two lines, the empty row with its wrapped tip. */
  .row { --tone: var(--color-subtle); display: flex; flex: none; align-items: center; justify-content: flex-start; gap: 10px; width: 100%; height: auto; min-height: 44px; padding: 4px 10px; border-radius: var(--radius-md); background: transparent; text-align: left; }
  .row:hover:not(:disabled) { background: var(--color-hover); }
  .row:active:not(:disabled) { transform: none; }
  .row.current { background: var(--color-active); }
  .row[data-link='connected'] { --tone: var(--color-success); }
  .row[data-link='connecting'] { --tone: var(--color-muted-foreground); }
  .avatar { position: relative; display: grid; flex: none; place-items: center; width: 30px; height: 30px; border-radius: 50%; background: var(--color-active); color: var(--color-foreground); font-size: var(--text-xs); font-weight: 700; letter-spacing: 0.02em; }
  .avatar.add { background: var(--color-surface-2); color: var(--color-muted-foreground); }
  .dot { position: absolute; right: -1px; bottom: -1px; width: 9px; height: 9px; border-radius: 50%; background: var(--tone); box-shadow: 0 0 0 2px var(--color-frame); }
  .text { display: flex; flex: 1; flex-direction: column; min-width: 0; line-height: 1.25; }
  .name, .state { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .name { color: var(--color-foreground); font-size: var(--text-sm); font-weight: 500; }
  .state { color: var(--color-subtle); font-size: var(--text-xs); }
  .state.asks { color: var(--color-muted-foreground); font-weight: 500; }
  .empty .state { white-space: normal; }
</style>
