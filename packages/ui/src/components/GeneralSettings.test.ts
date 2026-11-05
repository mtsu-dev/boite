import { afterEach, expect, test } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { FakeClient } from '../lib/fake-client';
import { lifecycleFilter } from '../lib/lifecycle-filter.svelte';
import { Store } from '../lib/store.svelte';
import GeneralSettings from './GeneralSettings.svelte';

const apps: ReturnType<typeof mount>[] = [];
const stores: Store[] = [];
const settle = async () => { for (let i = 0; i < 30; i++) { await Promise.resolve(); flushSync(); } };
afterEach(async () => {
  for (const app of apps.splice(0)) await unmount(app);
  for (const store of stores.splice(0)) { store.detach(); store.client?.close(); }
  lifecycleFilter.clear();
  document.body.innerHTML = '';
});

async function seed() {
  const store = new Store();
  store.attach(new FakeClient({ delayMs: 0 }));
  await store.connect();
  stores.push(store);
  return store;
}

test('the archived link in another machine\'s settings brings this window back to its filtered list', async () => {
  // The settings bar picked a second machine: its retention and archive count, but this window's navigation.
  const here = await seed(), target = await seed();
  here.showSettings('general');
  apps.push(mount(GeneralSettings, { target: document.body.appendChild(document.createElement('div')), props: { store: target, here } }));
  await settle();
  document.querySelector<HTMLButtonElement>('[data-testid=archived-show-list]')!.click();
  await settle();
  expect(lifecycleFilter.current).toBe('archived');
  expect(here.page).toBe('chat');
});
