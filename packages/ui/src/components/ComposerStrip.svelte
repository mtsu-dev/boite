<script lang="ts">
  import type { Store } from '../lib/store.svelte';
  import AgentDock from './AgentDock.svelte';
  import JumpLatest from './JumpLatest.svelte';

  /**
   * The one row above the box, in the flow so it never covers a line of the
   * timeline: the thread's subagents and workflows, each its own line by
   * name, and at its right end the way back to the latest message, drawn only
   * while the reader is scrolled up. Empty, it takes no room: a thread at
   * rest at its end shows no blank band over the box. The queue and the asks
   * live inside the box; toasts have their own slot above it (`toastSlot`).
   */
  let { store, thread, height = $bindable(0) }: { store: Store; thread: Store['openThread']; height?: number } = $props();
</script>

<div class="strip" data-testid="composer-strip" bind:clientHeight={height}>
  {#if thread}<AgentDock {store} threadId={thread.id} />{/if}
  <JumpLatest />
</div>

<style>
  .strip {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    width: 100%;
    max-width: var(--content);
    margin: 0 auto;
  }

  .strip:has(> :global(*)) { padding-bottom: 6px; }
  /* The dock's line takes the width; the way back keeps the right end. */
  .strip :global(.jump) { margin-left: auto; }
</style>
