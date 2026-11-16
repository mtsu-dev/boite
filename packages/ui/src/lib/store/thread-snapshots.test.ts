import { afterEach, expect, test, vi } from 'vitest';
import type { Thread } from '@boite/contracts';
import { FakeClient } from '../fake-client';
import { Store } from '../store.svelte';
import { MemorySnapshotDb, SNAPSHOT_WRITE_DELAY_MS, ThreadSnapshots, setThreadSnapshots } from '../thread-snapshots';
import { removeEnvironment, upsertEnvironment } from '../endpoint-env';

type Params = { threadId?: string; after?: string };

let stores: Store[] = [];
let clients: FakeClient[] = [];
afterEach(() => {
  for (const store of stores) store.detach();
  for (const client of clients) client.close();
  stores = []; clients = [];
  setThreadSnapshots(undefined);
  localStorage.clear();
  vi.restoreAllMocks();
});

/** A page load: a fresh fake core with the same id and seed, and a store attached to it. */
async function load(hold: Promise<void> = Promise.resolve()): Promise<{ store: Store; client: FakeClient; gets: Params[] }> {
  const client = new FakeClient({ delayMs: 0, coreId: 'core-fixture' });
  await client.connect();
  const real = client.call.bind(client);
  const gets: Params[] = [];
  vi.spyOn(client, 'call').mockImplementation((async (method: string, params: Params, options?: unknown) => {
    if (method === 'threads.get') { gets.push(params); await hold; }
    return real(method as never, params as never, options as never);
  }) as never);
  const store = new Store();
  store.attach(client);
  await store.connect();
  stores.push(store); clients.push(client);
  return { store, client, gets };
}

async function until(check: () => boolean | Promise<boolean>, ms = 4000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

test('a thread opened before a reload opens from its snapshot, then asks only for what came after it', async () => {
  const db = new MemorySnapshotDb();
  setThreadSnapshots(new ThreadSnapshots({ db, subtle: crypto.subtle }));
  const first = await load();
  await first.store.open('t-descriptors');
  const shown = first.store.openThread!.messages.map(message => message.id);
  // Written once the page settled, not before.
  expect(db.records.size).toBe(0);
  await until(() => db.records.size === 1, SNAPSHOT_WRITE_DELAY_MS + 3000);

  // The machine holds every page back: what shows meanwhile came from the device.
  let release!: () => void;
  const second = await load(new Promise<void>(resolve => { release = resolve; }));
  const opening = second.store.open('t-descriptors');
  await until(() => second.gets.some(params => params.threadId === 't-descriptors'));
  expect(second.store.openThread?.id).toBe('t-descriptors');
  expect(second.store.loadingThreadId).toBeNull();
  expect(second.store.openThread!.messages.map(message => message.id)).toEqual(shown);
  release();
  await opening;
  const ask = second.gets.find(params => params.threadId === 't-descriptors')!;
  expect(ask.after).toBe(shown.at(-1));
  expect(second.store.openThread!.messages.map(message => message.id)).toEqual(shown);
});

test('a snapshot whose cursor the core does not know is dropped, and the thread shows only what the core sent', async () => {
  const db = new MemorySnapshotDb();
  const snapshots = new ThreadSnapshots({ db, subtle: crypto.subtle });
  setThreadSnapshots(snapshots);
  const { store, gets } = await load();
  const page = await store.client!.call('threads.get', { threadId: 't-descriptors' });
  const gone = { ...page.messages.at(-1)!, id: 'm-rewound-away' } as Thread['messages'][number];
  const stale = { ...page, messages: [...page.messages.slice(0, -1), gone] } as Thread;
  await snapshots.write('core-fixture', null, stale, 'm-rewound-away' as never);
  gets.length = 0;
  await store.open('t-descriptors');
  expect(gets.find(params => params.threadId === 't-descriptors')?.after).toBe('m-rewound-away');
  expect(store.openThread!.messages.map(message => message.id)).not.toContain('m-rewound-away');
  expect(store.openThread!.messages.map(message => message.id)).toEqual(page.messages.map(message => message.id));
  await snapshots.purgeMachine('none');
  expect(await db.data('core-fixture', 't-descriptors')).toBeUndefined();
});

test('a write still waiting for its page to settle is dropped when the machine is removed or the store lets it go', async () => {
  const db = new MemorySnapshotDb();
  const snapshots = new ThreadSnapshots({ db, subtle: crypto.subtle });
  setThreadSnapshots(snapshots);
  const url = 'https://a.example';
  upsertEnvironment({ url, token: 'key-a', paired: true });
  const first = await load();
  first.store.endpointUrl = url;
  await first.store.open('t-descriptors');
  await until(() => db.records.size === 1, SNAPSHOT_WRITE_DELAY_MS + 3000);
  // Leaving schedules the left page and the new one; the device then loses its key there.
  await first.store.open('t-trace');
  removeEnvironment(url, 'key-a');
  await snapshots.purgeMachine('none');
  expect([db.keys.size, db.records.size]).toEqual([0, 0]);
  await new Promise(resolve => setTimeout(resolve, SNAPSHOT_WRITE_DELAY_MS + 1500));
  expect([db.keys.size, db.records.size]).toEqual([0, 0]);

  // A store that lets its machine go writes nothing it had waiting.
  const second = await load();
  await second.store.open('t-descriptors');
  second.store.detach();
  await new Promise(resolve => setTimeout(resolve, SNAPSHOT_WRITE_DELAY_MS + 1500));
  await snapshots.purgeMachine('none');
  expect([db.keys.size, db.records.size]).toEqual([0, 0]);
});
