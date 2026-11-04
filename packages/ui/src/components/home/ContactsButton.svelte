<script lang="ts">
  import { ChevronRight, Users } from '@lucide/svelte';
  import { contactsShown } from '../../lib/contacts-rail.svelte';
  import { watchContacts } from '../../lib/contacts.svelte';
  import type { Store } from '../../lib/store.svelte';
  import { fill, strings } from '../../lib/strings';
  import { workspace } from '../../lib/workspace.svelte';

  /**
   * The phone's way to Contacts, now that the bottom bar keeps four places:
   * a button in the Bots page's header, or a row in Settings when bots are
   * off. Its badge counts what waits from contacts (requests to answer and
   * held messages) on every machine that shows them, as the bell's notice does.
   */
  let { store, variant = 'icon' }: { store: Store; variant?: 'icon' | 'row' } = $props();
  const watched = watchContacts(() => workspace.machinesOr(store).filter(machine => contactsShown(machine.store)));
  const waiting = $derived(watched().reduce((total, { machine, view }) => machine.store.connection !== 'ready' ? total
    : total + (view.state?.requests ?? []).filter(request => request.direction === 'in' && request.status === 'pending').length + (view.state?.mail?.length ?? 0), 0));
  const label = $derived(waiting ? `${strings.contacts.heading}, ${fill(strings.contacts.waiting, { count: String(waiting) })}` : strings.contacts.heading);
</script>

{#if variant === 'row'}
  <button type="button" class="ghost row" data-testid="mobile-settings-contacts" data-preload-view="home" aria-label={label} onclick={() => store.showHome()}>
    <span class="glyph"><Users size={20} /></span><span class="name ui-label">{strings.contacts.heading}</span>
    {#if waiting}<span class="badge" data-testid="mobile-contacts-waiting">{waiting > 99 ? '99+' : waiting}</span>{/if}
    <span class="glyph"><ChevronRight size={18} /></span>
  </button>
{:else}
  <button type="button" class="ghost icon contacts" data-testid="mobile-contacts" data-preload-view="home" aria-label={label} title={strings.contacts.heading} onclick={() => store.showHome()}>
    <Users size={20} />
    {#if waiting}<span class="badge" data-testid="mobile-contacts-waiting">{waiting > 99 ? '99+' : waiting}</span>{/if}
  </button>
{/if}

<style>
  .contacts { position: relative; flex: none; width: var(--touch-target); height: var(--touch-target); color: var(--color-foreground); }
  .contacts .badge { position: absolute; top: 4px; right: 2px; }
  .badge {
    min-width: 18px; height: 18px; padding: 0 5px; border-radius: var(--radius-full);
    background: var(--color-live); color: var(--color-accent-ink); box-shadow: 0 0 0 2px var(--color-background);
    font-size: 11px; font-weight: 700; line-height: 18px; text-align: center; font-variant-numeric: tabular-nums;
  }
  /* Drawn as a row of the Settings list it sits in (MobileSettings' `.row`), after the machine's own row. */
  .row { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 56px; height: auto; padding: 12px 16px; border-top: 1px solid var(--color-border); border-radius: 0; text-align: left; font-size: var(--text-base); font-weight: 500; color: var(--color-foreground); }
  .row .glyph { display: grid; place-items: center; flex: none; color: var(--color-muted-foreground); }
  .row .name { flex: 1; min-width: 0; }
  .row .badge { box-shadow: none; }
</style>
