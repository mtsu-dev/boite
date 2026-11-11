<script lang="ts">
  import { ChevronDown, ChevronUp } from '@lucide/svelte';
  import { fill, strings } from '../lib/strings';

  /**
   * A project card's quiet threads, folded under one action (lib/card-fold.ts): "Show 3 more" shows them in place,
   * in the list's order, and "Show less" folds them back. The family's text button (app.css `.text`): the words, then
   * the chevron, on the rows' text edge, the same control on a desktop card and a phone's.
   */
  let { count, open, ontoggle }: {
    /** The threads the fold hides. */
    count: number;
    open: boolean;
    ontoggle: () => void;
  } = $props();
</script>

<button type="button" class="text small fold-more" data-testid="project-more" aria-expanded={open} onclick={ontoggle}>
  <span class="ui-label">{open ? strings.sidebar.lessThreads : fill(strings.sidebar.moreThreads, { count: String(count) })}</span>
  {#if open}<ChevronUp size={14} aria-hidden="true" />{:else}<ChevronDown size={14} aria-hidden="true" />{/if}
</button>

<style>
  /* The words on the rows' text edge (the button's own 6 px inset taken back), a row's height to press. */
  .fold-more {
    min-height: var(--fold-more-height, 30px);
    margin-left: calc(var(--fold-more-inset, 8px) - 6px);
    color: var(--color-muted-foreground);
    font-size: var(--text-sm);
    font-weight: 500;
  }
  /* Unfolded is not a menu held open: no fill at rest. */
  .fold-more[aria-expanded='true'] { background: transparent; }
  .fold-more:hover:not(:disabled) { background: var(--color-hover); color: var(--color-foreground); }
  .fold-more:active:not(:disabled) { transform: none; }
  .fold-more :global(svg) { flex: none; }
</style>
