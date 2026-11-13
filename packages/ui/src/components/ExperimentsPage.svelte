<script lang="ts">
  import InfoTip from './InfoTip.svelte';
  import CompactionSettings from './CompactionSettings.svelte';
  import CacheKeepaliveSettings from './CacheKeepaliveSettings.svelte';
  import DeviceStreamSettings from './DeviceStreamSettings.svelte';
  import { loadAutoGoalSetting } from '../lib/auto-goal-entry';
  import { untrack, type Snippet } from 'svelte';
  import { EXPERIMENT_STAGES, buildKindOf, experimentsRun } from '@boite/contracts';
  import { canFollowDesktop, desktopExperiments, experimentsBuild, followsDesktop, listedSwitches, readExperiments, setExperiment, setFollowDesktop, subscribeExperiments, type ExperimentId } from '../lib/experiments';
  import { experimentCopy } from '../lib/experiment-copy';
  import { strings } from '../lib/strings';
  import { ensureOperator } from '../lib/operator';
  import { workspace } from '../lib/workspace.svelte';
  import type { Store } from '../lib/store.svelte';

  /**
   * The switches of this device: the experiments the primary machine's build
   * lists (none on a Release, where Settings has no such page), with the
   * Automatic goals threshold of `store`, this window's machine; then the
   * experiments of `target`, the machine `bar` picks. A machine's own are
   * experiments too: they show only while its core is not a Release.
   */
  let { store, target = store, bar }: { store?: Store; target?: Store; bar?: Snippet } = $props();
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
  /** The machine being configured runs experiments: a Release core refuses them and reads them as off. */
  let machineRuns = $derived(target !== undefined && experimentsRun(target.core?.version));
  let thresholdRuns = $derived(store !== undefined && experimentsRun(store.core?.version));

  function toggle(id: ExperimentId, on: boolean) {
    setExperiment(id, on);
    // The group's one Operator, made where `operatorHost` says when no machine has it yet.
    if (id === 'contacts' && on && store) void ensureOperator(store, workspace.machinesOr(store).map(machine => machine.store));
  }

  // The desktop app can change them while the page is open.
  $effect(() => subscribeExperiments((next) => {
    enabled = next;
    listed = listedSwitches();
    tagged = buildKindOf(experimentsBuild()) === 'dev';
    following = followsDesktop();
    heard = desktopExperiments() !== null;
  }));
  // The threshold loads with the page, out of the builds below the experiment's tag (lib/auto-goal-entry.ts).
  let AutoGoalSetting = $state.raw<typeof import('./AutoGoalSetting.svelte').default>();
  void loadAutoGoalSetting()?.then(module => { AutoGoalSetting = module.default; }).catch(() => {});
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
      <!-- Its threshold is the core's, under the switch while it is on. -->
      {#if id === 'auto-goal' && store && thresholdRuns && enabled.includes(id) && AutoGoalSetting}<AutoGoalSetting {store} />{/if}
    {/each}
  </section>

  {#if target && bar}{@render bar()}{/if}
  {#if target && machineRuns}<CacheKeepaliveSettings store={target} /><CompactionSettings store={target} backgroundOnly /><DeviceStreamSettings store={target} />{/if}
</div>

<style>
  .tag { flex: none; padding: 0 var(--space-2); border: 1px solid var(--color-border); border-radius: var(--radius-sm); color: var(--color-muted-foreground); font-size: var(--text-xs); line-height: 1.5; white-space: nowrap; }
  .tag.dev { color: var(--color-foreground); border-color: var(--color-muted-foreground); }
</style>
