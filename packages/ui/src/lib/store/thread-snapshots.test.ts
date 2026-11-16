import { afterEach, expect, test, vi } from 'vitest';
import type { Thread } from '@boite/contracts';
import { FakeClient } from '../fake-client';
import { Store } from '../store.svelte';
import { MemorySnapshotDb, SNAPSHOT_WRITE_DELAY_MS, ThreadSnapshots, setThreadSnapshots } from '../thread-snapshots';
import { removeEnvironment, upsertEnvironment } from '../endpoint-env';
import type { StoreContext } from './context';
import { DeviceSnapshots } from './device-snapshots';

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

test('a page left before a drop in another window is not written once this window\'s memory let it go', async () => {
  const db = new MemorySnapshotDb();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let started!: () => void;
  const encrypting = new Promise<void>(resolve => { started = resolve; });
  const subtle = {
    generateKey: (...args: Parameters<SubtleCrypto['generateKey']>) => crypto.subtle.generateKey(...args),
    encrypt: async (...args: Parameters<SubtleCrypto['encrypt']>) => { started(); await gate; return crypto.subtle.encrypt(...args); },
    decrypt: (...args: Parameters<SubtleCrypto['decrypt']>) => crypto.subtle.decrypt(...args),
  } as unknown as SubtleCrypto;
  const one = new ThreadSnapshots({ db, subtle, channel: null });
  const two = new ThreadSnapshots({ db, subtle: crypto.subtle, channel: null });
  setThreadSnapshots(one);
  const page = (id: string, ids: string[]) => ({ id, projectId: 'p', title: id, status: 'idle', createdAt: 1, messages: ids.map(mid => ({ id: mid, threadId: id, turnId: `turn-${mid}`, role: 'assistant', createdAt: 1, parts: [{ type: 'text', text: mid }] })), turns: [], commands: [], messagesBefore: null }) as unknown as Thread;
  const left = page('t1', ['m1', 'removed-message']);
  const memory = new Map<string, Thread>([['t1', left]]);
  const ctx = { store: { core: { coreId: 'core-a' }, principal: 'owner' }, connection: { endpointUrl: null } } as unknown as StoreContext;
  const device = new DeviceSnapshots(ctx, { openThread: null, readingThreads: { get: id => memory.get(id) } }, new Set());
  // Another write holds this window's queue: the leave's generations are read behind it.
  const clog = one.write('core-a', null, page('t0', ['a']), null);
  await encrypting;
  // The leave, with the page it held then (an argument the store no longer passes).
  device.schedule('t1', ...([left] as unknown as []));
  // Window two drops t1 (a rewind there), and the memory here lets the page go.
  await two.drop('core-a', 't1');
  memory.delete('t1');
  release();
  await clog;
  await new Promise(resolve => setTimeout(resolve, SNAPSHOT_WRITE_DELAY_MS + 1500));
  await one.purgeMachine('none');
  expect(await db.data('core-a', 't1')).toBeUndefined();
  device.stop();
});

test('a snapshot read that fails, the database blocked, opens the thread from the machine as if there were none', async () => {
  const db = new MemorySnapshotDb();
  const snapshots = new ThreadSnapshots({ db, subtle: crypto.subtle });
  setThreadSnapshots(snapshots);
  vi.spyOn(snapshots, 'mayHold').mockReturnValue(true);
  vi.spyOn(snapshots, 'read').mockRejectedValue(new DOMException('The database is blocked by another tab.', 'AbortError'));
  const { store } = await load();
  await store.open('t-descriptors');
  expect(store.openThread?.id).toBe('t-descriptors');
  expect(store.openThread!.messages.length).toBeGreaterThan(0);
  expect(store.loadingThreadId).toBeNull();
});
