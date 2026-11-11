<script lang="ts">
  import { chatPrefs, setChatPref } from '../lib/chat-prefs.svelte';
  import { featureOn } from '../lib/features.svelte';
  import { setFeature } from '../lib/features';
  import { recentPreferences } from '../lib/recent.svelte';
  import { strings } from '../lib/strings';
  import InfoTip from './InfoTip.svelte';

  /**
   * The conversation switches kept on this device, rows of General's
   * Conversations card on the desktop and of its own page on a phone: how the
   * thread lists group, whether answers show their files and previews, whether
   * a file link opens in its own app (only the desktop app can do that), whether
   * the integrated browser references elements, and how a turn's changes show.
   * A phone groups its list from the list's display options.
   */
  let { phone = false }: { phone?: boolean } = $props();
  const uid = $props.id();
  const inShell = window.__TAURI_INTERNALS__ !== undefined;
  /** Each row says what turning it on does; the "i" stays where that needs more than a line. */
  type Option = { id: string; testid?: string; label: string; effect: string; tip?: string; checked: boolean; set: (value: boolean) => void };
  const effects = strings.settings.effects;
  const options = $derived<Option[]>([
    ...(phone ? [] : [
      { id: 'group-working-threads', label: strings.settings.groupWorkingThreads, effect: effects.groupWorking, checked: recentPreferences.groupWorking, set: (value: boolean) => recentPreferences.setGroupWorking(value) },
      { id: 'group-other-projects', label: strings.settings.groupOtherProjects, effect: effects.groupIdle, checked: recentPreferences.groupOtherProjects, set: (value: boolean) => recentPreferences.setGroupOtherProjects(value) }
    ]),
    { id: 'chat-artifacts', label: strings.features.chatArtifacts.title, effect: strings.features.chatArtifacts.hint, checked: featureOn('chat-artifacts'), set: (value: boolean) => setFeature('chat-artifacts', value) },
    ...(inShell && !phone ? [{ id: 'open-chat-links', label: strings.features.openChatLinks.title, effect: effects.openChatLinks, tip: strings.features.openChatLinks.hint, checked: featureOn('open-chat-links'), set: (value: boolean) => setFeature('open-chat-links', value) }] : []),
    { id: 'preview-comments', label: strings.features.previewComments.title, effect: strings.features.previewComments.hint, checked: featureOn('preview-comments'), set: (value: boolean) => setFeature('preview-comments', value) },
    // Once under Appearance; they change what a turn shows, not how it looks, and keep their test ids.
    { id: 'group-changes', testid: 'chat-group-changes', label: strings.settings.groupChanges, effect: effects.groupChanges, checked: chatPrefs.groupChanges, set: (value: boolean) => setChatPref('groupChanges', value) },
    { id: 'expand-diffs', testid: 'chat-expand-diffs', label: strings.settings.expandDiffs, effect: effects.expandDiffs, checked: chatPrefs.expandDiffs, set: (value: boolean) => setChatPref('expandDiffs', value) }
  ]);
</script>

{#each options as option (option.id)}
  <label for="{uid}-{option.id}" class="switch-row">
    <span class="text">
      <span class="ui-label-box"><span class="ui-label" id="{uid}-{option.id}-name">{option.label}</span>{#if option.tip}<InfoTip topic={option.label} text={option.tip} />{/if}</span>
      <span class="hint" id="{uid}-{option.id}-effect">{option.effect}</span>
    </span>
    <input id="{uid}-{option.id}" aria-labelledby="{uid}-{option.id}-name" aria-describedby="{uid}-{option.id}-effect" type="checkbox" role="switch" data-testid={option.testid ?? `setting-${option.id}`}
      checked={option.checked} onchange={event => option.set(event.currentTarget.checked)} />
  </label>
{/each}

<style>
  input { flex: none; }
</style>
