<script lang="ts">
  import { ChevronDown, ChevronRight } from '@lucide/svelte';
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import Elapsed from './Elapsed.svelte';
  import { wordFit } from '../lib/word-fit';

  /**
   * Work the agent sent, grouped on one card of the chat where it started,
   * framed so it never reads as one more tool line: the marks, the heading
   * over its counts, how long it has run, then a chevron. Live, its frame
   * takes the live tint; `tone` says how it ended (`done`: a result came
   * back, `failed`), and the frame says it too. With `children` the chevron unfolds the list
   * under the row in place (`expanded`); without, the row opens what follows
   * it, such as a workflow's graph. The head button's own attributes pass
   * through.
   */
  let { live, tone, heading, timing, mark, progress, extra, cause, progressTestId, expanded, children, ...button }: Omit<HTMLButtonAttributes, 'children'> & {
    live: boolean;
    /** How finished work ended: a result that came back shows in the success tint, a failure in the danger one. */
    tone?: 'done' | 'failed';
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

<div class="group" class:live data-tone={live ? undefined : tone}>
  <button type="button" class="ghost activity" title={heading} aria-expanded={children ? !!expanded : undefined} aria-controls={children ? listId : undefined} {...button}>
    <span class="glyph" aria-hidden="true">{@render mark()}</span>
    <span class="words">
      <span class="heading">{heading}</span>
      <span class="progress" data-testid={progressTestId}>{@render progress()}{@render extra?.()}</span>
      {#if cause}<span class="cause" data-testid="activity-cause" title={cause} use:wordFit={cause}></span>{/if}
    </span>
    {#if timing.startedAt !== null}<span class="timing"><Elapsed startedAt={timing.startedAt} finishedAt={timing.finishedAt} active={timing.active} /></span>{/if}
    <span class="caret" aria-hidden="true">{#if children}<ChevronDown size={14} />{:else}<ChevronRight size={14} />{/if}</span>
  </button>
  {#if children}
    <div class="disclosure-fold" class:open={expanded} inert={!expanded} id={listId}><div>{@render children()}</div></div>
  {/if}
</div>

<style>
  /* A card of its own: a frame, the card's fill, the live or the result's tint on its edge. */
  .group { --tint: transparent; display: flex; flex-direction: column; min-width: 0; margin-block: 4px; border: 1px solid color-mix(in oklab, var(--tint) 34%, var(--color-edge)); border-radius: var(--radius-md); background: color-mix(in oklab, var(--tint) 5%, var(--card-fill)); transition: border-color var(--motion-duration) var(--motion-curve), background var(--motion-duration) var(--motion-curve); }
  .group.live { --tint: var(--color-live); }
  .group[data-tone='done'] { --tint: var(--color-success); }
  .group[data-tone='failed'] { --tint: var(--color-danger); }
  .activity {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 10px;
    width: 100%;
    min-height: 48px;
    height: auto;
    padding: 7px 10px;
    border-radius: calc(var(--radius-md) - 1px);
    color: var(--color-muted-foreground);
    font-size: var(--text-sm);
    font-weight: 400;
    text-align: left;
  }
  .activity:hover:not(:disabled), .activity:focus-visible { background: color-mix(in oklab, var(--color-foreground) 5%, transparent); color: var(--color-foreground); }
  .activity:active:not(:disabled) { transform: none; background: color-mix(in oklab, var(--color-foreground) 8%, transparent); }
  /* At least the glyph column every timeline row keeps; a stack of marks takes what it needs. */
  .glyph { display: inline-flex; flex: none; align-items: center; justify-content: center; min-width: 28px; min-height: 28px; padding: 0 5px; border-radius: var(--radius-sm); background: color-mix(in oklab, var(--tint) 14%, var(--color-surface-3)); color: color-mix(in oklab, var(--tint) 70%, var(--color-muted-foreground)); }
  /* The heading on one line, cut at its end with the whole of it in the title, over its counts. */
  .words { display: flex; flex-direction: column; flex: 1 1 auto; min-width: 0; line-height: 18px; }
  .heading { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--color-foreground); font-weight: 600; }
  /* The counts are what the row says: on a narrow column they wrap, never cut. */
  .progress { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 6px; min-width: 0; margin-top: 1px; font-size: var(--text-xs); line-height: 16px; color: var(--color-muted-foreground); }
  /* Two lines at most, then cut on a whole word (`wordFit`): the reason reads whole, never cut inside a word.
     `normal`: the button around it keeps its words on one line, which would hold the cause to one. */
  .cause { white-space: normal; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; min-width: 0; contain: inline-size; margin-top: 1px; overflow: hidden; overflow-wrap: anywhere; font-size: var(--text-xs); line-height: 16px; color: var(--color-muted-foreground); }
  .timing { flex: none; color: var(--color-subtle); font-size: var(--text-sm); font-variant-numeric: tabular-nums; }
  .caret { display: inline-flex; flex: none; color: var(--color-subtle); transition: transform var(--motion-duration) var(--motion-curve); }
  .activity[aria-expanded='true'] .caret { transform: rotate(180deg); }
  @media (prefers-reduced-motion: reduce) { .caret, .group { transition: none; } }
  /* The list a group unfolds keeps the card's inset. */
  .group > :global(.disclosure-fold > div) { padding-inline: 4px; }
  /* A phone: the heading, the time and the chevron share the first line, and the counts take the full width
     under them, so "2 working, 1 done, 1 stopped" stays on one line beside the marks instead of three. */
  @media (max-width: 720px) {
    .activity { display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto; align-items: center; line-height: 18px; }
    .words { display: contents; }
    .glyph { grid-column: 1; grid-row: 1 / span 3; }
    .heading { grid-column: 2; grid-row: 1; }
    .timing { grid-column: 3; grid-row: 1; }
    .caret { grid-column: 4; grid-row: 1; }
    .progress { grid-column: 2 / -1; grid-row: 2; }
    .cause { grid-column: 2 / -1; grid-row: 3; }
  }
</style>
