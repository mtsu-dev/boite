<script lang="ts">
  import InfoTip from './InfoTip.svelte';
  import CardScope from './CardScope.svelte';
  import SyncMark from './SyncMark.svelte';
  import TitleModelSetting from './TitleModelSetting.svelte';
  import GoalTrackerSetting from './GoalTrackerSetting.svelte';
  import { strings } from '../lib/strings';
  import type { Store } from '../lib/store.svelte';

  /**
   * How a machine's agents answer: the questions they may leave, the length
   * and the tool summaries of a reply, the models that title a thread and
   * keep its checklist. Saved on the machine, so its own card under General
   * (round 19: once rows of the Conversations card, among this device's switches).
   */
  let { store }: { store: Store } = $props();
  const uid = $props.id();

  /** A switch saves when it flips, as every other switch in Settings does; a refusal puts it back. */
  async function toggle(key: 'asyncQuestions' | 'shortAnswers' | 'toolSummaries', input: HTMLInputElement) {
    const ok = await store.saveSettings({ [key]: input.checked });
    if (!ok) input.checked = store.settings?.[key] ?? (key === 'toolSummaries' ? false : true);
  }
</script>

<section class="card" id="settings-agent-replies" data-testid="agent-replies">
  <h2 class="ui-label-box"><span class="ui-label">{strings.settings.agentReplies}</span><CardScope {store} /></h2>
  <label for="{uid}-async" class="switch-row">
    <span class="text ui-label-box">
      <span class="ui-label" id="{uid}-async-name">{strings.settings.asyncQuestions}</span><InfoTip topic={strings.settings.asyncQuestions} text={strings.settings.asyncQuestionsHint} /><SyncMark {store} key="asyncQuestions" />
    </span>
    <input id="{uid}-async" aria-labelledby="{uid}-async-name" type="checkbox" role="switch" data-testid="setting-async-questions"
      checked={store.settings?.asyncQuestions ?? true} disabled={!store.settings} onchange={(event) => void toggle('asyncQuestions', event.currentTarget)} />
  </label>
  <label for="{uid}-short" class="switch-row">
    <span class="text ui-label-box">
      <span class="ui-label" id="{uid}-short-name">{strings.settings.shortAnswers}</span><InfoTip topic={strings.settings.shortAnswers} text={strings.settings.shortAnswersHint} /><SyncMark {store} key="shortAnswers" />
    </span>
    <input id="{uid}-short" aria-labelledby="{uid}-short-name" type="checkbox" role="switch" data-testid="setting-short-answers"
      checked={store.settings?.shortAnswers ?? true} disabled={!store.settings} onchange={(event) => void toggle('shortAnswers', event.currentTarget)} />
  </label>
  <label for="{uid}-tool-summaries" class="switch-row">
    <span class="text ui-label-box">
      <span class="ui-label" id="{uid}-tool-summaries-name">{strings.settings.toolSummaries}</span><InfoTip topic={strings.settings.toolSummaries} text={strings.settings.toolSummariesHint} /><SyncMark {store} key="toolSummaries" />
    </span>
    <input id="{uid}-tool-summaries" aria-labelledby="{uid}-tool-summaries-name" type="checkbox" role="switch" data-testid="setting-tool-summaries"
      checked={store.settings?.toolSummaries ?? false} disabled={!store.settings} onchange={(event) => void toggle('toolSummaries', event.currentTarget)} />
  </label>
  {#if store.settings}<TitleModelSetting {store} /><GoalTrackerSetting {store} />{/if}
</section>
