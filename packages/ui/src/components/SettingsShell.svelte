<script lang="ts">
  import { MediaQuery } from 'svelte/reactivity';
  import { tick } from 'svelte';
  import MobileSettings from './MobileSettings.svelte';
  import BrainPage from './BrainPage.svelte';
  import InfoTip from './InfoTip.svelte';
  import { Activity, Brain, Coins, FlaskConical, Gauge, Keyboard, Mic, Monitor, Palette, Puzzle, Plug, Settings, ShieldCheck, Stethoscope, Wrench } from '@lucide/svelte';
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
  import { holdSettingsCard, revealSettingsCard } from '../lib/settings-flash';
  import { desktopPage, desktopSettings, groupOf, machinePage, ownerOnly, pagesOf, sectionsOf, SETTINGS_GROUPS } from '../lib/settings-tabs';
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
  /** The page shown: the route's own, the one it is a section of, or Home where this window may not open it. */
  let tab = $derived(desktopPage(store.settingsTab, store.owner));
  let target = $derived(machinePage(tab) ? chosen?.store ?? store : store);
  /** A plugin card's Preview reads the repository on the card's machine, where the agent that asked runs. */
  $effect(() => {
    if (!store.pluginSource) return;
    untrack(() => { picked = choices.find((machine) => machine.store === store)?.id ?? picked; });
  });
  /** The bar when there is a machine to pick or a default machine to speak of. */
  let bar = $derived(machinePage(tab) && chosen !== undefined && (choices.length > 1 || chosen.store.group?.settingsHome !== undefined));
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
    { id: 'general', label: strings.settings.tabs.general, icon: Settings },
    { id: 'appearance', label: strings.settings.tabs.appearance, icon: Palette },
    { id: 'keyboard', label: strings.settings.tabs.keyboard, icon: Keyboard },
    { id: 'voice', label: strings.speech.heading, icon: Mic },
    { id: 'accounts', label: strings.settings.tabs.accounts, icon: Plug },
    { id: 'plugins', label: strings.settings.tabs.plugins, icon: Puzzle },
    { id: 'brain', label: strings.brain.heading, icon: Brain },
    { id: 'usage', label: strings.settings.tabs.usage, icon: Coins },
    { id: 'limits', label: strings.usage.limits, icon: Gauge },
    { id: 'task-manager', label: strings.taskManager.title, icon: Activity },
    { id: 'resources', label: strings.settings.tabs.resources, icon: ShieldCheck },
    { id: 'machines', label: strings.settings.tabs.machines, icon: Monitor },
    { id: 'advanced', label: strings.settings.tabs.advanced, icon: Wrench },
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
      ...(desktopSettings(narrow.current) ? [{ id: 'details', label: strings.settings.terminalAndScrollbars }] : []),
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
   * The nav's eight entries (`SETTINGS_GROUPS`), the same list a phone shows,
   * each led by the first page of it this window may open. Its other pages
   * are tabs at the top of its card; the search still finds every card.
   */
  let groups = $derived(SETTINGS_GROUPS
    .map((ids) => pagesOf(ids[0], store.owner).flatMap((id) => tabs.filter((entry) => entry.id === id)))
    .filter((members) => members.length > 0)
    .map(([lead, ...rest]): SettingsGroup => ({ ...lead!, members: rest })));
  /** The group the shown page sits in, by its first page this window lists. */
  let group = $derived(groups.find((entry) => entry.id === tab || entry.members.some((member) => member.id === tab)));
  /** The pages merged into the shown one as its last sections (the task manager under Diagnostics). */
  let merged = $derived(sectionsOf(tab, store.owner));
  /** A group of several pages shows them as tabs at the top of its card. */
  let strip = $derived((group?.members.length ?? 0) > 0);

  /**
   * What each page is for, said once behind the "i" beside the screen's title
   * at the top of its card: the page's own title steps aside, so its card
   * starts with its settings (app.css's `.page > header`).
   */
  function infoOf(page: SettingsTab): string {
    switch (page) {
      case 'keyboard': return strings.keyboard.intro;
      case 'voice': return strings.speech.description;
      case 'accounts': return strings.providerSettings.intro;
      case 'plugins': return strings.plugins.intro;
      case 'brain': return strings.brain.description;
      case 'usage': return `${strings.usage.intro} ${strings.usage.note}`;
      case 'machines': return strings.machines.intro;
      case 'experiments': return strings.settings.experiments.intro;
      case 'diagnostics': return strings.diagnostics.intro;
      case 'task-manager': return strings.taskManager.scope;
      default: return '';
    }
  }
  /** One title per screen, at the top of its card: the group the page sits in. Home has the list's head. */
  let title = $derived(tab === 'home' ? strings.settings.heading : group?.label ?? tabs.find((entry) => entry.id === tab)?.label ?? '');
  let info = $derived(tab === 'home' ? '' : infoOf(tab));

  /**
   * On a desktop the card carries the screen's one title, a step over the
   * cards' own, as a phone's screen does; the bar above stays empty but for a
   * page's buttons (UsagePage.svelte). The list's head leads back to Home and
   * the rail is the way out: no Back button.
   */
  $effect(() => {
    if (!desktopSettings(narrow.current)) return;
    titleSlot.current = blank;
    return () => { if (titleSlot.current === blank) titleSlot.current = null; };
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
    ['advanced', 'details', strings.features.edgeScrollbars.title],
    ['advanced', 'details', strings.settings.terminalCursor],
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
  // perform the first scroll without timing guesses in the caller. A page
  // merged into another is that page's section: its route scrolls to it.
  $effect(() => {
    const route = store.settingsTab, section = store.settingsSection;
    const id = tab === route ? section?.id : merged.includes(route) ? route : undefined;
    if (!id) return;
    void section?.request;
    let release = () => {};
    let live = true;
    void tick().then(() => {
      if (!live) return;
      // A merged section jumps and holds: the page above it is still filling in.
      revealSettingsCard(id, section?.flash === true, tab === route ? motion() : 'instant');
      if (tab !== route) release = holdSettingsCard(id);
    });
    return () => { live = false; release(); };
  });
</script>

{#snippet blank()}<span class="crumb" aria-hidden="true"></span>{/snippet}

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
    <!-- One entry a group, as on a phone: a group's other pages are tabs at the top of its card. -->
    {#each groups as entry (entry.id)}
      {@const Icon = entry.icon}
      {@const here = group?.id === entry.id}
      <button
        type="button"
        class="ghost tab"
        class:active={here}
        data-testid="settings-tab-{entry.id}"
        aria-current={here ? 'page' : undefined}
        onclick={() => store.showSettings(entry.id)}
      >
        <Icon size={16} strokeWidth={1.75} />
        <span class="ui-label">{entry.label}</span>
      </button>
    {/each}
  </nav>

  <!-- The panel is keyed on the tab, so switching tabs fades the new page in
       rather than swapping it in one frame. -->
  {#key tab}
    <section class="framed" class:with-bar={tab !== 'home' || bar || banner || strip || merged.length > 0}>
      {#if tab !== 'home'}
        <header class="screen" data-testid="settings-crumb">
          <h1 class="ui-label-box"><span class="ui-label">{title}</span>{#if info}<InfoTip topic={tabs.find((entry) => entry.id === tab)?.label ?? title} text={info} testid="settings-info" />{/if}</h1>
        </header>
      {/if}
      {#if strip && group}
        <!-- The group's pages, the shown one filled. The group's own entry keeps the nav's test id; a moved page keeps its own. -->
        <div class="pages" role="group" aria-label={group.label} data-testid="settings-pages">
          {#each [group, ...group.members] as page (page.id)}
            <button type="button" class="page-tab" class:on={page.id === tab} aria-current={page.id === tab ? 'page' : undefined}
              data-testid={page.id === group.id ? `settings-page-${page.id}` : `settings-tab-${page.id}`} onclick={() => store.showSettings(page.id)}>
              <span class="ui-label">{page.label}</span>
            </button>
          {/each}
        </div>
      {/if}
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
        {#if merged.includes('task-manager')}
          <!-- The live half of Diagnostics: its route scrolls here. -->
          <div class="merged" id="settings-task-manager"><TaskManagerLoader {store} {onopenthread} /></div>
        {/if}
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
  .tab span { flex: 1; text-align: left; }

  /* A group's pages: one quiet segmented track over the page, the shown one raised. The accent stays out. */
  .pages {
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
    width: fit-content;
    max-width: 100%;
    margin: var(--space-6) max(clamp(20px, 4vw, 64px), calc((100% - var(--settings-width)) / 2)) 0;
    padding: 2px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
  }
  .page-tab {
    height: var(--control-sm);
    padding: 0 var(--space-3);
    border-radius: var(--radius-sm);
    color: var(--color-muted-foreground);
    font-size: var(--text-sm);
    font-weight: 400;
    transition: background var(--dur-2) var(--ease-out-quint), color var(--dur-2) var(--ease-out-quint);
  }
  @media (hover: hover) { .page-tab:hover:not(.on) { background: var(--color-hover); color: var(--color-foreground); } }
  .page-tab.on { background: var(--color-surface-3); color: var(--color-foreground); box-shadow: var(--shadow-control); }
  .framed.with-bar > .pages + :global(.machine-bar) { padding-top: var(--space-4); }
  .framed.with-bar > .pages + :global(.page) { padding-top: var(--space-6); }

  /* A page merged into another reads as its last section: its title a section title, the same column. */
  .merged { min-height: 100%; scroll-margin-top: var(--space-6); }
  .merged > :global(.page) { height: auto; overflow: visible; padding-top: 0; padding-inline: max(clamp(20px, 4vw, 64px), calc((100% - var(--settings-width)) / 2)); }
  .merged > :global(.page > header h1) { font-size: var(--text-md); }

  /* The bar carries the page's title and its "i": the page's own heading steps aside, and
     its header with it unless it holds an action. A lock or another mark in the title stays. */
  .framed > :global(.page > header h1 > .ui-label),
  .framed > :global(.page > header h1 > .ui-label + .info-tip),
  .framed > :global(.page > header h1:not(:has(> :not(.ui-label, .ui-label + .info-tip)))),
  .framed > :global(.limits-page > header h1),
  .framed > :global(.machines-page .head h1) { display: none; }
  .framed > :global(.page > header:not(:has(button:not(.ui-label + .info-tip), [role='status'], .policy-lock))),
  .framed > :global(.machines-page .head:not(:has(button:not(.ui-label + .info-tip)))) { display: none; }
  .framed > :global(.page > header) { justify-content: flex-end; }

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
  .title { flex: none; justify-content: flex-start; height: 36px; margin: 16px 4px 4px; padding: 0 8px; font-size: 15px; font-weight: 600; letter-spacing: -0.015em; color: var(--color-foreground); }
  .title:hover:not(:disabled) { background: var(--color-hover); }

  .crumb { flex: 1; min-width: 0; }
  /* The screen's one title, at the top of its card in the settings column, one step over a card's. */
  .screen { padding: var(--space-8) max(clamp(20px, 4vw, 64px), calc((100% - var(--settings-width)) / 2)) 0; }
  .screen h1 { min-width: 0; margin: 0; color: var(--color-foreground); font-size: var(--text-lg); font-weight: 600; line-height: 1.3; letter-spacing: -0.01em; }
  .screen + .pages { margin-top: var(--space-4); }
  .screen + :global(.page) { padding-top: var(--space-5); }

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
    .tab { width: auto; white-space: nowrap; }
  }
</style>
