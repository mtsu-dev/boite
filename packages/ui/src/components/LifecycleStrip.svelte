<script lang="ts">
  import { Archive, Check } from '@lucide/svelte';
  import type { ProjectEntry } from '../lib/project-view.svelte';
  import { LIFECYCLES, lifecycleCounts, lifecycleFilter, type Lifecycle } from '../lib/lifecycle-filter.svelte';
  import { count as formatCount } from '../lib/format';
  import { fill, strings } from '../lib/strings';

  /**
   * The four lifecycle filters over the thread list: needs you, working, done,
   * archived, counted across every listed project and machine. The live two
   * show their number; done and archived say theirs in the tooltip, and give
   * their word up for a glyph when the four words outgrow the column: a hidden
   * copy of the full row measures them, in the language and the counts drawn,
   * so a 360 px phone or a longer French word never cuts a live word.
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
  let sizer = $state<HTMLSpanElement>();
  let compact = $state(false);

  $effect(() => {
    const row = strip, full = sizer;
    if (!row || !full || typeof ResizeObserver === 'undefined') return;
    const measure = () => { compact = full.getBoundingClientRect().width > row.clientWidth + 1; };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    observer.observe(full);
    return () => observer.disconnect();
  });

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

<div class="lifecycle" class:compact role="group" aria-label={strings.sidebar.lifecycle.label} bind:this={strip} data-testid={`${prefix}lifecycle`}>
  {#each LIFECYCLES as kind (kind)}
    {@const total = counts[kind]}
    {@const active = lifecycleFilter.current === kind}
    {@const hint = fill(hints[kind], { count: String(total) })}
    {@const live = kind === 'waiting' || kind === 'working'}
    <button type="button" class="ghost stage {kind}" class:active class:zero={total === 0} class:history={!live} aria-pressed={active}
      data-testid={`${prefix}lifecycle-${kind}`} data-count={total}
      title={active ? `${hint}\n${strings.sidebar.lifecycle.clearHint}` : hint}
      onclick={() => lifecycleFilter.toggle(kind)}>
      {#if !live}<span class="glyph" aria-hidden="true">{#if kind === 'done'}<Check size={15} strokeWidth={2} />{:else}<Archive size={14} strokeWidth={1.75} />{/if}</span>{/if}
      <span class="word">{strings.sidebar.lifecycle[kind]}</span>
      <!-- Only what is live gets a number: how much is done or archived is history, said in the tooltip. -->
      {#if live && total > 0}<span class="number">{formatCount(total)}</span>{/if}
    </button>
  {/each}
  <!-- The four words at full width, never seen or read: the width they would need. -->
  <span class="measure" aria-hidden="true"><span class="sizer" bind:this={sizer}>
    {#each LIFECYCLES as kind (kind)}
      <span class="stage {kind}"><span class="word">{strings.sidebar.lifecycle[kind]}</span>{#if (kind === 'waiting' || kind === 'working') && counts[kind] > 0}<span class="number">{formatCount(counts[kind])}</span>{/if}</span>
    {/each}
  </span></span>
</div>

<style>
  /* One line of text filters over the list, the way a mail app filters its inbox: words, and a number where something is live. */
  .lifecycle {
    display: flex;
    align-items: center;
    gap: 2px;
    position: relative;
    min-width: 0;
    padding: 0 0 6px;
  }
  /* Clipped to the strip, so the full row it holds never widens a scroller. */
  .measure { position: absolute; inset: 0; gap: inherit; overflow: hidden; visibility: hidden; pointer-events: none; }
  .sizer { position: absolute; top: 0; left: 0; display: flex; gap: inherit; width: max-content; white-space: nowrap; }
  .stage {
    display: inline-flex;
    flex: 0 1 auto;
    align-items: center;
    gap: 5px;
    min-width: 0;
    height: 26px;
    padding: 0 8px;
    border: 0;
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--color-muted-foreground);
    font-size: var(--text-sm);
    font-weight: 500;
    transition: background var(--dur-2) var(--ease-out-quint), color var(--dur-2) var(--ease-out-quint);
  }
  .stage:first-child { margin-left: -2px; }
  .word {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .glyph { display: none; }
  /*
   * Four words need about 300 px on a desktop and 340 on a phone; the sidebar
   * opens at 280 and a small phone leaves 328. Done and archived, history, give
   * way to their glyph, so the live two never cut their word; the hidden word
   * still names the button to a screen reader.
   */
  .compact .history { position: relative; padding: 0 7px; }
  .compact .history .glyph { display: inline-flex; }
  .compact .history .word { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .number {
    flex: none;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  /* Amber is needs-you only: the one number that asks for the user. */
  .waiting .number { color: var(--color-live); }
  .stage:hover:not(:disabled) { background: var(--color-hover); color: var(--color-foreground); }
  .stage.active, .stage.active:hover:not(:disabled) {
    background: var(--color-accent-soft);
    color: var(--color-accent);
  }
  /* A phone: the same words at the touch size, the target reaching past the 30 px pill. */
  @media (max-width: 720px) {
    .lifecycle { gap: 4px; padding: 0 0 4px; }
    .stage { position: relative; height: 32px; padding: 0 11px; font-size: var(--text-sm); }
    .stage::after { content: ''; position: absolute; inset: -6px 0; }
  }
</style>
