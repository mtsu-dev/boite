<script lang="ts">
  import JumpLatest from './JumpLatest.svelte';

  /**
   * The one row above the box, in the flow so it never covers a line of the
   * timeline: the way back to the latest message at its right end, drawn only
   * while the reader is scrolled up. Empty, it takes no room. The subagents,
   * the queue and the asks live inside the box (`AgentDock` on its top edge);
   * toasts have their own slot above it (`toastSlot`).
   */
</script>

<div class="strip" data-testid="composer-strip">
  <JumpLatest />
</div>

<style>
  .strip {
    display: flex;
    justify-content: flex-end;
    width: 100%;
    max-width: var(--content);
    margin: 0 auto;
  }

  .strip:has(> :global(*)) { padding-bottom: 6px; }
</style>
