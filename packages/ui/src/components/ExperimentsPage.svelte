<script lang="ts">
  import InfoTip from './InfoTip.svelte';
  import CardScope from './CardScope.svelte';
  import { untrack } from 'svelte';
  import { EXPERIMENT_SETTINGS, EXPERIMENT_STAGES, buildKindOf, featureRuns, isSettingExperiment, type SettingExperimentId } from '@boite/contracts';
  import { canFollowDesktop, desktopExperiments, experimentsBuild, followsDesktop, listedSwitches, readExperiments, setExperiment, setFollowDesktop, subscribeExperiments, type ExperimentId } from '../lib/experiments';
  import { experimentCopy } from '../lib/experiment-copy';
  import { loadAutoGoalSetting } from '../lib/auto-goal-entry';
  import { strings } from '../lib/strings';
  import type { Store } from '../lib/store.svelte';

  /**
   * The primary core decides which switches are listed. App switches belong
   * to this device, machine switches to the Store picked in Settings.
   */
  let { store }: { store: Store } = $props();
  const uid = $props.id();

  let copy = $derived(experimentCopy());

  let enabled = $state<ExperimentId[]>(untrack(() => readExperiments()));
  let following = $state(untrack(() => followsDesktop()));
  let heard = $state(untrack(() => desktopExperiments() !== null));

  let listed = $state<ExperimentId[]>(untrack(() => listedSwitches()));
  let app = $derived(listed.filter(id => !isSettingExperiment(id)));
  let machine = $derived(listed.filter(isSettingExperiment));
  /**
   * A Dev build lists the features of two tags, so each switch says its own
   * and the dev-only ones stand out. A Nightly lists one tag: nothing to tell apart.
   */
  let tagged = $state(untrack(() => buildKindOf(experimentsBuild()) === 'dev'));
  let saving = $state(false);
  const available = (id: SettingExperimentId) => featureRuns(id, store.core?.version);
  const on = (id: SettingExperimentId) => available(id) && store.settings?.[EXPERIMENT_SETTINGS[id]] === true;
  async function toggle(id: SettingExperimentId, input: HTMLInputElement) {
    const owner = store;
    saving = true;
    try {
      if (!await owner.saveSettings({ [EXPERIMENT_SETTINGS[id]]: input.checked })) {
        input.checked = owner.settings?.[EXPERIMENT_SETTINGS[id]] === true;
      }
    } finally { saving = false; }
  }

  // The desktop app can change them while the page is open.
  $effect(() => subscribeExperiments((next) => {
    enabled = next;
    listed = listedSwitches();
    tagged = buildKindOf(experimentsBuild()) === 'dev';
    following = followsDesktop();
    heard = desktopExperiments() !== null;
  }));
</script>

<div class="page" data-testid="experiments-page">
  <header>
    <div>
      <h1 class="ui-label-box"><span class="ui-label">{strings.settings.tabs.experiments}</span><InfoTip topic={strings.settings.tabs.experiments} text={strings.settings.experiments.intro} /></h1>
    </div>
  </header>

  {#if app.length > 0}
    <section class="card">
      <div class="scope"><CardScope /></div>
      {#if canFollowDesktop()}
        <label for="{uid}-follow" class="switch-row">
          <span class="text">
            <span class="ui-label-box"><span class="ui-label" id="{uid}-follow-name">{strings.settings.experiments.follow}</span><InfoTip topic={strings.settings.experiments.follow} text={heard ? strings.settings.experiments.followHint : strings.settings.experiments.followNone} /></span>
          </span>
          <input id="{uid}-follow" aria-labelledby="{uid}-follow-name" type="checkbox" role="switch" data-testid="experiments-follow"
            checked={following} onchange={(event) => setFollowDesktop(event.currentTarget.checked)} />
        </label>
      {/if}
      {#each app as id (id)}
        <label for="{uid}-{id}" class="switch-row" id="settings-{id}">
          {@render words(id)}
          <input id="{uid}-{id}" aria-labelledby="{uid}-{id}-name" type="checkbox" role="switch" data-testid="experiment-{id}"
            checked={enabled.includes(id)} onchange={(event) => setExperiment(id, event.currentTarget.checked)} />
        </label>
      {/each}
    </section>
  {/if}

  {#if machine.length > 0}
    <section class="card">
      <div class="scope"><CardScope {store} /></div>
      {#each machine as id (id)}
        <label for="{uid}-{id}" class="switch-row" id="settings-{id}">
          {@render words(id)}
          <input id="{uid}-{id}" aria-labelledby="{uid}-{id}-name" type="checkbox" role="switch" data-testid="experiment-{id}"
            checked={on(id)} disabled={!store.owner || !store.settings || !available(id) || saving}
            onchange={(event) => void toggle(id, event.currentTarget)} />
        </label>
        {#if id === 'auto-goal' && store.owner && on(id)}
          {#await loadAutoGoalSetting() then part}
            {#if part}<part.default {store} />{/if}
          {/await}
        {/if}
      {/each}
    </section>
  {/if}
</div>

{#snippet words(id: ExperimentId)}
  {@const title = copy[id]?.title ?? id}
  <span class="text">
    <span class="ui-label-box">
      <span class="ui-label" id="{uid}-{id}-name">{title}</span><InfoTip topic={title} text={copy[id]?.hint ?? ''} />
      {#if tagged}
        {@const tag = EXPERIMENT_STAGES[id] === 'dev' ? 'dev' : 'nightly'}
        <span class="tag" class:dev={tag === 'dev'} data-testid="stage-tag-{id}" data-tag={tag} title={strings.settings.experiments.tagHints[tag]}>{strings.settings.experiments.tags[tag]}</span>
      {/if}
    </span>
  </span>
{/snippet}

<style>
  /* Where a card applies heads it with no rule under it; a card the page's line already places has no head. */
  .scope { display: flex; justify-content: flex-end; }
  .scope:not(:has(:global(.card-scope))) { display: none; }
  :global(.settings .page) .card > .scope + .switch-row { border-top: 0; }
  .tag { flex: none; padding: 0 var(--space-2); border: 1px solid var(--color-border); border-radius: var(--radius-sm); color: var(--color-muted-foreground); font-size: var(--text-xs); line-height: 1.5; white-space: nowrap; }
  .tag.dev { color: var(--color-foreground); border-color: var(--color-muted-foreground); }
</style>
