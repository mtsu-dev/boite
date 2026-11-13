import { afterEach, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { FakeClient } from '../lib/fake-client';
import { Store, type SettingsTab } from '../lib/store.svelte';
import MobileSettings from './MobileSettings.svelte';
import { blocksOf, navOf, pageScopeOf } from '../lib/settings-tabs';
import { strings } from '../lib/strings';

let mounted: ReturnType<typeof mount> | undefined;
let client: FakeClient;
let store: Store;
const settle = async () => { for (let i = 0; i < 20; i++) { await Promise.resolve(); flushSync(); } };
afterEach(async () => {
  if (mounted) await unmount(mounted);
  mounted = undefined;
  store?.detach(); client?.close();
  vi.restoreAllMocks(); document.body.innerHTML = ''; localStorage.clear();
});

/** What a phone shows for a route: the page of the map its card is on, that page from the top for a card a phone lacks, its list for a page it lacks. */
const ROUTES: { owner: boolean; tab: SettingsTab; section?: string; shows: string }[] = [
  { owner: true, tab: 'home', shows: 'mobile-settings-pages' },
  { owner: true, tab: 'ai', shows: 'accounts-page' },
  { owner: true, tab: 'accounts', shows: 'accounts-page' },
  { owner: true, tab: 'plugins', shows: 'plugins-page' },
  { owner: false, tab: 'plugins', shows: 'mobile-settings-pages' },
  { owner: false, tab: 'agents', shows: 'mobile-settings-pages' },
  // A card's id finds its page, whatever page the route names beside it.
  { owner: true, tab: 'general', section: 'secrets', shows: 'secrets-card' },
  { owner: true, tab: 'general', section: 'windows', shows: 'window-allowlist' },
  { owner: true, tab: 'general', section: 'quiet', shows: 'setting-mute-agents' },
  { owner: true, tab: 'accounts', section: 'browser-profiles', shows: 'browser-profiles-card' },
  { owner: true, tab: 'advanced', section: 'auto-compact', shows: 'compaction-settings' },
  { owner: true, tab: 'general', shows: 'setting-chat-artifacts' },
  { owner: true, tab: 'advanced', shows: 'compaction-settings' },
  { owner: true, tab: 'resources', shows: 'resources-page' },
  // The shortcuts and this device's card stay on the desktop: their page opens on what a phone has of it.
  { owner: true, tab: 'keyboard', shows: 'voice-settings' },
  { owner: true, tab: 'general', section: 'app', shows: 'phone-settings' },
  // A paired phone: the shared pages without the owner's cards, no page that is the owner's alone.
  { owner: false, tab: 'accounts', shows: 'limits-page' },
  { owner: false, tab: 'general', section: 'worktrees', shows: 'setting-chat-artifacts' },
  { owner: false, tab: 'task-manager', shows: 'mobile-settings-detail' },
  // Without an admin policy, Safeguards holds nothing a paired phone reads.
  { owner: false, tab: 'browser', shows: 'mobile-settings-pages' },
  { owner: false, tab: 'resources', shows: 'mobile-settings-pages' }
];

test.each(ROUTES)('$tab $section on a phone, owner $owner, shows $shows', async ({ owner, tab, section, shows }) => {
  // A route to a card scrolls to it.
  Element.prototype.scrollIntoView ??= vi.fn();
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  vi.spyOn(store, 'owner', 'get').mockReturnValue(owner);
  store.showSettings(tab, section ?? null);
  mounted = mount(MobileSettings, { target: document.body, props: { store } });
  await settle();
  expect(document.querySelector(`[data-testid=${shows}]`)).not.toBeNull();
});

test.each([true, false])('the list holds the map\'s pages in order, an icon and a name each, owner %s', async (owner) => {
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  vi.spyOn(store, 'owner', 'get').mockReturnValue(owner);
  store.showSettings();
  mounted = mount(MobileSettings, { target: document.body, props: { store } });
  await settle();
  const rows = [...document.querySelectorAll<HTMLElement>('[data-testid=mobile-settings-pages] > .row')];
  expect(rows.map((row) => row.dataset.testid)).toEqual(navOf(owner, true).filter((page) => owner || page !== 'safeguards').map((page) => `settings-tab-${page}`));
  for (const row of rows) {
    expect(row.querySelector('svg.lead'), row.dataset.testid).not.toBeNull();
    expect(row.querySelector('.ui-label')?.textContent).toBe(strings.settingsMap.pages[row.dataset.testid!.slice('settings-tab-'.length) as keyof typeof strings.settingsMap.pages]);
  }
  expect(document.querySelector('[data-testid=settings-family]')).toBeNull();
  expect(document.querySelector('[data-testid=mobile-settings-home] h2')).toBeNull();
});

test.each(['appearance', 'input', 'conversations', 'ai', 'agents', 'safeguards', 'devices', 'version', 'help'] as const)('%s shows its title, its scope line and its blocks in the map\'s order', async (page) => {
  Element.prototype.scrollIntoView ??= vi.fn();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  vi.spyOn(store, 'owner', 'get').mockReturnValue(true);
  store.showSettings(page);
  mounted = mount(MobileSettings, { target: document.body, props: { store } });
  await settle();
  expect(document.querySelector('[data-testid=mobile-settings-header] h1 .ui-label')?.textContent).toBe(strings.settingsMap.pages[page]);
  expect(document.querySelector<HTMLElement>('[data-testid=mobile-settings-page-scope]')?.dataset.scope).toBe(pageScopeOf(page));
  expect(document.querySelector<HTMLElement>('[data-testid=settings-page]')?.dataset.page).toBe(page);
  expect([...document.querySelectorAll<HTMLElement>('[data-testid=settings-page] > [data-block]')].map((block) => block.dataset.block)).toEqual(blocksOf(page, true, true).map((entry) => entry.block));
  vi.unstubAllGlobals();
});
