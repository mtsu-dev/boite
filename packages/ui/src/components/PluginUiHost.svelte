<script lang="ts">
  import { ShieldAlert } from '@lucide/svelte';
  import { pluginUi, safeModeAt } from '../lib/plugin-ui.svelte';
  import { strings } from '../lib/strings';
  import type { Store } from '../lib/store.svelte';
  import { workspace } from '../lib/workspace.svelte';

  /**
   * Loads plugin interfaces from the window's own core, again on each new
   * connection, and says so when safe mode kept them off. Tests hand their store.
   */
  let { store = workspace.primary }: { store?: Store } = $props();

  const storage = (() => { try { return localStorage; } catch { return null; } })();
  pluginUi.start({
    openTab: (key, title) => store.panel.openPluginTab(key, title),
    threadId: () => store.openThread?.id ?? null,
    storage,
  }, safeModeAt(location.search, storage));

  $effect(() => {
    // A new connection is a new client: read the interfaces it serves now.
    void store.clientGeneration;
    if (store.connection !== 'ready' || !store.client) return;
    return pluginUi.attach(store.client);
  });

  $effect(() => () => pluginUi.stop());

  let dismissed = $state(false);
  let skipped = $derived(Object.values(pluginUi.status).filter((status) => status.state === 'skipped').length);
  let shown = $derived(pluginUi.safe.active && !dismissed && (pluginUi.safe.reason === 'flag' || skipped > 0));
</script>

{#if shown}
  <div class="safe-mode" role="status" data-testid="plugin-safe-mode" data-reason={pluginUi.safe.reason}>
    <span class="logo" aria-hidden="true"><ShieldAlert size={18} strokeWidth={1.75} /></span>
    <div class="lines">
      <span class="heading">{strings.pluginUi.safeTitle}</span>
      <p>{pluginUi.safe.reason === 'crash' ? strings.pluginUi.safeCrash : strings.pluginUi.safeFlag}</p>
    </div>
    <div class="actions">
      <button type="button" class="quiet small" data-testid="plugin-safe-keep" onclick={() => (dismissed = true)}>{strings.pluginUi.safeDismiss}</button>
      <button type="button" class="primary small" data-testid="plugin-safe-load" onclick={() => { dismissed = true; void pluginUi.leaveSafeMode(); }}>{strings.pluginUi.safeLoad}</button>
    </div>
  </div>
{/if}

<style>
  /* Pinned like the plugin update notice, at the bottom so both can show. */
  .safe-mode {
    position: fixed;
    right: max(16px, env(safe-area-inset-right));
    bottom: calc(16px + env(safe-area-inset-bottom, 0px));
    z-index: 54;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: 8px 12px;
    width: min(400px, calc(100vw - 32px));
    padding: 10px 12px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-surface-2);
    box-shadow: var(--shadow-e3);
    animation: rise var(--dur-3) var(--ease-out-quint);
  }
  .logo {
    display: grid;
    place-items: center;
    width: var(--control);
    height: var(--control);
    border-radius: var(--radius-md);
    background: var(--color-accent-soft);
    color: var(--color-accent);
  }
  .heading { display: block; font-size: var(--text-sm); font-weight: 600; }
  p { margin: 2px 0 0; color: var(--color-muted-foreground); font-size: var(--text-xs); line-height: 1.5; }
  .actions { grid-column: 1 / -1; display: flex; justify-content: flex-end; gap: 6px; }
  @media (prefers-reduced-motion: reduce) { .safe-mode { animation: none; } }
</style>
