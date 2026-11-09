<script lang="ts">
  import DecisionPill from './DecisionPill.svelte';
  import JumpLatest from './JumpLatest.svelte';

  /**
   * The one row above the box, in the flow so it never covers a line of the
   * timeline: at its left the way back to a decision out of view, at its right
   * the way back to the latest message, each drawn only while it is needed.
   * Empty, it takes no room. The "Waiting on" line of the subagents the
   * thread waits on (`AgentDock`), then the queued messages, stand under
   * this strip, a question at the top of the box; toasts have their own slot above it (`toastSlot`).
   */
</script>

<div class="strip" data-testid="composer-strip">
  <DecisionPill />
  <JumpLatest />
</div>

<style>
  .strip {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    width: 100%;
    max-width: var(--content);
    margin: 0 auto;
  }

  .strip:has(> :global(*)) { padding-bottom: 6px; }
</style>
