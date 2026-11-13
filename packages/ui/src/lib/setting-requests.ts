/**
 * What a settings card says: a setting's name, its value as a person reads
 * it, and where it sits in Settings. The card itself is
 * `components/SettingRequestCard.svelte`; the checks it shares with the core
 * are in `packages/contracts/src/setting-requests.ts`, the core's cards in
 * `packages/core/src/threads/cards.ts`.
 */
import { EXPERIMENT_STAGES, REQUESTABLE_SETTINGS, experimentOf, isRequestableSetting, type AutoCompactMoment, type ProviderSummary, type RequestableKey, type RequestableSetting, type SettingAsk, type SettingsPage, type SettingsPageName } from '@boite/contracts';
import { cardOf, placeOf, settingsHas, type SettingsCardId } from './settings-tabs';
import { cardWords } from './settings-index';
import { experimentCopy } from './experiment-copy';
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
  if (known !== null && EXPERIMENT_STAGES[known] === 'normal') return { title: strings.settingRequest.formerExperiment, switched: false };
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
export function settingHeading(setting: SettingAsk): string {
  const words = strings.settingRequest;
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

/**
 * Where a card points on the map of Settings (`settings-tabs.ts`). A change
 * names its setting, whose place this build knows whatever the core that
 * asked said; a card that only opens Settings names a page, one of the nine
 * or one from before them.
 */
export function settingPlace(setting: SettingAsk): { page: SettingsPage; section: string | null } {
  if (setting.kind === 'change' && isRequestableSetting(setting.key)) {
    const known = REQUESTABLE_SETTINGS[setting.key];
    return placeOf(known.page, known.section);
  }
  return placeOf(setting.page, setting.section);
}

/** A page's name as the nav lists it; a page from before the map by the page its content went to. */
export function settingsPageLabel(page: SettingsPageName): string {
  return strings.settingsMap.pages[placeOf(page, null).page];
}

/** A card's name on its page, when the app names it; a provider's card by the provider's name. */
export function settingsSectionLabel(section: string, providers: readonly ProviderSummary[] = []): string | null {
  if (section.startsWith('provider-')) return providers.find((provider) => provider.id === section.slice('provider-'.length))?.name ?? null;
  if (section === 'brain-folder') return strings.brain.folder;
  const card = cardOf(section);
  return card ? cardWords()[card.id as SettingsCardId].title : null;
}

/**
 * Whether this client's Settings has the card a settings card points at, on
 * a desktop or a phone: the map decides (`settingsHas`). A button that would
 * land on another page instead is not offered.
 */
export function settingsReachable(setting: SettingAsk, client: { owner: boolean; phone: boolean }): boolean {
  const place = settingPlace(setting);
  return settingsHas(place.page, place.section, client.owner, client.phone);
}

/** `Safeguards › Resource limits`, the trail under a card. */
export function settingPlaceText(setting: SettingAsk, providers: readonly ProviderSummary[] = []): string {
  const place = settingPlace(setting);
  const section = place.section === null ? null : settingsSectionLabel(place.section, providers);
  return [strings.settingsMap.pages[place.page], section].filter((part): part is string => part !== null).join(' › ');
}
