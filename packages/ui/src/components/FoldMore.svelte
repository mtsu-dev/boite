<script lang="ts">
  import { ChevronDown, ChevronUp } from '@lucide/svelte';
  import { fill, strings } from '../lib/strings';

  /**
   * A project card's quiet threads, folded under one action (lib/card-fold.ts): "Show 3 more" shows them in place,
   * in the list's order, and "Show less" folds them back. A filled bar on the rows' width, the words then the
   * chevron, the same control on a desktop card and a phone's.
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
  /* A control at a glance: a filled bar on the rows' width, its words centred, the chevron saying which way it goes.
     The fill is the rows' hover ground at rest and their pressed one under the pointer. */
  .fold-more {
    display: flex;
    justify-content: center;
    gap: 6px;
    width: calc(100% - 2 * var(--fold-more-inset, 8px));
    min-height: var(--fold-more-height, 28px);
    margin: 4px var(--fold-more-inset, 8px) 6px;
    border-radius: var(--radius-md);
    background: var(--color-hover);
    box-shadow: inset 0 0 0 1px var(--color-border);
    color: var(--color-muted-foreground);
    font-size: var(--text-xs);
    font-weight: 500;
    transition: background var(--dur-2) var(--ease-out-quint), color var(--dur-2) var(--ease-out-quint), box-shadow var(--dur-2) var(--ease-out-quint);
  }
  /* Unfolded is not a menu held open: the same fill as folded. */
  .fold-more[aria-expanded='true'] { background: var(--color-hover); }
  .fold-more:hover:not(:disabled) { background: var(--color-active); box-shadow: inset 0 0 0 1px var(--color-edge); color: var(--color-foreground); }
  .fold-more:active:not(:disabled) { transform: none; }
  .fold-more :global(svg) { flex: none; transition: transform var(--dur-2) var(--ease-out-quint); }
  /* The chevron leans the way the rows will go. */
  .fold-more:hover:not(:disabled) :global(svg) { transform: translateY(1px); }
  .fold-more[aria-expanded='true']:hover:not(:disabled) :global(svg) { transform: translateY(-1px); }
  @media (prefers-reduced-motion: reduce) { .fold-more, .fold-more :global(svg) { transition: none; } }
</style>
