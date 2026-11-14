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

const value = (testid: string) => document.querySelector(`[data-testid=${testid}-value]`)?.textContent ?? null;

test('Home\'s appearance row speaks the language just picked, theme word included', async () => {
  const { store } = await machine();
  store.showSettings();
  mounted = mount(MobileSettings, { target: document.body, props: { store } });
  await settle();
  expect(value('settings-tab-appearance')).toBe(`${strings.settings.themeSystem} · ${strings.settings.languageNames.en}`);
  await setLocaleSetting('fr');
  await settle();
  expect(strings.settings.themeSystem).toBe('Système');
  expect(value('settings-tab-appearance')).toBe(`Système · ${strings.settings.languageNames.fr}`);
});

test('Home\'s voice row says nothing once its machine is out of reach, rather than its last On or Off', async () => {
  const { store } = await machine();
  store.showSettings();
  mounted = mount(MobileSettings, { target: document.body, props: { store } });
  await settle();
  expect([strings.settings.homeOn, strings.settings.homeOff]).toContain(value('settings-tab-voice'));
  store.connection = 'closed';
  await settle();
  expect(value('settings-tab-voice')).toBeNull();
});

test('Diagnostics lists the agents of the machine its bar picked, as the pages above it do', async () => {
  const here = await machine();
  const picked = await machine();
  vi.spyOn(here.store, 'owner', 'get').mockReturnValue(true);
  vi.spyOn(picked.store, 'owner', 'get').mockReturnValue(true);
  const asked = (client: FakeClient) => {
    const call = vi.spyOn(client, 'call');
    return () => call.mock.calls.some(([method]) => method === 'resources.usage');
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
