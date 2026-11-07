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
}

/** The one table both layouts read a route from. */
const PAGES: Record<SettingsTab, SettingsPage> = {
  home: { phone: 'home' },
  general: { machine: true, phone: 'sections' },
  appearance: { phone: 'page' },
  keyboard: { machine: true, phone: 'home' },
  voice: { machine: true, phone: 'page' },
  // Installing, signing in and plugins stay on the desktop: a phone shows Home,
  // and the window widened again shows the page the route still names.
  accounts: { owner: true, machine: true, phone: 'home' },
  plugins: { owner: true, machine: true, phone: 'home' },
  brain: { owner: true, machine: true, phone: 'page' },
  usage: { phone: 'page' },
  limits: { machine: true, phone: 'page' },
  'task-manager': { phone: 'page' },
  resources: { owner: true, machine: true, phone: 'page' },
  machines: { phone: 'page' },
  advanced: { machine: true, phone: 'sections' },
  diagnostics: { owner: true, machine: true, phone: 'page' },
  experiments: { machine: true, phone: 'page' }
};

/** The cards of a long desktop page that a phone shows on a page of their own, and that page. */
const SECTION_PAGES: Partial<Record<SettingsTab, Record<string, { page: PhoneSectionPage; owner?: true }>>> = {
  general: {
    archived: { page: 'archived' },
    worktrees: { page: 'worktrees', owner: true },
    windows: { page: 'windows', owner: true },
    'window-exclusions': { page: 'windows', owner: true },
    secrets: { page: 'secrets' },
    'browser-profiles': { page: 'browser-profiles', owner: true }
  },
  advanced: { 'auto-compact': { page: 'auto-compact', owner: true } }
};

export type PhoneSectionPage = 'archived' | 'worktrees' | 'windows' | 'secrets' | 'browser-profiles' | 'auto-compact';

/**
 * The eight groups Settings shows, desktop and phone alike, each led by the page
 * its entry opens. A page keeps its id, its route and its test ids: the group
 * only says where it is listed, so an old link lands on the same page, inside
 * its group.
 */
export const SETTINGS_GROUPS = [
  ['general', 'keyboard', 'voice'],
  ['appearance'],
  ['accounts', 'plugins'],
  ['brain'],
  ['usage', 'limits'],
  ['resources'],
  ['machines'],
  ['advanced', 'task-manager', 'diagnostics', 'experiments']
] as const satisfies readonly (readonly SettingsTab[])[];

/** The page that leads a page's group: what the group's entry opens and marks. */
export function groupOf(tab: SettingsTab): SettingsTab {
  return SETTINGS_GROUPS.find((group) => (group as readonly SettingsTab[]).includes(tab))?.[0] ?? tab;
}

export function ownerOnly(tab: SettingsTab): boolean {
  return PAGES[tab].owner === true;
}

export function machinePage(tab: SettingsTab): boolean {
  return PAGES[tab].machine === true;
}

/**
 * Whether this window shows the desktop settings, the only ones with Providers
 * and Plugins: the app always does, a browser once wider than a phone.
 */
export function desktopSettings(phoneWidth: boolean): boolean {
  return !phoneWidth || window.__TAURI_INTERNALS__ !== undefined;
}

/** The page a desktop shows for a route. */
export function desktopPage(tab: SettingsTab, owner: boolean): SettingsTab {
  return owner || !ownerOnly(tab) ? tab : 'home';
}

/** The page a phone shows for a route: a whole page, one card's page, or Home. */
export function phonePage(tab: SettingsTab, section: string | null | undefined, owner: boolean): SettingsTab | PhoneSectionPage {
  const page = PAGES[tab];
  if (page.owner && !owner) return 'home';
  if (page.phone === 'page') return tab;
  if (page.phone === 'home') return 'home';
  // A card with a page of its own opens it; any other card lands on the group's index, a card it may not open on Home.
  const card = section ? SECTION_PAGES[tab]?.[section] : undefined;
  if (!card) return tab;
  return owner || !card.owner ? card.page : 'home';
}
