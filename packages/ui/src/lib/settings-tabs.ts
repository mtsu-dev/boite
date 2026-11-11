/** Every Settings page, so a value read from a link can be checked before it opens one. */
export const SETTINGS_TABS = ['home', 'advanced', 'brain', 'voice', 'general', 'machines', 'appearance', 'keyboard', 'accounts', 'plugins', 'browser', 'usage', 'limits', 'resources', 'task-manager', 'experiments', 'diagnostics'] as const;
export type SettingsTab = typeof SETTINGS_TABS[number];

interface SettingsPage {
  /** Its page calls something only the owner may call: a paired device lands on Home. */
  owner?: true;
  /** It changes one machine, picked from the bar above it. */
  machine?: true;
  /** Every setting on it is saved on this device. */
  device?: true;
  /**
   * What a phone shows for it: the page itself, a phone page for some of its
   * cards (`SECTION_PAGES`, the rest landing on its index), or Home,
   * where the phone has no such page.
   */
  phone: 'page' | 'sections' | 'home';
}

/** The one table both layouts read a route from. */
const PAGES: Record<SettingsTab, SettingsPage> = {
  home: { phone: 'home' },
  general: { machine: true, phone: 'sections' },
  appearance: { device: true, phone: 'page' },
  keyboard: { machine: true, phone: 'home' },
  voice: { machine: true, phone: 'page' },
  // A phone lists the providers, as the desktop does.
  accounts: { owner: true, machine: true, phone: 'page' },
  // Plugins run beside the core, so a phone turns them on and off, sets them
  // and installs them as well as the desktop; nothing there needs a right-click.
  plugins: { owner: true, machine: true, phone: 'page' },
  // The built-in browser of this device: its profiles and the sign-ins it hands to a machine's agent browser.
  browser: { owner: true, device: true, phone: 'page' },
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
    conversations: { page: 'conversations' },
    // Quiet is a card of the conversations page.
    quiet: { page: 'conversations', owner: true },
    // How agents answer is the machine's card under the same page, under its bar.
    'agent-replies': { page: 'conversations', owner: true },
    archived: { page: 'archived' },
    worktrees: { page: 'worktrees', owner: true }
  }
};

export type PhoneSectionPage = 'conversations' | 'archived' | 'worktrees';

/**
 * The families Settings lists, desktop nav and phone list alike, each page a
 * peer inside its family (a page indented under an unrelated one,
 * Usage under Limits or Plugins under Providers, was only found by guessing
 * its parent). Each family is named for what a person comes to change: the
 * app in front of them, the agents and what they may spend, what connects
 * outward, and the advanced pages last. A page merged into another
 * (`MERGED`) stays out of the nav and opens as that page's section.
 */
export const SETTINGS_FAMILIES = [
  { id: 'app', pages: ['general', 'keyboard', 'voice', 'appearance'] },
  { id: 'agents', pages: ['accounts', 'plugins', 'brain', 'limits', 'usage'] },
  { id: 'connections', pages: ['browser', 'machines'] },
  { id: 'advanced', pages: ['advanced', 'experiments', 'diagnostics', 'resources', 'task-manager'] }
] as const satisfies readonly { id: string; pages: readonly SettingsTab[] }[];

export type SettingsFamily = typeof SETTINGS_FAMILIES[number]['id'];

/** The family a page stands under. */
export function familyOf(tab: SettingsTab): SettingsFamily | null {
  return SETTINGS_FAMILIES.find((family) => (family.pages as readonly SettingsTab[]).includes(tab))?.id ?? null;
}

/**
 * A page shown as a last section of another: Resources and the task manager,
 * the live half of Diagnostics. A paired device, which may not read the logs,
 * still gets the task manager as a page of its own.
 */
const MERGED: Partial<Record<SettingsTab, SettingsTab>> = {
  resources: 'diagnostics',
  'task-manager': 'diagnostics'
};

/**
 * Cards that moved to another page, by their old page: a link to the old place
 * (a setting an agent asks for, a route kept from before) opens the new one.
 * General's odd cards live with the task they serve: the keys agents
 * ask for under Providers, the windows agents may see under Machines, the
 * browser logins under Browser.
 */
const MOVED: Partial<Record<SettingsTab, Record<string, SettingsTab>>> = {
  appearance: { workspace: 'general' },
  resources: { quiet: 'general' },
  // The browser has its own entry, out of Providers: its profiles are not a provider's.
  accounts: { 'browser-profiles': 'browser' },
  general: { secrets: 'accounts', 'browser-profiles': 'browser', windows: 'machines', 'window-exclusions': 'machines' }
};

/** The page a card lives on now, when a route still names its old one. */
export function movedTo(tab: SettingsTab, section: string | null | undefined): SettingsTab | undefined {
  return section ? MOVED[tab]?.[section] : undefined;
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

/** What the nav lists in a family, in its order: the pages this window may open, those merged into another left out. */
export function navOf(family: SettingsFamily, owner: boolean): SettingsTab[] {
  const pages: readonly SettingsTab[] = SETTINGS_FAMILIES.find((one) => one.id === family)?.pages ?? [];
  return pages.filter((tab) => (owner || !ownerOnly(tab)) && viewOf(tab, owner) === tab);
}

export function ownerOnly(tab: SettingsTab): boolean {
  return PAGES[tab].owner === true;
}

export function machinePage(tab: SettingsTab): boolean {
  return PAGES[tab].machine === true;
}

/** Where a page's settings are saved, or null for a page that holds none of its own (Usage, Machines). */
export function pageScopeOf(tab: SettingsTab): 'device' | 'machine' | null {
  return PAGES[tab].machine ? 'machine' : PAGES[tab].device ? 'device' : null;
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
  const moved = movedTo(route, section) ?? route;
  const tab = viewOf(moved, owner);
  const page = PAGES[tab];
  if (page.owner && !owner) return 'home';
  if (page.phone === 'page') return tab;
  if (page.phone === 'home') return 'home';
  // A card with a page of its own opens it; any other card lands on the group's index, a card it may not open on Home.
  const card = section ? SECTION_PAGES[tab]?.[section] : undefined;
  if (!card) return tab;
  return owner || !card.owner ? card.page : 'home';
}
