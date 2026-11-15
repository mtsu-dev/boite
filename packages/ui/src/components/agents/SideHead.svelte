<script lang="ts">
  import type { Snippet } from 'svelte';
  import { ChevronLeft } from '@lucide/svelte';
  import type { Store } from '../../lib/store.svelte';
  import { strings } from '../../lib/strings';
  import { inbox } from '../../lib/inbox.svelte';

  /**
   * The head of a list column that took the threads' place on a desktop: the
   * Bots column or the Contacts one, each reached from its own place in the
   * app rail. Its title leads back to the threads with one press on the name.
   */
  let { store, current, actions }: { store: Store; current: 'agents' | 'home'; actions?: Snippet } = $props();

  const title = $derived(current === 'home' ? strings.contacts.heading : strings.agents.heading);
  function back() {
    inbox.open = false;
    store.showChat();
    store.sidebarCollapsed = false;
  }
</script>

<div class="side-head" data-testid="side-head">
    <h2 class="title"><button type="button" class="ghost back-title" title={strings.settings.back} data-testid="side-back" onclick={back}>
      <ChevronLeft size={16} aria-hidden="true" /><span class="ui-label">{title}</span></button></h2>
  {#if actions}<div class="actions">{@render actions()}</div>{/if}
</div>

<style>
  /* The thread list's head, measure for measure (ProjectViews.svelte): swapping lists moves nothing above the rows. */
  .side-head { display: flex; align-items: center; gap: 4px; min-width: 0; height: 36px; margin-top: 10px; padding: 0; }
  .title { display: flex; flex: 1; min-width: 0; margin: 0; font-size: 15px; font-weight: 650; letter-spacing: -0.015em; color: var(--color-foreground); }
  /* 32 px targets, as the thread list's head (ProjectViews.svelte): the icon buttons are app.css's, their box as
     large as their target. */
  .actions :global(button.icon-button) { flex: none; margin: calc((var(--icon-button-target) - var(--icon-button)) / 2); }
  .back-title { color: var(--color-muted-foreground); }
  .back-title:hover:not(:disabled) { color: var(--color-foreground); }
  .back-title { display: inline-flex; align-items: center; gap: 2px; min-width: 0; height: 32px; padding: 0 6px 0 2px; border-radius: var(--radius-md); font: inherit; letter-spacing: inherit; }
  .back-title .ui-label { color: var(--color-foreground); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .actions { display: flex; align-items: center; gap: 4px; flex: none; }
</style>
