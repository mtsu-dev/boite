<script lang="ts">
  import { prefetchIdleParts, threadDecision } from '../lib/idle-parts';
  import { questionsWaiting } from '../lib/decision-tail.svelte';
  import type { Store } from '../lib/store.svelte';
  import Deferred from './Deferred.svelte';
  import ThreadActivity from './ThreadActivity.svelte';

  /**
   * The composer card's head. A question waiting on the user is attached
   * here, over the field, and is all the head holds while it waits
   * (`ThreadDecision`); otherwise the goal, the loop and the tasks. The
   * subagents at work stand above the card (`AgentDock`), a permission on
   * its command row in the timeline (`PermissionCard`).
   */
  let { store, thread, agentBox }: {
    store: Store;
    thread: Store['openThread'];
    /** The box speaks to an agent: no thread activity under it. */
    agentBox: boolean;
  } = $props();

  let asking = $derived(!!thread && !agentBox && questionsWaiting(store, thread.id) > 0);

  // The question's card and the permission row load at idle, so the first ask draws at once.
  $effect(prefetchIdleParts);
</script>

<div class="deck">
{#if asking && thread}
  <Deferred part={threadDecision}>{#snippet children(ThreadDecision)}<ThreadDecision {store} threadId={thread.id} />{/snippet}</Deferred>
{:else if !agentBox}<ThreadActivity {store} />{/if}
</div>

<style>
  /* The card's head, flat on the card's own surface in a quieter ink. On a
     desktop the activity keeps to a share of the conversation and scrolls
     inside it; a question has its own cap. Empty, it takes no room. */
  .deck { display: flex; flex-direction: column; min-height: 0; --dock-inset: 14px; }
  .deck > :global(*) { flex: none; }
  .deck > :global(:is(.activity, .thread-decision)) { flex: 0 1 auto; min-height: 0; }
  @media (min-width: 721px) {
    .deck > :global(.activity) { max-height: max(160px, calc(55dvh - 126px)); }
  }
  /* One inset hairline before the field, so drafting reads apart from what is asked or runs. */
  .deck:has(> :global(:is(.thread-decision, .activity:not(.hidden)))) {
    padding-bottom: 8px;
    background: linear-gradient(var(--color-border), var(--color-border)) no-repeat center bottom / calc(100% - 2 * var(--dock-inset)) 1px;
  }
  /* Each block stands `--deck-gap` (Composer) under the one above it and adds nothing under itself. */
  :global(.composer) .deck > :global(.activity) { padding: 0 6px; }
  :global(.composer) .deck > :global(.activity > *:first-child) { margin-top: var(--deck-gap); }
</style>
