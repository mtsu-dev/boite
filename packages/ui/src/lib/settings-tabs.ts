/** Every Settings page, so a value read from a link can be checked before it opens one. */
export const SETTINGS_TABS = ['home', 'advanced', 'brain', 'voice', 'general', 'machines', 'appearance', 'keyboard', 'accounts', 'plugins', 'usage', 'limits', 'resources', 'task-manager', 'experiments', 'diagnostics'] as const;
export type SettingsTab = typeof SETTINGS_TABS[number];

interface SettingsPage {
  /** Its page calls something only the owner may call: a paired device lands on Home. */
  owner?: true;
  /** It changes one machine, picked from the bar above it. */
  machine?: true;
  /**
   * What a phone shows for it: the page itself, a phone page for some of its
   * cards (`SECTION_PAGES`, the rest landing on the group's index), or Home,
   * where the phone has no such page.
   */
  phone: 'page' | 'sections' | 'home';
  /** A phone routes it by its own entry, though the desktop shows it as a section of another. */
  phoneOwn?: true;
}

/** The one table both layouts read a route from. */
const PAGES: Record<SettingsTab, SettingsPage> = {
  home: { phone: 'home' },
  general: { machine: true, phone: 'sections' },
  appearance: { phone: 'page' },
  keyboard: { machine: true, phone: 'home' },
  voice: { machine: true, phone: 'page' },
  // A phone lists the providers, as the desktop does; plugins stay on the
  // desktop: a phone shows Home, and the window widened again shows the page.
  accounts: { owner: true, machine: true, phone: 'page' },
  plugins: { owner: true, machine: true, phone: 'home', phoneOwn: true },
  brain: { owner: true, machine: true, phone: 'page' },
  usage: { phone: 'page', phoneOwn: true },
  limits: { machine: true, phone: 'page' },
  'task-manager': { phone: 'page' },
  resources: { owner: true, machine: true, phone: 'page' },
  machines: { phone: 'page' },
  advanced: { machine: true, phone: 'sections' },
  diagnostics: { owner: true, machine: true, phone: 'page' },
  experiments: { machine: true, phone: 'page', phoneOwn: true }
};

/** The cards of a long desktop page that a phone shows on a page of their own, and that page. */
const SECTION_PAGES: Partial<Record<SettingsTab, Record<string, { page: PhoneSectionPage; owner?: true }>>> = {
  general: {
    conversations: { page: 'conversations' },
    // Quiet is a card of the conversations page, Browser profiles one of Secrets.
    quiet: { page: 'conversations', owner: true },
    archived: { page: 'archived' },
    worktrees: { page: 'worktrees', owner: true },
    windows: { page: 'windows', owner: true },
    'window-exclusions': { page: 'windows', owner: true },
    secrets: { page: 'secrets' },
    'browser-profiles': { page: 'secrets', owner: true }
  }
};

export type PhoneSectionPage = 'conversations' | 'archived' | 'worktrees' | 'windows' | 'secrets';

/**
 * The seven entries Settings lists, desktop and phone alike, each led by the
 * page its entry opens. The other pages of a group are tabs at the top of its
 * card (desktop) or rows of its index (phone): a page keeps its id, its route
 * and its test ids, so an old link lands on the same page, inside its group.
 */
export const SETTINGS_GROUPS = [
  ['general', 'keyboard', 'voice'],
  ['appearance'],
  ['accounts', 'plugins'],
  ['brain'],
  ['limits', 'usage'],
  ['machines'],
  ['advanced', 'experiments', 'diagnostics', 'resources', 'task-manager']
] as const satisfies readonly (readonly SettingsTab[])[];

/**
 * A page shown as a last section of another, once that one may open here, in
 * this order: Usage under Limits, Plugins under Accounts, Experiments under
 * Advanced, then Resources and the task manager, the live half of
 * Diagnostics. A paired device, which may not read the logs, still gets the
 * task manager as a page of its own.
 */
const MERGED: Partial<Record<SettingsTab, SettingsTab>> = {
  usage: 'limits',
  plugins: 'accounts',
  experiments: 'advanced',
  resources: 'diagnostics',
  'task-manager': 'diagnostics'
};

/**
 * Cards that moved to another page, by their old page: a link to the old place
 * (a setting an agent asks for, a route kept from before) opens the new one.
 */
const MOVED: Partial<Record<SettingsTab, Record<string, SettingsTab>>> = {
  appearance: { workspace: 'general' },
  resources: { quiet: 'general' }
};

/** The page a card lives on now, when a route still names its old one. */
export function movedTo(tab: SettingsTab, section: string | null | undefined): SettingsTab | undefined {
  return section ? MOVED[tab]?.[section] : undefined;
}

/** The page that leads a page's group: what the group's entry opens and marks. */
export function groupOf(tab: SettingsTab): SettingsTab {
  return SETTINGS_GROUPS.find((group) => (group as readonly SettingsTab[]).includes(tab))?.[0] ?? tab;
}

/** The page whose view shows a route: its own, or the one it is a section of. */
export function viewOf(tab: SettingsTab, owner: boolean): SettingsTab {
  const host = MERGED[tab];
  return host && (owner || !ownerOnly(host)) ? host : tab;
}

/** The pages merged into a view as its last sections, in order. */
export function sectionsOf(view: SettingsTab, owner: boolean): SettingsTab[] {
  return (Object.keys(MERGED) as SettingsTab[]).filter((tab) => MERGED[tab] === view && viewOf(tab, owner) === view);
}

/** The tabs a group's card shows: its pages this window may open, those merged into another left out. */
export function pagesOf(lead: SettingsTab, owner: boolean): SettingsTab[] {
  const group: readonly SettingsTab[] = SETTINGS_GROUPS.find((members) => members[0] === lead) ?? [lead];
  return group.filter((tab) => (owner || !ownerOnly(tab)) && viewOf(tab, owner) === tab);
}

export function ownerOnly(tab: SettingsTab): boolean {
  return PAGES[tab].owner === true;
}

export function machinePage(tab: SettingsTab): boolean {
  return PAGES[tab].machine === true;
}

/**
 * Whether this window shows the desktop settings, the only ones with Plugins
 * and the keyboard: the app always does, a browser once wider than a phone.
 */
export function desktopSettings(phoneWidth: boolean): boolean {
  return !phoneWidth || window.__TAURI_INTERNALS__ !== undefined;
}

/**
 * The page a desktop shows for a route: the view it is a section of, or
 * General for Home and wherever this window may not go. A desktop has two
 * levels, the nav and a page: its home is the nav's search over the first page.
 */
export function desktopPage(tab: SettingsTab, owner: boolean): SettingsTab {
  const view = owner || !ownerOnly(tab) ? viewOf(tab, owner) : 'home';
  return view === 'home' ? 'general' : view;
}

/** The page a phone shows for a route: a whole page, one card's page, or Home. */
export function phonePage(route: SettingsTab, section: string | null | undefined, owner: boolean): SettingsTab | PhoneSectionPage {
  const tab = PAGES[route].phoneOwn ? route : viewOf(route, owner);
  const page = PAGES[tab];
  if (page.owner && !owner) return 'home';
  if (page.phone === 'page') return tab;
  if (page.phone === 'home') return 'home';
  // A card with a page of its own opens it; any other card lands on the group's index, a card it may not open on Home.
  const card = section ? SECTION_PAGES[tab]?.[section] : undefined;
  if (!card) return tab;
  return owner || !card.owner ? card.page : 'home';
}
