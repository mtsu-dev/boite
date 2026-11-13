<script lang="ts">
  import JumpLatest from './JumpLatest.svelte';

  /**
   * The slot above the composer's foot, in the flow so it never covers a line
   * of the timeline: at its right the way back to the latest message, drawn
   * only while the reader is scrolled up. Empty, it takes no room. What waits
   * (a decision out of view, the subagents, the queued messages) is the foot
   * under it (`ComposerFoot`); toasts have their own slot above it (`toastSlot`).
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

  .strip:has(> :global(*)) { padding-bottom: 8px; }
</style>
