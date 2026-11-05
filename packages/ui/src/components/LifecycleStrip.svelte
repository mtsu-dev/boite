<script lang="ts">
  import { Archive, CheckCheck, CircleDot, LoaderCircle } from '@lucide/svelte';
  import type { ProjectEntry } from '../lib/project-view.svelte';
  import { LIFECYCLES, lifecycleCounts, lifecycleFilter, type Lifecycle } from '../lib/lifecycle-filter.svelte';
  import { count as formatCount } from '../lib/format';
  import { fill, strings } from '../lib/strings';

  /**
   * The four lifecycle buttons over the thread list: needs you, working, done,
   * archived, each with its count across every listed project and machine.
   * One filters the list to its state; the same button or Escape clears it.
   * Escape clears only while focus is in the list's column, so from the
   * composer the key still stops a turn.
   */
  let { entries, prefix = '' }: { entries: readonly ProjectEntry[]; prefix?: string } = $props();
  const counts = $derived(lifecycleCounts(entries));
  const hints: Record<Lifecycle, string> = {
    waiting: strings.sidebar.lifecycle.waitingHint,
    working: strings.sidebar.lifecycle.workingHint,
    done: strings.sidebar.lifecycle.doneHint,
    archived: strings.sidebar.lifecycle.archivedHint
  };
  let strip = $state<HTMLDivElement>();

  $effect(() => {
    const scope = strip?.closest<HTMLElement>('[data-testid="sidebar"], [data-testid="mobile-list"]') ?? strip;
    if (!scope) return;
    // Capture on the window runs before the app's own Escape, which would stop the running turn.
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || lifecycleFilter.current === null) return;
      const focus = document.activeElement;
      if (!focus || !scope.contains(focus)) return;
      event.preventDefault();
      lifecycleFilter.clear();
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  });
</script>

<div class="lifecycle" role="group" aria-label={strings.sidebar.lifecycle.label} bind:this={strip} data-testid={`${prefix}lifecycle`}>
  {#each LIFECYCLES as kind (kind)}
    {@const total = counts[kind]}
    {@const active = lifecycleFilter.current === kind}
    {@const hint = fill(hints[kind], { count: String(total) })}
    <button type="button" class="ghost stage {kind}" class:active class:zero={total === 0} aria-pressed={active}
      data-testid={`${prefix}lifecycle-${kind}`} data-count={total}
      title={active ? `${hint}\n${strings.sidebar.lifecycle.clearHint}` : hint}
      onclick={() => lifecycleFilter.toggle(kind)}>
      <span class="figure">
        {#if kind === 'waiting'}<CircleDot size={11} aria-hidden="true" />{:else if kind === 'working'}<LoaderCircle size={11} aria-hidden="true" />{:else if kind === 'done'}<CheckCheck size={11} aria-hidden="true" />{:else}<Archive size={11} aria-hidden="true" />{/if}
        <span class="number">{formatCount(total)}</span>
      </span>
      <span class="word">{strings.sidebar.lifecycle[kind]}</span>
    </button>
  {/each}
</div>

<style>
  .lifecycle {
    display: grid;
    /* A tile never gets narrower than its word: the longer words take room from the shorter ones. */
    grid-template-columns: repeat(4, minmax(max-content, 1fr));
    gap: 3px;
    padding: 2px 0 8px;
  }
  /* A stat tile: the number first, the word under it, so four fit at 288 px in French too. */
  .stage {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: center;
    gap: 1px;
    height: auto;
    min-width: 0;
    padding: 5px 4px 6px;
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border);
    background: color-mix(in srgb, var(--color-surface-2) 55%, transparent);
    color: var(--color-muted-foreground);
    text-align: left;
    transition: border-color var(--dur-2) var(--ease-out-quint), background var(--dur-2) var(--ease-out-quint), color var(--dur-2) var(--ease-out-quint);
  }
  .figure {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .number {
    font-size: var(--text-base);
    font-weight: 600;
    line-height: 1.2;
    font-variant-numeric: tabular-nums;
    color: var(--color-foreground);
  }
  .word {
    max-width: 100%;
    font-size: 11px;
    line-height: 1.25;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: clip;
  }
  .waiting:not(.zero) .figure { color: var(--color-live); }
  .working:not(.zero) .figure { color: var(--color-accent); }
  .done:not(.zero) .figure { color: var(--color-success); }
  /* Zero stays in place, quiet: the tile keeps its slot so the strip never shifts. */
  .zero .number { color: var(--color-subtle); font-weight: 500; }
  .zero .word { color: var(--color-subtle); }
  .stage:hover:not(:disabled) { background: var(--color-hover); }
  .stage.active {
    border-color: var(--color-accent);
    background: var(--color-accent-soft);
    box-shadow: inset 0 0 0 1px var(--color-accent);
  }
  .stage.active .word { color: var(--color-foreground); }
  /* A phone: 36 px tiles, the number over its word as on the desktop, the word at the tab bar's
     10 px, so four tiles fit 360 px in French without a cut; the touch target reaches 4 px past
     each edge to keep its 44 px. */
  @media (max-width: 720px) {
    .lifecycle { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; padding: 0 0 4px; }
    .stage { position: relative; gap: 0; height: 36px; min-height: 0; padding: 2px 8px; }
    .stage::after { content: ''; position: absolute; inset: -4px 0; }
    .number { font-size: var(--text-sm); line-height: 16px; }
    .word { font-size: 10px; line-height: 12px; text-overflow: ellipsis; }
  }
</style>
