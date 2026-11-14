import { SETTINGS_PAGES, SETTINGS_PAGE_ALIASES, isExperimentId, type SettingsPage, type SettingsPageAlias } from '@boite/contracts';
import { experimentsShown } from './experiments.svelte';

/**
 * The map of Settings: nine pages, one per question a person asks, each a
 * list of cards. This file is the one place that knows the pages, their
 * order, their cards, who may open them and where a route from before the map
 * lands. The desktop screen and the phone's render a page from `blocksOf`,
 * the search indexes `SETTINGS_CARDS` (`settings-index.ts`), and a card an
 * agent asks for opens through `placeOf`. A phone shows every card but the
 * ones marked `desktop`: that mark is the whole phone rule.
 */
export type { SettingsPage };

/** A page id from before the map; `home` was the phone's list and the desktop's first page. */
export type LegacyTab = 'home' | 'appearance' | SettingsPageAlias;

/** Every value a route may hold, so one read from a link can be checked before it opens a page. */
export const SETTINGS_TABS = [...SETTINGS_PAGES, 'home', ...SETTINGS_PAGE_ALIASES] as const;
export type SettingsTab = typeof SETTINGS_TABS[number];

/** Where a card's rows are saved: this device, the machine the page shows, or every machine of the group. */
export type SettingsScope = 'device' | 'machine' | 'group';

interface PageDef {
  /** What most of its cards change, said once under its title; a card that differs tags itself. */
  scope: SettingsScope;
  /** Every card on it is the owner's: a paired device has no such page. */
  owner?: true;
  /** It is long enough for the nav to list its sections under it while it is open. */
  long?: true;
}

/** The nine pages, in the nav's order (`SETTINGS_PAGES`). */
export const PAGES: Record<SettingsPage, PageDef> = {
  appearance: { scope: 'device' },
  input: { scope: 'machine' },
  conversations: { scope: 'device' },
  ai: { scope: 'machine', long: true },
  agents: { scope: 'machine', owner: true },
  safeguards: { scope: 'machine' },
  devices: { scope: 'group' },
  version: { scope: 'machine' },
  help: { scope: 'machine' }
};

interface CardDef {
  /** Its anchor, `settings-<id>` in the DOM, and the section a route names. One id, one card. */
  readonly id: string;
  readonly page: SettingsPage;
  /**
   * The component that draws it. Several cards of one block are drawn by one
   * component, in the block's place on the page.
   */
  readonly block: string;
  readonly scope: SettingsScope;
  /** Only the owner's Settings draws it. */
  readonly owner?: true;
  /** It exists only where the primary machine's build runs experiments. */
  readonly experimental?: true;
  /** Drawn by the desktop app or a wide window only: a phone has every card but these. */
  readonly desktop?: true;
  /** Where it was before the map: the old page and its anchor there (null: the page itself). */
  readonly from: readonly [LegacyTab, string | null];
  /** The nav lists it under a long page. */
  readonly nav?: true;
}

/** Every card, in the order its page shows it. */
export const SETTINGS_CARDS = [
  // Appearance: what it looks like, on this device.
  { id: 'theme', page: 'appearance', block: 'appearance', scope: 'device', from: ['appearance', 'theme'] },
  { id: 'reading', page: 'appearance', block: 'appearance', scope: 'device', from: ['appearance', 'reading'] },
  { id: 'buttons', page: 'appearance', block: 'appearance', scope: 'device', desktop: true, from: ['appearance', 'buttons'] },
  { id: 'workspace', page: 'appearance', block: 'workspace', scope: 'device', desktop: true, from: ['general', 'workspace'] },
  { id: 'details', page: 'appearance', block: 'details', scope: 'device', desktop: true, from: ['advanced', 'details'] },
  // Input: how I talk to Boite.
  { id: 'keyboard', page: 'input', block: 'keyboard', scope: 'machine', desktop: true, from: ['keyboard', null] },
  { id: 'keybinding-file', page: 'input', block: 'keyboard', scope: 'machine', desktop: true, from: ['keyboard', 'keybinding-file'] },
  { id: 'voice', page: 'input', block: 'voice', scope: 'machine', from: ['voice', null] },
  // Conversations: how threads are listed and answer. This device first, then the machine.
  { id: 'thread-list', page: 'conversations', block: 'thread-list', scope: 'device', desktop: true, from: ['general', 'thread-list'] },
  { id: 'conversations', page: 'conversations', block: 'conversations', scope: 'device', from: ['general', 'conversations'] },
  { id: 'notifications', page: 'conversations', block: 'notifications', scope: 'device', desktop: true, from: ['general', 'notifications'] },
  { id: 'agent-replies', page: 'conversations', block: 'agent-replies', scope: 'machine', owner: true, from: ['general', 'agent-replies'] },
  { id: 'archived', page: 'conversations', block: 'archived', scope: 'machine', from: ['general', 'archived'] },
  { id: 'worktrees', page: 'conversations', block: 'worktrees', scope: 'machine', owner: true, from: ['general', 'worktrees'] },
  // AI accounts: which AIs, and how much is left.
  { id: 'providers', page: 'ai', block: 'providers', scope: 'machine', owner: true, nav: true, from: ['accounts', null] },
  { id: 'local-acp', page: 'ai', block: 'local-acp', scope: 'machine', owner: true, nav: true, from: ['accounts', 'local-acp'] },
  { id: 'secrets', page: 'ai', block: 'secrets', scope: 'machine', owner: true, nav: true, from: ['accounts', 'secrets'] },
  { id: 'quotas', page: 'ai', block: 'quotas', scope: 'machine', nav: true, from: ['limits', null] },
  { id: 'limit-resume', page: 'ai', block: 'quotas', scope: 'machine', owner: true, from: ['limits', 'limit-resume'] },
  { id: 'subscription-proxy', page: 'ai', block: 'subscription-proxy', scope: 'machine', owner: true, nav: true, from: ['accounts', 'subscription-proxy'] },
  { id: 'usage', page: 'ai', block: 'usage', scope: 'group', nav: true, from: ['usage', null] },
  // Agents: what they know and how they run.
  { id: 'brain', page: 'agents', block: 'brain', scope: 'machine', owner: true, from: ['brain', null] },
  { id: 'hooks', page: 'agents', block: 'brain', scope: 'machine', owner: true, from: ['brain', 'hooks'] },
  { id: 'plugins', page: 'agents', block: 'plugins', scope: 'machine', owner: true, from: ['plugins', null] },
  // What agents may do alone: how far they reach other conversations, and creating a bot without asking.
  { id: 'agents-alone', page: 'agents', block: 'agents-alone', scope: 'machine', owner: true, from: ['general', 'agents-alone'] },
  { id: 'auto-compact', page: 'agents', block: 'auto-compact', scope: 'machine', owner: true, from: ['advanced', 'auto-compact'] },
  { id: 'execution', page: 'agents', block: 'execution', scope: 'machine', owner: true, desktop: true, from: ['advanced', 'execution'] },
  // Safeguards: what they are allowed to do.
  { id: 'quiet', page: 'safeguards', block: 'quiet', scope: 'machine', owner: true, from: ['general', 'quiet'] },
  { id: 'windows', page: 'safeguards', block: 'windows', scope: 'machine', owner: true, from: ['machines', 'windows'] },
  { id: 'window-exclusions', page: 'safeguards', block: 'window-exclusions', scope: 'machine', owner: true, from: ['machines', 'window-exclusions'] },
  { id: 'limits', page: 'safeguards', block: 'limits', scope: 'machine', owner: true, from: ['resources', 'limits'] },
  { id: 'browser-profiles', page: 'safeguards', block: 'browser-profiles', scope: 'device', owner: true, from: ['browser', 'browser-profiles'] },
  { id: 'privacy', page: 'safeguards', block: 'privacy', scope: 'machine', owner: true, from: ['general', 'privacy'] },
  { id: 'policy', page: 'safeguards', block: 'policy', scope: 'machine', from: ['general', 'policy'] },
  // Devices: who connects to what.
  { id: 'app', page: 'devices', block: 'app', scope: 'device', desktop: true, from: ['general', 'app'] },
  { id: 'main-machine', page: 'devices', block: 'app', scope: 'device', from: ['machines', null] },
  { id: 'group', page: 'devices', block: 'machines', scope: 'group', from: ['machines', 'group'] },
  { id: 'machines', page: 'devices', block: 'machines', scope: 'group', from: ['machines', 'machines'] },
  { id: 'phone', page: 'devices', block: 'phone', scope: 'machine', from: ['advanced', 'phone'] },
  { id: 'origins', page: 'devices', block: 'origins', scope: 'machine', owner: true, desktop: true, from: ['advanced', 'origins'] },
  // Version: stable or ahead.
  { id: 'updates', page: 'version', block: 'updates', scope: 'group', from: ['machines', 'updates'] },
  { id: 'agent-updates', page: 'version', block: 'agent-updates', scope: 'machine', owner: true, from: ['accounts', 'agent-updates'] },
  { id: 'experiments', page: 'version', block: 'experiments', scope: 'device', experimental: true, from: ['experiments', null] },
  { id: 'cache-keepalive', page: 'version', block: 'experiments', scope: 'machine', owner: true, experimental: true, from: ['experiments', 'cache-keepalive'] },
  { id: 'background-compaction', page: 'version', block: 'experiments', scope: 'machine', owner: true, experimental: true, from: ['experiments', 'background-compaction'] },
  { id: 'device-stream', page: 'version', block: 'experiments', scope: 'machine', owner: true, experimental: true, from: ['experiments', 'device-stream'] },
  // Troubleshooting: what is wrong.
  { id: 'diagnostics-status', page: 'help', block: 'diagnostics', scope: 'machine', owner: true, from: ['diagnostics', 'diagnostics-status'] },
  { id: 'diagnostics-problems', page: 'help', block: 'diagnostics', scope: 'machine', owner: true, from: ['diagnostics', 'diagnostics-problems'] },
  { id: 'diagnostics-log', page: 'help', block: 'diagnostics', scope: 'machine', owner: true, from: ['diagnostics', 'diagnostics-log'] },
  { id: 'diagnostics-agents', page: 'help', block: 'diagnostics', scope: 'machine', owner: true, from: ['diagnostics', 'diagnostics-agents'] },
  { id: 'tasks', page: 'help', block: 'tasks', scope: 'machine', owner: true, from: ['resources', 'tasks'] },
  { id: 'task-manager', page: 'help', block: 'task-manager', scope: 'group', from: ['task-manager', null] },
  { id: 'core', page: 'help', block: 'core', scope: 'machine', desktop: true, from: ['advanced', 'core'] },
  { id: 'tour', page: 'help', block: 'tour', scope: 'device', desktop: true, from: ['general', 'tour'] }
] as const satisfies readonly CardDef[];

export type SettingsCard = CardDef;
export type SettingsCardId = typeof SETTINGS_CARDS[number]['id'];
export type SettingsBlock = typeof SETTINGS_CARDS[number]['block'];

const CARDS: readonly CardDef[] = SETTINGS_CARDS;
const BY_ID = new Map<string, CardDef>(CARDS.map((card) => [card.id, card]));

/** The card a section names, when the map lists it. A provider's row, a command group or one experiment is an anchor inside a card. */
export function cardOf(section: string | null | undefined): SettingsCard | undefined {
  return section ? BY_ID.get(section) : undefined;
}

/**
 * Where an old page lands when its route names no card of the map: the page
 * that took most of it, at the section that holds what the old page opened on.
 */
const LEGACY: Record<LegacyTab, readonly [SettingsPage, SettingsCardId | null]> = {
  home: ['appearance', null],
  appearance: ['appearance', null],
  general: ['conversations', null],
  keyboard: ['input', 'keyboard'],
  voice: ['input', 'voice'],
  accounts: ['ai', null],
  plugins: ['agents', 'plugins'],
  brain: ['agents', null],
  browser: ['safeguards', 'browser-profiles'],
  usage: ['ai', 'usage'],
  limits: ['ai', 'quotas'],
  resources: ['safeguards', 'limits'],
  'task-manager': ['help', 'task-manager'],
  machines: ['devices', null],
  advanced: ['agents', 'auto-compact'],
  experiments: ['version', 'experiments'],
  diagnostics: ['help', null]
};

const isPage = (tab: string): tab is SettingsPage => (SETTINGS_PAGES as readonly string[]).includes(tab);

/** A card as this window's Settings would draw it, or not at all: the owner's cards, the experiments, and on a phone no desktop card. */
function cardShown(card: CardDef, owner: boolean, phone = false): boolean {
  return (owner || !card.owner) && (!card.experimental || experimentsShown()) && !(phone && card.desktop);
}

/** The card that draws an anchor which is not a card itself, by how the anchor starts: a provider's row sits in the providers. */
const HOSTS: readonly (readonly [SettingsPage, string, SettingsCardId])[] = [
  ['ai', 'provider-', 'providers'],
  ['ai', 'usage-', 'usage'],
  ['input', 'keys-', 'keyboard'],
  ['agents', 'plugins-', 'plugins'],
  ['agents', 'brain-', 'brain']
];

/** The card a route's section names or sits in, on the page the route lands on: one experiment's switch sits in the experiments. */
function cardAt(place: { page: SettingsPage; section: string | null }): CardDef | undefined {
  const host = place.section ? HOSTS.find(([page, prefix]) => page === place.page && place.section!.startsWith(prefix))?.[2] : undefined;
  return cardOf(place.section) ?? cardOf(host ?? (place.page === 'version' && place.section !== null && isExperimentId(place.section) ? 'experiments' : undefined));
}

/**
 * Whether this window's Settings draws what a route names, a desktop's or a
 * phone's: its page, and the card when the route names one, or the card an
 * anchor sits in.
 */
export function settingsHas(tab: SettingsTab, section: string | null | undefined, owner: boolean, phone = false): boolean {
  const place = placeOf(tab, section);
  if (!pageAvailable(place.page, owner, phone)) return false;
  const card = cardAt(place);
  return card ? cardShown(card, owner, phone) : true;
}

/** `settingsHas` for a desktop. */
export function desktopHas(tab: SettingsTab, section: string | null | undefined, owner: boolean): boolean {
  return settingsHas(tab, section, owner);
}

/** The cards a page shows this window, in order. */
export function cardsOf(page: SettingsPage, owner: boolean, phone = false): SettingsCard[] {
  return CARDS.filter((card) => card.page === page && cardShown(card, owner, phone));
}

/** A page's render units in order: one component each, with the cards it draws. */
export function blocksOf(page: SettingsPage, owner: boolean, phone = false): { block: SettingsBlock; cards: SettingsCard[] }[] {
  const blocks: { block: SettingsBlock; cards: SettingsCard[] }[] = [];
  for (const card of cardsOf(page, owner, phone)) {
    const last = blocks.at(-1);
    if (last?.block === card.block) last.cards.push(card);
    else blocks.push({ block: card.block as SettingsBlock, cards: [card] });
  }
  return blocks;
}

export function ownerOnly(page: SettingsPage): boolean {
  return PAGES[page].owner === true;
}

/** Whether this window has the page at all: an owner page needs the owner, and any page needs a card to show. */
export function pageAvailable(page: SettingsPage, owner: boolean, phone = false): boolean {
  return (owner || !ownerOnly(page)) && cardsOf(page, owner, phone).length > 0;
}

/** What the nav lists, and a phone's list, in the map's order: nine entries for the owner, no family above them. */
export function navOf(owner: boolean, phone = false): SettingsPage[] {
  return SETTINGS_PAGES.filter((page) => pageAvailable(page, owner, phone));
}

/**
 * The pages from before the map this window still answers to by name: one
 * whose cards it shows somewhere. A paired device, which had no Providers
 * page, has no route by that name either.
 */
export function aliasesOf(owner: boolean, phone = false): LegacyTab[] {
  return (Object.keys(LEGACY) as LegacyTab[]).filter((alias) => {
    if (isPage(alias) || (phone && alias === 'home')) return false;
    const cards = CARDS.filter((card) => card.from[0] === alias);
    return cards.length === 0 ? pageAvailable(LEGACY[alias][0], owner, phone) : cards.some((card) => cardShown(card, owner, phone));
  });
}

/** The sections the nav lists under a long page while it is open. */
export function navSectionsOf(page: SettingsPage, owner: boolean, phone = false): SettingsCard[] {
  return PAGES[page].long ? cardsOf(page, owner, phone).filter((card) => card.nav) : [];
}

/** What most of a page's cards change, the line under its title. */
export function pageScopeOf(page: SettingsPage): SettingsScope {
  return PAGES[page].scope;
}

/** Whether a page holds a card of one machine, picked from the line under its title or the bar above it. */
export function machinePage(page: SettingsPage): boolean {
  return CARDS.some((card) => card.page === page && card.scope === 'machine');
}

/**
 * Where a route lands on the map, whatever names it: one of the nine pages,
 * or a page and a card from before them. A card the map lists opens on its
 * page under its own id; an anchor inside a card (a provider's row, a command
 * group) opens on the page its old page went to. Not checked against what the
 * window may open: `desktopPlace` does that.
 */
export function placeOf(tab: SettingsTab, section: string | null | undefined): { page: SettingsPage; section: string | null } {
  const card = cardOf(section);
  // A card's id wins over the page beside it: the page may be the old one, or the card may have moved again.
  if (card) return { page: card.page, section: card.id };
  if (isPage(tab)) return { page: tab, section: section ?? null };
  const [page, landing] = LEGACY[tab as LegacyTab];
  return { page, section: section ?? landing };
}

/**
 * What a desktop shows for a route: its place on the map, or the first page
 * where this window lacks it (an owner page, a card of a build without
 * experiments). A desktop has two levels, the nav and a page.
 */
export function desktopPlace(tab: SettingsTab, section: string | null | undefined, owner: boolean): { page: SettingsPage; section: string | null } {
  const place = placeOf(tab, section);
  const card = cardAt(place);
  if (!pageAvailable(place.page, owner)) return { page: 'appearance', section: null };
  // A card this window lacks: its page, from the top.
  if (card && !cardShown(card, owner)) return { page: place.page, section: null };
  return place;
}

/**
 * What a phone shows for a route: its place on the map, the page from the top
 * for a card a phone lacks (the shortcuts, the toolbar), or its list of pages
 * (a null page) for `home` and for a page it has no card of. A phone has two
 * levels as well: the list, then a page.
 */
export function phonePlace(tab: SettingsTab, section: string | null | undefined, owner: boolean): { page: SettingsPage | null; section: string | null } {
  if (tab === 'home') return { page: null, section: null };
  const place = placeOf(tab, section);
  if (!pageAvailable(place.page, owner, true)) return { page: null, section: null };
  const card = cardAt(place);
  if (card && !cardShown(card, owner, true)) return { page: place.page, section: null };
  return place;
}

/** The page a desktop shows for a route. */
export function desktopPage(tab: SettingsTab, owner: boolean, section?: string | null): SettingsPage {
  return desktopPlace(tab, section, owner).page;
}

/**
 * Whether this window shows the desktop settings, the only ones with Plugins
 * and the keyboard: the app always does, a browser once wider than a phone.
 */
export function desktopSettings(phoneWidth: boolean): boolean {
  return !phoneWidth || window.__TAURI_INTERNALS__ !== undefined;
}
