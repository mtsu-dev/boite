<script lang="ts">
  import { MediaQuery } from 'svelte/reactivity';
  import { tick } from 'svelte';
  import MobileSettings from './MobileSettings.svelte';
  import BrainPage from './BrainPage.svelte';
  import InfoTip from './InfoTip.svelte';
  import { ChevronDown, ChevronLeft, ChevronRight, Search, Monitor, MonitorSmartphone } from '@lucide/svelte';
  import { SETTINGS_ICONS, SETTINGS_ICON_SIZE, SETTINGS_ICON_STROKE } from '../lib/settings-icons';
  import KeyboardPage from './KeyboardPage.svelte';
  import LimitsPage from './LimitsPage.svelte';
  import PluginsPage from './PluginsPage.svelte';
  import { COMMAND_GROUPS } from '../lib/keybindings';
  import { experimentsListed, experimentsShown } from '../lib/experiments.svelte';
  import { experimentsRun } from '@boite/contracts';
  import { experimentCopy } from '../lib/experiment-copy';
  import { fill, strings } from '../lib/strings';
  import type { SettingsTab, Store } from '../lib/store.svelte';
  import AccountsPage from './AccountsPage.svelte';
  import BrowserPage from './BrowserPage.svelte';
  import AdvancedSettings from './AdvancedSettings.svelte';
  import AppearancePage from './AppearancePage.svelte';
  import ExperimentsPage from './ExperimentsPage.svelte';
  import DiagnosticsPage from './DiagnosticsPage.svelte';
  import GeneralSettings from './GeneralSettings.svelte';
  import PolicyBanner from './PolicyBanner.svelte';
  import MachinesPage from './MachinesPage.svelte';
  import ResourcesPage from './ResourcesPage.svelte';
  import TaskManagerLoader from './TaskManagerLoader.svelte';
  import UsagePage from './UsagePage.svelte';
  import VoiceSettings from './VoiceSettings.svelte';
  import { providerGroups } from '../lib/provider-family';
  import { isThisPC, listedName, machineName, workspace } from '../lib/workspace.svelte';
  import SettingsMachineBar from './SettingsMachineBar.svelte';
  import Menu from './Menu.svelte';
  import MachineIcon from './MachineIcon.svelte';
  import { untrack } from 'svelte';
  import { holdSettingsCard, revealSettingsCard } from '../lib/settings-flash';
  import { desktopPage, desktopSettings, familyOf, machinePage, movedTo, navOf, ownerOnly, pageScopeOf, phonePage, sectionsOf, SETTINGS_FAMILIES } from '../lib/settings-tabs';
  import { PageScope, providePageScope } from '../lib/page-scope.svelte';
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
  /** A card that moved (Workspace to General, Windows and sound to General): a link to its old page lands on its new one. */
  $effect(() => {
    const section = store.settingsSection;
    const page = section && movedTo(store.settingsTab, section.id);
    if (page && section) untrack(() => store.showSettings(page, section.id, { flash: section.flash === true }));
  });
  const narrow = new MediaQuery('(max-width: 720px)');
  const inShell = window.__TAURI_INTERNALS__ !== undefined;

  /** A page as the nav names it. */
  type Tab = { id: SettingsTab; label: string };
  /** One place the search can land: a page, or a card on it. */
  type SettingsEntry = { tab: SettingsTab; section: string | null; label: string; trail: string; family: string };

  // Derived, not built once: the nav is written in the language the app is
  // speaking, and the language changes without a reload. Each entry wears its
  // icon (`SETTINGS_ICONS`), so the list scans by shape as well as by word.
  let all = $derived<Tab[]>([
    { id: 'general', label: strings.settings.tabs.general },
    { id: 'appearance', label: strings.settings.tabs.appearance },
    { id: 'keyboard', label: strings.settings.tabs.keyboard },
    { id: 'voice', label: strings.speech.heading },
    { id: 'accounts', label: strings.settings.tabs.accounts },
    { id: 'plugins', label: strings.settings.tabs.plugins },
    { id: 'browser', label: strings.settings.tabs.browser },
    { id: 'brain', label: strings.brain.heading },
    { id: 'usage', label: strings.settings.tabs.usage },
    { id: 'limits', label: strings.usage.limits },
    { id: 'task-manager', label: strings.taskManager.title },
    { id: 'resources', label: strings.settings.tabs.resources },
    { id: 'machines', label: strings.settings.tabs.machines },
    { id: 'advanced', label: strings.settings.tabs.advanced },
    { id: 'diagnostics', label: strings.settings.tabs.diagnostics },
    { id: 'experiments', label: strings.settings.tabs.experiments }
  ]);

  let providerList = $derived(providerGroups(store.providers, store.shownAccounts()));

  let children: Partial<Record<SettingsTab, { id: string; label: string }[]>> = $derived({
    general: [
      { id: 'thread-list', label: strings.settings.threadList },
      { id: 'conversations', label: strings.settings.inConversation },
      { id: 'notifications', label: strings.settings.notificationsHeading },
      ...(store.owner ? [{ id: 'agent-replies', label: strings.settings.agentReplies }] : []),
      ...(store.owner ? [{ id: 'quiet', label: strings.protection.quiet }] : []),
      ...(store.owner ? [{ id: 'agents-alone', label: strings.agentsAlone.heading }] : []),
      { id: 'workspace', label: strings.settings.workspace },
      { id: 'archived', label: strings.settings.archived.heading },
      ...(store.owner ? [{ id: 'worktrees', label: strings.settings.worktrees.heading }] : []),
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
      { id: 'agent-updates', label: strings.harnessUpdates.heading },
      { id: 'secrets', label: strings.secrets.heading }
    ],
    browser: [{ id: 'browser-profiles', label: strings.browserProfiles.card }],
    usage: [
      { id: 'usage-overview', label: strings.usage.overview },
      { id: 'usage-chart', label: strings.usage.chart },
      { id: 'usage-breakdown', label: strings.usage.breakdown },
      { id: 'usage-threads', label: strings.usage.threads }
    ],
    resources: [
      { id: 'limits', label: strings.protection.limits },
      { id: 'tasks', label: strings.protection.tasks }
    ],
    machines: [
      { id: 'updates', label: strings.appUpdate.updates },
      { id: 'machines', label: strings.machines.heading },
      ...(store.owner ? [{ id: 'windows', label: strings.windows.settings.allowedHeading }, { id: 'window-exclusions', label: strings.windows.settings.exclusionsHeading }] : [])
    ],
    advanced: [
      ...(store.owner ? [{ id: 'execution', label: strings.settings.execution }, { id: 'phone', label: strings.phone.heading }, { id: 'origins', label: strings.machines.browserOrigins }] : []),
      ...(desktopSettings(narrow.current) ? [{ id: 'details', label: strings.settings.terminalAndScrollbars }] : []),
      { id: 'core', label: strings.settings.core }
    ],
    experiments: [...experimentsListed().map((id) => ({ id, label: experimentCopy()[id]?.title ?? id })), ...(store.owner && experimentsRun(target.core?.version) ? [{ id: 'background-compaction', label: strings.settings.backgroundCompaction }, { id: 'device-stream', label: strings.settings.deviceStream }] : [])],
    diagnostics: [
      { id: 'diagnostics-status', label: strings.diagnostics.status },
      { id: 'diagnostics-problems', label: strings.diagnostics.problems },
      { id: 'diagnostics-log', label: strings.diagnostics.log },
      { id: 'diagnostics-agents', label: strings.diagnostics.agentAccess }
    ]
  });

  // Experiments is a page only where the primary machine's build runs them: a Release has none, in the nav or in the search.
  let tabs = $derived(all.filter((tab) => (store.owner || !ownerOnly(tab.id)) && (tab.id !== 'experiments' || experimentsShown())));
  /**
   * The nav's families (`SETTINGS_FAMILIES`), the same list a phone shows,
   * each page a peer inside its family (`navOf`): two levels, the nav and the
   * page, nothing between. A family this window has no page of is left out.
   */
  let families = $derived(SETTINGS_FAMILIES
    .map((family) => ({ id: family.id, label: strings.settings.families[family.id], pages: navOf(family.id, store.owner).flatMap((id) => tabs.filter((entry) => entry.id === id)) }))
    .filter((family) => family.pages.length > 0));
  /** The pages merged into the shown one as its last sections (`lib/settings-tabs.ts`). */
  let merged = $derived(sectionsOf(tab, store.owner));

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
      case 'usage': return `${strings.usage.intro} ${strings.usage.note}`;
      case 'machines': return strings.machines.intro;
      case 'experiments': return strings.settings.experiments.intro;
      case 'diagnostics': return strings.diagnostics.intro;
      case 'task-manager': return strings.taskManager.scope;
      default: return '';
    }
  }
  /** One title per screen, at the top of its card: the page's own name, as the nav lists it. */
  let title = $derived(tabs.find((entry) => entry.id === tab)?.label ?? '');
  let info = $derived(infoOf(tab));
  let scopePicks = $derived(bar && tab !== 'experiments' && choices.length > 1 && chosen !== undefined);
  /**
   * Where the page's settings apply, said once under the title, for most of
   * its cards ("Saved on this device", "Agent settings apply on studio", the
   * name the picker where there are several); a card that differs says its
   * own at its head, the first machine one then holding the picker.
   */
  const scopes = providePageScope(new PageScope(() => pageScopeOf(tab), () => (scopePicks ? scopePicker : undefined)));
  let scopeKind = $derived(scopes.line ?? (scopePicks && !scopes.hasMachineCard ? 'machine' : null));
  let scope = $derived.by((): string | null => {
    if (scopeKind === 'device') return strings.settings.scopeDevice;
    if (scopeKind !== 'machine') return null;
    const machine = workspace.machines.find((m) => m.store === target);
    return machine ? fill(strings.settings.scopeMachine, { machine: machineName(machine) }) : null;
  });

  /**
   * On a desktop the card carries the screen's one title, a step over the
   * cards' own, as a phone's screen does; the bar above stays empty but for a
   * page's buttons (UsagePage.svelte). The list's head leads back to the
   * threads, as the bots column's does (SideHead.svelte); the rail's gear
   * opens Settings' home: no extra Back button.
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
    ['general', 'thread-list', strings.settings.groupWorkingThreads],
    ['general', 'thread-list', strings.settings.groupOtherProjects],
    ['general', 'notifications', strings.settings.notifications],
    ['general', 'agent-replies', strings.settings.asyncQuestions],
    ['general', 'agent-replies', strings.settings.shortAnswers],
    ['general', 'agent-replies', strings.settings.toolSummaries],
    ['general', 'agent-replies', strings.settings.titleModel],
    ['general', 'agent-replies', strings.settings.goalTrackerModel],
    ['general', 'conversations', strings.features.chatArtifacts.title],
    ...(inShell ? [['general', 'conversations', strings.features.openChatLinks.title] as [SettingsTab, string, string]] : []),
    ['general', 'conversations', strings.features.previewComments.title],
    ['browser', 'browser-profiles', strings.browserProfiles.heading],
    ...(store.owner ? [['machines', 'window-exclusions', strings.windows.settings.addLabel]] as [SettingsTab, string, string][] : []),
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
    ['general', 'quiet', strings.settings.focusGuard],
    ['general', 'quiet', strings.settings.muteAgents],
    ['general', 'agents-alone', strings.agentsAlone.reach],
    ['general', 'agents-alone', strings.agentsAlone.bots],
    ['resources', 'limits', strings.settings.memoryProtection],
    ['resources', 'tasks', strings.settings.reapOrphans],
    ['resources', 'tasks', strings.settings.keepAwake],
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
    // "agents" finds Providers and Limits: a family's name is searched, never shown in a result.
    const home = familyOf(entry.id);
    const family = home ? strings.settings.families[home] : '';
    return [
      { tab: entry.id, section: null, label: entry.label, trail: '', family },
      ...sections.map((child) => ({ tab: entry.id, section: child.id, label: child.label, trail: entry.label, family })),
      ...words.map(([, section, label]) => ({
        tab: entry.id,
        section,
        label,
        trail: [entry.label, sections.find((child) => child.id === section)?.label].filter(Boolean).join(' · '),
        family
      }))
    ];
  // A word that repeats its section's own name ("Updates" under Updates) is one result, not two: two of one key broke the list.
  }).filter((entry, index, all) => all.findIndex((other) => other.tab === entry.tab && other.section === entry.section && other.label === entry.label) === index));

  const motion = (): ScrollBehavior => (window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth');

  /**
   * The search heads the nav: while it holds words, the card lists what they
   * find in place of the page; a result or a nav entry opens its page and
   * empties it.
   */
  let query = $state('');
  let field = $state<HTMLInputElement>();
  /** The result Enter opens: the arrows move it, a new query puts it back on top. */
  let active = $state(0);
  /** "Clavier" finds "clavier", "Récents" finds "recents": case and accents never decide a match. */
  const fold = (text: string): string => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  /** A phone finds only what it can open: a desktop page it lacks (Keyboard, Plugins) would land on Home. */
  let reachable = $derived(desktopSettings(narrow.current) ? entries : entries.filter((entry) => phonePage(entry.tab, entry.section, store.owner) !== 'home'));
  let results = $derived.by(() => {
    const words = fold(query).split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    return reachable.filter((entry) => {
      const text = fold(`${entry.label} ${entry.trail} ${entry.family}`);
      return words.every((word) => text.includes(word));
    }).slice(0, 12);
  });
  let searching = $derived(query.trim() !== '');

  function open(entry: SettingsEntry) {
    query = '';
    store.showSettings(entry.tab, entry.section);
  }

  function go(page: SettingsTab) {
    query = '';
    store.showSettings(page);
  }

  // The gear opens Settings to be searched: the keyboard lands in the field. A
  // touch screen would answer with its keyboard over the page, so it waits for a tap.
  $effect(() => {
    if (untrack(() => store.settingsTab) === 'home' && window.matchMedia('(hover: hover) and (pointer: fine)').matches) field?.focus({ preventScroll: true });
  });

  function onkey(event: KeyboardEvent) {
    const picked = results[Math.min(active, results.length - 1)];
    if (event.key === 'Enter' && picked) {
      event.preventDefault();
      open(picked);
    } else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && results.length > 0) {
      event.preventDefault();
      active = (Math.min(active, results.length - 1) + (event.key === 'ArrowDown' ? 1 : results.length - 1)) % results.length;
    } else if (event.key === 'Escape' && query) {
      event.preventDefault();
      event.stopPropagation();
      query = '';
    }
  }

  // A caller can name a card before this lazy settings subtree is mounted.
  // Effects run after its DOM is present, so the normal navigation path can
  // perform the first scroll without timing guesses in the caller. A page
  // merged into another is that page's section: its route scrolls to it.
  $effect(() => {
    const route = store.settingsTab, section = store.settingsSection;
    const inside = merged.includes(route);
    const id = tab === route ? section?.id : inside ? route : undefined;
    if (!id) return;
    void section?.request;
    let release = () => {};
    let live = true;
    void tick().then(() => {
      if (!live) return;
      // A merged section jumps and holds: the page above it is still filling in.
      // A card of a merged page is found by its own id, the page by its section's.
      const card = inside && section && document.getElementById(`settings-${section.id}`) ? section.id : id;
      revealSettingsCard(card, section?.flash === true, tab === route ? motion() : 'instant');
      if (tab !== route) release = holdSettingsCard(card);
    });
    return () => { live = false; release(); };
  });
</script>

{#snippet blank()}<span class="crumb" aria-hidden="true"></span>{/snippet}

{#snippet machineBar()}
  {#if chosen}<SettingsMachineBar machine={chosen} machines={choices} onpick={(id) => { picked = id; }} />{/if}
{/snippet}
<!-- A scope phrase with its machine as the picker, "Agent settings apply on [studio v]": it says where they apply and switches it. -->
{#snippet scopePicker(template: string)}
  {@const scopeWords = template.split('{machine}')}
  {#if chosen}
    {#if scopeWords[0]?.trim()}<span class="ui-label">{scopeWords[0].trim()}</span>{/if}
    <Menu items={choices.map((entry) => ({ id: entry.id, label: listedName(entry), active: entry === chosen }))} label={strings.machines.pick} placement="bottom" variant="text" testid="settings-machine" onpick={(id) => { picked = id; }}>
      <MachineIcon icon={chosen.icon} os={chosen.store.core?.os} size={14} /><span class="pick-name ui-label">{listedName(chosen)}</span><ChevronDown size={13} aria-hidden="true" />
    </Menu>
    {#if scopeWords[1]?.trim()}<span class="ui-label">{scopeWords[1].trim()}</span>{/if}
  {/if}
{/snippet}
<!-- Settings' home is this search: it finds every page, card and single setting. The phone's home opens on the same field. -->
{#snippet searchField(phone: boolean)}
  <label class="search" class:phone data-testid="settings-home">
    <Search size={14} strokeWidth={1.75} aria-hidden="true" />
    <input type="search" bind:this={field} bind:value={query} oninput={() => (active = 0)} placeholder={strings.settings.search} aria-label={strings.settings.search} data-testid="settings-search" onkeydown={onkey} spellcheck="false" autocomplete="off" />
  </label>
{/snippet}
{#snippet searchResults()}
  {#if results.length === 0}
    <p class="hint" data-testid="settings-search-empty">{strings.settings.searchEmpty}</p>
  {:else}
    <div class="card flush results" data-testid="settings-search-results">
      {#each results as entry, index (`${entry.tab}:${entry.section}:${entry.label}`)}
        <button type="button" class="ghost result" class:active={index === Math.min(active, results.length - 1)} data-testid="settings-search-result" onpointermove={() => (active = index)} onclick={() => open(entry)}>
          <span class="label ui-label">{entry.label}</span>
          {#if entry.trail}<span class="trail ui-label">{entry.trail}</span>{/if}
          <ChevronRight size={15} />
        </button>
      {/each}
    </div>
  {/if}
{/snippet}
<!-- Under a title whose scope line is the picker: only the bar's notes (follows, default machine). -->
{#snippet machineNotes()}
  {#if chosen}<SettingsMachineBar machine={chosen} machines={choices} picker={false} onpick={(id) => { picked = id; }} />{/if}
{/snippet}

{#if !desktopSettings(narrow.current)}
  <MobileSettings {store} {target} bar={bar ? machineBar : undefined} pick={bar && choices.length > 1 ? scopePicker : undefined} notes={machineNotes} search={searchField} found={searching ? searchResults : undefined} {onopenthread} />
{:else}
<div class="settings" data-testid="settings">
  <nav aria-label={strings.settings.heading}>
    <!-- The list's head leads back to the threads, like the bots column's; the rail's gear opens Settings' home. -->
    <button type="button" class="ghost title" data-testid="settings-back" title={strings.settings.back} onclick={() => { store.showChat(); store.sidebarCollapsed = false; }}>
      <ChevronLeft size={18} aria-hidden="true" /><span class="ui-label">{strings.settings.heading}</span>
    </button>
    {@render searchField(false)}
    <!-- The pages under their family heads, as on a phone, every page a peer of its family. -->
    {#each families as family (family.id)}
      <div class="family" role="group" aria-label={family.label} data-testid="settings-family" data-family={family.id}>
        <p class="family-head ui-label" aria-hidden="true">{family.label}</p>
        {#each family.pages as page (page.id)}
          {@const here = !searching && tab === page.id}
          {@const Icon = SETTINGS_ICONS[page.id as keyof typeof SETTINGS_ICONS]}
          <button
            type="button"
            class="ghost tab"
            class:active={here}
            data-testid="settings-tab-{page.id}"
            aria-current={here ? 'page' : undefined}
            onclick={() => go(page.id)}
          >
            {#if Icon}<Icon size={SETTINGS_ICON_SIZE} strokeWidth={SETTINGS_ICON_STROKE} aria-hidden="true" />{/if}
            <span class="ui-label">{page.label}</span>
          </button>
        {/each}
      </div>
    {/each}
  </nav>

  <!-- The panel is keyed on the tab, so switching tabs fades the new page in
       rather than swapping it in one frame. -->
  {#key tab}
    <section class="framed">
      {#if searching}
        <div class="found">{@render searchResults()}</div>
      {:else}
        <header class="screen" data-testid="settings-crumb">
          <h1 class="ui-label-box"><span class="ui-label">{title}</span>{#if info}<InfoTip topic={title} text={info} testid="settings-info" />{/if}</h1>
          {#if scope}
            <p class="scope" data-testid="settings-scope" data-scope={scopeKind}>
              {#if scopeKind === 'device'}<MonitorSmartphone size={14} strokeWidth={1.75} aria-hidden="true" />{:else if !scopePicks}<Monitor size={14} strokeWidth={1.75} aria-hidden="true" />{/if}
              {#if scopeKind === 'machine' && scopePicks}{@render scopePicker(strings.settings.scopeMachine)}{:else}<span class="ui-label">{scope}</span>{/if}
            </p>
          {/if}
        </header>
        {#if bar && tab !== 'experiments'}{@render machineNotes()}{/if}
        {#key target}
        <PolicyBanner store={target} />
        {@render view(tab)}
        {#each merged as section (section)}
          <!-- A page merged into this one, as its last section: its route scrolls here. -->
          <div class="merged" id="settings-{section}">{@render view(section)}</div>
        {/each}
        {/key}
      {/if}
    </section>
  {/key}
</div>
{/if}

{#snippet view(page: SettingsTab)}
      {#if page === 'brain'}
        <BrainPage store={target} />
      {:else if page === 'voice'}
        <VoiceSettings store={target} />
      {:else if page === 'general'}
        <GeneralSettings store={target} here={store} />
      {:else if page === 'machines'}
        <MachinesPage {onopenthread} {store} />
      {:else if page === 'advanced'}
        <AdvancedSettings store={target} />
      {:else if page === 'appearance'}
        <AppearancePage {store} />
      {:else if page === 'keyboard'}
        <KeyboardPage store={target} />
      {:else if page === 'accounts'}
        <AccountsPage store={target} />
      {:else if page === 'browser'}
        <BrowserPage />
      {:else if page === 'usage'}
        <UsagePage {store} />
      {:else if page === 'limits'}
        <LimitsPage store={target} />
      {:else if page === 'task-manager'}
        <TaskManagerLoader {store} {onopenthread} />
      {:else if page === 'plugins'}
        <PluginsPage store={target} />
      {:else if page === 'experiments'}
        <!-- Shown alone it carries the bar between its two halves; under Advanced, the bar above serves both. -->
        <ExperimentsPage {store} {target} bar={bar && page === tab ? machineBar : undefined} />
      {:else if page === 'diagnostics'}
        <DiagnosticsPage store={target} {onopenthread} />
      {:else if page === 'resources'}
        <ResourcesPage store={target} />
      {/if}
{/snippet}

<style>
  /* The panel scrolls title, bar and page together, on one column. */
  .framed { scrollbar-gutter: stable both-edges; }
  .framed > :global(.machine-bar) { padding: 24px var(--settings-gutter) 0; }
  .framed > :global(.page) { height: auto; overflow: visible; padding-top: 20px; }
  .framed > :global(.policy-banner) { margin: 24px var(--settings-gutter) 0; }
  @media (min-width: 721px) {
    .framed > :global(.machine-bar) { padding-inline: max(var(--settings-gutter), calc((100% - var(--settings-width)) / 2)); max-width: none; }
    .framed > :global(.policy-banner) { margin-inline: max(var(--settings-gutter), calc((100% - var(--settings-width)) / 2)); }
  }
  @media (max-width: 720px) {
    .framed > :global(.machine-bar) { padding: 16px 16px 0; }
    .framed > :global(.page) { padding-top: 16px; }
    .framed > :global(.policy-banner) { margin: 16px 16px 0; }
  }
  .tab span { flex: 1; text-align: left; }
  .tab { gap: 12px; }
  .tab :global(svg) { flex: none; width: 18px; height: 18px; color: var(--color-subtle); transition: color var(--dur-2); }
  .tab.active :global(svg) { color: var(--color-accent); }
  /* A family: its head in the meta size over its entries, and air between two families. */
  .family { display: flex; flex-direction: column; gap: 2px; }
  .family + .family { margin-top: var(--space-5); }
  .search + .family { margin-top: var(--space-3); }
  .family-head { margin: 0; padding: 0 12px var(--space-2); color: var(--color-subtle); font-size: var(--text-meta); font-weight: 500; }

  /* The search heads the nav, on the chrome like the rows under it. */
  .search {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: 38px;
    margin: 0 0 var(--space-2);
    padding: 0 12px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-hover);
    color: var(--color-subtle);
    transition: border-color var(--dur-2);
  }
  /* A field brightens its edge on focus, as every field does (app.css): an autofocused search wore an accent frame. */
  .search:focus-within { border-color: var(--color-composer-focus); }
  .search :global(svg) { flex: none; }
  .search input { flex: 1; min-width: 0; height: 100%; padding: 0; border: 0; background: transparent; box-shadow: none; outline: none; font-size: var(--text-base); color: var(--color-foreground); }
  .search input::-webkit-search-cancel-button { display: none; }
  /* The phone's home: the field spans its column, first under the header, a finger tall. */
  .search.phone { width: auto; height: var(--touch-target); margin: 0 0 var(--space-5); background: var(--color-surface); }
  .search.phone input { font-size: var(--text-md); }

  /* What the search finds, in the page's column. */
  .found { padding: var(--space-8) max(var(--settings-gutter), calc((100% - var(--settings-width)) / 2)); }
  .hint { margin: 0; color: var(--color-muted-foreground); font-size: var(--text-base); }
  .results { display: grid; }
  .result {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: var(--space-3);
    height: auto;
    min-height: var(--row);
    padding: var(--space-2) var(--space-4);
    border-radius: 0;
    color: var(--color-foreground);
    text-align: left;
  }
  button.result.active { background: var(--color-hover); }
  .result + .result { border-top: 1px solid var(--color-border); }
  .result .label { flex: none; max-width: 60%; }
  .result .trail { flex: 1; min-width: 0; font-size: var(--text-sm); color: var(--color-muted-foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .result :global(svg) { flex: none; color: var(--color-subtle); }

  /* A page merged into another reads as its last section: its title a section title, the same column. */
  .merged { scroll-margin-top: var(--space-6); }
  /* The last one fills the panel, so its route can scroll it to the top. */
  .merged:last-child { min-height: 100%; }
  .merged > :global(.page) { height: auto; overflow: visible; padding-top: 0; padding-inline: max(var(--settings-gutter), calc((100% - var(--settings-width)) / 2)); }
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

  /* The pages' list is a column of its own width, on the chrome: every page's name fits it,
     so it does not follow the thread list's, which a long title can pull to a third of the
     window. The page stands in the inset card beside it, as in the rest of the frame. */
  .settings {
    display: flex;
    flex: 1;
    gap: var(--frame-gap);
    min-height: 0;
    min-width: 0;
  }

  nav {
    width: var(--settings-nav);
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 0 8px 12px;
    overflow-y: auto;
  }

  /* The thread list's head: same height, size and inset, so the switch reads as one column changing.
     It leads back to the threads (SideHead.svelte's back title), so it only lights under the pointer. */
  .title { flex: none; justify-content: flex-start; gap: 4px; height: 40px; margin: 14px 0 8px; padding: 0 10px 0 6px; font-size: var(--text-lg); font-weight: 600; letter-spacing: -0.015em; color: var(--color-subtle); }
  .title .ui-label { color: var(--color-foreground); }
  .title:hover:not(:disabled) { background: var(--color-hover); color: var(--color-foreground); }

  .crumb { flex: 1; min-width: 0; }
  /* The screen's one title, at the top of its card in the settings column, one step over a card's. */
  .screen { display: flex; flex-direction: column; align-items: flex-start; padding: var(--space-8) max(var(--settings-gutter), calc((100% - var(--settings-width)) / 2)) 0; }
  .screen h1 { min-width: 0; margin: 0; color: var(--color-foreground); font-size: var(--settings-title); font-weight: 650; line-height: 1.2; letter-spacing: -0.02em; }
  /* The first card's title follows the screen's title at the normal step, with no empty band between. */
  .screen ~ :global(.page) { padding-top: var(--space-4); }
  .screen ~ :global(.page > .card:first-child:has(> h2:first-child)),
  .screen ~ :global(.page > header:first-child + .card:has(> h2:first-child)) { margin-top: var(--card-head); }
  /* The machine's name in the scope line is the picker: a word with an edge and a chevron, so it reads as one at rest. */
  :global(.settings .scope .trigger.text) { margin: -2px 0; color: var(--color-foreground); box-shadow: inset 0 0 0 1px var(--color-edge); }
  :global(.settings .scope .pick-name) { overflow: hidden; max-width: 28ch; text-overflow: ellipsis; white-space: nowrap; }

  .tab {
    justify-content: flex-start;
    width: 100%;
    position: relative;
    min-height: 40px;
    height: auto;
    padding: 8px 12px;
    white-space: normal;
    font-size: var(--text-head);
    line-height: 1.35;
    color: var(--color-muted-foreground);
  }
  /* The open page's mark: a short bar of the accent at the row's edge, drawn in as the page changes. */
  .tab::before { content: ''; position: absolute; left: 0; top: 50%; width: 3px; height: 18px; border-radius: 0 3px 3px 0; background: var(--color-accent); transform: translateY(-50%) scaleY(0); transition: transform var(--dur-3) var(--ease-out-quint); }
  .tab.active::before { transform: translateY(-50%) scaleY(1); }

  /* A full width row does not shrink under the finger, it fills one step more. */
  .tab:active:not(:disabled) {
    transform: none;
    background: color-mix(in srgb, var(--color-surface-3) 85%, var(--color-foreground));
  }

  .tab.active {
    background: var(--color-active);
    color: var(--color-foreground);
    font-weight: 500;
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
    /* In a row, the head is the first chip, then the search, then each page a chip. */
    .title { height: var(--control); margin: 0; font-size: var(--text-sm); white-space: nowrap; }
    .search { width: 180px; height: var(--control); margin: 0; }
    .tab { width: auto; min-height: var(--row); white-space: nowrap; padding: 6px 10px; font-size: var(--text-sm); }
    .tab::before { display: none; }
    .family { flex-direction: row; }
    .family + .family, .search + .family { margin-top: 0; }
    .family-head { display: none; }
  }
</style>
