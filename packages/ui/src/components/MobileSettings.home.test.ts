import { afterEach, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { FakeClient } from '../lib/fake-client';
import { setLocaleSetting } from '../lib/i18n.svelte';
import { strings } from '../lib/strings';
import { Store } from '../lib/store.svelte';
import MobileSettings from './MobileSettings.svelte';

let mounted: ReturnType<typeof mount> | undefined;
const clients: FakeClient[] = [];
const stores: Store[] = [];
const settle = async () => { for (let i = 0; i < 20; i++) { await Promise.resolve(); flushSync(); } };
afterEach(async () => {
  if (mounted) await unmount(mounted);
  mounted = undefined;
  for (const store of stores.splice(0)) store.detach();
  for (const client of clients.splice(0)) client.close();
  await setLocaleSetting('en');
  vi.restoreAllMocks(); document.body.innerHTML = ''; localStorage.clear();
});

async function machine(): Promise<{ client: FakeClient; store: Store }> {
  const client = new FakeClient({ delayMs: 0 });
  const store = new Store(); store.attach(client); await store.connect();
  clients.push(client); stores.push(store);
  return { client, store };
}

test('the list speaks the language just picked, and Devices says which machine this phone reaches', async () => {
  const { store } = await machine();
  store.showSettings();
  mounted = mount(MobileSettings, { target: document.body, props: { store } });
  await settle();
  const name = (page: string) => document.querySelector(`[data-testid=settings-tab-${page}] .ui-label`)?.textContent;
  expect(name('ai')).toBe('AI accounts');
  expect(document.querySelector('[data-testid=mobile-settings-connection-value]')?.textContent?.trim()).not.toBe('');
  // One value in the list, the connection: no other row carries a word of its own.
  expect(document.querySelectorAll('[data-testid=mobile-settings-pages] .value')).toHaveLength(1);
  await setLocaleSetting('fr');
  await settle();
  expect(name('ai')).toBe('Comptes IA');
  expect(name('help')).toBe(strings.settingsMap.pages.help);
  store.connection = 'closed';
  await settle();
  expect(document.querySelector('[data-testid=mobile-settings-connection-value]')?.textContent?.trim()).toBe(strings.connection.closed);
});

test('Troubleshooting reads the machine picked, as the pages above it do', async () => {
  const here = await machine();
  const picked = await machine();
  vi.spyOn(here.store, 'owner', 'get').mockReturnValue(true);
  vi.spyOn(picked.store, 'owner', 'get').mockReturnValue(true);
  const asked = (client: FakeClient) => {
    const call = vi.spyOn(client, 'call');
    return () => call.mock.calls.some(([method]) => method === 'diagnostics.summary');
  };
  const hereAsked = asked(here.client), pickedAsked = asked(picked.client);
  Element.prototype.scrollIntoView ??= vi.fn();
  here.store.showSettings('diagnostics');
  mounted = mount(MobileSettings, { target: document.body, props: { store: here.store, target: picked.store } });
  for (let i = 0; i < 50 && !pickedAsked() && !hereAsked(); i++) { await settle(); await new Promise(resolve => setTimeout(resolve, 2)); }
  expect(document.querySelector('#settings-task-manager')).not.toBeNull();
  expect(pickedAsked()).toBe(true);
  expect(hereAsked()).toBe(false);
});
