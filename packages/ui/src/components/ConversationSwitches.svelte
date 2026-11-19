<script lang="ts">
  import { desktopShell } from '../lib/shell-platform';
  import { chatPrefs, setChatPref } from '../lib/chat-prefs.svelte';
  import { featureOn } from '../lib/features.svelte';
  import { setFeature } from '../lib/features';
  import { recentPreferences } from '../lib/recent.svelte';
  import { strings } from '../lib/strings';
  import SettingField from './SettingField.svelte';
  import SettingSwitch from './SettingSwitch.svelte';

  /**
   * The conversation switches kept on this device, by topic: `list`, how the
   * thread lists group (General's Thread list card; a phone groups its list
   * from the list's display options), and `conversation`, whether answers show
   * their files and previews, whether a file link opens in its own app (only
   * the desktop app can do that), whether the integrated browser references
   * elements, how a turn's changes show and whether the message box corrects
   * what is typed (In the conversation, on the desktop and on a phone's own page).
   */
  let { part, phone = false }: { part: 'list' | 'conversation'; phone?: boolean } = $props();
  const inShell = desktopShell();
  /** Each row says what turning it on does; the "i" stays where that needs more than a line. */
  type Option = { id: string; testid?: string; label: string; effect: string; tip?: string; checked: boolean; set: (value: boolean) => void };
  const effects = strings.settings.effects;
  const options = $derived<Option[]>(part === 'list' ? (phone ? [] : [
    { id: 'group-working-threads', label: strings.settings.groupWorkingThreads, effect: effects.groupWorking, checked: recentPreferences.groupWorking, set: (value: boolean) => recentPreferences.setGroupWorking(value) },
    { id: 'group-other-projects', label: strings.settings.groupOtherProjects, effect: effects.groupIdle, checked: recentPreferences.groupOtherProjects, set: (value: boolean) => recentPreferences.setGroupOtherProjects(value) }
  ]) : [
    { id: 'chat-artifacts', label: strings.features.chatArtifacts.title, effect: strings.features.chatArtifacts.hint, checked: featureOn('chat-artifacts'), set: (value: boolean) => setFeature('chat-artifacts', value) },
    ...(inShell && !phone ? [{ id: 'open-chat-links', label: strings.features.openChatLinks.title, effect: effects.openChatLinks, tip: strings.features.openChatLinks.hint, checked: featureOn('open-chat-links'), set: (value: boolean) => setFeature('open-chat-links', value) }] : []),
    { id: 'preview-comments', label: strings.features.previewComments.title, effect: strings.features.previewComments.hint, checked: featureOn('preview-comments'), set: (value: boolean) => setFeature('preview-comments', value) },
    // Once under Appearance; they change what a turn shows, not how it looks, and keep their test ids.
    { id: 'group-changes', testid: 'chat-group-changes', label: strings.settings.groupChanges, effect: effects.groupChanges, checked: chatPrefs.groupChanges, set: (value: boolean) => setChatPref('groupChanges', value) },
    { id: 'expand-diffs', testid: 'chat-expand-diffs', label: strings.settings.expandDiffs, effect: effects.expandDiffs, checked: chatPrefs.expandDiffs, set: (value: boolean) => setChatPref('expandDiffs', value) },
    // What the system does to a message as it is typed: its red underlines, its corrections, its capitals.
    { id: 'typing-correction', testid: 'chat-typing-correction', label: strings.settings.typingCorrection, effect: effects.typingCorrection, checked: chatPrefs.typingCorrection, set: (value: boolean) => setChatPref('typingCorrection', value) }
  ]);
</script>

{#each options as option (option.id)}
  <SettingField title={option.label} hint={option.effect} help={option.tip}>
    {#snippet control(attributes)}
      <SettingSwitch {...attributes} data-testid={option.testid ?? `setting-${option.id}`}
        checked={option.checked} onchange={(event) => option.set(event.currentTarget.checked)} />
    {/snippet}
  </SettingField>
{/each}
