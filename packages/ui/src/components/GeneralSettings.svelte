<script lang="ts">
  import AgentRepliesSettings from './AgentRepliesSettings.svelte';
  import CardScope from './CardScope.svelte';
  import ShellSettings from './ShellSettings.svelte';
  import TelemetrySettings from './TelemetrySettings.svelte';
  import ArchivedThreads from './ArchivedThreads.svelte';
  import WorktreesCard from './WorktreesCard.svelte';
  import { strings } from '../lib/strings';
  import { openTour } from '../lib/onboarding.svelte';
  import type { Store } from '../lib/store.svelte';
  import ConversationSwitches from './ConversationSwitches.svelte';
  import NotificationKinds from './NotificationKinds.svelte';
  import PolicySettings from './PolicySettings.svelte';
  import WorkspaceCard from './WorkspaceCard.svelte';
  import QuietCard from './QuietCard.svelte';
  import { untrack } from 'svelte';
  import { readTerminalGpu, setTerminalGpu } from '../lib/terminal-cursor';

  /**
   * What the app does for the person in front of it: how a thread
   * reaches them, the archive, the window and the tour. Where agents run and
   * how many at once live under Machines and Advanced.
   */
  /** `store` is the machine whose settings these are; `here`, this window's, holds its notifications and tour. */
  let { store, here = store }: { store: Store; here?: Store } = $props();
  const uid = $props.id();
  const inShell = window.__TAURI_INTERNALS__ !== undefined;
  let terminalGpu = $state(untrack(() => readTerminalGpu()));
</script>

<div class="page" data-testid="settings-page">
  <header>
    <h1>{strings.settings.tabs.general}</h1>
  </header>

  <!-- This device's switches by topic, then the machine's: each card saying where it applies. -->
  <section class="card" id="settings-thread-list" data-testid="settings-card-thread-list">
    <h2><span class="ui-label">{strings.settings.threadList}</span><CardScope /></h2>
    <ConversationSwitches part="list" />
  </section>
  <section class="card" id="settings-conversations" data-testid="settings-card-conversation">
    <h2><span class="ui-label">{strings.settings.inConversation}</span><CardScope /></h2>
    <ConversationSwitches part="conversation" />
  </section>
  <section class="card" id="settings-notifications" data-testid="settings-card-notifications">
    <h2><span class="ui-label">{strings.settings.notificationsHeading}</span><CardScope /></h2>
    <label for="{uid}-notifications" class="switch-row">
      <span class="text">
        <span class="ui-label" id="{uid}-notifications-name">{strings.settings.notifications}</span>
        <span class="hint" id="{uid}-notifications-effect">{strings.settings.effects.notifications}</span>
      </span>
      <input id="{uid}-notifications" aria-labelledby="{uid}-notifications-name" aria-describedby="{uid}-notifications-effect" type="checkbox" role="switch" data-testid="setting-notifications"
        checked={here.notifications} onchange={(event) => void here.setNotifications(event.currentTarget.checked)} />
    </label>
    <NotificationKinds store={here} />
  </section>

  {#if store.owner}<AgentRepliesSettings {store} />{/if}

  <!-- Notifications above, the sound and the windows of the machine here: what reaches the person at it. -->
  {#if store.owner}<QuietCard {store} />{/if}
  <WorkspaceCard />
  <ArchivedThreads {store} />
  <WorktreesCard {store} />
  <!-- The keys agents ask for live under Providers, the windows agents may see under Machines, the browser logins under Browser. -->

  <section class="card" id="settings-app">
    <h2><span class="ui-label">{strings.settings.app}</span><CardScope /></h2>
    {#if inShell}<ShellSettings />{/if}
    <!-- How this device draws a terminal: a renderer choice, once under Appearance. -->
    <label for="{uid}-terminal-gpu" class="switch-row">
      <span class="text"><span class="ui-label" id="{uid}-terminal-gpu-name">{strings.settings.terminalGpu}</span><span class="hint" id="{uid}-terminal-gpu-effect">{strings.settings.terminalGpuHint}</span></span>
      <input id="{uid}-terminal-gpu" aria-labelledby="{uid}-terminal-gpu-name" aria-describedby="{uid}-terminal-gpu-effect" type="checkbox" role="switch" checked={terminalGpu} data-testid="terminal-gpu"
        onchange={(event) => { terminalGpu = event.currentTarget.checked; setTerminalGpu(terminalGpu); }} />
    </label>
    <div class="switch-row">
      <span class="text">
        <span>{strings.onboarding.label}</span>
      </span>
      <button type="button" data-testid="settings-tour" onclick={() => { here.showChat(); openTour(); }}><span class="ui-label">{strings.settings.tourReplay}</span></button>
    </div>
  </section>

  <TelemetrySettings {store} />
  <PolicySettings {store} />
</div>
