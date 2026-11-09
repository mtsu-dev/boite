<script lang="ts">
  import { ChevronDown, ChevronUp } from '@lucide/svelte';
  import { fill, strings } from '../lib/strings';

  /**
   * A project card's quiet threads, folded under one action (lib/card-fold.ts): "Show 3 more" shows them in place,
   * in the list's order, and "Show less" folds them back. A quiet link in the list's ink, on the rows' text edge,
   * the same control on a desktop card and a phone's.
   */
  let { count, open, ontoggle }: {
    /** The threads the fold hides. */
    count: number;
    open: boolean;
    ontoggle: () => void;
  } = $props();
</script>

<button type="button" class="ghost fold-more" data-testid="project-more" aria-expanded={open} onclick={ontoggle}>
  <span class="ui-label">{open ? strings.sidebar.lessThreads : fill(strings.sidebar.moreThreads, { count: String(count) })}</span>
  {#if open}<ChevronUp size={14} aria-hidden="true" />{:else}<ChevronDown size={14} aria-hidden="true" />{/if}
</button>

<style>
  /* The rows' text edge and a row's height; a link's underline, not a caption, so it reads as something to press.
     The same ink, weight and underline as the dock's and a question's "Show N more". */
  .fold-more {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    width: auto;
    height: auto;
    min-height: var(--fold-more-height, 30px);
    padding: 0 var(--fold-more-inset, 8px);
    border: none;
    border-radius: var(--radius-md);
    background: transparent;
    box-shadow: none;
    color: var(--color-foreground);
    font-size: var(--text-sm);
    font-weight: 550;
  }
  .fold-more .ui-label {
    text-decoration: underline;
    text-decoration-color: color-mix(in oklab, currentColor 45%, transparent);
    text-decoration-thickness: 1px;
    text-underline-offset: 3px;
  }
  .fold-more:hover:not(:disabled) { background: transparent; color: var(--color-foreground); }
  .fold-more:hover .ui-label { text-decoration-color: currentColor; }
  .fold-more:active:not(:disabled) { transform: none; }
  .fold-more :global(svg) { flex: none; }
</style>
