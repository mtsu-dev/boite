<script lang="ts">
  import { prefetchIdleParts } from '../lib/idle-parts';
  import type { Store } from '../lib/store.svelte';
  import AgentDock from './AgentDock.svelte';
  import ThreadActivity from './ThreadActivity.svelte';

  /**
   * The composer card's head: the subagents' quiet rows, then the goal, the
   * loop and the tasks. What waits on the user stands at the end of the
   * timeline (`ThreadDecision`), never here, so the field keeps its place.
   * `room` is how tall the subagents' rows stand.
   */
  let { store, thread, agentBox, room = $bindable(0) }: {
    store: Store;
    thread: Store['openThread'];
    /** The box speaks to an agent: no thread activity under it. */
    agentBox: boolean;
    room?: number;
  } = $props();

  // The decision card and the permission card load at idle, so the first ask draws at once.
  $effect(prefetchIdleParts);
</script>

<div class="deck">
{#if thread}<AgentDock {store} threadId={thread.id} bind:height={room} />{/if}
{#if !agentBox}<ThreadActivity {store} />{/if}
</div>

<style>
  /* The card's head, flat on the card's own surface in a quieter ink. On a
     desktop it keeps to a share of the conversation; the subagents' rows keep
     their size and the rest scrolls inside it. Empty, it takes no room. */
  .deck { display: flex; flex-direction: column; --dock-inset: 14px; }
  .deck > :global(*) { flex: none; }
  .deck > :global(.activity) { flex: 0 1 auto; min-height: 0; }
  @media (min-width: 721px) {
    .deck { max-height: max(160px, calc(55dvh - 126px)); }
  }
  /* One inset hairline before the field, so drafting reads apart from what runs. */
  .deck:has(> :global(:is(.dock, .activity:not(.hidden)))) {
    padding-bottom: 8px;
    background: linear-gradient(var(--color-border), var(--color-border)) no-repeat center bottom / calc(100% - 2 * var(--dock-inset)) 1px;
  }
  /* Each block stands `--deck-gap` (Composer) under the one above it and adds nothing under itself. */
  :global(.composer) .deck > :global(.activity) { padding: 0 6px; }
  :global(.composer) .deck > :global(.activity > *:first-child) { margin-top: var(--deck-gap); }
</style>
