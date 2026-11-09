<script lang="ts">
  import { untrack } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import { readTerminalCursor, setTerminalCursor, type TerminalCursor } from '../lib/terminal-cursor';
  import { featureOn } from '../lib/features.svelte';
  import { setFeature } from '../lib/features';
  import { checkSettingsPatch } from '@boite/contracts';
  import InfoTip from './InfoTip.svelte';
  import CardScope from './CardScope.svelte';
  import SaveStatus from './SaveStatus.svelte';
  import { Autosave, typed } from '../lib/autosave.svelte';
  import CompactionSettings from './CompactionSettings.svelte';
  import SchedulerSettings from './SchedulerSettings.svelte';
  import PhoneSettings from './PhoneSettings.svelte';
  import { strings } from '../lib/strings';
  import type { Store } from '../lib/store.svelte';

  /**
   * What most people never touch: how many turns run at once, how a phone
   * reaches this machine without a server of the group in between, which
   * browser origins may reach this core, the core this window talks to, and
   * on a desktop the terminal's cursor and the scrollbars' manner.
   */
  let { store }: { store: Store } = $props();
  const uid = $props.id();
  const narrow = new MediaQuery('(max-width: 720px)');

  let terminalCursor = $state<TerminalCursor>(untrack(() => readTerminalCursor()));
  let cursors = $derived<{ id: TerminalCursor; label: string }[]>([
    { id: 'bar', label: strings.settings.terminalCursorBar },
    { id: 'block', label: strings.settings.terminalCursorBlock },
    { id: 'underline', label: strings.settings.terminalCursorUnderline }
  ]);
  function pickTerminalCursor(next: TerminalCursor) {
    terminalCursor = next;
    setTerminalCursor(next);
  }

  let origins = $state('');
  /** A draft being typed survives a settings update from elsewhere; a save lets the saved list back in. */
  let dirty = $state(false);
  let saved = $derived((store.settings?.browserOrigins ?? []).join('\n'));
  $effect(() => {
    const next = saved;
    untrack(() => { if (!dirty) origins = next; });
  });

  const list = () => origins.split('\n').map((line) => line.trim()).filter(Boolean);
  const save = new Autosave(async () => {
    const sent = origins;
    if (!await store.saveSettings({ browserOrigins: list() })) throw new Error('');
    if (origins === sent) dirty = false;
  }, () => checkSettingsPatch({ browserOrigins: list() }).ok ? null : strings.settings.autosave.invalid);
  $effect(() => () => void save.flush());
</script>

<div class="page" data-testid="advanced-page">
  <header>
    <h1>{strings.settings.tabs.advanced}</h1>
  </header>

  <SchedulerSettings {store} />
  <CompactionSettings {store} />

  <PhoneSettings {store} />

  {#if store.owner}
    <section class="card" id="settings-origins" data-testid="browser-origins">
      <h2 class="ui-label-box"><span class="ui-label">{strings.machines.browserOrigins}</span><InfoTip topic={strings.machines.browserOrigins} text={strings.machines.browserOriginsHint} /><CardScope {store} /><SaveStatus {save} /></h2>
      <textarea bind:value={origins} oninput={() => { dirty = true; typed(save).oninput(); }} onchange={() => void save.flush()} disabled={!store.settings} aria-label={strings.machines.browserOrigins} rows="3" spellcheck="false" placeholder="https://boite.example.com"></textarea>
    </section>
  {/if}

  {#if !narrow.current}
    <!-- Desktop details few people change, once under Appearance. -->
    <section class="card" id="settings-details">
      <h2><span class="ui-label">{strings.settings.terminalAndScrollbars}</span><CardScope /></h2>
      <div class="switch-row">
        <span class="text ui-label">{strings.settings.terminalCursor}</span>
        <div class="segmented" role="group" aria-label={strings.settings.terminalCursor}>
          {#each cursors as option (option.id)}
            <button type="button" class:on={terminalCursor === option.id} aria-pressed={terminalCursor === option.id} data-testid="terminal-cursor-{option.id}" onclick={() => pickTerminalCursor(option.id)}><span class="ui-label">{option.label}</span></button>
          {/each}
        </div>
      </div>
      <label class="switch-row" for="{uid}-edge-scrollbars">
        <span class="text ui-label-box"><span class="ui-label" id="{uid}-edge-scrollbars-name">{strings.features.edgeScrollbars.title}</span><InfoTip topic={strings.features.edgeScrollbars.title} text={strings.features.edgeScrollbars.hint} /></span>
        <input id="{uid}-edge-scrollbars" aria-labelledby="{uid}-edge-scrollbars-name" type="checkbox" role="switch" checked={featureOn('edge-scrollbars')} data-testid="setting-edge-scrollbars"
          onchange={event => setFeature('edge-scrollbars', event.currentTarget.checked)} />
      </label>
    </section>
  {/if}

  <section class="card" id="settings-core">
    <h2>{strings.settings.core}</h2>
    {#if store.core}
      <dl>
        <dt>{strings.settings.version}</dt>
        <dd data-testid="settings-version">{store.core.version}</dd>
        <dt>{strings.settings.protocol}</dt>
        <dd>{store.core.protocolVersion}</dd>
        <dt>{strings.settings.os}</dt>
        <dd>{store.core.os}</dd>
        <dt>{strings.settings.pid}</dt>
        <dd>{store.core.pid}</dd>
        <dt>{strings.settings.endpoint}</dt>
        <dd class="mono" data-testid="settings-endpoint">{store.core.endpoint.host}:{store.core.endpoint.port}</dd>
        <dt>{strings.settings.dataDir}</dt>
        <dd class="mono">{store.core.dataDir}</dd>
      </dl>
    {:else}
      <p class="hint">{strings.settings.noCore}</p>
    {/if}
  </section>
</div>

<style>
  textarea { display: block; width: 100%; height: auto; min-height: 72px; padding: 8px 10px; margin-bottom: 12px; font-family: var(--font-mono); font-size: var(--text-sm); resize: vertical; }
  /* The settings row grammar: the name at the start, its value at the end, a hairline between rows,
     so the card reads across its whole width instead of leaving its right half empty. */
  dl { display: grid; grid-template-columns: 140px 1fr; align-items: baseline; margin: 0; }
  dt, dd { padding: 7px 0; }
  dt:not(:first-of-type), dd:not(:first-of-type) { border-top: 1px solid var(--color-border); }
  dt { color: var(--color-muted-foreground); font-size: var(--text-sm); }
  /* Versions and numbers read in the sans; only an address and a path stay mono. */
  dd { margin: 0; padding-left: var(--space-3); text-align: end; overflow: hidden; text-overflow: ellipsis; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
</style>
