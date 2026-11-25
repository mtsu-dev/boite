<script lang="ts">
  import { desktopShell } from '../lib/shell-platform';
  import AgentRepliesSettings from './AgentRepliesSettings.svelte';
  import CardScope from './CardScope.svelte';
  import ShellSettings from './ShellSettings.svelte';
  import TelemetrySettings from './TelemetrySettings.svelte';
  import DeletedThreads from './DeletedThreads.svelte';
  import TranscriptStorage from './TranscriptStorage.svelte';
  import { openArchived } from '../lib/archived-view.svelte';
  import SettingsSection from './SettingsSection.svelte';
  import SettingField from './SettingField.svelte';
  import SettingSwitch from './SettingSwitch.svelte';
  import WorktreesCard from './WorktreesCard.svelte';
  import { strings } from '../lib/strings';
  import { openTour } from '../lib/onboarding.svelte';
  import type { Store } from '../lib/store.svelte';
  import ConversationSwitches from './ConversationSwitches.svelte';
  import NotificationKinds from './NotificationKinds.svelte';
  import PolicySettings from './PolicySettings.svelte';
  import WorkspaceCard from './WorkspaceCard.svelte';
  import QuietCard from './QuietCard.svelte';
  import AgentsAloneCard from './AgentsAloneCard.svelte';
  import { untrack } from 'svelte';
  import { readTerminalGpu, setTerminalGpu } from '../lib/terminal-cursor';

  /**
   * What the app does for the person in front of it: how a thread
   * reaches them, the archive, the window and the tour. Where agents run and
   * how many at once live under Machines and Advanced.
   */
  /** `store` is the machine whose settings these are; `here`, this window's, holds its notifications and tour. */
  let { store, here = store }: { store: Store; here?: Store } = $props();
  const inShell = desktopShell();
  let terminalGpu = $state(untrack(() => readTerminalGpu()));
</script>

<div class="page" data-testid="settings-page">
  <!-- This device's switches by topic, then the machine's: each card saying where it applies. -->
  <SettingsSection id="settings-thread-list" testid="settings-card-thread-list" title={strings.settings.threadList}>
    {#snippet actions()}<CardScope />{/snippet}
    <ConversationSwitches part="list" />
  </SettingsSection>
  <SettingsSection id="settings-conversations" testid="settings-card-conversation" title={strings.settings.inConversation}>
    {#snippet actions()}<CardScope />{/snippet}
    <ConversationSwitches part="conversation" />
  </SettingsSection>
  <SettingsSection id="settings-notifications" testid="settings-card-notifications" title={strings.settings.notificationsHeading}>
    {#snippet actions()}<CardScope />{/snippet}
    <SettingField title={strings.settings.notifications} hint={strings.settings.effects.notifications}>
      {#snippet control(attributes)}
        <SettingSwitch {...attributes} data-testid="setting-notifications" checked={here.notifications}
          onchange={(event) => void here.setNotifications(event.currentTarget.checked)} />
      {/snippet}
    </SettingField>
    <NotificationKinds store={here} />
  </SettingsSection>

  {#if store.owner}<AgentRepliesSettings {store} />{/if}

  <!-- Notifications above, the sound and the windows of the machine here: what reaches the person at it. -->
  {#if store.owner}<QuietCard {store} /><AgentsAloneCard {store} />{/if}
  <WorkspaceCard />
  <SettingsSection id="settings-archived" testid="settings-archived-entry" title={strings.settings.archived.heading} info={strings.settings.archived.intro}>
    <button type="button" data-testid="archived-show" onclick={() => openArchived(here)}><span class="ui-label">{strings.settings.archived.show}</span></button>
  </SettingsSection>
  <DeletedThreads {store} />
  <TranscriptStorage {store} />
  <WorktreesCard {store} />
  <!-- The keys agents ask for live under Providers, the windows agents may see under Machines, the browser logins under Browser. -->

  <SettingsSection id="settings-app" title={strings.settings.app}>
    {#snippet actions()}<CardScope />{/snippet}
    {#if inShell}<ShellSettings />{/if}
    <!-- How this device draws a terminal: a renderer choice, once under Appearance. -->
    <SettingField title={strings.settings.terminalGpu} hint={strings.settings.terminalGpuHint}>
      {#snippet control(attributes)}
        <SettingSwitch {...attributes} data-testid="terminal-gpu" checked={terminalGpu}
          onchange={(event) => { terminalGpu = event.currentTarget.checked; setTerminalGpu(terminalGpu); }} />
      {/snippet}
    </SettingField>
    <div class="switch-row">
      <span class="text">
        <span>{strings.onboarding.label}</span>
      </span>
      <button type="button" data-testid="settings-tour" onclick={() => { here.showChat(); openTour(); }}><span class="ui-label">{strings.settings.tourReplay}</span></button>
    </div>
  </SettingsSection>

  <TelemetrySettings {store} />
  <PolicySettings {store} />
</div>
