<script lang="ts">
  import { untrack } from 'svelte';
  import { checkSettingsPatch } from '@boite/contracts';
  import InfoTip from './InfoTip.svelte';
  import CardScope from './CardScope.svelte';
  import SaveStatus from './SaveStatus.svelte';
  import { Autosave, typed } from '../lib/autosave.svelte';
  import { strings } from '../lib/strings';
  import type { Store } from '../lib/store.svelte';

  /** Which browser origins, beside the core's own, may reach this core. */
  let { store }: { store: Store } = $props();

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

{#if store.owner}
  <section class="card" id="settings-origins" data-testid="browser-origins">
    <h2 class="ui-label-box"><span class="ui-label">{strings.machines.browserOrigins}</span><InfoTip topic={strings.machines.browserOrigins} text={strings.machines.browserOriginsHint} /><CardScope {store} /><SaveStatus {save} /></h2>
    <textarea bind:value={origins} oninput={() => { dirty = true; typed(save).oninput(); }} onchange={() => void save.flush()} disabled={!store.settings} aria-label={strings.machines.browserOrigins} rows="3" spellcheck="false" placeholder="https://boite.example.com"></textarea>
  </section>
{/if}

<style>
  textarea { display: block; width: 100%; height: auto; min-height: 72px; padding: 8px 10px; margin-bottom: 12px; font-family: var(--font-mono); font-size: var(--text-sm); resize: vertical; }
</style>
