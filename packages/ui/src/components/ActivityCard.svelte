<script lang="ts">
  import { ChevronDown, ChevronRight } from '@lucide/svelte';
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import Elapsed from './Elapsed.svelte';

  /**
   * Work the agent sent, grouped on one row of the chat where it started:
   * the marks, the heading over its counts in small muted ink, how long it
   * has run, then a chevron. With `children` the chevron unfolds the list
   * under the row in place (`expanded`); without, the row opens what follows
   * it, such as a workflow's graph. The head button's own attributes pass
   * through.
   */
  let { live, heading, timing, mark, progress, extra, cause, progressTestId, expanded, children, ...button }: Omit<HTMLButtonAttributes, 'children'> & {
    live: boolean;
    heading: string;
    /** No start yet means no clock. */
    timing: { startedAt: number | null; finishedAt: number | null; active: boolean };
    mark: Snippet;
    progress: Snippet;
    /** After the counts, such as the workflow's phases. */
    extra?: Snippet;
    /** Why it failed, one muted line under the counts, whole in its tooltip. */
    cause?: string;
    /** Test hook on the counts, beside the row's own data-testid. */
    progressTestId?: string;
    /** Whether the list is unfolded; only read with `children`. */
    expanded?: boolean;
    /** The list the chevron unfolds. */
    children?: Snippet;
  } = $props();
  const listId = $props.id();
</script>

<div class="group" class:live>
  <button type="button" class="ghost activity" title={heading} aria-expanded={children ? !!expanded : undefined} aria-controls={children ? listId : undefined} {...button}>
    <span class="glyph" aria-hidden="true">{@render mark()}</span>
    <span class="words">
      <span class="heading">{heading}</span>
      <span class="progress" data-testid={progressTestId}>{@render progress()}{@render extra?.()}</span>
      {#if cause}<span class="cause" data-testid="activity-cause" title={cause}>{cause}</span>{/if}
    </span>
    {#if timing.startedAt !== null}<span class="timing"><Elapsed startedAt={timing.startedAt} finishedAt={timing.finishedAt} active={timing.active} /></span>{/if}
    <span class="caret" aria-hidden="true">{#if children}<ChevronDown size={14} />{:else}<ChevronRight size={14} />{/if}</span>
  </button>
  {#if children}
    <div class="disclosure-fold" class:open={expanded} inert={!expanded} id={listId}><div>{@render children()}</div></div>
  {/if}
</div>

<style>
  .group { display: flex; flex-direction: column; min-width: 0; }
  .activity {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: var(--activity-gap);
    width: 100%;
    min-height: var(--control);
    height: auto;
    padding: var(--activity-padding);
    border-radius: var(--radius-sm);
    color: var(--color-muted-foreground);
    font-size: var(--text-sm);
    font-weight: 400;
    text-align: left;
  }
  .activity:hover:not(:disabled), .activity:focus-visible { background: var(--color-surface-2); color: var(--color-foreground); }
  .activity:active:not(:disabled) { transform: none; background: var(--color-surface-3); }
  /* At least the glyph column every timeline row keeps; a stack of marks takes what it needs. */
  .glyph { display: inline-flex; flex: none; align-items: center; justify-content: center; min-width: var(--activity-glyph); color: var(--color-subtle); }
  .live .glyph { color: var(--color-muted-foreground); }
  /* The heading on one line, cut at its end with the whole of it in the title, over its counts. */
  .words { display: flex; flex-direction: column; flex: 1 1 auto; min-width: 0; line-height: 18px; }
  .heading { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--color-foreground); font-weight: 500; }
  /* The counts are what the row says: on a narrow column they wrap, never cut. */
  .progress { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 6px; min-width: 0; margin-top: 1px; font-size: var(--text-xs); line-height: 16px; color: var(--color-subtle); }
  .cause { min-width: 0; contain: inline-size; margin-top: 1px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--text-xs); line-height: 16px; color: var(--color-muted-foreground); }
  .timing { flex: none; color: var(--color-subtle); font-size: var(--text-sm); font-variant-numeric: tabular-nums; }
  .caret { display: inline-flex; flex: none; color: var(--color-subtle); transition: transform var(--motion-duration) var(--motion-curve); }
  .activity[aria-expanded='true'] .caret { transform: rotate(180deg); }
  @media (prefers-reduced-motion: reduce) { .caret { transition: none; } }
</style>
