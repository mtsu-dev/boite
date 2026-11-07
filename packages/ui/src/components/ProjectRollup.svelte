<script lang="ts">
  import { LoaderCircle } from '@lucide/svelte';
  import { fill, strings } from '../lib/strings';
  import type { projectRollup } from '../lib/thread-state';

  /**
   * What a folded project's threads do, beside its name in the sidebar and on a phone:
   * the most urgent state, a spinner while one works, and the count beside it.
   */
  let { rollup }: { rollup: NonNullable<ReturnType<typeof projectRollup>> } = $props();
  const label = $derived(fill(rollup.count === 1 ? strings.sidebar.rollupOne : strings.sidebar.rollupMany, { count: String(rollup.count), state: strings.sidebar.state[rollup.kind] }));
</script>

<span class="rollup {rollup.kind}" data-testid="project-rollup" data-state={rollup.kind} title={label} aria-label={label}
  >{#if rollup.kind === 'working'}<LoaderCircle size={11} class="spinner" aria-hidden="true" />{:else}<span class="dot" aria-hidden="true"></span>{/if}{#if rollup.count > 1}<span class="ui-label">{rollup.count}</span>{/if}</span>

<style>
  .rollup {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 4px;
    font-size: var(--text-xs);
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }
  .rollup .dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
  .rollup.working, .rollup.delegating, .rollup.monitoring, .rollup.background, .rollup.watching { color: var(--color-accent); }
  .rollup.waiting { color: var(--color-live); }
  .rollup.error { color: var(--color-danger); }
  .rollup.done { color: var(--color-success); }
  .rollup.queued { color: var(--color-muted-foreground); }
  .rollup.delegating .dot, .rollup.monitoring .dot, .rollup.background .dot, .rollup.watching .dot { animation: pulse 1.6s var(--loop-ease-out-quint-48) infinite var(--loops); }
  .rollup :global(.spinner) { animation: spin 1s steps(60) infinite var(--loops); }
  @media (prefers-reduced-motion: reduce) { .rollup .dot, .rollup :global(.spinner) { animation: none; } }
  :global(html[data-motion='reduced']) .rollup .dot,
  :global(html[data-motion='reduced']) .rollup :global(.spinner) { animation: none; }
</style>
