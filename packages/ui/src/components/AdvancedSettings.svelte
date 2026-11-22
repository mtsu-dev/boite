<script lang="ts">
  import SettingField from './SettingField.svelte';
  import SettingSwitch from './SettingSwitch.svelte';
  import SettingsSection from './SettingsSection.svelte';
  import { untrack } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import { readTerminalCursor, setTerminalCursor, type TerminalCursor } from '../lib/terminal-cursor';
  import { featureOn } from '../lib/features.svelte';
  import { setFeature } from '../lib/features';
  import { checkSettingsPatch } from '@boite/contracts';
  import CardScope from './CardScope.svelte';
  import SaveStatus from './SaveStatus.svelte';
  import { Autosave, typed } from '../lib/autosave.svelte';
  import CompactionSettings from './CompactionSettings.svelte';
  import CacheKeepaliveSettings from './CacheKeepaliveSettings.svelte';
  import DeviceStreamSettings from './DeviceStreamSettings.svelte';
  import SchedulerSettings from './SchedulerSettings.svelte';
  import PhoneSettings from './PhoneSettings.svelte';
  import { strings } from '../lib/strings';
  import type { Store } from '../lib/store.svelte';

  /**
   * What most people never touch: how many turns run at once, keeping the
   * prompt cache warm, compaction, the Device panel's live stream, how a phone
   * reaches this machine without a server of the group in between, which
   * browser origins may reach this core, the core this window talks to, and
   * on a desktop the terminal's cursor and the scrollbars' manner.
   */
  let { store }: { store: Store } = $props();
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

  <SchedulerSettings {store} />
  <CacheKeepaliveSettings {store} />
  <CompactionSettings {store} />
  <DeviceStreamSettings {store} />

  <PhoneSettings {store} />

  {#if store.owner}
    <SettingsSection id="settings-origins" testid="browser-origins" title={strings.machines.browserOrigins} info={strings.machines.browserOriginsHint}>
      {#snippet actions()}<CardScope {store} /><SaveStatus {save} />{/snippet}
      <textarea bind:value={origins} oninput={() => { dirty = true; typed(save).oninput(); }} onchange={() => void save.flush()} disabled={!store.settings} aria-label={strings.machines.browserOrigins} rows="3" spellcheck="false" placeholder="https://boite.example.com"></textarea>
    </SettingsSection>
  {/if}

  {#if !narrow.current}
    <!-- Desktop details few people change, once under Appearance. -->
    <SettingsSection id="settings-details" title={strings.settings.terminalAndScrollbars}>
      {#snippet actions()}<CardScope />{/snippet}
      <SettingField title={strings.settings.terminalCursor} field={false}>
        {#snippet control()}
          <div class="segmented" role="group" aria-label={strings.settings.terminalCursor}>
            {#each cursors as option (option.id)}
              <button type="button" class:on={terminalCursor === option.id} aria-pressed={terminalCursor === option.id} data-testid="terminal-cursor-{option.id}" onclick={() => pickTerminalCursor(option.id)}><span class="ui-label">{option.label}</span></button>
            {/each}
          </div>
        {/snippet}
      </SettingField>
      <SettingField title={strings.features.edgeScrollbars.title} hint={strings.features.edgeScrollbars.hint}>
        {#snippet control(attributes)}
          <SettingSwitch {...attributes} checked={featureOn('edge-scrollbars')} data-testid="setting-edge-scrollbars"
            onchange={(event) => setFeature('edge-scrollbars', event.currentTarget.checked)} />
        {/snippet}
      </SettingField>
    </SettingsSection>
  {/if}

  <SettingsSection id="settings-core" title={strings.settings.core}>
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
  </SettingsSection>
</div>

<style>
  textarea { display: block; width: 100%; height: auto; min-height: 72px; padding: 8px 10px; margin-bottom: 12px; font-family: var(--font-mono); font-size: var(--text-sm); resize: vertical; }
  /* The settings row grammar: the name at the start, its value at the end, a hairline between rows,
     so the card reads across its whole width instead of leaving its right half empty. */
  dl { display: grid; grid-template-columns: 140px 1fr; margin: 0; }
  /* Both cells fill the row on one line height, so each row's hairline runs straight across both columns
     (baseline alignment let the 13 px name and the 14 px value draw theirs at two heights). */
  dt, dd { padding: 7px 0; line-height: 20px; }
  dt:not(:first-of-type), dd:not(:first-of-type) { border-top: 1px solid var(--color-border); }
  dt { color: var(--color-muted-foreground); font-size: var(--text-sm); }
  /* Versions and numbers read in the sans; only an address and a path stay mono. */
  dd { margin: 0; padding-left: var(--space-3); text-align: end; overflow: hidden; text-overflow: ellipsis; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
</style>
