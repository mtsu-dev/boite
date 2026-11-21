<script lang="ts">
  import InfoTip from './InfoTip.svelte';
  import { untrack } from 'svelte';
  import { EXPERIMENT_STAGES, buildKindOf } from '@boite/contracts';
  import { canFollowDesktop, desktopExperiments, experimentsBuild, followsDesktop, listedSwitches, readExperiments, setExperiment, setFollowDesktop, subscribeExperiments, type ExperimentId } from '../lib/experiments';
  import { experimentCopy } from '../lib/experiment-copy';
  import { strings } from '../lib/strings';

  /**
   * The switches of this device: the experiments the primary machine's build
   * lists. Settings has the page only while there is one to list
   * (`experimentsAvailable`): none on a Release, and none while every feature
   * is finished. A machine's own settings live on the pages they belong to.
   */
  const uid = $props.id();

  let copy = $derived(experimentCopy());

  let enabled = $state<ExperimentId[]>(untrack(() => readExperiments()));
  let following = $state(untrack(() => followsDesktop()));
  let heard = $state(untrack(() => desktopExperiments() !== null));

  let listed = $state<ExperimentId[]>(untrack(() => listedSwitches()));
  /**
   * A Dev build lists the features of two tags, so each switch says its own
   * and the dev-only ones stand out. A Nightly lists one tag: nothing to tell apart.
   */
  let tagged = $state(untrack(() => buildKindOf(experimentsBuild()) === 'dev'));
  function toggle(id: ExperimentId, on: boolean) {
    setExperiment(id, on);
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

  <!-- The desktop app is what a phone follows: it has no one to follow itself. -->
  {#if canFollowDesktop()}
    <section class="card">
      <label for="{uid}-follow" class="switch-row">
        <span class="text">
          <span class="ui-label-box"><span class="ui-label" id="{uid}-follow-name">{strings.settings.experiments.follow}</span><InfoTip topic={strings.settings.experiments.follow} text={heard ? strings.settings.experiments.followHint : strings.settings.experiments.followNone} /></span>
        </span>
        <input id="{uid}-follow" aria-labelledby="{uid}-follow-name" type="checkbox" role="switch" data-testid="experiments-follow"
          checked={following} onchange={(event) => setFollowDesktop(event.currentTarget.checked)} />
      </label>
    </section>
  {/if}

  <section class="card">
    {#each listed as id (id)}
      <label for="{uid}-{id}" class="switch-row" id="settings-{id}">
        <span class="text">
          <span class="ui-label-box"><span class="ui-label" id="{uid}-{id}-name">{copy[id]?.title ?? id}</span><InfoTip topic={copy[id]?.title ?? id} text={copy[id]?.hint ?? ''} />{#if tagged}{@const tag = EXPERIMENT_STAGES[id] === 'dev' ? 'dev' : 'nightly'}<span class="tag" class:dev={tag === 'dev'} data-testid="stage-tag-{id}" data-tag={tag} title={strings.settings.experiments.tagHints[tag]}>{strings.settings.experiments.tags[tag]}</span>{/if}</span>
        </span>
        <input id="{uid}-{id}" aria-labelledby="{uid}-{id}-name"
          type="checkbox"
          role="switch"
          data-testid="experiment-{id}"
          checked={enabled.includes(id)}
          onchange={(event) => toggle(id, event.currentTarget.checked)}
        />
      </label>
    {/each}
  </section>
</div>

<style>
  .tag { flex: none; padding: 0 var(--space-2); border: 1px solid var(--color-border); border-radius: var(--radius-sm); color: var(--color-muted-foreground); font-size: var(--text-xs); line-height: 1.5; white-space: nowrap; }
  .tag.dev { color: var(--color-foreground); border-color: var(--color-muted-foreground); }
</style>
