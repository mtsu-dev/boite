<script lang="ts">
  import { ChevronRight, Network } from '@lucide/svelte';
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import { clockTime } from '../lib/format';
  import { fill, strings } from '../lib/strings';
  import Elapsed from './Elapsed.svelte';

  /**
   * Work the agent started, as one line in the chat where it started. The
   * status strip above the composer is the only live view of it, so while it
   * runs the line says what it is and when it started, with no bar, badge or
   * ticking clock; once it ended it reads as a record with its duration.
   * Clicking opens the surface that follows it; the button's own attributes
   * pass through.
   */
  let { live, heading, timing, progress, progressTestId, ...button }: Omit<HTMLButtonAttributes, 'children'> & {
    live: boolean;
    heading: string;
    /** No start yet means no clock. */
    timing: { startedAt: number | null; finishedAt: number | null; active: boolean };
    progress: Snippet;
    /** Test hook on the progress segment, beside the line's own data-testid. */
    progressTestId?: string;
  } = $props();
</script>

<button type="button" class="activity" class:live {...button}>
  <Network class="glyph" size={14} strokeWidth={1.75} aria-hidden="true" />
  <span class="line">
    <span class="heading">{heading}</span>
    <span class="progress" data-testid={progressTestId}>{@render progress()}</span>
    {#if timing.startedAt !== null}
      {#if timing.active}
        <span class="when started ui-label">· {fill(strings.delegation.startedAt, { time: clockTime(timing.startedAt) })}</span>
      {:else if timing.finishedAt !== null}
        <span class="when">· <Elapsed startedAt={timing.startedAt} finishedAt={timing.finishedAt} active={false} /></span>
      {/if}
    {/if}
  </span>
  <ChevronRight class="chevron" size={14} aria-hidden="true" />
</button>

<style>
  /* One 28 px line, the weight of a tool line: history, not a second live view, so no box at rest. */
  .activity {
    width: 100%;
    height: var(--control-sm);
    min-height: var(--control-sm);
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 8px;
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    background: none;
    text-align: left;
    color: var(--color-muted-foreground);
    font-size: var(--text-xs);
    font-weight: 400;
    font-variant-numeric: tabular-nums;
    container: activity / inline-size;
    transition: background var(--dur-1), color var(--dur-1);
  }
  .activity:hover, .activity:focus-visible { background: var(--color-hover); color: var(--color-foreground); }
  .activity :global(.glyph) { flex: none; color: var(--color-muted-foreground); }
  .live :global(.glyph) { color: var(--color-accent); }
  /* A line box taller than the button's: the clipped segments keep their descenders. */
  .line { flex: 1; min-width: 0; display: flex; align-items: center; gap: 4px; overflow: hidden; white-space: nowrap; line-height: 16px; }
  .heading { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--color-foreground); font-weight: 500; }
  /* The progress gives way first; a long workflow name still ellipsizes, never to nothing.
     Its labels are trimmed to the cap and the baseline, so the clip box takes back half an em
     below them: clipped at their own height, "steps" lost the tail of its p. */
  .progress { display: inline-flex; flex: 0 1000 auto; min-width: 0; overflow: hidden; align-items: center; gap: 4px; padding-block: 0.5em; margin-block: -0.5em; }
  .progress > :global(span) { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .when { flex: none; display: inline-flex; gap: 4px; }
  .activity :global(.chevron) { flex: none; }
  /* A phone-wide line keeps what and how far; the start time is the strip's to tell. A record keeps its short duration. */
  @container activity (max-width: 400px) { .started { display: none; } }
  @media (max-width: 720px) {
    /* A finger's target without a taller line. */
    .activity { position: relative; }
    .activity::after { content: ''; position: absolute; inset: -8px 0; }
  }
</style>
