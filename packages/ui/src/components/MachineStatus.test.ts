import { afterEach, expect, test } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { FakeClient } from '../lib/fake-client';
import { Store } from '../lib/store.svelte';
import { workspace } from '../lib/workspace.svelte';
import MachineStatus from './MachineStatus.svelte';

let mounted: ReturnType<typeof mount> | undefined;
let client: FakeClient;
let store: Store;
const settle = async () => { for (let i = 0; i < 20; i++) { await Promise.resolve(); flushSync(); } };
afterEach(async () => {
  if (mounted) await unmount(mounted);
  mounted = undefined;
  store?.detach(); client?.close();
  document.body.innerHTML = '';
});

test('one connected machine says nothing; a filter brings back the button, its name and Manage', async () => {
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  mounted = mount(MachineStatus, { target: document.body, props: { store } });
  await settle();
  expect(document.querySelector('[data-testid=status-connection]')?.getAttribute('data-state')).toBe('ready');
  expect(document.querySelector('[data-testid=machine-status]')).toBeNull();
  // The limits left this menu for the list foot (QuotaLine.test.ts).
  expect(document.querySelector('[data-testid=nav-limits]')).toBeNull();
  await unmount(mounted);

  mounted = mount(MachineStatus, { target: document.body, props: { store, filter: 'local' } });
  await settle();
  expect(document.querySelector('[data-testid=machine-status] .name')?.textContent).toBeTruthy();
  document.querySelector<HTMLButtonElement>('[data-testid=machine-status]')!.click();
  await settle();
  const rows = [...document.querySelectorAll<HTMLElement>('[data-testid=machine-status-menu] [data-row]')].map(row => row.dataset.value);
  expect(rows).toEqual(['manage']);
});

test('a machine that is off reads quiet: a grey dot on the button and "offline" after its name, never the trouble sign', async () => {
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  // A Store is a class instance, which `$state` keeps as it is rather than proxying.
  const asleep = Object.assign(Object.create({}), { connection: 'closed', booted: true, threads: [], pairingRequired: false }) as Store;
  const before = workspace.machines;
  workspace.machines = [{ id: 'local', label: 'Desktop', store }, { id: 'http://laptop', label: 'Laptop', store: asleep }];
  try {
    mounted = mount(MachineStatus, { target: document.body, props: { store } });
    await settle();
    const button = document.querySelector<HTMLButtonElement>('[data-testid=machine-status]')!;
    expect(button.querySelector('[data-testid=machine-offline]')).not.toBeNull();
    // The glyph says which machines and how, in words: each name and its state.
    expect(button.getAttribute('aria-label')).toBe('Filter machines · Desktop: Connected, Laptop: Offline');
    expect(document.querySelector('.machines')?.classList.contains('problem')).toBe(false);
  } finally {
    workspace.machines = before;
  }
});
