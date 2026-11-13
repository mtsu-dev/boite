import { SETTINGS_PAGES, SETTINGS_PAGE_ALIASES, type SettingsPage, type SettingsPageAlias } from '@boite/contracts';
import { experimentsShown } from './experiments.svelte';

/**
 * The map of Settings: nine pages, one per question a person asks, each a
 * list of cards. This file is the one place that knows the pages, their
 * order, their cards, who may open them and where a route from before the map
 * lands. The desktop screen renders a page from `blocksOf`, the search indexes
 * `SETTINGS_CARDS` (`settings-index.ts`), and a card an agent asks for opens
 * through `placeOf`.
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
  /** What a phone opens for the page until it has the map: a page of its own list. */
  phone: readonly [LegacyTab, string | null];
}

/** The nine pages, in the nav's order (`SETTINGS_PAGES`). */
export const PAGES: Record<SettingsPage, PageDef> = {
  appearance: { scope: 'device', phone: ['appearance', null] },
  input: { scope: 'machine', phone: ['voice', null] },
  conversations: { scope: 'device', phone: ['general', 'conversations'] },
  ai: { scope: 'machine', long: true, phone: ['accounts', null] },
  agents: { scope: 'machine', owner: true, phone: ['brain', null] },
  safeguards: { scope: 'machine', phone: ['general', null] },
  devices: { scope: 'group', phone: ['machines', null] },
  version: { scope: 'machine', phone: ['machines', null] },
  help: { scope: 'machine', phone: ['diagnostics', null] }
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
  /** Drawn by the desktop app or a wide window only. */
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
  { id: 'notifications', page: 'conversations', block: 'notifications', scope: 'device', from: ['general', 'notifications'] },
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
  { id: 'auto-compact', page: 'agents', block: 'auto-compact', scope: 'machine', owner: true, from: ['advanced', 'auto-compact'] },
  { id: 'execution', page: 'agents', block: 'execution', scope: 'machine', owner: true, from: ['advanced', 'execution'] },
  // Safeguards: what they are allowed to do.
  { id: 'quiet', page: 'safeguards', block: 'quiet', scope: 'machine', owner: true, from: ['general', 'quiet'] },
  { id: 'windows', page: 'safeguards', block: 'windows', scope: 'machine', owner: true, from: ['machines', 'windows'] },
  { id: 'window-exclusions', page: 'safeguards', block: 'window-exclusions', scope: 'machine', owner: true, from: ['machines', 'window-exclusions'] },
  { id: 'limits', page: 'safeguards', block: 'limits', scope: 'machine', owner: true, from: ['resources', 'limits'] },
  { id: 'browser-profiles', page: 'safeguards', block: 'browser-profiles', scope: 'device', owner: true, from: ['browser', 'browser-profiles'] },
  { id: 'privacy', page: 'safeguards', block: 'privacy', scope: 'machine', owner: true, from: ['general', 'privacy'] },
  { id: 'policy', page: 'safeguards', block: 'policy', scope: 'machine', from: ['general', 'policy'] },
  // Devices: who connects to what.
  { id: 'app', page: 'devices', block: 'app', scope: 'device', from: ['general', 'app'] },
  { id: 'main-machine', page: 'devices', block: 'app', scope: 'device', from: ['machines', null] },
  { id: 'group', page: 'devices', block: 'machines', scope: 'group', from: ['machines', 'group'] },
  { id: 'machines', page: 'devices', block: 'machines', scope: 'group', from: ['machines', 'machines'] },
  { id: 'phone', page: 'devices', block: 'phone', scope: 'machine', from: ['advanced', 'phone'] },
  { id: 'origins', page: 'devices', block: 'origins', scope: 'machine', owner: true, from: ['advanced', 'origins'] },
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
  { id: 'core', page: 'help', block: 'core', scope: 'machine', from: ['advanced', 'core'] },
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

/** A card as this window's Settings would draw it, or not at all. */
function cardShown(card: CardDef, owner: boolean): boolean {
  return (owner || !card.owner) && (!card.experimental || experimentsShown());
}

/** The card that draws an anchor which is not a card itself, by how the anchor starts: a provider's row sits in the providers. */
const HOSTS: readonly (readonly [SettingsPage, string, SettingsCardId])[] = [
  ['ai', 'provider-', 'providers'],
  ['ai', 'usage-', 'usage'],
  ['input', 'keys-', 'keyboard'],
  ['agents', 'plugins-', 'plugins'],
  ['agents', 'brain-', 'brain']
];

/**
 * Whether this window's desktop Settings draws what a route names: its page,
 * and the card when the route names one, or the card an anchor sits in.
 */
export function desktopHas(tab: SettingsTab, section: string | null | undefined, owner: boolean): boolean {
  const place = placeOf(tab, section);
  if (!pageAvailable(place.page, owner)) return false;
  const host = place.section ? HOSTS.find(([page, prefix]) => page === place.page && place.section!.startsWith(prefix))?.[2] : undefined;
  const card = cardOf(place.section) ?? cardOf(host);
  return card ? cardShown(card, owner) : true;
}

/** The cards a page shows this window, in order. */
export function cardsOf(page: SettingsPage, owner: boolean): SettingsCard[] {
  return CARDS.filter((card) => card.page === page && cardShown(card, owner));
}

/** A page's render units in order: one component each, with the cards it draws. */
export function blocksOf(page: SettingsPage, owner: boolean): { block: SettingsBlock; cards: SettingsCard[] }[] {
  const blocks: { block: SettingsBlock; cards: SettingsCard[] }[] = [];
  for (const card of cardsOf(page, owner)) {
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
export function pageAvailable(page: SettingsPage, owner: boolean): boolean {
  return (owner || !ownerOnly(page)) && cardsOf(page, owner).length > 0;
}

/** What the nav lists, in its order: nine entries for the owner, no family above them. */
export function navOf(owner: boolean): SettingsPage[] {
  return SETTINGS_PAGES.filter((page) => pageAvailable(page, owner));
}

/**
 * The pages from before the map this window still answers to by name: one
 * whose cards it shows somewhere. A paired device, which had no Providers
 * page, has no route by that name either.
 */
export function aliasesOf(owner: boolean): LegacyTab[] {
  return (Object.keys(LEGACY) as LegacyTab[]).filter((alias) => {
    if (isPage(alias)) return false;
    const cards = CARDS.filter((card) => card.from[0] === alias);
    return cards.length === 0 ? pageAvailable(LEGACY[alias][0], owner) : cards.some((card) => cardShown(card, owner));
  });
}

/** The sections the nav lists under a long page while it is open. */
export function navSectionsOf(page: SettingsPage, owner: boolean): SettingsCard[] {
  return PAGES[page].long ? cardsOf(page, owner).filter((card) => card.nav) : [];
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
  const card = cardOf(place.section);
  if (!pageAvailable(place.page, owner)) return { page: 'appearance', section: null };
  // A card this window lacks: its page, from the top.
  if (card && !cardShown(card, owner)) return { page: place.page, section: null };
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

// ---------------------------------------------------------------------------
// The phone, until it has the map: its list still names the pages from before
// (`MobileSettings.svelte`). A route to one of the nine pages is read back to
// the old page that holds its card there.
// ---------------------------------------------------------------------------

interface PhonePage {
  owner?: true;
  /** The page itself, a phone page for some of its cards (`SECTION_PAGES`, the rest on its index), or Home where the phone has none. */
  phone: 'page' | 'sections' | 'home';
}

const PHONE: Record<LegacyTab, PhonePage> = {
  home: { phone: 'home' },
  general: { phone: 'sections' },
  appearance: { phone: 'page' },
  keyboard: { phone: 'home' },
  voice: { phone: 'page' },
  accounts: { owner: true, phone: 'page' },
  plugins: { owner: true, phone: 'page' },
  browser: { owner: true, phone: 'page' },
  brain: { owner: true, phone: 'page' },
  usage: { phone: 'page' },
  limits: { phone: 'page' },
  'task-manager': { phone: 'page' },
  resources: { owner: true, phone: 'page' },
  machines: { phone: 'page' },
  advanced: { phone: 'sections' },
  diagnostics: { owner: true, phone: 'page' },
  experiments: { phone: 'page' }
};

/** The cards of a long page that a phone shows on a page of their own, and that page. */
const SECTION_PAGES: Partial<Record<LegacyTab, Record<string, { page: PhoneSectionPage; owner?: true }>>> = {
  general: {
    conversations: { page: 'conversations' },
    quiet: { page: 'conversations', owner: true },
    'agent-replies': { page: 'conversations', owner: true },
    archived: { page: 'archived' },
    worktrees: { page: 'worktrees', owner: true }
  }
};

export type PhoneSectionPage = 'conversations' | 'archived' | 'worktrees';

/** On a phone, Resources and the task manager are the last sections of Diagnostics for the owner. */
const PHONE_MERGED: Partial<Record<LegacyTab, LegacyTab>> = { resources: 'diagnostics', 'task-manager': 'diagnostics' };

/** Cards the phone draws on another of its pages than the one a route from before names. */
const PHONE_MOVED: Partial<Record<LegacyTab, Record<string, LegacyTab>>> = {
  appearance: { workspace: 'general' },
  resources: { quiet: 'general' },
  accounts: { 'browser-profiles': 'browser' },
  general: { secrets: 'accounts', 'browser-profiles': 'browser', windows: 'machines', 'window-exclusions': 'machines' }
};

/** Anchors inside a card of the map, by their page and how they start: a provider's row, a usage chart, an experiment's switch. */
const ANCHORS: readonly (readonly [SettingsPage, string, LegacyTab])[] = [
  ['ai', 'provider-', 'accounts'],
  ['ai', 'usage-', 'usage'],
  ['input', 'keys-', 'keyboard'],
  ['agents', 'plugins-', 'plugins'],
  ['agents', 'brain-', 'brain'],
  // Version's only anchors that are not cards are the experiments' switches.
  ['version', '', 'experiments']
];

/**
 * A route as the phone's list names it: a route from before unchanged, one to
 * a page of the map as the old page and anchor of its card.
 */
export function legacyRoute(tab: SettingsTab, section: string | null | undefined, owner: boolean): { tab: LegacyTab; section: string | null } {
  if (!isPage(tab) || (tab === 'appearance' && !cardOf(section))) return { tab: tab as LegacyTab, section: section ?? null };
  const card = cardOf(section);
  if (card && card.page === tab) return { tab: card.from[0], section: card.from[1] };
  // A paired phone has no providers: AI accounts opens on its limits, Troubleshooting on the task manager.
  if (tab === 'ai' && !owner) return { tab: 'limits', section: section ?? null };
  if (tab === 'help' && !owner) return { tab: 'task-manager', section: section ?? null };
  // An anchor inside a card: the old page that drew it, known by how the anchor starts.
  const inside = section ? ANCHORS.find(([page, prefix]) => page === tab && section.startsWith(prefix)) : undefined;
  if (inside && section) return { tab: inside[2], section };
  const [old, anchor] = PAGES[tab].phone;
  return { tab: old, section: section ?? anchor };
}

/** The page a phone shows for a route: a whole page, one card's page, or Home. */
export function phonePage(route: SettingsTab, section: string | null | undefined, owner: boolean): LegacyTab | PhoneSectionPage {
  const old = legacyRoute(route, section, owner);
  const moved = (old.section ? PHONE_MOVED[old.tab]?.[old.section] : undefined) ?? old.tab;
  const host = PHONE_MERGED[moved];
  const tab = host && (owner || !PHONE[host].owner) ? host : moved;
  const page = PHONE[tab];
  if ((!owner && page.owner) || (tab === 'experiments' && !experimentsShown())) return 'home';
  if (page.phone === 'page') return tab;
  if (page.phone === 'home') return 'home';
  // A card with a page of its own opens it; any other card lands on the group's index, a card it may not open on Home.
  const card = old.section ? SECTION_PAGES[tab]?.[old.section] : undefined;
  if (!card) return tab;
  return owner || !card.owner ? card.page : 'home';
}
