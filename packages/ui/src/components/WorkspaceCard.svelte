<script lang="ts">
  import { strings } from '../lib/strings';
  import CardScope from './CardScope.svelte';
  import { work, type PanelStart, type StartIn } from '../lib/work-prefs.svelte';

  /**
   * What the tour's question set, each piece on its own: where a new window
   * starts and what the side panel opens on. Behaviour, so it sits in General;
   * it keeps the `settings-workspace` anchor it had under Appearance.
   */
  let starts = $derived<{ id: StartIn; label: string }[]>([
    { id: 'drafts', label: strings.settings.startDrafts },
    { id: 'project', label: strings.settings.startProject }
  ]);
  let panels = $derived<{ id: PanelStart; label: string }[]>([
    { id: 'launcher', label: strings.settings.panelLauncher },
    { id: 'files', label: strings.settings.panelFiles },
    { id: 'changes', label: strings.settings.panelChanges }
  ]);
</script>

<section class="card" id="settings-workspace">
  <h2><span class="ui-label">{strings.settings.workspace}</span><CardScope /></h2>
  <div class="switch-row">
    <span class="text ui-label">{strings.settings.startIn}</span>
    <div class="segmented" role="group" aria-label={strings.settings.startIn}>
      {#each starts as option (option.id)}
        <button type="button" class:on={work.current.startIn === option.id} aria-pressed={work.current.startIn === option.id} data-testid="start-in-{option.id}" onclick={() => work.setStartIn(option.id)}><span class="ui-label">{option.label}</span></button>
      {/each}
    </div>
  </div>
  <div class="switch-row">
    <span class="text ui-label">{strings.settings.panelStart}</span>
    <div class="segmented" role="group" aria-label={strings.settings.panelStart}>
      {#each panels as option (option.id)}
        <button type="button" class:on={work.current.panel === option.id} aria-pressed={work.current.panel === option.id} data-testid="panel-start-{option.id}" onclick={() => work.setPanel(option.id)}><span class="ui-label">{option.label}</span></button>
      {/each}
    </div>
  </div>
</section>
