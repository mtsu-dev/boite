<script lang="ts">
  import { ChevronRight, CircleCheck, FoldVertical, Sparkles } from '@lucide/svelte';
  import { compactionMark, compactionText, type CompactionPart } from '../lib/tool-groups';
  import { foldText, toggleTurn, type TurnFold } from '../lib/agent-turns';
  import { clockTime, fullTime } from '../lib/format';
  import { strings } from '../lib/strings';

  /**
   * One thin divider in place of a whole wake that had nothing for the user
   * ("Checked: <what it checked> · 3 steps"), a check and its time on it,
   * and what an automatic compaction after it let go. A click opens the turn as it ran, a second folds it. A
   * worked turn has no row: its count sits on the line under its answer.
   */
  let { fold, at, compactions = [] }: { fold: TurnFold; at: number; compactions?: CompactionPart[] } = $props();
  const t = $derived(strings.chat.fold);
  const quiet = $derived(fold.kind === 'quiet');
  const hint = $derived(quiet ? (fold.open ? t.hideTurn : t.showTurn) : (fold.open ? t.hideSteps : t.showSteps));

  const toggle = () => toggleTurn(fold.turnId);
</script>

<div class="turn-fold" data-kind={fold.kind} data-open={fold.open} data-testid="turn-fold">
  <span class="rule"></span>
  <button type="button" class="ghost small row" aria-expanded={fold.open} title={hint} onclick={toggle} data-testid="turn-fold-toggle">
    <span class="glyph" aria-hidden="true">
      {#if quiet}
        <CircleCheck size={13} strokeWidth={1.75} />
      {:else}
        <Sparkles size={13} strokeWidth={1.75} />
      {/if}
    </span>
    <span class="ui-label text" title={foldText(fold)}>{foldText(fold)}</span>
    {#each compactions as part, index (index)}<span class="compacted ui-label" data-testid="turn-fold-compaction" title={compactionText(part)}><FoldVertical size={12} strokeWidth={1.75} aria-hidden="true" />{compactionMark(part)}</span>{/each}
    {#if quiet}<time datetime={new Date(at).toISOString()} title={fullTime(at)}>{clockTime(at)}</time>{/if}
    <span class="fold-caret" class:open={fold.open} aria-hidden="true"><ChevronRight size={12} /></span>
  </button>
  <span class="rule"></span>
</div>

<style>
  /* A thin divider across the column, the words on it: no pill, no box. */
  .turn-fold {
    align-self: stretch;
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 4px 0;
    min-width: 0;
    font-size: var(--text-xs);
    color: var(--color-muted-foreground);
  }
  .rule { flex: 1; min-width: 12px; height: 1px; background: var(--color-border); }
  .row {
    flex: 0 1 auto;
    min-width: 0;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: auto;
    min-height: var(--control-sm);
    padding: 2px 4px;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--color-muted-foreground);
    font-size: var(--text-xs);
    font-weight: 500;
    transition: color var(--dur-2) var(--ease-out-quint);
  }
  .row:hover, .row:focus-visible { color: var(--color-foreground); background: none; }
  .glyph { display: inline-flex; color: var(--color-subtle); }
  .text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .compacted { flex: none; display: inline-flex; align-items: center; gap: 4px; color: var(--color-subtle); }
  time { flex: none; color: var(--color-subtle); font-variant-numeric: tabular-nums; }
</style>
