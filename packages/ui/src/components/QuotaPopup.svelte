<script lang="ts">
  import { Gauge, RefreshCw } from '@lucide/svelte';
  import type { AccountQuota } from '@boite/contracts';
  import type { Snippet } from 'svelte';
  import { strings } from '../lib/strings';
  import QuotaLoadState from './QuotaLoadState.svelte';
  import PopoverFrame from './PopoverFrame.svelte';
  import Deferred from './Deferred.svelte';
  import { parts } from '../lib/nested-parts';

  let { rows, current = null, loading, completed, error = '', outdated = false, owner = true, order = [], reorder, refresh, connect, settings, close, title, actions: extraActions, testPrefix = 'quota' }: {
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

<PopoverFrame testid="quota-panel" actionLabel={strings.quotas.allLimits} actionTestid={`${testPrefix}-page`} onaction={settings} {close}>
  {#snippet heading()}<Gauge size={17} /><span>{#if title}{@render title()}{:else}{strings.quotas.glance}{/if}</span>{/snippet}
  {#snippet actions()}
    {@render extraActions?.()}
    {#if owner}
      <button type="button" class="ghost icon refresh" aria-label={strings.quotas.refresh} title={strings.quotas.refresh} aria-busy={loading} data-testid={`${testPrefix}-refresh`} onclick={refresh}><RefreshCw size={16} /></button>
    {/if}
  {/snippet}
  <QuotaLoadState {error} {outdated} pending={rows === null} busy={loading} retry={refresh} {testPrefix}>
    {#if rows && !(error && rows.length === 0)}
      {@const shown = rows}
      <Deferred part={parts.QuotaOverview}>{#snippet children(QuotaOverview)}<QuotaOverview rows={shown} {current} {loading} {completed} {connect} {order} onreorder={reorder} />{/snippet}</Deferred>
    {/if}
  </QuotaLoadState>
</PopoverFrame>

<style>
  .refresh[aria-busy='true'] :global(svg) { animation: spin 900ms linear infinite var(--loops); }
  @media (prefers-reduced-motion: reduce) { .refresh[aria-busy='true'] :global(svg) { animation: none; } }
</style>
