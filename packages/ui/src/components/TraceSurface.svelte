<script lang="ts">
  import { RefreshCw } from '@lucide/svelte';
  import { bytes, percent } from '../lib/format';
  import { strings } from '../lib/strings';
  import type { Store } from '../lib/store.svelte';
  import TraceTable from './TraceTable.svelte';
  import SurfaceHead from './SurfaceHead.svelte';
  import { panelTools } from '../lib/panel-tools.svelte';

  let { store }: { store: Store } = $props();

  let load = $derived(store.openThread?.load ?? null);
  const tools = panelTools();
  /** In a desktop panel's strip, eight tabs leave the head no width: the totals go above the list there. */
  const inStrip = $derived(!!tools?.slot);
  const active = $derived(load?.processes ?? store.trace.filter(record => record.exitedAt === null).length);
  /** A macOS core reads no CPU per thread: its 0 is unknown, as the Task manager says. */
  const cpuUnknown = $derived(store.core?.os === 'macos');

  // The surface reads the trace the moment it is the one showing, whichever
  // way it got there: the chat header, the launcher, a tab, a restored panel.
  $effect(() => {
    const id = store.openThread?.id;
    if (id) void store.refreshTrace();
  });

  // `Store.open` no longer reads a trace nobody is looking at; this says somebody is.
  $effect(() => {
    store.traceWatched = true;
    return () => { store.traceWatched = false; };
  });
</script>

<div class="trace-surface" data-testid="trace-panel">
  <SurfaceHead>
    {#if !inStrip}{@render totals()}{/if}
    <span class="spacer"></span>
    <button
      type="button"
      class="icon-button"
      title={strings.common.refresh}
      aria-label={strings.common.refresh}
      data-testid="trace-refresh"
      onclick={() => void store.refreshTrace()}
    >
      <RefreshCw size={14} strokeWidth={1.75} />
    </button>
  </SurfaceHead>
  {#snippet totals()}<span class="totals" data-testid="trace-totals">{store.trace.length} {strings.trace.recorded} · {active} {strings.trace.active}</span>{/snippet}
  {#if inStrip || load}
    <div class="load" class:strip={inStrip}>
    {#if inStrip}{@render totals()}{/if}
    {#if load}<span>{strings.trace.cpu} <b>{cpuUnknown ? strings.resources.unknown : percent(load.cpuPercent)}</b></span><span>{strings.trace.currentMemory} <b>{bytes(load.memoryBytes)}</b></span>{/if}
    </div>
  {/if}
  <div class="scroll">
    <TraceTable records={store.trace} capability={store.core?.trace ?? null} />
  </div>
</div>

<style>
  .trace-surface {
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
  }

  .spacer {
    flex: 1;
  }

  .totals, .load { font-size: var(--text-xs); color: var(--color-muted-foreground); }
  .load { display: flex; flex-wrap: wrap; gap: 4px 14px; padding: 0 12px 8px; }
  .load.strip { padding-top: 8px; }
  .totals, .load > span { white-space: nowrap; }
  .load b { color: var(--color-foreground); font-weight: 500; margin-left: 4px; }

  .scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
</style>
