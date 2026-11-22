<script lang="ts">
  import { markFeature } from '@boite/contracts';
  import { backdrop, type BackdropChoice } from '../../lib/backdrop/choice.svelte';
  import { strings } from '../../lib/strings';
  import InfoTip from '../InfoTip.svelte';

  markFeature('boite-feature:draft-backdrop');

  /** The row of Settings, Appearance that picks the scene of the empty new thread screen, on this device. */
  let options = $derived<{ id: BackdropChoice; label: string }[]>([
    { id: 'off', label: strings.settings.backdropOff },
    { id: 'random', label: strings.settings.backdropRandom },
    { id: 'glyphs', label: strings.settings.backdropGlyphs },
    { id: 'crates', label: strings.settings.backdropCrates },
    { id: 'tunnel', label: strings.settings.backdropTunnel }
  ]);
</script>

<div class="switch-row" id="settings-backdrop">
  <span class="text"><span class="ui-label-box"><span class="ui-label">{strings.settings.backdrop}</span><InfoTip topic={strings.settings.backdrop} text={strings.settings.backdropHint} /></span></span>
  <div class="segmented" role="group" aria-label={strings.settings.backdrop}>
    {#each options as option (option.id)}
      <button type="button" class:on={backdrop.choice === option.id} aria-pressed={backdrop.choice === option.id} data-testid="backdrop-{option.id}" onclick={() => backdrop.set(option.id)}>
        <span class="ui-label">{option.label}</span>
      </button>
    {/each}
  </div>
</div>

<style>
  /* On a phone the label sits above its five choices, as the page's other rows do. */
  @media (max-width: 720px) {
    :global(.settings .page) .switch-row { flex-direction: column; align-items: stretch; }
    :global(.settings .page) .segmented { display: flex; }
    .segmented button { flex: 1 1 auto; min-width: 0; padding: 0 6px; }
    .segmented button .ui-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  }
</style>
