/**
 * What a settings card says: a setting's name, its value as a person reads
 * it, and where it sits in Settings. The card itself is
 * `components/SettingRequestCard.svelte`; the checks it shares with the core
 * are in `packages/contracts/src/setting-requests.ts`, the core's cards in
 * `packages/core/src/threads/cards.ts`.
 */
import { EXPERIMENT_STAGES, experimentOf, type AutoCompactMoment, type ProviderSummary, type RequestableKey, type RequestableSetting, type SettingAsk, type SettingCardAsk, type SettingsPage } from '@boite/contracts';
import { experimentCopy } from './experiment-copy';
import { experimentsShown } from './experiments.svelte';
import { formatLocale } from './i18n.svelte';
import { fill, strings } from './strings';
import { formatTokens } from './format';

const UNITS: Partial<Record<RequestableSetting, { unit: string; display: 'short' | 'long' }>> = {
  agentCpuCapPercent: { unit: 'percent', display: 'short' },
  agentMemoryBudgetPercent: { unit: 'percent', display: 'short' },
  threadMemoryCapMb: { unit: 'megabyte', display: 'short' },
  memoryReserveMb: { unit: 'megabyte', display: 'short' },
  warmProcessMinutes: { unit: 'minute', display: 'short' },
  threadDoneRetentionDays: { unit: 'day', display: 'long' },
  threadDeletionRetentionDays: { unit: 'day', display: 'long' },
};

/**
 * The experiments that left the Experiments page, for a card asked about one
 * before: the name the user knows it by now, and whether a switch is left.
 */
function graduated(key: string): { title: string; switched: boolean } | null {
  const id = key.startsWith('experiment.') ? key.slice('experiment.'.length) : null;
  if (id === 'open-chat-links') return { title: strings.features.openChatLinks.title, switched: true };
  if (id === 'preview-comments') return { title: strings.features.previewComments.title, switched: true };
  if (id === 'edge-scrollbars') return { title: strings.features.edgeScrollbars.title, switched: true };
  if (id === 'press-preload') return { title: strings.settingRequest.loadOnPress, switched: false };
  // Finished since: on in every build, with no switch (`EXPERIMENT_STAGES`).
  if (id === 'resident-agents') return { title: strings.agents.heading, switched: false };
  if (id === 'theme-grain') return { title: strings.settings.themeGrain, switched: false };
  if (id === 'session-import') return { title: strings.palette.importSession, switched: false };
  if (id === 'pinned-quotas') return { title: strings.quotas.pin, switched: false };
  if (id === 'prompt-cache') return { title: strings.settingRequest.promptCacheTimer, switched: false };
  if (id === 'recording-indicators') return { title: strings.settingRequest.recordingActions, switched: false };
  const known = experimentOf(key);
  if (known !== null && EXPERIMENT_STAGES[known] === 'release') return { title: strings.settingRequest.formerExperiment, switched: false };
  return null;
}

/** What a card about a graduated experiment says instead of offering Apply. */
export function retiredHint(key: string): string {
  const former = graduated(key);
  // Still an experiment, on a machine whose build runs none.
  if (former === null && experimentOf(key) !== null) return strings.settingRequest.retiredRelease;
  return former?.switched === false ? strings.settingRequest.retiredAlwaysOn : strings.settingRequest.retired;
}

/** The card's title, in the dock's row and on the card. */
export function settingHeading(setting: SettingCardAsk): string {
  const words = strings.settingRequest;
  if (setting.kind === 'bot') return strings.botRequest.heading;
  if (setting.kind === 'open') return setting.plugin ? words.headingPlugin : words.headingOpen;
  return setting.sensitive ? words.headingSensitive : words.heading;
}

export function settingLabel(key: RequestableKey): string {
  const experiment = experimentOf(key);
  const former = graduated(key);
  if (former !== null) return former.title;
  if (experiment !== null) return experimentCopy()[experiment]?.title ?? key;
  return strings.settingRequest.keys[key as RequestableSetting] ?? key;
}

/** What the setting does, as the Settings page explains it; null where the card's name says enough. */
export function settingHint(key: RequestableKey): string | null {
  const experiment = experimentOf(key);
  return experiment === null ? null : experimentCopy()[experiment]?.hint ?? null;
}

/** A value as the card shows it: `60 %`, `On`, `512 MB`, `In D:/worktrees`. */
export function settingValueText(key: RequestableKey, value: unknown, providers: readonly ProviderSummary[] = []): string {
  const words = strings.settingRequest;
  if (value === null || value === undefined) return words.none;
  if (typeof value === 'boolean') return value ? words.on : words.off;
  if (typeof value === 'number') {
    const zero = (words.zero as Partial<Record<RequestableKey, string>>)[key];
    if (value === 0 && zero !== undefined) return zero;
    const unit = UNITS[key as RequestableSetting];
    return new Intl.NumberFormat(formatLocale(), unit ? { style: 'unit', unit: unit.unit, unitDisplay: unit.display } : {}).format(value);
  }
  if (key === 'coordinationReach' && typeof value === 'string' && value in strings.agentsAlone.steps) return strings.agentsAlone.steps[value as keyof typeof strings.agentsAlone.steps];
  if (key === 'agentBotCreation' && typeof value === 'string' && value in strings.agentsAlone.values) return strings.agentsAlone.values[value as keyof typeof strings.agentsAlone.values];
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.length === 0 ? words.none : value.map(String).join(', ');
  const object = value as Record<string, unknown>;
  if (key === 'worktreeStorage') {
    const directory = typeof object.directory === 'string' ? object.directory : null;
    return object.mode === 'shared' && directory !== null ? fill(words.worktreeShared, { dir: directory }) : words.worktreeProject;
  }
  if (key === 'titleModel' && typeof object.model === 'string') {
    const provider = providers.find((entry) => entry.id === object.providerId);
    return provider ? `${provider.name} · ${object.model}` : object.model;
  }
  if (key === 'autoCompact') {
    const size = typeof object.tokens === 'number' ? fill(words.compactAt, { tokens: formatTokens(object.tokens) }) : words.compactAny;
    const names: Record<AutoCompactMoment, string> = {
      'turn-end': strings.settings.autoCompactTurnEnd,
      background: strings.settings.autoCompactBackground,
      'cache-expiry': strings.settings.autoCompactCacheExpiry,
    };
    const moments = Array.isArray(object.moments) ? (object.moments as AutoCompactMoment[]).map((moment) => names[moment] ?? moment) : [];
    return [size, ...moments].join(' · ');
  }
  return JSON.stringify(value);
}

export function settingsPageLabel(page: SettingsPage): string {
  const tabs = strings.settings.tabs;
  const labels: Record<SettingsPage, string> = {
    general: tabs.general,
    appearance: tabs.appearance,
    keyboard: tabs.keyboard,
    voice: strings.speech.heading,
    accounts: tabs.accounts,
    plugins: tabs.plugins,
    brain: strings.brain.heading,
    usage: tabs.usage,
    limits: strings.usage.limits,
    'task-manager': strings.taskManager.title,
    resources: tabs.resources,
    machines: tabs.machines,
    advanced: tabs.advanced,
    experiments: tabs.experiments,
  };
  return labels[page];
}

/** A card's name on its page, when the app names it; a provider's card by the provider's name. */
export function settingsSectionLabel(section: string, providers: readonly ProviderSummary[] = []): string | null {
  if (section.startsWith('provider-')) return providers.find((provider) => provider.id === section.slice('provider-'.length))?.name ?? null;
  const settings = strings.settings;
  const labels: Record<string, string> = {
    'thread-list': settings.threadList,
    conversations: settings.inConversation,
    notifications: settings.notificationsHeading,
    archived: settings.archived.heading,
    worktrees: settings.worktrees.heading,
    app: settings.app,
    privacy: strings.telemetry.heading,
    theme: settings.display,
    reading: settings.reading,
    workspace: settings.workspace,
    buttons: strings.controls.heading,
    'brain-folder': strings.brain.folder,
    hooks: strings.hooks.heading,
    quiet: strings.protection.quiet,
    limits: strings.protection.limits,
    tasks: strings.protection.tasks,
    'limit-resume': strings.quotas.autoResume,
    'agents-alone': strings.agentsAlone.heading,
    machines: strings.machines.heading,
    updates: strings.appUpdate.updates,
    'agent-updates': strings.harnessUpdates.heading,
    phone: strings.phone.heading,
    execution: settings.execution,
    origins: strings.machines.browserOrigins,
    'auto-compact': settings.autoCompact,
    'device-stream': settings.deviceStream,
    'background-compaction': settings.backgroundCompaction,
  };
  return labels[section] ?? null;
}

/** Pages a paired device's Settings leaves out: `OWNER_TABS` in `SettingsShell.svelte`. */
const OWNER_PAGES: readonly SettingsPage[] = ['accounts', 'plugins', 'resources', 'brain'];
/** Cards of the shared pages that only the owner's Settings draws there. */
const OWNER_SECTIONS: readonly string[] = ['quiet', 'agents-alone', 'agent-replies', 'worktrees', 'privacy', 'execution', 'origins', 'auto-compact', 'device-stream', 'background-compaction'];
/**
 * What a phone browser's Settings (`MobileSettings.svelte`) draws: the pages
 * it opens whole, then the cards it has of the others. Keep it in step with
 * that component's `page`.
 */
const PHONE_PAGES: readonly SettingsPage[] = ['appearance', 'accounts', 'voice', 'usage', 'limits', 'task-manager', 'experiments', 'brain'];
const PHONE_CARDS: Partial<Record<SettingsPage, readonly string[]>> = {
  resources: ['limits', 'tasks'],
  machines: ['machines', 'group'],
  general: ['archived', 'worktrees', 'conversations', 'quiet', 'agents-alone', 'agent-replies'],
  advanced: ['auto-compact'],
};

/**
 * Whether this client's Settings has the card a settings card points at. A
 * button that would land on Home instead is not offered.
 */
export function settingsReachable(setting: SettingAsk, client: { owner: boolean; phone: boolean }): boolean {
  const section = setting.section;
  // A Release has no Experiments page.
  if (setting.page === 'experiments' && !experimentsShown()) return false;
  if (!client.owner && (OWNER_PAGES.includes(setting.page) || (section !== null && OWNER_SECTIONS.includes(section)))) return false;
  if (!client.phone || PHONE_PAGES.includes(setting.page)) return true;
  const cards = PHONE_CARDS[setting.page];
  if (cards === undefined) return false;
  // Resources and Machines open as pages of their own; General and Advanced only through one of their cards.
  return section === null ? setting.page === 'resources' || setting.page === 'machines' : cards.includes(section);
}

/** `Resources › Limits`, the trail under a card. */
export function settingPlaceText(setting: SettingAsk, providers: readonly ProviderSummary[] = []): string {
  const section = setting.section === null ? null : settingsSectionLabel(setting.section, providers);
  return [settingsPageLabel(setting.page), section].filter((part): part is string => part !== null).join(' › ');
}
