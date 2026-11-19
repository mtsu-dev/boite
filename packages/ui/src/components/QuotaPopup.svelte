<script lang="ts">
  import { Gauge, RefreshCw, Settings2, X } from '@lucide/svelte';
  import type { AccountQuota } from '@boite/contracts';
  import type { Snippet } from 'svelte';
  import { strings } from '../lib/strings';
  import QuotaLoadState from './QuotaLoadState.svelte';
  import Deferred from './Deferred.svelte';
  import { parts } from '../lib/nested-parts';

  let { rows, current = null, loading, completed, error = '', outdated = false, owner = true, order = [], reorder, refresh, connect, settings, close, title, actions, testPrefix = 'quota' }: {
    rows: AccountQuota[] | null;
    loading: boolean;
    completed: string[];
    error?: string;
    /** The core predates paired devices reading limits. */
    outdated?: boolean;
    /** Only the owner forces a new reading; a paired device's retry reads what the core holds. */
    owner?: boolean;
    order?: string[];
    reorder?: (order: string[]) => Promise<boolean>;
    refresh: () => void;
    /** Absent where Providers is out of reach: a phone or a paired device. */
    connect?: () => void;
    settings: () => void;
    close: () => void;
    title?: Snippet;
    actions?: Snippet;
    testPrefix?: string;
    /** The account the open thread runs on: its row stands out. */
    current?: string | null;
  } = $props();
</script>

<div class="quota-popup" data-testid="quota-panel">
  <header>
    <h2><Gauge size={17} /><span>{#if title}{@render title()}{:else}{strings.quotas.glance}{/if}</span></h2>
    <div class="actions">
      {@render actions?.()}
      {#if owner}
        <button type="button" class="ghost icon" aria-label={strings.quotas.refresh} title={strings.quotas.refresh} aria-busy={loading} data-testid={`${testPrefix}-refresh`} onclick={refresh}><RefreshCw size={16} class={loading ? 'spinning' : ''} /></button>
      {/if}
      <button type="button" class="ghost icon" aria-label={strings.common.close} title={strings.common.close} onclick={close}><X size={17} /></button>
    </div>
  </header>
  <section class="body">
    <QuotaLoadState {error} {outdated} pending={rows === null} busy={loading} retry={refresh} {testPrefix}>
      {#if rows && !(error && rows.length === 0)}
        {@const shown = rows}
        <Deferred part={parts.QuotaOverview}>{#snippet children(QuotaOverview)}<QuotaOverview rows={shown} {current} {loading} {completed} {connect} {order} onreorder={reorder} />{/snippet}</Deferred>
      {/if}
    </QuotaLoadState>
  </section>
  <footer>
    <button type="button" class="ghost" data-testid={`${testPrefix}-page`} onclick={settings}><Settings2 size={15} /><span class="ui-label">{strings.quotas.allLimits}</span></button>
  </footer>
</div>

<style>
  .quota-popup { display: flex; flex-direction: column; min-height: 0; height: 100%; color: var(--color-foreground); background: var(--color-surface-2); }
  header, footer { flex: none; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 4px 10px 4px 12px; }
  header { border-bottom: 1px solid var(--color-border); }
  footer { border-top: 1px solid var(--color-border); }
  h2 { display: flex; align-items: center; gap: 6px; min-width: 0; margin: 0; font-size: var(--text-sm); font-weight: 600; }
  h2 :global(svg) { flex: none; color: var(--color-muted-foreground); }
  .actions { flex: none; display: flex; gap: 2px; }
  .body { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 2px 8px; }
  footer button { font-size: var(--text-sm); }
  .actions :global(.spinning) { animation: spin 900ms linear infinite var(--loops); }
  @media (prefers-reduced-motion: reduce) { .actions :global(.spinning) { animation: none; } }
</style>
