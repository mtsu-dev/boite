<script lang="ts">
  import type { Snippet } from 'svelte';

  /**
   * A decision's one pair of actions, the same wherever a decision is asked:
   * right-aligned, the secondary (Deny, Skip) an outline button, then the
   * primary (Allow once, Answer) solid in the neutral ink, both one height.
   * The buttons are the caller's: `class="secondary"` and `class="primary"`.
   * A primary that cannot act yet stays solid, faded: the decision's one
   * filled action reads first whether or not it is ready. `lead` holds what
   * reads before them at the line's start (a pager, a count).
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
     one line, and only a row too short for a few words puts it on its own.
     A lead that cannot wrap (a pager) names its least width in `--decision-lead`. */
  .lead { flex: 1 1 0; min-width: var(--decision-lead, min(7em, 100%)); }
  /* A lead that drew nothing (a pager of one page) takes no room from the pair. */
  .lead:not(:has(*)) { display: none; }
  /* The family's buttons as they are: a decision pair is a primary and a secondary, nothing local. */
  .decision-actions > :global(button) { flex: none; }
  /* Not app.css's outline for a disabled primary: here the pair's primary is always the filled one. */
  .decision-actions > :global(button.primary:disabled) { background: var(--primary-fill); border-color: var(--primary-fill); color: var(--primary-ink); box-shadow: none; opacity: 0.45; }
</style>
