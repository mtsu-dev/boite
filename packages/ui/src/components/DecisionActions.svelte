<script lang="ts">
  import type { Snippet } from 'svelte';

  /**
   * A decision's one pair of actions, the same wherever a decision is asked:
   * right-aligned, the secondary (Deny, Skip) an outline button, then the
   * primary (Allow once, Answer) solid in the neutral ink, both one height.
   * The buttons are the caller's: `class="secondary"` and `class="primary"`.
   * A disabled primary keeps its outline (app.css `button.primary:disabled`),
   * so it reads as waiting, not missing. `lead` holds what reads before them
   * at the line's start (a hint, a count).
   */
  let { lead, children }: { lead?: Snippet; children: Snippet } = $props();
</script>

<div class="decision-actions">
  {#if lead}<div class="lead">{@render lead()}</div>{/if}
  {@render children()}
</div>

<style>
  .decision-actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px; min-width: 0; }
  /* The lead gives way first: its words wrap inside it so the pair stays on
     one line, and only a row too short for a few words puts it on its own. */
  .lead { flex: 1 1 0; min-width: min(7em, 100%); }
  /* The family's buttons as they are: a decision pair is a primary and a secondary, nothing local. */
  .decision-actions > :global(button) { flex: none; }
</style>
