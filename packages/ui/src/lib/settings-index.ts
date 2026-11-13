/**
 * What the Settings search looks through: each page, each card of the map
 * (`settings-tabs.ts`), each control of a card with its hint, and the card's
 * keywords. One table keyed by the map's own card ids, so a card cannot be on
 * a page and missing from the search: the type refuses a missing key, and
 * `settings-index.test.ts` holds the table against the rendered pages.
 */
import { SETTINGS_PAGES, SETTINGS_PAGE_ALIASES } from '@boite/contracts';
import { strings } from './strings';
import { cardsOf, pageAvailable, placeOf, type SettingsCardId, type SettingsPage, type SettingsTab } from './settings-tabs';

/** A control as the search knows it: its label, and the hint that explains it when it has one. */
type Control = readonly [label: string, hint?: string];
interface CardWords { title: string; controls: readonly Control[] }

/** Each card's title and controls, in the language the app speaks now. */
export function cardWords(): Record<SettingsCardId, CardWords> {
  const s = strings.settings;
  const fx = s.effects;
  return {
    theme: { title: s.display, controls: [[s.language], [s.theme], [s.accent], [s.chatWidth], [s.material]] },
    reading: { title: s.reading, controls: [[s.font], [s.monoFont], [s.zoom]] },
    buttons: { title: strings.controls.heading, controls: [[strings.terminal.title], [strings.rightPanel.trace]] },
    workspace: { title: s.workspace, controls: [[s.startIn], [s.panelStart]] },
    details: { title: s.terminalAndScrollbars, controls: [[s.terminalCursor], [strings.features.edgeScrollbars.title, strings.features.edgeScrollbars.hint]] },
    keyboard: { title: s.tabs.keyboard, controls: [[strings.keyboard.search, strings.keyboard.intro], [strings.keyboard.resetAll]] },
    'keybinding-file': { title: strings.keyboard.file, controls: [] },
    voice: { title: strings.speech.heading, controls: [[strings.speech.enabled, strings.speech.enabledHint], [strings.speech.microphone]] },
    'thread-list': { title: s.threadList, controls: [[s.groupWorkingThreads, fx.groupWorking], [s.groupOtherProjects, fx.groupIdle]] },
    conversations: { title: s.inConversation, controls: [[strings.features.chatArtifacts.title], [strings.features.openChatLinks.title, fx.openChatLinks], [strings.features.previewComments.title], [s.groupChanges, fx.groupChanges], [s.expandDiffs, fx.expandDiffs]] },
    notifications: { title: s.notificationsHeading, controls: [[s.notifications, fx.notifications]] },
    'agent-replies': { title: s.agentReplies, controls: [[s.asyncQuestions, fx.asyncQuestions], [s.shortAnswers, fx.shortAnswers], [s.toolSummaries, fx.toolSummaries], [s.titleModel, s.titleModelHint], [s.goalTrackerModel, s.goalTrackerModelHint]] },
    archived: { title: s.archived.heading, controls: [[s.archived.doneRetentionLabel, s.archived.intro]] },
    worktrees: { title: s.worktrees.heading, controls: [[s.worktrees.heading, s.worktrees.intro]] },
    providers: { title: strings.providerSettings.heading, controls: [[s.modelDefaults, strings.providerSettings.intro]] },
    'local-acp': { title: strings.localAcp.heading, controls: [[strings.localAcp.command, strings.localAcp.hint]] },
    secrets: { title: strings.secrets.heading, controls: [] },
    quotas: { title: strings.usage.limits, controls: [[strings.quotas.tracked, strings.quotas.trackedHint], [strings.quotas.pin]] },
    'limit-resume': { title: strings.quotas.autoResume, controls: [[strings.quotas.autoResume, strings.quotas.autoResumeHint]] },
    'subscription-proxy': { title: strings.subscriptionProxy.heading, controls: [[strings.subscriptionProxy.enable, strings.subscriptionProxy.hint]] },
    usage: { title: strings.usage.heading, controls: [[strings.usage.overview, strings.usage.intro], [strings.usage.chart], [strings.usage.breakdown], [strings.usage.threads]] },
    brain: { title: strings.brain.heading, controls: [[strings.brain.folder], [strings.brain.autoPull], [strings.brain.globalInstructions, strings.brain.globalHint]] },
    hooks: { title: strings.hooks.heading, controls: [[strings.hooks.refresh]] },
    plugins: { title: strings.plugins.heading, controls: [[strings.plugins.search, strings.plugins.intro]] },
    'agents-alone': { title: strings.agentsAlone.heading, controls: [[strings.agentsAlone.reach], [strings.agentsAlone.bots, strings.agentsAlone.botsEffect]] },
    'auto-compact': { title: s.compactionScope, controls: [[s.autoCompact], [s.compactionCustomize], [s.compactionSummary, s.compactionSummaryHint]] },
    execution: { title: s.execution, controls: [[s.warmProcessMinutes, s.warmProcessMinutesHint]] },
    quiet: { title: strings.protection.quiet, controls: [[s.focusGuard, fx.focusGuard], [s.muteAgents, fx.muteAgents]] },
    windows: { title: strings.windows.settings.allowedHeading, controls: [[strings.windows.settings.allowedHeading, strings.windows.settings.allowedIntro]] },
    'window-exclusions': { title: strings.windows.settings.exclusionsHeading, controls: [[strings.windows.settings.addLabel, strings.windows.settings.exclusionsIntro]] },
    limits: { title: strings.protection.limits, controls: [[s.memoryProtection, s.memoryProtectionHint], [s.agentCpuCapPercent, s.agentCpuCapHint]] },
    'browser-profiles': { title: strings.browserProfiles.card, controls: [[strings.browserProfiles.heading], [strings.browserProfiles.userAgent, strings.browserProfiles.userAgentHint]] },
    privacy: { title: strings.telemetry.heading, controls: [[strings.telemetry.basic, fx.telemetryBasic], [strings.telemetry.enhanced, fx.telemetryEnhanced]] },
    policy: { title: strings.policy.heading, controls: [[strings.policy.file, strings.policy.info]] },
    app: { title: strings.settingsMap.thisDevice, controls: [[s.closeToTray, s.closeToTrayHint], [s.launchAtLogin, s.launchAtLoginHint], [s.terminalGpu, s.terminalGpuHint]] },
    'main-machine': { title: strings.machines.main, controls: [] },
    group: { title: strings.group.heading, controls: [[strings.group.addDevice, strings.group.intro], [strings.group.name], [strings.machines.home], [strings.machines.bots, strings.machines.botsHint]] },
    machines: { title: strings.machines.heading, controls: [[strings.machines.heading, strings.machines.intro]] },
    phone: { title: strings.phone.heading, controls: [[strings.phone.tailscale.heading], [s.listenOnLan, s.listenOnLanHint], [strings.phone.publicUrl, strings.phone.publicUrlHint], [strings.phone.install]] },
    origins: { title: strings.machines.browserOrigins, controls: [[strings.machines.browserOrigins, strings.machines.browserOriginsHint]] },
    updates: { title: strings.appUpdate.updates, controls: [[strings.appUpdate.heading], [strings.appUpdate.channel], [strings.appUpdate.autoInstall, strings.appUpdate.autoInstallHint], [strings.serverUpdate.updates]] },
    'agent-updates': { title: strings.harnessUpdates.heading, controls: [[strings.harnessUpdates.auto, strings.harnessUpdates.autoHint]] },
    experiments: { title: s.tabs.experiments, controls: [[s.tabs.experiments, s.experiments.intro]] },
    'cache-keepalive': { title: s.cacheKeepalive, controls: [[s.cacheKeepalive, s.cacheKeepaliveHint]] },
    'background-compaction': { title: s.backgroundCompaction, controls: [[s.backgroundCompaction, s.backgroundCompactionHint]] },
    'device-stream': { title: s.deviceStream, controls: [[s.deviceStream, s.deviceStreamHint]] },
    'diagnostics-status': { title: strings.diagnostics.status, controls: [[strings.diagnostics.export, strings.diagnostics.intro]] },
    'diagnostics-problems': { title: strings.diagnostics.problems, controls: [[strings.diagnostics.report]] },
    'diagnostics-log': { title: strings.diagnostics.log, controls: [[strings.diagnostics.search]] },
    'diagnostics-agents': { title: strings.diagnostics.agentAccess, controls: [] },
    tasks: { title: strings.protection.tasks, controls: [[s.reapOrphans, s.reapOrphansHint], [s.keepAwake, s.keepAwakeHint]] },
    'task-manager': { title: strings.taskManager.title, controls: [[strings.taskManager.search, strings.taskManager.scope]] },
    core: { title: s.core, controls: [[s.version], [s.endpoint], [s.dataDir]] },
    tour: { title: strings.settingsMap.tour, controls: [[s.tourReplay, strings.settingsMap.tourHint]] }
  };
}

/** One place the search can land: a page, a card on it, or a control of a card. */
export interface SettingsEntry {
  page: SettingsPage;
  /** The card to scroll to and flash; null for the page itself. */
  section: string | null;
  label: string;
  /** Where it is, shown beside the label: the page, then the card when the entry is a control. */
  trail: string;
  /** Searched, never shown: the hint, the keywords, the page's own question. */
  more: string;
}

/** A card the map does not list, found on a page while it is open: a provider's row, an experiment's switch. */
export interface ExtraEntry { page: SettingsPage; section: string; label: string; card: SettingsCardId }

/** The names of the pages from before the map whose content a page took: "Providers" still finds AI accounts. */
function formerNames(page: SettingsPage): string {
  const tabs: Partial<Record<string, string>> = strings.settings.tabs;
  return ['appearance', ...SETTINGS_PAGE_ALIASES].filter((old) => placeOf(old as SettingsTab, null).page === page).map((old) => tabs[old] ?? '').join(' ');
}

/** Every entry this window may open, a phone's without the desktop cards, pages first in the nav's order, each page's cards in its own. */
export function settingsEntries(owner: boolean, extras: readonly ExtraEntry[] = [], phone = false): SettingsEntry[] {
  const words = cardWords();
  const keywords: Partial<Record<SettingsCardId, string>> = strings.settingsMap.keywords;
  const entries: SettingsEntry[] = [];
  for (const page of SETTINGS_PAGES) {
    if (!pageAvailable(page, owner, phone)) continue;
    const name = strings.settingsMap.pages[page];
    entries.push({ page, section: null, label: name, trail: '', more: `${strings.settingsMap.about[page]} ${formerNames(page)}` });
    for (const card of cardsOf(page, owner, phone)) {
      const { title, controls } = words[card.id as SettingsCardId];
      entries.push({ page, section: card.id, label: title, trail: name, more: keywords[card.id as SettingsCardId] ?? '' });
      for (const [label, hint] of controls) {
        // A control named as its card ("Usage" under Usage) only lends the card its hint.
        if (label === title) entries[entries.length - 1]!.more += ` ${hint ?? ''}`;
        else entries.push({ page, section: card.id, label, trail: `${name} · ${title}`, more: hint ?? '' });
      }
    }
    for (const extra of extras) {
      if (extra.page === page) entries.push({ page, section: extra.section, label: extra.label, trail: `${name} · ${words[extra.card].title}`, more: '' });
    }
  }
  return entries;
}

/** "Clavier" finds "clavier", "Récents" finds "recents": case and accents never decide a match. */
export const fold = (text: string): string => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * What a query finds: every word of it in an entry's label, trail, hint or
 * keywords. An entry whose own label holds the words comes before one found
 * by its hint or a keyword, each group in the map's order.
 */
export function searchSettings(entries: readonly SettingsEntry[], query: string, limit = 12): SettingsEntry[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const named: SettingsEntry[] = [];
  const other: SettingsEntry[] = [];
  for (const entry of entries) {
    const label = fold(entry.label);
    if (words.every((word) => label.includes(word))) named.push(entry);
    else if (words.every((word) => fold(`${entry.label} ${entry.trail} ${entry.more}`).includes(word))) other.push(entry);
  }
  return [...named, ...other].slice(0, limit);
}
