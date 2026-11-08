<script lang="ts">
  import InfoTip from './InfoTip.svelte';
  import SyncMark from './SyncMark.svelte';
  import { strings } from '../lib/strings';
  import type { Store } from '../lib/store.svelte';
  import { toggled } from '../lib/autosave.svelte';

  /** What an agent may do to the person at the machine: take a window's focus, play a sound. General on a desktop, a page of General's index on a phone. */
  let { store }: { store: Store } = $props();
  const uid = $props.id();
</script>

<section class="card" id="settings-quiet">
  <h2 class="ui-label-box"><span class="ui-label">{strings.protection.quiet}</span><InfoTip topic={strings.protection.quiet} text={strings.protection.windows} /></h2>
  <label for="{uid}-focus-guard" class="switch-row">
    <span class="text"><span id="{uid}-focus-guard-name">{strings.settings.focusGuard}</span><SyncMark {store} key="focusGuard" /></span>
    <input id="{uid}-focus-guard" aria-labelledby="{uid}-focus-guard-name" type="checkbox" role="switch" data-testid="setting-focus-guard" checked={store.settings?.focusGuard ?? true} onchange={(event) => void toggled(event.currentTarget, focusGuard => store.saveSettings({ focusGuard }))} />
  </label>
  <label for="{uid}-mute-agents" class="switch-row">
    <span class="text"><span id="{uid}-mute-agents-name">{strings.settings.muteAgents}</span><SyncMark {store} key="muteAgents" /></span>
    <input id="{uid}-mute-agents" aria-labelledby="{uid}-mute-agents-name" type="checkbox" role="switch" data-testid="setting-mute-agents" checked={store.settings?.muteAgents ?? true} onchange={(event) => void toggled(event.currentTarget, muteAgents => store.saveSettings({ muteAgents }))} />
  </label>
</section>
