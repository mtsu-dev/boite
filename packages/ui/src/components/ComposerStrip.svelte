<script lang="ts">
  import JumpLatest from './JumpLatest.svelte';

  /**
   * The slot above the composer's foot. It has no height of its own: the way
   * back to the latest message floats from it, centred over the timeline's
   * last lines, drawn only while the reader is scrolled up, so no band opens
   * between the last message and the composer. What waits
   * (a decision out of view, the subagents, the queued messages) is the foot
   * under it (`ComposerFoot`); toasts have their own slot above it (`toastSlot`).
   */
</script>

<div class="strip" data-testid="composer-strip">
  <JumpLatest />
</div>

<style>
  .strip {
    position: relative;
    height: 0;
    width: 100%;
    max-width: var(--content);
    margin: 0 auto;
  }
</style>
