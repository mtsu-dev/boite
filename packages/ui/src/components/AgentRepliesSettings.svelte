<script lang="ts">
  import SettingField from './SettingField.svelte';
  import SettingSwitch from './SettingSwitch.svelte';
  import SettingsSection from './SettingsSection.svelte';
  import CardScope from './CardScope.svelte';
  import SyncMark from './SyncMark.svelte';
  import TitleModelSetting from './TitleModelSetting.svelte';
  import GoalTrackerSetting from './GoalTrackerSetting.svelte';
  import { strings } from '../lib/strings';
  import type { Store } from '../lib/store.svelte';

  /**
   * How a machine's agents answer: the questions they may leave, the length
   * and the tool summaries of a reply, the models that title a thread and
   * keep its checklist. Saved on the machine, so it has its own card under General.
   */
  let { store }: { store: Store } = $props();
  const fields = [
    { key: 'asyncQuestions', testid: 'setting-async-questions', fallback: true },
    { key: 'shortAnswers', testid: 'setting-short-answers', fallback: true, help: 'shortAnswersHint' },
    { key: 'toolSummaries', testid: 'setting-tool-summaries', fallback: false, help: 'toolSummariesHint' },
    { key: 'promptSuggestions', testid: 'setting-prompt-suggestions', fallback: true, help: 'promptSuggestionsHint' },
  ] as const;

  /** A switch saves when it flips, as every other switch in Settings does; a refusal puts it back. */
  async function toggle(key: 'asyncQuestions' | 'shortAnswers' | 'toolSummaries' | 'promptSuggestions', input: HTMLInputElement) {
    const ok = await store.saveSettings({ [key]: input.checked });
    if (!ok) input.checked = store.settings?.[key] ?? (key === 'toolSummaries' ? false : true);
  }
</script>

<SettingsSection id="settings-agent-replies" testid="agent-replies" title={strings.settings.agentReplies}>
  {#snippet actions()}<CardScope {store} />{/snippet}
  {#each fields as field (field.key)}
    <SettingField title={strings.settings[field.key]} hint={strings.settings.effects[field.key]} help={'help' in field ? strings.settings[field.help] : undefined}>
      {#snippet actions()}{#if field.key !== 'promptSuggestions'}<SyncMark {store} key={field.key} />{/if}{/snippet}
      {#snippet control(attributes)}
        <SettingSwitch {...attributes} data-testid={field.testid} checked={store.settings?.[field.key] ?? field.fallback}
          disabled={!store.settings} onchange={(event) => void toggle(field.key, event.currentTarget)} />
      {/snippet}
    </SettingField>
  {/each}
  {#if store.settings}<TitleModelSetting {store} /><GoalTrackerSetting {store} />{/if}
</SettingsSection>
