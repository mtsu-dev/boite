<script lang="ts">
  import { MediaQuery } from 'svelte/reactivity';
  import { tick } from 'svelte';
  import MobileSettings from './MobileSettings.svelte';
  import BrainPage from './BrainPage.svelte';
  import { Activity, ArrowLeft, Brain, ChevronRight, Coins, FlaskConical, Gauge, Keyboard, Mic, Monitor, Palette, Puzzle, Settings2, ShieldCheck, SlidersHorizontal, Stethoscope, Users } from '@lucide/svelte';
  import KeyboardPage from './KeyboardPage.svelte';
  import LimitsPage from './LimitsPage.svelte';
  import PluginsPage from './PluginsPage.svelte';
  import { COMMAND_GROUPS } from '../lib/keybindings';
  import { EXPERIMENT_IDS } from '../lib/experiments';
  import { experimentCopy } from '../lib/experiment-copy';
  import { fill, strings } from '../lib/strings';
  import type { SettingsTab, Store } from '../lib/store.svelte';
  import AccountsPage from './AccountsPage.svelte';
  import AdvancedSettings from './AdvancedSettings.svelte';
  import AppearancePage from './AppearancePage.svelte';
  import InfoTip from './InfoTip.svelte';
  import ExperimentsPage from './ExperimentsPage.svelte';
  import DiagnosticsPage from './DiagnosticsPage.svelte';
  import GeneralSettings from './GeneralSettings.svelte';
  import PolicyBanner from './PolicyBanner.svelte';
  import MachinesPage from './MachinesPage.svelte';
  import ResourcesPage from './ResourcesPage.svelte';
  import TaskManagerLoader from './TaskManagerLoader.svelte';
  import SettingsSearch, { type SettingsEntry, type SettingsTile } from './SettingsSearch.svelte';
  import UsagePage from './UsagePage.svelte';
  import VoiceSettings from './VoiceSettings.svelte';
  import { providerGroups } from '../lib/provider-family';
  import { isThisPC, listedName, workspace } from '../lib/workspace.svelte';
  import SettingsMachineBar from './SettingsMachineBar.svelte';
  import { untrack } from 'svelte';
  import { revealSettingsCard } from '../lib/settings-flash';
  import { desktopPage, desktopSettings, machinePage, ownerOnly, phonePage } from '../lib/settings-tabs';

  /** `onopenlist` shows a phone's thread list, under the Archived filter Settings leads to. */
  let { store, onopenthread, onopenlist }: { store: Store; onopenthread?: () => void; onopenlist?: () => void } = $props();

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
  const narrow = new MediaQuery('(max-width: 720px)');
  /**
   * The page shown: on a desktop, Settings opens on its first page (the
   * route's "home" is the phone's list), and a page only the owner may open
   * lands there too on a paired device.
   */
  let tab = $derived(desktopSettings(narrow.current) ? desktopPage(store.settingsTab, store.owner) : store.settingsTab);
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
  const inShell = window.__TAURI_INTERNALS__ !== undefined;

  type Tab = SettingsTile;

  // Derived, not built once: the nav is written in the language the app is
  // speaking, and the language changes without a reload. Four labelled
  // groups: the app itself, the agents, what they cost, where they run.
  let all = $derived<Tab[]>([
    { id: 'general', label: strings.settings.tabs.general, icon: Settings2, group: 0 },
    { id: 'appearance', label: strings.settings.tabs.appearance, icon: Palette, group: 0 },
    { id: 'keyboard', label: strings.settings.tabs.keyboard, icon: Keyboard, group: 0 },
    { id: 'voice', label: strings.speech.heading, icon: Mic, group: 0 },
    { id: 'accounts', label: strings.settings.tabs.accounts, icon: Users, group: 1 },
    { id: 'plugins', label: strings.settings.tabs.plugins, icon: Puzzle, group: 1 },
    { id: 'brain', label: strings.brain.heading, icon: Brain, group: 1 },
    { id: 'usage', label: strings.settings.tabs.usage, icon: Coins, group: 2 },
    { id: 'limits', label: strings.usage.limits, icon: Gauge, group: 2 },
    { id: 'task-manager', label: strings.taskManager.title, icon: Activity, group: 2 },
    { id: 'resources', label: strings.settings.tabs.resources, icon: ShieldCheck, group: 2 },
    { id: 'machines', label: strings.settings.tabs.machines, icon: Monitor, group: 3 },
    { id: 'advanced', label: strings.settings.tabs.advanced, icon: SlidersHorizontal, group: 3 },
    { id: 'diagnostics', label: strings.settings.tabs.diagnostics, icon: Stethoscope, group: 3 },
    { id: 'experiments', label: strings.settings.tabs.experiments, icon: FlaskConical, group: 3 }
  ]);

  let providerList = $derived(providerGroups(store.providers, store.shownAccounts()));

  let children: Partial<Record<SettingsTab, { id: string; label: string }[]>> = $derived({
    general: [
      { id: 'conversations', label: strings.settings.conversations },
      { id: 'archived', label: strings.settings.archived.heading },
      ...(store.owner ? [{ id: 'worktrees', label: strings.settings.worktrees.heading }] : []),
      ...(store.owner ? [{ id: 'windows', label: strings.windows.settings.allowedHeading }, { id: 'window-exclusions', label: strings.windows.settings.exclusionsHeading }] : []),
      { id: 'secrets', label: strings.secrets.heading },
      ...(store.owner ? [{ id: 'browser-profiles', label: strings.browserProfiles.card }] : []),
      { id: 'app', label: strings.settings.app },
      ...(store.owner ? [{ id: 'privacy', label: strings.telemetry.heading }] : []),
      ...(target.policy?.present ? [{ id: 'policy', label: strings.policy.heading }] : [])
    ],
    appearance: [{ id: 'theme', label: strings.settings.display }, { id: 'reading', label: strings.settings.reading }, { id: 'workspace', label: strings.settings.workspace }, { id: 'buttons', label: strings.controls.heading }],
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

  /**
   * The pages whose sections the nav lists under their name: the ones several
   * screens long. Every other page fits on about one screen, or lists rows
   * whose names are already in view, and a sub-entry there only repeats a
   * heading. The search still finds every section above.
   */
  const LONG_PAGES: SettingsTab[] = ['keyboard', 'usage'];
  let toc = $derived<Partial<Record<SettingsTab, { id: string; label: string }[]>>>(
    Object.fromEntries(LONG_PAGES.map((id) => [id, children[id] ?? []]))
  );

  let tabs = $derived(all.filter((tab) => store.owner || !ownerOnly(tab.id)));
  let tileOf = $derived(new Map(tabs.map((entry) => [entry.id, entry])));

  /**
   * Eight entries in the nav: a grouped one holds several pages, shown as tabs
   * at the top of its card. Every page keeps its own route, so a link, the
   * search and a phone still open it by name.
   */
  type NavEntry = { id: SettingsTab; label: string; icon: SettingsTile['icon']; pages: SettingsTab[] };
  let nav = $derived<NavEntry[]>(([
    { id: 'general', label: strings.settings.tabs.general, icon: Settings2, pages: ['general'] },
    { id: 'appearance', label: strings.settings.tabs.appearance, icon: Palette, pages: ['appearance', 'keyboard', 'voice'] },
    { id: 'accounts', label: strings.settings.tabs.accounts, icon: Users, pages: ['accounts', 'plugins'] },
    { id: 'brain', label: strings.brain.heading, icon: Brain, pages: ['brain'] },
    { id: 'usage', label: strings.settings.homeGroups[2]!, icon: Coins, pages: ['usage', 'limits'] },
    { id: 'machines', label: strings.settings.tabs.machines, icon: Monitor, pages: ['machines'] },
    { id: 'resources', label: strings.settings.homeGroups[3]!, icon: ShieldCheck, pages: ['resources', 'task-manager'] },
    { id: 'advanced', label: strings.settings.tabs.advanced, icon: SlidersHorizontal, pages: ['advanced', 'diagnostics', 'experiments'] }
  ] satisfies NavEntry[]).map((entry) => ({ ...entry, pages: entry.pages.filter((page) => tileOf.has(page)) }))
    .filter((entry) => entry.pages.length > 0)
    .map((entry) => ({ ...entry, id: entry.pages[0]! })));
  let current = $derived(nav.find((entry) => entry.pages.includes(tab)));
  /** A grouped entry's pages, as tabs at the top of its card. */
  let strip = $derived((current?.pages.length ?? 0) > 1);
  /** What a page said in its title's "i" before the strip took its title. */
  let tabTips = $derived<Partial<Record<SettingsTab, string>>>({ keyboard: strings.keyboard.intro, voice: strings.speech.description });
  /**
   * The Appearance entry mixes this device's page with two of a machine's
   * (Keyboard, Voice): one short line per tab says where it is saved, once
   * there is a second machine or this window is not the machine itself.
   */
  let scope = $derived.by((): string | undefined => {
    if (current?.id !== 'appearance' || !chosen || (choices.length < 2 && store.localCore)) return undefined;
    const machine = listedName(chosen);
    return tab === 'appearance' ? fill(strings.settings.scopeDevice, { machine }) : fill(strings.settings.scopeMachine, { machine });
  });
  /** Opened on no page in particular, Settings is there to be looked through: the keyboard goes to the search. */
  // Read once on purpose: moving to a page later must not pull the focus back.
  const searchFirst = untrack(() => store.settingsTab === 'home');

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
    ['appearance', 'theme', strings.settings.theme],
    ['appearance', 'theme', strings.settings.colors.title],
    ['appearance', 'theme', strings.settings.material],
    ['appearance', 'theme', strings.settings.language],
    ['appearance', 'theme', strings.settings.groupChanges],
    ['appearance', 'theme', strings.settings.expandDiffs],
    ['appearance', 'theme', strings.features.edgeScrollbars.title],
    ['appearance', 'reading', strings.settings.font],
    ['appearance', 'reading', strings.settings.monoFont],
    ...(inShell ? [['appearance', 'reading', strings.settings.zoom] as [SettingsTab, string, string]] : []),
    ['appearance', 'workspace', strings.settings.startIn],
    ['appearance', 'workspace', strings.settings.panelStart],
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

  /** Every page, every section the nav names and the settings above: what the nav's search looks through. */
  let entries = $derived<SettingsEntry[]>(tabs.flatMap((entry) => {
    const sections = children[entry.id] ?? [];
    const words = settingsWords.filter(([tab, section]) => tab === entry.id && (section === null || sections.some((child) => child.id === section)));
    return [
      { tab: entry.id, section: null, label: entry.label, trail: '' },
      ...sections.map((child) => ({ tab: entry.id, section: child.id, label: child.label, trail: entry.label })),
      ...words.map(([, section, label]) => ({
        tab: entry.id,
        section,
        label,
        trail: [entry.label, sections.find((child) => child.id === section)?.label].filter(Boolean).join(' · ')
      }))
    ];
  }));

  let selectedSection = $state('');
  let chosenSection = $derived(store.settingsSection?.id ?? selectedSection);
  /** While a click scrolls to a card, the spy waits: the scroll passes other cards on its way. */
  let jumping = 0;

  const motion = (): ScrollBehavior => (window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth');

  function jump(id: string) {
    store.settingsSection = null;
    selectedSection = id;
    const target = document.getElementById(`settings-${id}`);
    if (!target) return;
    jumping = Date.now();
    target.scrollIntoView({ behavior: motion(), block: 'start' });
  }

  function open(entry: SettingsEntry) {
    selectedSection = '';
    store.showSettings(entry.tab, entry.section);
  }

  /**
   * Scroll spy: the section whose top has passed the top of the scrolling
   * page is the one being read. At the very bottom the last one wins, since a
   * short card there never reaches the top. The page scrolls, not the panel,
   * and a scroll does not bubble, so the panel listens in the capture phase.
   */
  function spy(event: Event) {
    const page = event.target;
    if (!(page instanceof HTMLElement) || Date.now() - jumping < 900) return;
    const sections = toc[tab] ?? [];
    if (sections.length === 0) return;
    const top = page.getBoundingClientRect().top + 24;
    let current = '';
    for (const section of sections) {
      const element = document.getElementById(`settings-${section.id}`);
      if (element && element.getBoundingClientRect().top <= top) current = section.id;
    }
    if (page.scrollTop + page.clientHeight >= page.scrollHeight - 2) {
      const last = sections.findLast((section) => document.getElementById(`settings-${section.id}`));
      if (last) current = last.id;
    }
    if (current !== chosenSection) {
      store.settingsSection = null;
      selectedSection = current;
    }
  }

  // A caller can name a card before this lazy settings subtree is mounted.
  // Effects run after its DOM is present, so the normal navigation path can
  // perform the first scroll without timing guesses in the caller.
  $effect(() => {
    const section = store.settingsSection;
    if (!section || tab !== store.settingsTab) return;
    void section.request;
    void tick().then(() => {
      if (revealSettingsCard(section.id, section.flash === true, motion())) jumping = Date.now();
    });
  });
</script>

{#snippet machineBar()}
  {#if chosen}<SettingsMachineBar machine={chosen} machines={choices} note={scope} onpick={(id) => { picked = id; }} />{/if}
{/snippet}

{#if !desktopSettings(narrow.current)}
  <MobileSettings {store} {target} bar={bar ? machineBar : undefined} {onopenthread} {onopenlist} entries={entries.filter((entry) => phonePage(entry.tab, entry.section, store.owner) !== 'home')} onsearch={open} />
{:else}
<div class="settings" data-testid="settings">
  <nav aria-label={strings.settings.heading}>
    <button type="button" class="ghost back" data-testid="settings-back" onclick={() => store.showChat()}>
      <ArrowLeft size={15} strokeWidth={1.75} />
      <span class="ui-label">{strings.settings.back}</span>
    </button>
    <SettingsSearch {entries} onopen={open} focus={searchFirst}>
      {#each nav as entry (entry.id)}
        {@const Icon = entry.icon}
        {@const here = current?.id === entry.id}
        {@const long = entry.pages.find((page) => toc[page])}
        <div class="category">
        <button
          type="button"
          class="ghost tab"
          class:active={here}
          data-testid="settings-tab-{entry.id}"
          aria-current={here ? 'page' : undefined}
          aria-expanded={long ? here && !!toc[tab] : undefined}
          onclick={() => { selectedSection = ''; store.showSettings(entry.id); }}
        >
          <Icon size={15} strokeWidth={1.75} />
          <span class="ui-label">{entry.label}</span>
          {#if long}<ChevronRight size={14} class={here && toc[tab] ? 'fold-caret open' : 'fold-caret'} />{/if}
        </button>
        {#if long}
          {@const shown = here && toc[tab] ? tab : long}
          <div class="subcategories disclosure-fold" class:open={here && !!toc[tab]} inert={!here || !toc[tab]}>
            <div>
              {#each toc[shown] ?? [] as child (child.id)}
                <button class="ghost subsection" class:chosen={chosenSection === child.id} data-settings-section={child.id} title={child.label} onclick={() => jump(child.id)}><span class="ui-label">{child.label}</span></button>
              {/each}
            </div>
          </div>
        {/if}
        </div>
      {/each}
    </SettingsSearch>
  </nav>

  {#if toc[tab]}
    <div class="mobile-subcategories">
      {#each toc[tab] ?? [] as child (child.id)}
        <button class="ghost" class:active={chosenSection === child.id} data-settings-section={child.id} onclick={() => jump(child.id)}><span class="ui-label">{child.label}</span></button>
      {/each}
    </div>
  {/if}

  <!-- The panel is keyed on the tab, so switching tabs fades the new page in
       rather than swapping it in one frame. -->
  {#key current?.id ?? tab}
    <section class="framed" class:with-bar={bar || banner || strip} onscrollcapture={spy}>
      {#if strip && current}
        <div class="page-tabs">
          <div class="tab-row" role="tablist" aria-label={current.label} data-testid="settings-page-tabs">
            {#each current.pages as page (page)}
              <button type="button" role="tab" class="ghost page-tab" class:active={page === tab} aria-selected={page === tab}
                data-testid="settings-page-{page}" onclick={() => { selectedSection = ''; store.showSettings(page); }}>
                <span class="ui-label">{tileOf.get(page)?.label ?? page}</span>
              </button>
            {/each}
          </div>
          <!-- The page drops its title under the strip (titled), so its "i" moves here, after the tabs. -->
          {#if tabTips[tab]}<InfoTip topic={tileOf.get(tab)?.label ?? tab} text={tabTips[tab]!} testid="settings-tab-tip" />{/if}
        </div>
      {/if}
      {#if bar && tab !== 'experiments'}{@render machineBar()}{:else if scope}<p class="scope-note muted" data-testid="settings-scope">{scope}</p>{/if}
      {#key tab}
      {#key target}
      <PolicyBanner store={target} />
      {#if tab === 'brain'}
        <BrainPage store={target} />
      {:else if tab === 'voice'}
        <VoiceSettings store={target} titled={!strip} />
      {:else if tab === 'general'}
        <GeneralSettings store={target} here={store} {onopenlist} />
      {:else if tab === 'machines'}
        <MachinesPage {onopenthread} />
      {:else if tab === 'advanced'}
        <AdvancedSettings store={target} />
      {:else if tab === 'appearance'}
        <AppearancePage {store} titled={!strip} />
      {:else if tab === 'keyboard'}
        <KeyboardPage store={target} titled={!strip} />
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
      {/key}
    </section>
  {/key}
</div>
{/if}

<style>
  .mobile-subcategories { display: none; }
  /* With the machine bar, the panel scrolls bar and page together, on one column. */
  .framed.with-bar { scrollbar-gutter: stable both-edges; }
  .framed.with-bar > :global(.machine-bar) { padding: 24px clamp(20px, 4vw, 64px) 0; }
  .framed.with-bar > :global(.page) { height: auto; overflow: visible; padding-top: 20px; }
  .framed > :global(.policy-banner) { margin: 24px clamp(20px, 4vw, 64px) 0; }
  /* The scroll ends 24 px under the last card, whichever element scrolls: the panel with the bar, the page without it. */
  .framed > :global(.page) { padding-bottom: 24px; }
  @media (min-width: 721px) {
    /* A bottom edge fade as tall as the phone list's (24 px): a row the window cuts fades out over more than its
       13 px line, so it reads as more to scroll to, not as a broken card. Not a mask on the panel, which would fade
       its border and clip its shadow: a strip of the panel's own ground, faded in, held at the bottom edge while the
       content scrolls under it. At the end of the scroll it covers only the page's 24 px end padding. */
    .framed { --fade: 24px; }
    .framed::after {
      content: '';
      position: sticky;
      bottom: 0;
      display: block;
      height: var(--fade);
      margin-top: calc(-1 * var(--fade));
      pointer-events: none;
      background: inherit;
      mask-image: linear-gradient(to bottom, transparent, black);
    }
    .framed.with-bar > :global(.machine-bar) { padding-inline: max(clamp(20px, 4vw, 64px), calc((100% - var(--settings-width)) / 2)); max-width: none; }
    .framed > :global(.policy-banner) { margin-inline: max(clamp(20px, 4vw, 64px), calc((100% - var(--settings-width)) / 2)); }
  }
  @media (max-width: 720px) {
    .framed.with-bar > :global(.machine-bar) { padding: 16px 16px 0; }
    .framed.with-bar > :global(.page) { padding-top: 16px; }
    .framed > :global(.policy-banner) { margin: 16px 16px 0; }
  }
  .category { flex: none; }
  /* A grouped entry's pages: text tabs on one line, the page in view underlined. */
  /* Both on the page's column: the tabs' text, inside their 12 px padding, and the note line up with its title. */
  .scope-note { margin: 8px 0 0; padding-inline: max(clamp(20px, 4vw, 64px), calc((100% - var(--settings-width)) / 2)); font-size: var(--text-sm); }
  .tab-row { display: flex; gap: 4px; }
  .page-tabs { display: flex; align-items: center; gap: 4px; padding: 24px calc(max(clamp(20px, 4vw, 64px), calc((100% - var(--settings-width)) / 2)) - 12px) 0; overflow-x: auto; scrollbar-width: none; }
  .page-tab { flex: none; position: relative; height: var(--row); padding: 0 12px; color: var(--color-muted-foreground); }
  .page-tab.active { color: var(--color-foreground); }
  .page-tab.active::after { content: ''; position: absolute; left: 12px; right: 12px; bottom: -1px; height: 2px; border-radius: 1px; background: var(--color-accent); }
  .framed.with-bar > .page-tabs + :global(.machine-bar) { padding-top: 16px; }
  .tab span { flex: 1; text-align: left; }
  .tab :global(.fold-caret) { color: inherit; }
  /* Block rather than flex, and a label longer than the rail wraps onto a second
     line: French says most of these in more letters, and a cut label hides the word
     that tells two sections apart. */
  .subsection { display: block; text-align: left; white-space: normal; text-wrap: pretty; height: auto; min-height: var(--control); padding-block: 5px; line-height: 1.3; width: calc(100% - 24px); margin-left: 24px; padding-left: 15px; border-left: 1px solid var(--color-edge); border-radius: 0; color: var(--color-muted-foreground); font-size: var(--text-sm); transition: color var(--dur-2), border-color var(--dur-2), background var(--dur-2); }
  .subsection.chosen { color: var(--color-foreground); border-left-color: var(--color-foreground); background: var(--color-hover); }

  .settings {
    display: flex;
    flex: 1;
    min-height: 0;
    min-width: 0;
    animation: rise var(--dur-3) var(--ease-out-quint);
  }

  nav {
    width: 240px;
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 20px 14px;
    overflow-y: auto;
  }


  .back {
    flex: none;
    justify-content: flex-start;
    margin-bottom: 10px;
  }

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

    .page-tabs { padding: 12px 4px 0; }
    .scope-note { padding-inline: 16px; }
    nav > :global(.search) { flex: 0 0 180px; margin: 0 6px 0 0; }
    .subcategories { display: none; }
    .mobile-subcategories { display: flex; gap: 4px; padding: 8px 14px; overflow-x: auto; flex: none; border-bottom: 1px solid var(--color-border); }
    .mobile-subcategories button { flex: none; font-size: var(--text-sm); }
    .back { display: none; }
    .category { min-width: 0; }
  }
</style>
