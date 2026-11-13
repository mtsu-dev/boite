<script lang="ts">
  import { Square } from '@lucide/svelte';
  import { fill, strings } from '../lib/strings';
  import type { projectRollup } from '../lib/thread-state';

  /**
   * What a folded project's threads do when its counters (ProjectThreadCounters: Needs you, else working) say
   * nothing, beside its name in the sidebar and on a phone: the most urgent other state, its mark and count.
   */
  let { rollup }: { rollup: NonNullable<ReturnType<typeof projectRollup>> } = $props();
  const label = $derived(fill(rollup.count === 1 ? strings.sidebar.rollupOne : strings.sidebar.rollupMany, { count: String(rollup.count), state: strings.sidebar.state[rollup.kind] }));
</script>

<span class="rollup {rollup.kind}" data-testid="project-rollup" data-state={rollup.kind} title={label} aria-label={label}
  >{#if rollup.kind === 'interrupted'}<Square size={9} fill="currentColor" aria-hidden="true" />{:else}<span class="work-ring" aria-hidden="true"></span>{/if}{#if rollup.count > 1}<span class="ui-label">{rollup.count}</span>{/if}</span>

<style>
  .rollup {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 4px;
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
    color: var(--color-muted-foreground);
  }
  /* The rows' marks: the turning arc for work (a still dotted ring in the queue), the stop's grey square for work that stopped short. */
  .rollup .work-ring { box-sizing: border-box; width: 8px; height: 8px; border: 1.5px dashed var(--color-accent); border-radius: var(--radius-full); }
  .rollup:not(.queued) .work-ring { border-style: solid; border-top-color: transparent; animation: spin 0.9s steps(54) infinite var(--loops); }
  .rollup.queued .work-ring { border-style: dotted; border-color: var(--color-muted-foreground); }
  .rollup.interrupted :global(svg) { color: var(--color-subtle); }
</style>
