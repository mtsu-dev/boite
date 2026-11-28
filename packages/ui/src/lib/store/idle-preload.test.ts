import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Thread, ThreadId } from '@boite/contracts';
import { FakeClient } from '../fake-client';
import { Store } from '../store.svelte';
import { READING_CACHE_BYTES, READING_CACHE_THREADS, ReadingCache } from '../reading-cache';
import { IDLE_PRELOAD_WAIT_MS } from './thread-preload';

/** A gate the test opens. */
function gated(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

type Params = { threadId?: string; limit?: number; after?: string; open?: unknown };

let client: FakeClient;
let store: Store;
beforeEach(() => { window.__BOITE_IDLE_PRELOAD_TEST__ = true; });
afterEach(() => {
  store?.detach(); client?.close(); vi.restoreAllMocks();
  delete window.__BOITE_IDLE_PRELOAD_TEST__;
  Reflect.deleteProperty(navigator, 'connection');
});

/** A read ahead: a page with no `open`, so no subscription, and no `after`, so a first page. */
const isReadAhead = (method: string, params: Params) => method === 'threads.get' && params.limit !== undefined && params.open === undefined && params.after === undefined;

/**
 * A machine with a pinned old thread, two new ones, an archived and an
 * incognito one, the store attached to it and `t-descriptors` open. Reads
 * ahead wait for `release` when `hold` is set: before the core reads the
 * page, or after it, holding an answer that may be stale by then, when
 * `answerFirst` is set. `release(true)` holds the next read again.
 */
async function machine(hold = false, answerFirst = false): Promise<{ ahead: () => ThreadId[]; calls: () => [string, Params][]; inFlight: () => number; release: (again?: boolean) => void; created: { older: ThreadId; newer: ThreadId } }> {
  client = new FakeClient({ delayMs: 0 });
  await client.connect();
  await client.call('threads.pin', { threadId: 't-trace', pinned: true });
  const make = (title: string, extra: { incognito?: boolean; projectId?: string } = {}) => client.call('threads.create', { projectId: 'p-boite', providerId: 'echo', accountId: 'a-echo', title, ...extra });
  const older = await make('older');
  await new Promise(resolve => setTimeout(resolve, 5));
  const newer = await make('newer');
  const shelved = await make('archived');
  await client.call('threads.archive', { threadId: shelved.id, archived: true });
  // As on the core, an incognito thread starts in the drafts. Pinned, it would come first were it not left out.
  const drafts = await client.call('projects.drafts', {});
  const hidden = await make('incognito', { incognito: true, projectId: drafts.id });
  await client.call('threads.pin', { threadId: hidden.id, pinned: true });
  const real = client.call.bind(client);
  const calls: [string, Params][] = [];
  let inFlight = 0, most = 0;
  let gate: { promise: Promise<void>; resolve: () => void } | null = hold ? gated() : null;
  vi.spyOn(client, 'call').mockImplementation((async (method: string, params: Params, options?: unknown) => {
    calls.push([method, params]);
    if (!isReadAhead(method, params)) return real(method as never, params as never, options as never);
    inFlight++; most = Math.max(most, inFlight);
    try {
      if (gate && !answerFirst) await gate.promise;
      const answer = await real(method as never, params as never, options as never);
      if (gate && answerFirst) await gate.promise;
      return answer;
    } finally { inFlight--; }
  }) as never);
  store = new Store();
  store.attach(client);
  await store.connect();
  await store.open('t-descriptors');
  return {
    ahead: () => calls.filter(([method, params]) => isReadAhead(method, params)).map(([, params]) => params.threadId as ThreadId),
    calls: () => calls,
    inFlight: () => most,
    release: (again = false) => { const held = gate; gate = again ? gated() : null; held?.resolve(); },
    created: { older: older.id, newer: newer.id },
  };
}

/** Whether opening `id` paints it in the same task, before any answer, without the loading view: it was held. */
async function paintsAtOnce(id: ThreadId): Promise<boolean> {
  const opening = store.open(id);
  // A thread with no message yet holds none: its loading view is what says it was not held.
  const painted = store.openThread?.id === id && store.loadingThreadId === null;
  await opening;
  return painted;
}

test('a ready machine reads its first four sidebar threads ahead, one at a time, and one of them opens from memory', async () => {
  const { ahead, calls, inFlight, created } = await machine();
  // Pins first, then the latest message (the fake dates its new threads before the seed's): the open,
  // archived and incognito threads are left out, and the fifth, the older new thread, waits.
  await vi.waitFor(() => expect(ahead()).toHaveLength(4), { timeout: IDLE_PRELOAD_WAIT_MS * 4 });
  await new Promise(resolve => setTimeout(resolve, IDLE_PRELOAD_WAIT_MS * 1.5));
  expect(ahead()).toEqual(['t-trace', 't-bench', 't-scheduler', created.newer]);
  expect(inFlight()).toBe(1);
  // Reading ahead subscribed to nothing: only the open thread is live.
  expect(client.coreSubscribers).toEqual(['t-descriptors']);

  const before = calls().length;
  const opening = store.open('t-bench');
  // Painted in the same task as the click, before any answer.
  expect(store.openThread?.id).toBe('t-bench');
  expect(store.openThread?.messages.length).toBeGreaterThan(0);
  expect(store.loadingThreadId).toBeNull();
  await opening;
  // The open asks only what came after the page it holds, never the page again.
  const pages = calls().slice(before).filter(([method, params]) => method === 'threads.get' && params.threadId === 't-bench');
  expect(pages.length).toBeGreaterThan(0);
  for (const [, params] of pages) expect(params.after).toBeDefined();
  expect(store.error).toBeNull();
  // The other three paint at once too; the fifth thread, never read, waits for its page.
  for (const id of ['t-trace', 't-scheduler', created.newer]) expect(await paintsAtOnce(id)).toBe(true);
  expect(await paintsAtOnce(created.older)).toBe(false);
});

test('where the read-ahead is off (a driven browser, a unit test), an open does not start it', async () => {
  delete window.__BOITE_IDLE_PRELOAD_TEST__;
  const { ahead } = await machine();
  await store.open('t-bench');
  await new Promise(resolve => setTimeout(resolve, IDLE_PRELOAD_WAIT_MS * 2.5));
  expect(ahead()).toEqual([]);
});

test('a connection that saves data reads one thread ahead', async () => {
  Object.defineProperty(navigator, 'connection', { value: { saveData: true }, configurable: true });
  const { ahead } = await machine();
  await vi.waitFor(() => expect(ahead()).toHaveLength(1), { timeout: IDLE_PRELOAD_WAIT_MS * 4 });
  await new Promise(resolve => setTimeout(resolve, IDLE_PRELOAD_WAIT_MS * 1.5));
  expect(ahead()).toEqual(['t-trace']);
});

test('a drop or an open drops the read in flight and the rest; the reads start over once the page is idle again', async () => {
  const { ahead, release } = await machine(true);
  await vi.waitFor(() => expect(ahead()).toEqual(['t-trace']), { timeout: IDLE_PRELOAD_WAIT_MS * 4 });

  // The machine drops with the read in flight: its answer, if any, is not kept, and nothing more is asked.
  client.drop();
  release();
  await new Promise(resolve => setTimeout(resolve, IDLE_PRELOAD_WAIT_MS * 1.5));
  expect(ahead()).toEqual(['t-trace']);
  // Opened offline, the thread has only its bare row: nothing was kept.
  await store.open('t-trace');
  expect(store.openThread?.id).toBe('t-trace');
  expect(store.openThread?.messages).toEqual([]);
  await store.open('t-descriptors');

  // Back, the machine reads ahead again from the first thread.
  const { ahead: again, release: releaseAgain } = await reattach(true);
  await vi.waitFor(() => expect(again()).toEqual(['t-trace']), { timeout: IDLE_PRELOAD_WAIT_MS * 4 });
  // The user opens a thread while the read is in flight: no read is asked during the open, the answer is dropped.
  const opening = store.open('t-scheduler');
  releaseAgain();
  await opening;
  expect(again()).toEqual(['t-trace']);
  // Once the open settled and the page is idle, what was left is read, the open thread aside:
  // the dropped answer was not kept, so the first thread is read again.
  await vi.waitFor(() => expect(again().length).toBeGreaterThan(1), { timeout: IDLE_PRELOAD_WAIT_MS * 4 });
  expect(again()).not.toContain('t-scheduler');
  expect(again()[1]).toBe('t-trace');
});

test('a page read before a rewind or an archive of its thread is not kept once it lands', async () => {
  const { ahead, release } = await machine(true, true);
  const first = (await client.call('threads.get', { threadId: 't-trace' })).messages.find(message => message.role === 'user')!;
  // The core read t-trace whole; the user then edits its first message before the answer lands.
  await vi.waitFor(() => expect(ahead()).toEqual(['t-trace']), { timeout: IDLE_PRELOAD_WAIT_MS * 4 });
  expect(await store.rewind(first.id, 't-trace')).not.toBeNull();
  release(true);
  // The next read is answered, then its thread is archived before the answer lands.
  await vi.waitFor(() => expect(ahead()).toEqual(['t-trace', 't-bench']), { timeout: IDLE_PRELOAD_WAIT_MS * 4 });
  await store.archive('t-bench');
  release();
  await vi.waitFor(() => expect(ahead().length).toBeGreaterThan(2), { timeout: IDLE_PRELOAD_WAIT_MS * 4 });
  // Neither stale page was kept: the rewound thread loads again and never shows the message that left it.
  const opening = store.open('t-trace');
  expect(store.loadingThreadId).toBe('t-trace');
  expect(store.openThread?.messages.some(message => message.id === first.id) ?? false).toBe(false);
  await opening;
  expect(store.openThread?.messages.some(message => message.id === first.id)).toBe(false);
  expect(store.threads.some(row => row.id === 't-bench')).toBe(false);
  expect(await paintsAtOnce('t-bench')).toBe(false);
});

/** The same machine, its socket back. */
async function reattach(hold: boolean): Promise<{ ahead: () => ThreadId[]; release: () => void }> {
  const calls: [string, Params][] = [];
  let gate: { promise: Promise<void>; resolve: () => void } | null = hold ? gated() : null;
  const spied = vi.mocked(client.call);
  const previous = spied.getMockImplementation()!;
  spied.mockImplementation((async (method: string, params: Params, options?: unknown) => {
    calls.push([method, params]);
    if (gate && isReadAhead(method, params)) await gate.promise;
    return (previous as (...args: unknown[]) => Promise<unknown>)(method, params, options);
  }) as never);
  await client.restore();
  return {
    ahead: () => calls.filter(([method, params]) => isReadAhead(method, params)).map(([, params]) => params.threadId as ThreadId),
    release: () => { const held = gate; gate = null; held?.resolve(); },
  };
}

test('a page read ahead goes into the reading cache only where it fits, never over a visit', () => {
  const cache = new ReadingCache();
  const thread = (id: string) => ({ id, messages: [] }) as unknown as Thread;
  for (let index = 0; index < READING_CACHE_THREADS - 1; index++) cache.remember(`v${index}`, thread(`v${index}`), 10);
  expect(cache.prefill('v0', thread('again'), 10)).toBe(false);
  expect(cache.get('v0')?.id).toBe('v0');
  expect(cache.prefill('a', thread('a'), 10)).toBe(true);
  // Full: the next one is dropped, and every visit stays.
  expect(cache.prefill('b', thread('b'), 10)).toBe(false);
  expect(cache.size).toBe(READING_CACHE_THREADS);
  expect(cache.get('v0')).toBeDefined();
});

test('a departure delays its projection, a quick return reuses it, and a forgotten visit stays gone', () => {
  const cache = new ReadingCache();
  const thread = { id: 'left', messages: [] } as unknown as Thread;
  const prepare = vi.fn(() => thread);
  const copy = (held: Thread) => held;
  cache.defer(thread, 0, prepare, copy, () => false);
  expect(cache.has(thread.id)).toBe(true);
  expect(cache.prefill(thread.id, thread, 0)).toBe(false);
  expect(prepare).not.toHaveBeenCalled();
  expect(cache.get(thread.id)).toBe(thread);
  expect(prepare).toHaveBeenCalledOnce();
  cache.defer(thread, 0, prepare, copy, () => false);
  cache.forget(thread.id);
  expect(cache.get(thread.id)).toBeUndefined();
  expect(prepare).toHaveBeenCalledOnce();
});

test('ready visits and visits waiting for idle share the same byte budget', () => {
  const waiting = new Map<number, IdleRequestCallback>();
  let sequence = 0;
  vi.stubGlobal('requestIdleCallback', (run: IdleRequestCallback) => { waiting.set(++sequence, run); return sequence; });
  vi.stubGlobal('cancelIdleCallback', (id: number) => waiting.delete(id));
  const cache = new ReadingCache();
  const page = (id: string) => ({ id, messages: [{ parts: [{ type: 'text', text: 'x'.repeat(READING_CACHE_BYTES / 2) }] }] }) as Thread;
  try {
    cache.remember('first', page('first'), READING_CACHE_BYTES, thread => thread);
    for (const id of ['second', 'third', 'fourth']) expect(cache.defer(page(id), READING_CACHE_BYTES, thread => thread, thread => thread, () => true)).toBe(true);
    const mark = cache.mark('second');
    expect(cache.get('second')?.id).toBe('second');
    expect(mark.dropped).toBe(false);
    mark.release();
    expect(cache.defer(page('fifth'), READING_CACHE_BYTES, thread => thread, thread => thread, () => true)).toBe(true);
    expect(cache.has('first')).toBe(false);
    expect(waiting.size).toBe(4);
  } finally {
    cache.clear();
    expect(waiting.size).toBe(0);
    vi.unstubAllGlobals();
  }
});

test('a press waits for a same-thread idle transfer, and releasing it before that transfer never unsubscribes', async () => {
  const { calls, ahead, release } = await machine(true);
  await vi.waitFor(() => expect(ahead()).toEqual(['t-trace']), { timeout: 3500 });
  const end = store.preload('t-trace');
  expect(calls().filter(([method, params]) => method === 'threads.get' && params.threadId === 't-trace')).toHaveLength(1);
  end();
  release();
  await vi.waitFor(() => expect(ahead().length).toBeGreaterThan(1), { timeout: 3500 });
  expect(calls().filter(([method, params]) => method === 'threads.unsubscribe' && params.threadId === 't-trace')).toEqual([]);
});

test('idle reads wait for a hidden document to become visible', async () => {
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  const { ahead } = await machine();
  await new Promise(resolve => setTimeout(resolve, IDLE_PRELOAD_WAIT_MS + 50));
  expect(ahead()).toEqual([]);
  hidden.mockReturnValue(false);
  document.dispatchEvent(new Event('visibilitychange'));
  await vi.waitFor(() => expect(ahead()).toContain('t-trace'), { timeout: 3500 });
});
