<script lang="ts">
  import type { Store } from '../lib/store.svelte';
  import AgentDock from './AgentDock.svelte';
  import JumpLatest from './JumpLatest.svelte';

  /**
   * The one row above the box, in the flow so it never covers a line of the
   * timeline: the thread's subagents and workflows, each by name, and at its
   * right end the way back to the latest message. A thread keeps the row
   * reserved, so neither coming and going moves the timeline; the queue and
   * the asks live inside the box. On a wide window the undo and error
   * toasts keep room at its top, at its right end (`toastSlot`).
   */
  let { store, thread }: { store: Store; thread: Store['openThread'] } = $props();
</script>

<div class="strip" class:reserved={!!thread} data-testid="composer-strip">
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
    /* The toasts' room, kept while one is up (lib/notify-corner.ts). */
    padding-top: var(--corner-room, 0px);
  }

  .strip.reserved, .strip:has(> :global(*)) { min-height: 34px; padding-bottom: 6px; }
  /* The dock's line takes the width; the way back keeps the right end. */
  .strip :global(.jump) { margin-left: auto; }
</style>
