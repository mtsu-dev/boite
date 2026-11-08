<script lang="ts">
  import type { Snippet } from 'svelte';
  import { ChevronLeft } from '@lucide/svelte';
  import type { Store } from '../../lib/store.svelte';
  import { strings } from '../../lib/strings';
  import { experimentOn } from '../../lib/experiments.svelte';
  import { contactsShown } from '../../lib/contacts-rail.svelte';
  import { inbox } from '../../lib/inbox.svelte';
  import { workspace } from '../../lib/workspace.svelte';
  import ViewSwitch from '../ViewSwitch.svelte';

  /**
   * The head of a list column that took the threads' place on a desktop: the
   * Bots column, or its other side, Contacts, as the phone's title switches
   * them. Its title leads back to the threads: one press on the name when
   * there is one side, the arrow before the switch when there are two.
   */
  let { store, current, actions }: { store: Store; current: 'agents' | 'home'; actions?: Snippet } = $props();

  const two = $derived(experimentOn('resident-agents') && contactsShown(store));
  const title = $derived(current === 'home' ? strings.contacts.heading : strings.agents.heading);
  function back() {
    inbox.open = false;
    store.showChat();
    store.sidebarCollapsed = false;
  }
  function pick(id: string) {
    if (id === 'home') store.showHome();
    else workspace.showAgents(store);
  }
</script>

<div class="side-head" data-testid="side-head">
  {#if two}
    <button type="button" class="ghost icon small back" title={strings.settings.back} aria-label={strings.settings.back} data-testid="side-back" onclick={back}><ChevronLeft size={16} /></button>
    <h2 class="title"><ViewSwitch label={strings.agents.heading} {current} onpick={pick}
      options={[{ id: 'agents', label: strings.agents.heading, testid: 'side-bots', preload: 'agents' }, { id: 'home', label: strings.contacts.heading, testid: 'side-contacts', preload: 'home' }]} testid="side-switch" /></h2>
  {:else}
    <h2 class="title"><button type="button" class="ghost back-title" title={strings.settings.back} data-testid="side-back" onclick={back}>
      <ChevronLeft size={16} aria-hidden="true" /><span class="ui-label">{title}</span></button></h2>
  {/if}
  {#if actions}<div class="actions">{@render actions()}</div>{/if}
</div>

<style>
  /* The thread list's head, measure for measure (ProjectViews.svelte): swapping lists moves nothing above the rows. */
  .side-head { display: flex; align-items: center; gap: 2px; min-width: 0; height: 36px; margin-top: 10px; padding: 0; }
  .title { display: flex; flex: 1; min-width: 0; margin: 0; font-size: 15px; font-weight: 650; letter-spacing: -0.015em; color: var(--color-foreground); }
  .back, .back-title { color: var(--color-subtle); }
  .back { flex: none; width: 28px; height: 28px; border-radius: var(--radius-md); }
  .back:hover:not(:disabled), .back-title:hover:not(:disabled) { color: var(--color-foreground); }
  .back-title { display: inline-flex; align-items: center; gap: 2px; min-width: 0; height: 28px; padding: 0 6px 0 2px; border-radius: var(--radius-md); font: inherit; letter-spacing: inherit; }
  .back-title .ui-label { color: var(--color-foreground); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .actions { display: flex; align-items: center; gap: 4px; flex: none; }
  .actions :global(button.icon) { flex: none; width: 28px; height: 28px; border-radius: var(--radius-md); color: var(--color-subtle); }
  .actions :global(button.icon:hover) { color: var(--color-foreground); }
</style>
