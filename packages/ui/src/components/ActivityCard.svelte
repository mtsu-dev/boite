<script lang="ts">
  import { ChevronRight } from '@lucide/svelte';
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import Elapsed from './Elapsed.svelte';

  /**
   * Work the agent started, as one row of the chat where it started, drawn
   * like a tool group's head (ToolGroup.svelte) so the timeline reads as one
   * list: a mark, a heading, its progress, how long it has run, then the
   * chevron to the panel that follows it. A live row wraps on a narrow column
   * rather than cutting its words; a finished one stays one quiet line, its
   * heading whole in the title. The button's own attributes pass through.
   */
  let { live, heading, timing, mark, progress, extra, progressTestId, ...button }: Omit<HTMLButtonAttributes, 'children'> & {
    live: boolean;
    heading: string;
    /** No start yet means no clock. */
    timing: { startedAt: number | null; finishedAt: number | null; active: boolean };
    mark: Snippet;
    progress: Snippet;
    /** After the progress, such as the workflow's phases. */
    extra?: Snippet;
    /** Test hook on the progress, beside the row's own data-testid. */
    progressTestId?: string;
  } = $props();
</script>

<button type="button" class="ghost activity" class:live title={live ? undefined : heading} {...button}>
  <span class="glyph" aria-hidden="true">{@render mark()}</span>
  <span class="line">
    <span class="heading">{heading}</span>
    <span class="progress" data-testid={progressTestId}>{@render progress()}</span>
    {@render extra?.()}
  </span>
  {#if timing.startedAt !== null}<span class="timing"><Elapsed startedAt={timing.startedAt} finishedAt={timing.finishedAt} active={timing.active} /></span>{/if}
  {#if live}<span class="spinner" aria-hidden="true"></span>{/if}
  <span class="caret" aria-hidden="true"><ChevronRight size={12} /></span>
</button>

<style>
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
  .glyph { display: inline-flex; flex: none; width: var(--activity-glyph); justify-content: center; color: var(--color-subtle); }
  .live .glyph { color: var(--color-muted-foreground); }
  .line { display: flex; flex: 0 1 auto; flex-wrap: wrap; align-items: center; gap: 2px 6px; min-width: 0; }
  .heading { overflow-wrap: anywhere; }
  .activity:not(.live) .line { flex-wrap: nowrap; }
  .activity:not(.live) .heading { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .activity:not(.live) .progress { flex: none; flex-wrap: nowrap; white-space: nowrap; }
  .activity:hover .heading { color: var(--color-foreground); }
  .progress { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 2px 4px; font-size: var(--text-xs); color: var(--color-subtle); }
  .progress::before { content: '·'; }
  .timing { flex: none; color: var(--color-subtle); font-size: var(--text-xs); font-variant-numeric: tabular-nums; }
  .spinner {
    flex: none;
    width: 11px;
    height: 11px;
    border-radius: 50%;
    border: 1.5px solid var(--color-edge);
    border-top-color: var(--color-live);
    animation: spin 0.9s steps(54) infinite var(--loops);
  }
  .caret { display: inline-flex; flex: none; color: var(--color-subtle); }
  @media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }
  :global(html[data-motion='reduced']) .spinner { animation: none; }
</style>
