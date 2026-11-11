<script lang="ts">
  import type { Snippet } from 'svelte';

  /**
   * The one place an Activity card's state mark stands, on every kind of card (a thread's, a contact's), desktop and
   * phone: a column before the title as wide as the kind line's glyph (ActivityKind.svelte), so the glyph, the mark
   * and the title's words each start on one edge, centred on the title's first line. An empty slot keeps the column.
   * `--mark-shift` moves it onto that line's capitals when the title's box is trimmed to them (`.ui-label`).
   */
  let { children }: { children?: Snippet } = $props();
</script>

<span class="activity-mark" data-testid="activity-mark">{@render children?.()}</span>

<style>
  .activity-mark { display: flex; flex: none; align-items: center; justify-content: center; width: 13px; height: 20px; margin-top: var(--mark-shift, 0px); }
</style>
