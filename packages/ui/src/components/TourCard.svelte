<script lang="ts">
  import CardScope from './CardScope.svelte';
  import { strings } from '../lib/strings';
  import { openTour } from '../lib/onboarding.svelte';
  import type { Store } from '../lib/store.svelte';

  /** The tour of the first launch, again: it plays over the conversation, so it leaves Settings. */
  let { store }: { store: Store } = $props();
</script>

<section class="card" id="settings-tour" data-testid="settings-card-tour">
  <h2><span class="ui-label">{strings.settingsMap.tour}</span><CardScope /></h2>
  <div class="switch-row">
    <span class="text"><span class="ui-label">{strings.settings.tourReplay}</span><span class="hint">{strings.settingsMap.tourHint}</span></span>
    <button type="button" data-testid="settings-tour" onclick={() => { store.showChat(); openTour(); }}><span class="ui-label">{strings.settings.tourReplay}</span></button>
  </div>
</section>
