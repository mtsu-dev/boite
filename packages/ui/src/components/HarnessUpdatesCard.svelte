<script lang="ts">
  import { lockedBy } from '../lib/policy';
  import { onMount } from 'svelte';
  import { RefreshCw } from '@lucide/svelte';
  import { providerEnabled } from '@boite/contracts';
  import type { Store } from '../lib/store.svelte';
  import { strings } from '../lib/strings';
  import ProviderVersion from './ProviderVersion.svelte';
  import ProviderLogo from './ProviderLogo.svelte';
  import InfoTip from './InfoTip.svelte';
  import PolicyLock from './PolicyLock.svelte';

  let { store }: { store: Store } = $props();
  const uid = $props.id();
  let checking = $state(false);
  const connected = $derived(store.owner && store.connection === 'ready');
  const busy = $derived(checking || store.harnessUpdates.some(update => update.state === 'checking'));
  /** The admin policy's `updates.agents`: `off` checks and updates nothing, any value holds the automatic update. */
  const agentsPolicy = $derived(lockedBy(store.policy, 'updates.agents') ? store.policy?.values.updates?.agents ?? null : null);
  const updatesOff = $derived(agentsPolicy === 'off');
  // A provider turned off is never asked its version and never updated.
  const providers = $derived(store.providers.filter(provider => {
    if (!providerEnabled(provider)) return false;
    const install = store.installOf(provider.id);
    return store.harnessUpdates.some(update => update.providerId === provider.id && (update.current !== null || update.state !== 'idle'))
      || (provider.available && install?.state === 'installed')
      || install?.state === 'verifying' || install?.state === 'downloading' || install?.state === 'extracting' || install?.state === 'failed';
  }));

  async function check() {
    checking = true;
    try { await store.loadHarnessUpdates(true); }
    finally { checking = false; }
  }

  async function toggleAuto(input: HTMLInputElement) {
    if (!await store.saveSettings({ autoUpdateHarnesses: input.checked })) input.checked = store.settings?.autoUpdateHarnesses ?? false;
  }

  onMount(() => { if (connected && !updatesOff && store.harnessUpdates.length === 0) void check(); });
</script>

<!-- Each machine's agents and their versions, on that machine's Providers page. -->
<section class="card agent-updates" id="settings-agent-updates" data-testid="harness-updates-card">
  <header class="card-head">
    <h2 class="ui-label-box"><span class="ui-label">{strings.harnessUpdates.heading}</span><InfoTip topic={strings.harnessUpdates.heading} text={strings.harnessUpdates.intro} />{#if updatesOff}<PolicyLock {store} keys={['updates.agents']} />{/if}</h2>
    <button type="button" class="ghost small" data-testid="harness-updates-check" disabled={!connected || busy || updatesOff} onclick={() => void check()}>
      <RefreshCw size={13} /><span class="ui-label">{busy ? strings.harnessUpdates.checking : strings.providerSettings.checkUpdates}</span>
    </button>
  </header>
  <div class="agents">
    {#each providers as provider (provider.id)}
      {@const update = store.harnessUpdates.find(entry => entry.providerId === provider.id)}
      {@const install = update?.route === 'self' ? undefined : store.installOf(provider.id)}
      {@const installing = install?.state === 'verifying' || install?.state === 'downloading' || install?.state === 'extracting'}
      <div class="agent" data-testid="machine-agent-update" data-provider-id={provider.id}>
        <div class="agent-row">
          <span class="name"><ProviderLogo providerId={provider.id} size={16} /><span class="ui-label">{provider.name}</span></span>
          <ProviderVersion {store} {provider} controls main {installing} disabled={!connected || busy || updatesOff}
            oninstall={() => void store.installProvider(provider.id)} />
          {#if installing}
            <span class="progress ui-label" role="status">{strings.providerSettings.updating}</span>
            <button class="ghost small" data-testid="install-cancel" disabled={!connected} onclick={() => void store.cancelInstall(provider.id)}><span class="ui-label">{strings.common.cancel}</span></button>
          {:else if install?.state === 'failed' && update?.state !== 'failed'}
            <button class="small" disabled={!connected || busy || updatesOff} data-testid="install-update" onclick={() => void store.installProvider(provider.id)}><span class="ui-label">{strings.common.retry}</span></button>
          {/if}
        </div>
        {#if installing}
          {@const progress = install?.state === 'downloading' && install.totalBytes > 0 ? Math.min(100, install.receivedBytes / install.totalBytes * 100) : null}
          <div class="track" data-testid="install-progress" role="progressbar" aria-label={strings.install.progress}
            aria-valuemin={progress === null ? undefined : 0} aria-valuemax={progress === null ? undefined : 100}
            aria-valuenow={progress === null ? undefined : Math.round(progress)}>
            <span style:width={progress === null ? '100%' : `${progress}%`}></span>
          </div>
        {/if}
        {#if update?.state === 'failed' || install?.state === 'failed'}
          <p class="error" role="status">{update?.message ?? (install?.state === 'failed' ? install.message : null) ?? strings.harnessUpdates.failed(provider.name)}</p>
        {/if}
      </div>
    {:else}
      <p class="empty-agents">{strings.harnessUpdates.none}</p>
    {/each}
  </div>
  <label class="auto" for="{uid}-auto-update">
    <span class="words"><span class="ui-label-box"><span class="ui-label">{strings.providerSettings.autoUpdate}</span><InfoTip topic={strings.providerSettings.autoUpdate} text={strings.harnessUpdates.autoHint} /><PolicyLock {store} keys={['updates.agents']} /></span><span class="effect" id="{uid}-auto-update-effect">{strings.settings.effects.harnessAutoUpdate}</span></span>
    <input id="{uid}-auto-update" aria-describedby="{uid}-auto-update-effect" type="checkbox" role="switch" data-testid="setting-auto-update-harnesses"
      checked={store.settings?.autoUpdateHarnesses ?? false} disabled={!connected || !store.settings || agentsPolicy !== null}
      onchange={(event) => void toggleAuto(event.currentTarget)} />
  </label>
</section>

<style>
  .agent-updates { font-size: var(--text-sm); }
  .agent-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 12px; }
  /* The card's row line runs over the list (app.css): the first agent keeps the same air under it as between two agents. */
  .agents { display: grid; gap: 12px; padding: var(--space-3) 0; }
  .agent-row { justify-content: flex-start; }
  .name { display: inline-flex; flex: 1; align-items: center; gap: 8px; min-width: 140px; }
  .name :global(svg) { flex: none; }
  .progress, .empty-agents { color: var(--color-muted-foreground); }
  .empty-agents { margin: 0; }
  .error { margin: 6px 0 0; }
  .track { height: 3px; margin-top: 8px; background: var(--color-surface-3); border-radius: var(--radius-sm); overflow: hidden; }
  .track span { display: block; height: 100%; background: var(--color-foreground); }
  .auto { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: var(--space-3) 0; color: var(--color-muted-foreground); }
  .auto > .words { display: grid; gap: 2px; min-width: 0; }
  .auto .ui-label-box { display: inline-flex; align-items: center; }
  .effect { color: var(--color-muted-foreground); font-size: var(--text-sm); line-height: 1.4; }
  .auto input { flex: 0 0 40px; width: 40px; }
  @media (max-width: 720px) {
    header button { min-height: var(--touch-target); }
    /* The version stays at the end of its agent's line, in one column with the others: the
       version's actions join the row. One action alone (Run its updater) stays on the agent's line while it fits;
       two of them, or an install in progress, start a line of their own. */
    .agent-row { align-items: center; }
    .name { flex: 1 1 auto; min-width: 0; }
    .agent-row :global(.update) { display: contents; }
    .agent-row :global(.update > .version) { order: 1; margin-left: auto; }
    .agent-row :global(.update > :not(.version)), .agent-row > .progress, .agent-row > button { order: 3; }
    .agent-row:has(:global(.update > :not(.version) ~ :not(.version)), > .progress, > button)::after { content: ''; order: 2; flex-basis: 100%; }
    .auto { min-height: var(--touch-target); }
  }
</style>
