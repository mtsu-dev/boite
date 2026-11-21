<script lang="ts">
  import type { Snippet } from 'svelte';
  import { fill, strings } from '../lib/strings';

  let { error, outdated, pending, busy, retry, testPrefix, size = 'popup', beforeRows, children }: {
    error?: string | null;
    outdated: boolean;
    pending: boolean;
    busy: boolean;
    retry: () => void;
    testPrefix: string;
    size?: 'popup' | 'page' | 'pinned';
    beforeRows?: Snippet;
    children: Snippet;
  } = $props();
</script>

{#if error}
  <div class="failed size-{size}" class:card={size === 'page'} role="alert" data-testid="{testPrefix}-error">
    <p>{fill(strings.quotas.readFailed, { error })}</p>
    <button type="button" class="ghost small" disabled={busy} data-testid="{testPrefix}-retry" onclick={retry}><span class="ui-label">{strings.common.retry}</span></button>
  </div>
{/if}
{@render beforeRows?.()}
{#if outdated}
  <p class="status size-{size}" role="status" data-testid="{testPrefix}-outdated">{strings.quotas.outdated}</p>
{:else if pending}
  {#if !error}
    {#if size === 'page'}
      <div class="skeleton" role="status" aria-label={strings.quotas.loading}>
        <div class="card ghost-card"></div><div class="card ghost-card"></div>
      </div>
    {:else}
      <p class="status size-{size}" role="status">{strings.quotas.loading}</p>
    {/if}
  {/if}
{:else}
  {@render children()}
{/if}

<style>
  .failed { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-2); color: var(--color-danger); font-size: var(--text-sm); }
  .failed p { flex: 1 1 12ch; min-width: 0; margin: 0; overflow-wrap: anywhere; }
  .failed.size-popup { padding: var(--space-3) var(--space-1); }
  .failed.size-page { max-width: var(--settings-width); margin-bottom: var(--space-3); padding: var(--settings-padding); }
  .size-pinned { margin: var(--space-1) 0; font-size: var(--text-xs); }
  .status { color: var(--color-muted-foreground); }
  .status.size-popup { margin: 0; padding: 14px var(--space-1); font-size: var(--text-sm); }
  .status.size-page { font-size: var(--text-sm); }
  .skeleton { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(320px, 100%), 1fr)); gap: var(--space-3); max-width: var(--settings-width); }
  .ghost-card { height: 150px; margin: 0; animation: ghost-breathe 1.4s var(--ease-out-quint) infinite alternate var(--loops); }
  @keyframes ghost-breathe { from { opacity: 0.45; } to { opacity: 0.9; } }
  @media (prefers-reduced-motion: reduce) { .ghost-card { animation: none; } }
</style>
