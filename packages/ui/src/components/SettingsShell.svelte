<script lang="ts">
  import { MediaQuery } from 'svelte/reactivity';
  import { tick } from 'svelte';
  import MobileSettings from './MobileSettings.svelte';
  import BrainPage from './BrainPage.svelte';
  import { Activity, Brain, ChevronRight, Coins, FlaskConical, Gauge, Keyboard, Mic, Monitor, Palette, Puzzle, Settings2, ShieldCheck, SlidersHorizontal, Stethoscope, Users } from '@lucide/svelte';
  import KeyboardPage from './KeyboardPage.svelte';
  import LimitsPage from './LimitsPage.svelte';
  import PluginsPage from './PluginsPage.svelte';
  import { COMMAND_GROUPS } from '../lib/keybindings';
  import { EXPERIMENT_IDS } from '../lib/experiments';
  import { experimentCopy } from '../lib/experiment-copy';
  import { strings } from '../lib/strings';
  import type { SettingsTab, Store } from '../lib/store.svelte';
  import AccountsPage from './AccountsPage.svelte';
  import AdvancedSettings from './AdvancedSettings.svelte';
  import AppearancePage from './AppearancePage.svelte';
  import ExperimentsPage from './ExperimentsPage.svelte';
  import DiagnosticsPage from './DiagnosticsPage.svelte';
  import GeneralSettings from './GeneralSettings.svelte';
  import PolicyBanner from './PolicyBanner.svelte';
  import MachinesPage from './MachinesPage.svelte';
  import ResourcesPage from './ResourcesPage.svelte';
  import TaskManagerLoader from './TaskManagerLoader.svelte';
  import SettingsHome, { type SettingsEntry, type SettingsGroup, type SettingsTile } from './SettingsHome.svelte';
  import UsagePage from './UsagePage.svelte';
  import VoiceSettings from './VoiceSettings.svelte';
  import { providerGroups } from '../lib/provider-family';
  import { isThisPC, workspace } from '../lib/workspace.svelte';
  import SettingsMachineBar from './SettingsMachineBar.svelte';
  import { untrack } from 'svelte';
  import { revealSettingsCard } from '../lib/settings-flash';
  import { desktopPage, desktopSettings, groupOf, machinePage, ownerOnly, SETTINGS_GROUPS } from '../lib/settings-tabs';
  import { titleSlot } from '../lib/title-slot.svelte';

  let { store, onopenthread }: { store: Store; onopenthread?: () => void } = $props();

  /**
   * The pages that change one machine (`machinePage`) take it from the bar
   * above them; the others are this window's (appearance), the whole group's (machines) or
   * pick their own (usage, which also reads every machine). Experiments mixes
   * this device's switches with a machine's, so its bar sits above the latter.
   */
  /** Machines this window controls, and the window's own whatever its role there. */
  let choices = $derived(workspace.machines.filter((machine) => machine.store === store || (machine.store.connection === 'ready' && machine.store.owner)));
  let picked = $state<string | null>(null);
  /**
   * Until one is picked, a page shows the window's machine. Plugins open on
   * this PC instead: desktop apps run where they were installed.
   */
  let chosen = $derived(choices.find((machine) => machine.id === picked)
    ?? (store.settingsTab === 'plugins' ? choices.find(isThisPC) : undefined)
    ?? choices.find((machine) => machine.store === store));
  let target = $derived(machinePage(store.settingsTab) ? chosen?.store ?? store : store);
  /** A plugin card's Preview reads the repository on the card's machine, where the agent that asked runs. */
  $effect(() => {
    if (!store.pluginSource) return;
    untrack(() => { picked = choices.find((machine) => machine.store === store)?.id ?? picked; });
  });
  /** The bar when there is a machine to pick or a default machine to speak of. */
  let bar = $derived(machinePage(store.settingsTab) && chosen !== undefined && (choices.length > 1 || chosen.store.group?.settingsHome !== undefined));
  /** The policy banner stands above the page, so the panel scrolls both on one column, as under the bar. */
  let banner = $derived(target.policy?.present === true && target.policy.problems.length > 0);
  /**
   * A page reads the card it was asked to show off its own machine's layout:
   * on another machine than the window's, that layout follows the window's.
   */
  $effect(() => {
    const machine = target, tab = store.settingsTab, section = store.settingsSection;
    if (machine === store) return;
    untrack(() => { machine.settingsTab = tab; machine.settingsSection = section; });
  });
  /** The Workspace card moved from Appearance to General: an old link to it lands on its new page. */
  $effect(() => {
    const section = store.settingsSection;
    if (store.settingsTab === 'appearance' && section?.id === 'workspace') untrack(() => store.showSettings('general', 'workspace', { flash: section.flash === true }));
  });
  const narrow = new MediaQuery('(max-width: 720px)');
  const inShell = window.__TAURI_INTERNALS__ !== undefined;

  type Tab = SettingsTile;

  // Derived, not built once: the nav is written in the language the app is
  // speaking, and the language changes without a reload.
  let all = $derived<Tab[]>([
    { id: 'general', label: strings.settings.tabs.general, icon: Settings2 },
    { id: 'appearance', label: strings.settings.tabs.appearance, icon: Palette },
    { id: 'keyboard', label: strings.settings.tabs.keyboard, icon: Keyboard },
    { id: 'voice', label: strings.speech.heading, icon: Mic },
    { id: 'accounts', label: strings.settings.tabs.accounts, icon: Users },
    { id: 'plugins', label: strings.settings.tabs.plugins, icon: Puzzle },
    { id: 'brain', label: strings.brain.heading, icon: Brain },
    { id: 'usage', label: strings.settings.tabs.usage, icon: Coins },
    { id: 'limits', label: strings.usage.limits, icon: Gauge },
    { id: 'task-manager', label: strings.taskManager.title, icon: Activity },
    { id: 'resources', label: strings.settings.tabs.resources, icon: ShieldCheck },
    { id: 'machines', label: strings.settings.tabs.machines, icon: Monitor },
    { id: 'advanced', label: strings.settings.tabs.advanced, icon: SlidersHorizontal },
    { id: 'diagnostics', label: strings.settings.tabs.diagnostics, icon: Stethoscope },
    { id: 'experiments', label: strings.settings.tabs.experiments, icon: FlaskConical }
  ]);

  let providerList = $derived(providerGroups(store.providers, store.shownAccounts()));

  let children: Partial<Record<SettingsTab, { id: string; label: string }[]>> = $derived({
    general: [
      { id: 'conversations', label: strings.settings.conversations },
      { id: 'workspace', label: strings.settings.workspace },
      { id: 'archived', label: strings.settings.archived.heading },
      ...(store.owner ? [{ id: 'worktrees', label: strings.settings.worktrees.heading }] : []),
      ...(store.owner ? [{ id: 'windows', label: strings.windows.settings.allowedHeading }, { id: 'window-exclusions', label: strings.windows.settings.exclusionsHeading }] : []),
      { id: 'secrets', label: strings.secrets.heading },
      ...(store.owner ? [{ id: 'browser-profiles', label: strings.browserProfiles.card }] : []),
      { id: 'app', label: strings.settings.app },
      ...(store.owner ? [{ id: 'privacy', label: strings.telemetry.heading }] : []),
      ...(target.policy?.present ? [{ id: 'policy', label: strings.policy.heading }] : [])
    ],
    appearance: [{ id: 'theme', label: strings.settings.display }, { id: 'reading', label: strings.settings.reading }, { id: 'buttons', label: strings.controls.heading }],
    keyboard: [
      ...COMMAND_GROUPS.map((group) => ({ id: `keys-${group.id}`, label: strings.keyboard.groups[group.id] })),
      { id: 'keybinding-file', label: strings.keyboard.file }
    ],
    brain: [{ id: 'brain-folder', label: strings.brain.folder }, { id: 'hooks', label: strings.hooks.heading }],
    // The page's order: connected providers first, then the ones still to add.
    accounts: [
      ...[...providerList.connected, ...providerList.rest, ...providerList.off].map((row) => ({ id: `provider-${row.id}`, label: row.name })),
      { id: 'agent-updates', label: strings.harnessUpdates.heading }
    ],
    usage: [
      { id: 'usage-overview', label: strings.usage.overview },
      { id: 'usage-chart', label: strings.usage.chart },
      { id: 'usage-breakdown', label: strings.usage.breakdown },
      { id: 'usage-threads', label: strings.usage.threads }
    ],
    resources: [
      { id: 'quiet', label: strings.protection.quiet },
      { id: 'limits', label: strings.protection.limits },
      { id: 'tasks', label: strings.protection.tasks }
    ],
    machines: [
      { id: 'updates', label: strings.appUpdate.updates },
      { id: 'machines', label: strings.machines.heading }
    ],
    advanced: [
      ...(store.owner ? [{ id: 'execution', label: strings.settings.execution }, { id: 'phone', label: strings.phone.heading }, { id: 'origins', label: strings.machines.browserOrigins }] : []),
      { id: 'core', label: strings.settings.core }
    ],
    experiments: [...EXPERIMENT_IDS.map((id) => ({ id, label: experimentCopy()[id].title })), ...(store.owner ? [{ id: 'background-compaction', label: strings.settings.backgroundCompaction }, { id: 'device-stream', label: strings.settings.deviceStream }] : [])],
    diagnostics: [
      { id: 'diagnostics-status', label: strings.diagnostics.status },
      { id: 'diagnostics-problems', label: strings.diagnostics.problems },
      { id: 'diagnostics-log', label: strings.diagnostics.log },
      { id: 'diagnostics-agents', label: strings.diagnostics.agentAccess }
    ]
  });

  let tabs = $derived(all.filter((tab) => store.owner || !ownerOnly(tab.id)));
  /**
   * The nav's eight groups (`SETTINGS_GROUPS`), each led by the first page of
   * it this window may open, its other pages listed right under it. The home's
   * tiles open the leads; the search still finds every card of every page.
   */
  let groups = $derived(SETTINGS_GROUPS
    .map((ids) => ids.flatMap((id) => tabs.filter((entry) => entry.id === id)))
    .filter((members) => members.length > 0)
    .map(([lead, ...rest]): SettingsGroup => ({ ...lead!, members: rest })));
  /** A page only the owner may open lands on Home on a paired device, as it does on a phone. */
  let tab = $derived(desktopPage(store.settingsTab, store.owner));
  let tabLabel = $derived(tabs.find((entry) => entry.id === tab)?.label ?? '');
  /** The group the shown page sits in, by its first page this window lists. */
  let group = $derived(groups.find((entry) => entry.id === tab || entry.members.some((member) => member.id === tab)));

  /**
   * On a desktop the bar above the page says where it is, Settings then the
   * page, and Settings leads back to Home. The rail and this trail are the way
   * out: no Back button.
   */
  $effect(() => {
    if (!desktopSettings(narrow.current)) return;
    titleSlot.current = crumb;
    return () => { if (titleSlot.current === crumb) titleSlot.current = null; };
  });

  /**
   * Single settings the search also finds, each with the card it sits on:
   * people look for "network" or "accent", not for the card's title.
   */
  let settingsWords = $derived<[SettingsTab, string | null, string][]>([
    ['general', 'conversations', strings.settings.groupWorkingThreads],
    ['general', 'conversations', strings.settings.groupOtherProjects],
    ['general', 'conversations', strings.settings.notifications],
    ['general', 'conversations', strings.settings.asyncQuestions],
    ['general', 'conversations', strings.settings.shortAnswers],
    ['general', 'conversations', strings.settings.toolSummaries],
    ['general', 'conversations', strings.settings.titleModel],
    ['general', 'conversations', strings.settings.goalTrackerModel],
    ['general', 'conversations', strings.features.chatArtifacts.title],
    ...(inShell ? [['general', 'conversations', strings.features.openChatLinks.title] as [SettingsTab, string, string]] : []),
    ['general', 'conversations', strings.features.previewComments.title],
    ...(store.owner ? [['general', 'browser-profiles', strings.browserProfiles.heading]] as [SettingsTab, string, string][] : []),
    ...(store.owner ? [['general', 'window-exclusions', strings.windows.settings.addLabel]] as [SettingsTab, string, string][] : []),
    ['general', 'archived', strings.settings.archived.doneRetentionLabel],
    // The switch lives in the shell's own card: a browser has no tray.
    ...(inShell ? [['general', 'app', strings.settings.closeToTray] as [SettingsTab, string, string]] : []),
    ...(inShell ? [['general', 'app', strings.settings.launchAtLogin] as [SettingsTab, string, string]] : []),
    ['general', 'app', strings.onboarding.label],
    ['appearance', 'theme', strings.settings.accent],
    ['appearance', 'theme', strings.settings.material],
    ['appearance', 'theme', strings.settings.language],
    ['appearance', 'theme', strings.features.edgeScrollbars.title],
    ['appearance', 'reading', strings.settings.font],
    ['appearance', 'reading', strings.settings.monoFont],
    ...(inShell ? [['appearance', 'reading', strings.settings.zoom] as [SettingsTab, string, string]] : []),
    ['general', 'workspace', strings.settings.startIn],
    ['general', 'workspace', strings.settings.panelStart],
    ['general', 'conversations', strings.settings.groupChanges],
    ['general', 'conversations', strings.settings.expandDiffs],
    ['general', 'app', strings.settings.terminalGpu],
    // The buttons people most often look for by name, the ones the old developer switch hid.
    ['appearance', 'buttons', strings.terminal.title],
    ['appearance', 'buttons', strings.rightPanel.trace],
    ['accounts', null, strings.settings.modelDefaults],
    ['machines', 'updates', strings.appUpdate.heading],
    ['machines', 'updates', strings.appUpdate.channel],
    ['accounts', 'agent-updates', strings.harnessUpdates.auto],
    ['accounts', 'agent-updates', strings.harnessUpdates.heading],
    ['machines', 'updates', strings.serverUpdate.updates],
    ['resources', 'quiet', strings.settings.focusGuard],
    ['resources', 'quiet', strings.settings.muteAgents],
    ['resources', 'limits', strings.settings.memoryProtection],
    ['resources', 'tasks', strings.settings.reapOrphans],
    ['advanced', 'phone', strings.settings.listenOnLan],
    ['machines', 'machines', strings.group.addDevice],
    ['machines', 'machines', strings.machines.home],
    ['advanced', 'phone', strings.phone.publicUrl],
    ['machines', 'machines', strings.machines.main],
    ['advanced', 'execution', strings.settings.warmProcessMinutes],
    ['limits', 'limit-resume', strings.quotas.autoResume],
    ['diagnostics', 'diagnostics-status', strings.diagnostics.export],
    ['diagnostics', 'diagnostics-status', strings.diagnostics.report],
    ['diagnostics', 'diagnostics-log', strings.diagnostics.search]
  ]);

  /** Every page, every section the nav names and the settings above: what the home page's search looks through. */
  let entries = $derived<SettingsEntry[]>(tabs.flatMap((entry) => {
    const sections = children[entry.id] ?? [];
    const words = settingsWords.filter(([tab, section]) => tab === entry.id && (section === null || sections.some((child) => child.id === section)));
    const lead = groupOf(entry.id);
    return [
      { tab: entry.id, section: null, label: entry.label, trail: lead === entry.id ? '' : tabs.find((other) => other.id === lead)?.label ?? '' },
      ...sections.map((child) => ({ tab: entry.id, section: child.id, label: child.label, trail: entry.label })),
      ...words.map(([, section, label]) => ({
        tab: entry.id,
        section,
        label,
        trail: [entry.label, sections.find((child) => child.id === section)?.label].filter(Boolean).join(' · ')
      }))
    ];
  }));

  const motion = (): ScrollBehavior => (window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth');

  function open(entry: SettingsEntry) {
    store.showSettings(entry.tab, entry.section);
  }

  // A caller can name a card before this lazy settings subtree is mounted.
  // Effects run after its DOM is present, so the normal navigation path can
  // perform the first scroll without timing guesses in the caller.
  $effect(() => {
    const section = store.settingsSection;
    if (!section || tab !== store.settingsTab) return;
    void section.request;
    void tick().then(() => {
      revealSettingsCard(section.id, section.flash === true, motion());
    });
  });
</script>

{#snippet crumb()}
  <span class="crumb" data-testid="settings-crumb">
    {#if tab === 'home'}
      <span class="here ui-label">{strings.settings.heading}</span>
    {:else}
      <button type="button" class="ghost root" onclick={() => store.showSettings('home')}><span class="ui-label">{strings.settings.heading}</span></button>
      <ChevronRight size={14} strokeWidth={1.75} aria-hidden="true" />
      {#if group && group.id !== tab}
        <button type="button" class="ghost root" onclick={() => store.showSettings(group.id)}><span class="ui-label">{group.label}</span></button>
        <ChevronRight size={14} strokeWidth={1.75} aria-hidden="true" />
      {/if}
      <span class="here ui-label">{tabLabel}</span>
    {/if}
  </span>
{/snippet}

{#snippet machineBar()}
  {#if chosen}<SettingsMachineBar machine={chosen} machines={choices} onpick={(id) => { picked = id; }} />{/if}
{/snippet}

{#if !desktopSettings(narrow.current)}
  <MobileSettings {store} {target} bar={bar ? machineBar : undefined} {onopenthread} />
{:else}
<div class="settings" data-testid="settings">
  <nav aria-label={strings.settings.heading} style:--list-width={`${store.sidebarWidth}px`}>
    <!-- The list's head is the way to Settings' home: no Home row under it. -->
    <button type="button" class="ghost title" class:active={tab === 'home'} data-testid="settings-tab-home" aria-current={tab === 'home' ? 'page' : undefined} title={strings.settings.tabs.home} onclick={() => store.showSettings('home')}>
      <span class="ui-label">{strings.settings.heading}</span>
    </button>
    <!-- Every page in view, its group's pages right under the one that leads it: nothing to unfold. -->
    {#each groups as entry (entry.id)}
      <div class="category" role="group" aria-label={entry.label}>
        {#each [entry, ...entry.members] as page (page.id)}
          {@const Icon = page.icon}
          <button
            type="button"
            class="ghost tab"
            class:active={tab === page.id}
            data-testid="settings-tab-{page.id}"
            aria-current={tab === page.id ? 'page' : undefined}
            onclick={() => store.showSettings(page.id)}
          >
            <Icon size={16} strokeWidth={1.75} />
            <span class="ui-label">{page.label}</span>
          </button>
        {/each}
      </div>
    {/each}
  </nav>

  <!-- The panel is keyed on the tab, so switching tabs fades the new page in
       rather than swapping it in one frame. -->
  {#key tab}
    <section class="framed" class:with-bar={bar || banner}>
      {#if bar && tab !== 'experiments'}{@render machineBar()}{/if}
      {#key target}
      <PolicyBanner store={target} />
      {#if tab === 'home'}
        <SettingsHome {store} tiles={groups} {entries} onopen={open} />
      {:else if tab === 'brain'}
        <BrainPage store={target} />
      {:else if tab === 'voice'}
        <VoiceSettings store={target} />
      {:else if tab === 'general'}
        <GeneralSettings store={target} here={store} />
      {:else if tab === 'machines'}
        <MachinesPage {onopenthread} />
      {:else if tab === 'advanced'}
        <AdvancedSettings store={target} />
      {:else if tab === 'appearance'}
        <AppearancePage {store} />
      {:else if tab === 'keyboard'}
        <KeyboardPage store={target} />
      {:else if tab === 'accounts'}
        <AccountsPage store={target} />
      {:else if tab === 'usage'}
        <UsagePage {store} />
      {:else if tab === 'limits'}
        <LimitsPage store={target} />
      {:else if tab === 'task-manager'}
        <TaskManagerLoader {store} {onopenthread} />
      {:else if tab === 'plugins'}
        <PluginsPage store={target} />
      {:else if tab === 'experiments'}
        <ExperimentsPage {store} {target} bar={bar ? machineBar : undefined} />
      {:else if tab === 'diagnostics'}
        <DiagnosticsPage store={target} {onopenthread} />
      {:else}
        <ResourcesPage store={target} />
      {/if}
      {/key}
    </section>
  {/key}
</div>
{/if}

<style>
  /* With the machine bar, the panel scrolls bar and page together, on one column. */
  .framed.with-bar { scrollbar-gutter: stable both-edges; }
  .framed.with-bar > :global(.machine-bar) { padding: 24px clamp(20px, 4vw, 64px) 0; }
  .framed.with-bar > :global(.page) { height: auto; overflow: visible; padding-top: 20px; }
  .framed > :global(.policy-banner) { margin: 24px clamp(20px, 4vw, 64px) 0; }
  @media (min-width: 721px) {
    .framed.with-bar > :global(.machine-bar) { padding-inline: max(clamp(20px, 4vw, 64px), calc((100% - var(--settings-width)) / 2)); max-width: none; }
    .framed > :global(.policy-banner) { margin-inline: max(clamp(20px, 4vw, 64px), calc((100% - var(--settings-width)) / 2)); }
  }
  @media (max-width: 720px) {
    .framed.with-bar > :global(.machine-bar) { padding: 16px 16px 0; }
    .framed.with-bar > :global(.page) { padding-top: 16px; }
    .framed > :global(.policy-banner) { margin: 16px 16px 0; }
  }
  /* A group's pages stand together; the air between groups is their only divider. */
  .category { flex: none; display: flex; flex-direction: column; gap: 2px; }
  .category + .category { margin-top: var(--space-3); }
  .tab span { flex: 1; text-align: left; }

  /* The pages' list stands in the thread list's column, on the chrome, and
     the page in the inset card beside it, as in the rest of the frame. */
  .settings {
    display: flex;
    flex: 1;
    gap: var(--frame-gap);
    min-height: 0;
    min-width: 0;
  }

  nav {
    width: var(--list-width);
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 0 6px 12px;
    overflow-y: auto;
  }

  /* The thread list's head: same height, size and inset, so the switch reads as one column changing.
     It is a button too, to Settings' home, so it only lights under the pointer. */
  .title { flex: none; justify-content: flex-start; height: 36px; margin: 16px 4px 4px; padding: 0 8px; font-size: 15px; font-weight: 650; letter-spacing: -0.015em; color: var(--color-foreground); }
  .title:hover:not(:disabled) { background: var(--color-hover); }

  .crumb { display: flex; align-items: center; gap: 4px; min-width: 0; padding-left: 10px; color: var(--color-subtle); font-size: var(--text-sm); }
  .crumb :global(svg) { flex: none; }
  .crumb .root { height: var(--control-sm); padding: 0 6px; color: var(--color-muted-foreground); font-weight: 500; }
  .crumb .root:hover:not(:disabled) { color: var(--color-foreground); }
  .crumb .here { min-width: 0; padding: 0 6px; color: var(--color-foreground); font-weight: 600; }

  .tab {
    justify-content: flex-start;
    width: 100%;
    min-height: var(--row);
    height: auto;
    padding: 6px 10px;
    white-space: normal;
    line-height: 1.35;
    color: var(--color-muted-foreground);
  }

  /* A full width row does not shrink under the finger, it fills one step more. */
  .tab:active:not(:disabled) {
    transform: none;
    background: color-mix(in srgb, var(--color-surface-3) 85%, var(--color-foreground));
  }

  .tab.active {
    background: var(--color-active);
    color: var(--color-foreground);
  }

  section {
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: auto;
    animation: fade var(--dur-2) var(--ease-out-quint);
  }

  /* Up to the window's top, like the thread list (App.svelte's bar starts right of it). */
  @media (min-width: 721px) {
    nav { margin-top: calc(-1 * var(--titlebar)); }
  }

  @media (max-width: 720px) {
    .settings {
      flex-direction: column;
    }

    nav {
      width: auto;
      display: flex;
      flex-direction: row;
      overflow-x: auto;
      overflow-y: hidden;
      padding: 8px 12px;
      align-items: flex-start;
      background: var(--color-surface);
      border-bottom: 1px solid var(--color-border);
    }

    .settings { gap: 0; }
    /* In a row, the head is the first chip and each group a run of chips. */
    .title { height: var(--control); margin: 0; font-size: var(--text-sm); white-space: nowrap; }
    .title.active { background: var(--color-active); }
    .category { flex-direction: row; min-width: 0; }
    .category + .category { margin: 0 0 0 var(--space-3); }
    .tab { width: auto; white-space: nowrap; }
  }
</style>
