<script lang="ts">
  import { dayLabel } from '../lib/day-breaks';
  import { longDay } from '../lib/format';

  /** Where the conversation changes day: the day on a small chip across the column (`dayBreaks`). */
  let { at }: { at: number } = $props();
</script>

<div class="day" data-testid="day-divider">
  <span class="rule"></span>
  <time class="ui-label" datetime={new Date(at).toISOString().slice(0, 10)} title={longDay(at)}>{dayLabel(at)}</time>
  <span class="rule"></span>
</div>

<style>
  /* A chip, not a bare line: the thin dividers belong to turns, this one to the calendar. */
  .day { align-self: stretch; display: flex; align-items: center; gap: 12px; margin: 4px 0 16px; }
  .rule { flex: 1; min-width: 12px; height: 1px; background: var(--color-border); }
  time {
    flex: none;
    padding: 2px 10px;
    border: 1px solid var(--color-border);
    border-radius: 999px;
    background: var(--color-surface-2);
    color: var(--color-foreground);
    font-size: var(--text-xs);
    font-weight: 600;
  }
</style>
