<script lang="ts">
  import { onMount } from 'svelte';
  import { House, UserPlus } from '@lucide/svelte';
  import { openContact } from '../../lib/contacts.svelte';
  import { contactsRail } from '../../lib/contacts-rail.svelte';
  import { strings } from '../../lib/strings';
  import type { Store } from '../../lib/store.svelte';
  import ContactRows from './ContactRows.svelte';

  /**
   * The contacts on the window's right edge, the projects keeping the left
   * one (ContactRows.svelte). The title opens the Contacts page (requests,
   * adding one, Tailscale) and Add the same page. The Contacts side of the
   * list column folds it (Sidebar.svelte); App.svelte leaves it out while that
   * side is open, which lists the same rows. It slides in when unfolded, not each
   * time it is drawn: a column open at startup is simply there.
   */
  let { store }: { store: Store } = $props();
  const labels = $derived(strings.contacts);
  const show = (coreId: string | null) => void openContact(store, coreId);
  const folded = $derived(contactsRail.folded);

  // Two frames: the first style the column gets is without `drawn`, so it starts in place.
  let drawn = $state(false);
  onMount(() => {
    let frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => { drawn = true; }); });
    return () => cancelAnimationFrame(frame);
  });
</script>

<aside class="contacts-rail" class:collapsed={folded} class:drawn inert={folded} aria-label={labels.heading} data-testid="contacts-rail">
  <div class="head">
    <button type="button" class="ghost home" title={labels.rail.home}
      onclick={() => show(null)} data-testid="contacts-rail-home"><House size={15} /><span class="title ui-label">{labels.heading}</span></button>
    <button type="button" class="ghost icon" title={labels.add} aria-label={labels.add}
      onclick={() => show(null)} data-testid="contacts-rail-add"><UserPlus size={16} /></button>
  </div>
  <div class="scroll">
    <ContactRows {store} />
  </div>
</aside>

<style>
  /* The thread list's twin on the other edge: it stands on the frame, no card,
     and folds by sliding out past the window's right edge. */
  .contacts-rail {
    --rail-width: 240px;
    --slide-room: calc(var(--rail-width) + var(--frame-gap));
    display: flex;
    flex: none;
    flex-direction: column;
    width: var(--rail-width);
    min-height: 0;
    margin-right: calc(-1 * var(--frame-gap));
    transition: margin-right var(--motion-duration) var(--motion-curve), opacity var(--dur-3) var(--ease-out-quint), display var(--motion-duration) allow-discrete;
  }
  .contacts-rail.collapsed {
    display: none;
    pointer-events: none;
    opacity: 0;
    margin-right: calc(-1 * var(--slide-room));
    transition: margin-right var(--motion-duration) var(--motion-curve), opacity var(--dur-2) var(--ease-out-quint), display var(--motion-duration) allow-discrete;
  }
  @starting-style { .contacts-rail.drawn:not(.collapsed) { opacity: 0; margin-right: calc(-1 * var(--slide-room)); } }
  .head { display: flex; align-items: center; gap: 6px; height: var(--control-lg); margin: 0 10px 0 6px; }
  .home { flex: 1; min-width: 0; justify-content: flex-start; gap: 8px; padding: 0 10px; color: var(--color-muted-foreground); }
  .home:hover:not(:disabled) { color: var(--color-foreground); }
  .title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--text-sm); font-weight: 600; }
  .head button { flex: none; }
  .head .home { flex: 1; }
  .scroll { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 2px; padding: 6px 10px 10px 6px; }
  @media (prefers-reduced-motion: reduce) { .contacts-rail, .contacts-rail.collapsed { transition: none; } }
  :global(html[data-motion='reduced']) .contacts-rail, :global(html[data-motion='reduced']) .contacts-rail.collapsed { transition: none; }
</style>
