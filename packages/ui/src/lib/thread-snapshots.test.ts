import { afterEach, expect, test } from 'vitest';
import type { Message, Thread } from '@boite/contracts';
import { MemorySnapshotDb, SNAPSHOT_BYTES, SNAPSHOT_THREADS, SNAPSHOT_TOTAL, ThreadSnapshots, setThreadSnapshots } from './thread-snapshots';
import { removeEnvironment, upsertEnvironment } from './endpoint-env';

afterEach(() => { setThreadSnapshots(undefined); localStorage.clear(); });

function message(id: string, text: string, extra: Partial<Message> = {}): Message {
  return { id, threadId: 't', turnId: `turn-${id}`, role: 'assistant', createdAt: 1, parts: [{ type: 'text', text }], ...extra } as Message;
}

function thread(id: string, text = 'hello from the machine', extra: Partial<Thread> = {}): Thread {
  return { id, projectId: 'p', title: id, status: 'idle', createdAt: 1, messages: [message(`${id}-m1`, text)], turns: [], commands: [], messagesBefore: null, ...extra } as unknown as Thread;
}

/** Waits for the purges and writes queued so far: a purge of a machine that has nothing runs behind them. */
const settled = (snapshots: ThreadSnapshots) => snapshots.purgeMachine('none');

function setup(clock = { now: 1000 }) {
  const db = new MemorySnapshotDb();
  const snapshots = new ThreadSnapshots({ db, subtle: crypto.subtle, now: () => clock.now++ });
  return { db, snapshots, clock };
}

test('a written thread reads back whole, and is stored encrypted under a key that cannot be exported', async () => {
  const { db, snapshots } = setup();
  expect(await snapshots.write('core-a', 'https://a.example', thread('t1', 'a secret-free but private line'), 't1-m1' as never)).toBe(true);
  const read = await snapshots.read('core-a', 't1');
  expect(read?.thread.messages[0]?.parts[0]).toEqual({ type: 'text', text: 'a secret-free but private line' });
  expect(read?.after).toBe('t1-m1');
  const record = [...db.records.values()][0]!;
  expect(record.iv.byteLength).toBe(12);
  expect(new TextDecoder().decode(record.data)).not.toContain('private line');
  const { key } = (await db.machine('core-a'))!;
  expect(key.extractable).toBe(false);
  await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow();
  // Each record has its own IV.
  await snapshots.write('core-a', null, thread('t2'), null);
  const ivs = [...db.records.values()].map(entry => [...entry.iv].join(','));
  expect(new Set(ivs).size).toBe(2);
});

test('a machine keeps its 8 most recently opened threads, and the oldest goes first', async () => {
  const { db, snapshots } = setup();
  for (let index = 0; index < SNAPSHOT_THREADS + 2; index++) await snapshots.write('core-a', null, thread(`t${index}`), null);
  // Opened again, t2 is recent once more.
  await snapshots.write('core-a', null, thread('t2'), null);
  await snapshots.write('core-a', null, thread('t10'), null);
  await snapshots.write('core-b', null, thread('other'), null);
  const kept = (await db.metas()).filter(meta => meta.machine === 'core-a').map(meta => meta.threadId).sort();
  expect(kept).toHaveLength(SNAPSHOT_THREADS);
  expect(kept).toEqual(['t10', 't2', 't5', 't6', 't7', 't8', 't9', 't4'].sort());
  expect(await snapshots.read('core-a', 't0')).toBeUndefined();
  expect(await snapshots.read('core-b', 'other')).toBeDefined();
});

test('a thread over 512 KiB is not kept, and the device holds at most 4 MiB, least recent going first', async () => {
  const { db, snapshots } = setup();
  expect(await snapshots.write('core-a', null, thread('huge', 'x'.repeat(SNAPSHOT_BYTES)), null)).toBe(false);
  expect(db.records.size).toBe(0);
  // About 450 KiB each: 9 fit in no machine's 8, so they go to two machines.
  const big = 'y'.repeat(450 * 1024);
  for (let index = 0; index < 5; index++) await snapshots.write('core-a', null, thread(`a${index}`, big), null);
  for (let index = 0; index < 5; index++) await snapshots.write('core-b', null, thread(`b${index}`, big), null);
  const metas = await db.metas();
  expect(metas.reduce((sum, meta) => sum + meta.bytes, 0)).toBeLessThanOrEqual(SNAPSHOT_TOTAL);
  expect(metas.map(meta => meta.threadId)).not.toContain('a0');
  expect(metas.map(meta => meta.threadId)).toContain('b4');
});

test('an incognito thread or one with a secret card is never stored, and loses a record it had', async () => {
  const { db, snapshots } = setup();
  expect(await snapshots.write('core-a', null, thread('ghost', 'hidden', { incognito: true }), null)).toBe(false);
  expect(db.records.size).toBe(0);
  await snapshots.write('core-a', null, thread('t1'), null);
  const secret = thread('t1');
  secret.messages.push(message('t1-m2', '', { parts: [{ type: 'secret_request', requestId: 'r1', name: 'API_KEY', reason: 'deploy', status: 'pending' }] } as never));
  expect(await snapshots.write('core-a', null, secret, null)).toBe(false);
  expect(db.records.size).toBe(0);
  expect(await snapshots.read('core-a', 't1')).toBeUndefined();
});

test('a record that does not decrypt is dropped, and so is one moved to another thread', async () => {
  const { db, snapshots } = setup();
  await snapshots.write('core-a', null, thread('t1'), null);
  await snapshots.write('core-a', null, thread('t2'), null);
  const [first] = [...db.records.values()];
  const flipped = new Uint8Array(first!.data.slice(0));
  flipped[0]! ^= 1;
  await db.put((await db.metas()).find(meta => meta.threadId === 't1')!, { iv: first!.iv, data: flipped.buffer });
  expect(await snapshots.read('core-a', 't1')).toBeUndefined();
  expect((await db.metas()).map(meta => meta.threadId)).toEqual(['t2']);
  // t2's bytes under t3's name: the additional data says which thread it was written for.
  const t2 = (await db.data('core-a', 't2'))!;
  await db.put({ machine: 'core-a', threadId: 't3', bytes: 1, openedAt: 1 }, t2);
  const fresh = new ThreadSnapshots({ db, subtle: crypto.subtle });
  expect(await fresh.read('core-a', 't3')).toBeUndefined();
  expect(await db.data('core-a', 't3')).toBeUndefined();
  expect(await fresh.read('core-a', 't2')).toBeDefined();
});

test('removing a machine or the device losing its key there purges that machine\'s records and key, and only those', async () => {
  const { db, snapshots } = setup();
  setThreadSnapshots(snapshots);
  upsertEnvironment({ url: 'https://a.example', token: 'key-a', paired: true });
  upsertEnvironment({ url: 'https://b.example', token: 'key-b', paired: true });
  await snapshots.write('core-a', 'https://a.example', thread('t1'), null);
  await snapshots.write('core-b', 'https://b.example', thread('t2'), null);
  // Another key for the same address is not this one: nothing goes.
  removeEnvironment('https://a.example', 'someone-else');
  await settled(snapshots);
  expect(await db.machine('core-a')).toBeDefined();
  removeEnvironment('https://a.example', 'key-a');
  await settled(snapshots);
  expect(await db.machine('core-a')).toBeUndefined();
  expect((await db.metas()).map(meta => meta.machine)).toEqual(['core-b']);
  expect(await snapshots.read('core-b', 't2')).toBeDefined();
  // Written again, the machine gets a new key.
  await snapshots.write('core-a', 'https://a.example', thread('t1'), null);
  expect(await snapshots.read('core-a', 't1')).toBeDefined();
  await snapshots.purgeAll();
  expect(db.records.size + db.keys.size).toBe(0);
});

test('a drop asked while the first write of its thread is still pending removes what that write stored', async () => {
  const { snapshots } = setup();
  // The index is read and holds nothing yet: the write below has not noted its record.
  expect(await snapshots.read('core-a', 't1')).toBeUndefined();
  const writing = snapshots.write('core-a', null, thread('t1'), null);
  const dropping = snapshots.drop('core-a', 't1');
  expect(await writing).toBe(true);
  await dropping;
  expect(await snapshots.read('core-a', 't1')).toBeUndefined();
  expect(snapshots.mayHold('core-a', 't1')).toBe(false);
});

test('two windows writing a machine\'s first threads at once share one key, and each reads the other\'s', async () => {
  const db = new MemorySnapshotDb();
  const one = new ThreadSnapshots({ db, subtle: crypto.subtle });
  const two = new ThreadSnapshots({ db, subtle: crypto.subtle });
  expect(await Promise.all([one.write('core-a', 'https://a.example', thread('t1'), null), two.write('core-a', null, thread('t2'), null)])).toEqual([true, true]);
  expect(db.keys.size).toBe(1);
  // After a reload, both records decrypt under the one key kept.
  const reloaded = new ThreadSnapshots({ db, subtle: crypto.subtle });
  expect((await reloaded.read('core-a', 't1'))?.thread.id).toBe('t1');
  expect((await reloaded.read('core-a', 't2'))?.thread.id).toBe('t2');
  expect((await db.machine('core-a'))?.urls).toEqual(['https://a.example']);
});
