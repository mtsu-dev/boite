<script lang="ts">
  import { strings } from '../lib/strings';
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
  <h2>{strings.settings.workspace}</h2>
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

<style>
  /* The segmented track Appearance draws: the chosen option raised on a dark track. */
  .segmented { display: inline-flex; flex: none; gap: 2px; padding: 2px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-frame); }
  .segmented button { height: var(--control-sm); padding: 0 10px; border: 1px solid transparent; border-radius: var(--radius-sm); background: transparent; color: var(--color-muted-foreground); font-size: var(--text-sm); }
  @media (hover: hover) { .segmented button:hover:not(.on) { background: var(--color-surface-3); color: var(--color-foreground); } }
  .segmented button.on { background: var(--color-surface-3); border-color: var(--color-edge); color: var(--color-foreground); box-shadow: var(--shadow-e1); }
</style>
