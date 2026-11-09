import { afterEach, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { FakeClient } from '../lib/fake-client';
import { Store, type SettingsTab } from '../lib/store.svelte';
import MobileSettings from './MobileSettings.svelte';

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

/** What a phone shows for a route: the page a desktop shows for it, the card's own page, its group's index, or Home where the phone has no such page. */
const ROUTES: { owner: boolean; tab: SettingsTab; section?: string; shows: string }[] = [
  // Providers has its page as on the desktop; plugins and the keyboard stay on the desktop.
  { owner: true, tab: 'accounts', shows: 'accounts-page' },
  { owner: true, tab: 'plugins', shows: 'mobile-settings-home' },
  // The keys agents ask for and the browser's logins moved under Providers, the windows under Machines (round 18).
  { owner: true, tab: 'general', section: 'secrets', shows: 'secrets-card' },
  { owner: true, tab: 'general', section: 'windows', shows: 'window-allowlist' },
  { owner: true, tab: 'keyboard', shows: 'mobile-settings-home' },
  // A group with no card named opens its index; a card the phone has no page for lands there too.
  { owner: true, tab: 'general', shows: 'mobile-settings-general' },
  { owner: true, tab: 'general', section: 'conversations', shows: 'setting-chat-artifacts' },
  { owner: true, tab: 'general', section: 'app', shows: 'mobile-settings-general' },
  { owner: true, tab: 'advanced', shows: 'mobile-settings-advanced' },
  { owner: false, tab: 'accounts', shows: 'mobile-settings-home' },
  { owner: false, tab: 'general', section: 'worktrees', shows: 'mobile-settings-home' },
  { owner: false, tab: 'general', section: 'secrets', shows: 'mobile-settings-home' },
  // The small pages are sections of their family: quiet under the conversations, browser profiles beside the keys,
  // compaction on Advanced's index, Resources inside Diagnostics.
  { owner: true, tab: 'general', section: 'quiet', shows: 'setting-mute-agents' },
  { owner: true, tab: 'general', section: 'browser-profiles', shows: 'browser-profiles-card' },
  { owner: true, tab: 'advanced', section: 'auto-compact', shows: 'compaction-settings' },
  { owner: true, tab: 'resources', shows: 'resources-page' },
  { owner: false, tab: 'resources', shows: 'mobile-settings-home' }
];

test.each(ROUTES)('$tab $section on a phone, owner $owner, shows $shows', async ({ owner, tab, section, shows }) => {
  // Diagnostics scrolls to a section merged into it.
  Element.prototype.scrollIntoView ??= vi.fn();
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  vi.spyOn(store, 'owner', 'get').mockReturnValue(owner);
  store.showSettings(tab, section ?? null);
  mounted = mount(MobileSettings, { target: document.body, props: { store } });
  await settle();
  expect(document.querySelector(`[data-testid=${shows}]`)).not.toBeNull();
});
