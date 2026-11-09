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
  .decision-actions > :global(button) { position: relative; flex: none; height: var(--control); padding: 0 14px; border-radius: var(--radius-md); font-size: var(--text-sm); font-weight: 600; box-shadow: none; }
  .decision-actions > :global(button.secondary) { border-color: var(--color-edge); background: transparent; color: var(--color-foreground); }
  @media (hover: hover) { .decision-actions > :global(button.secondary:hover:not(:disabled)) { background: var(--color-hover); } }
  /* A phone draws them 36 px tall in a 44 px target, as the composer's chips. */
  @media (max-width: 720px) {
    .decision-actions > :global(button) { height: 36px; min-height: 0; padding: 0 16px; }
    .decision-actions > :global(button)::after { content: ''; position: absolute; inset: -4px 0; }
  }
</style>
