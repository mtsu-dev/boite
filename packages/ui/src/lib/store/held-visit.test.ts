import { afterEach, expect, test, vi } from 'vitest';
import { flushSync } from 'svelte';
import type { Message } from '@boite/contracts';
import { FakeClient } from '../fake-client';
import { READING_CACHE_BYTES, ReadingCache } from '../reading-cache';
import { Store } from '../store.svelte';

let client: FakeClient;
let store: Store;
afterEach(() => { store?.detach(); client?.close(); vi.restoreAllMocks(); });

test('threads read a moment ago paint again without a proxy identity warning', async () => {
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  const ids = store.threads.filter(thread => !thread.archived).map(thread => thread.id).slice(0, 4);
  const warn = vi.spyOn(console, 'warn');
  // Two rounds of visits, then the first again: those come back from the threads held in memory.
  for (const id of [...ids, ...ids, ids[0]!]) { await store.open(id); await new Promise(resolve => setTimeout(resolve, 50)); }
  expect(store.openThread?.id).toBe(ids[0]);
  expect(warn.mock.calls.flat().join(' ')).not.toContain('state_proxy_equality_mismatch');
});

test.each([
  { count: 100, large: false }, { count: 1000, large: false },
  { count: 5000, large: false }, { count: 1000, large: true },
])('leaving a thread does not reread the parts of its $count messages (large: $large)', async ({ count, large }) => {
  client = new FakeClient({ delayMs: 0, long: true });
  store = new Store(); store.attach(client); await store.connect();
  await store.open('t-long');
  const thread = store.openThread!;
  const original = thread.messages[0]!;
  const parts = [{ type: 'text', text: 'x'.repeat(large ? 4096 : 9) }] satisfies Message['parts'];
  let reads = 0;
  store.openThread = { ...thread, messages: Array.from({ length: count }, (_, i) => ({
    ...original, id: `visit-${i}`,
    get parts() { reads++; return parts; },
  })) };
  flushSync();
  reads = 0;
  const opening = store.open('t-bench');
  const synchronous = reads;
  await opening;
  expect(synchronous).toBe(0);
});

test('leaving immediately after a part grows reserves its new weight', async () => {
  client = new FakeClient({ delayMs: 0, long: true });
  store = new Store(); store.attach(client); await store.connect();
  await store.open('t-long');
  flushSync();
  const reserve = vi.spyOn(ReadingCache.prototype, 'defer');
  const message = store.openThread!.messages.at(-1)!;
  message.parts = [{ type: 'text', text: 'x'.repeat(READING_CACHE_BYTES / 2 + 1) }];
  const leaving = store.open('t-bench');
  const reservation = reserve.mock.calls[0];
  await leaving;
  expect(reservation?.[0].id).toBe('t-long');
  expect(reservation?.[1]).toBeGreaterThan(READING_CACHE_BYTES);
  expect(reserve.mock.results[0]?.value).toBe(false);
});

test('the renderer cache evicts preloads and off-screen visits before the active thread', () => {
  const visible = new ReadingCache(undefined, () => true, () => 'open');
  const offScreen = new ReadingCache(undefined, () => false, () => 'oldest');
  const bytes = READING_CACHE_BYTES;
  const page = (id: string) => ({ id, messages: [], turns: [], commands: [] }) as unknown as import('@boite/contracts').Thread;
  try {
    offScreen.remember('oldest', page('oldest'), bytes);
    visible.remember('open', page('open'), bytes);
    visible.prefill('ahead', page('ahead'), bytes);
    for (const id of ['another', 'third', 'fourth']) offScreen.remember(id, page(id), bytes);

    visible.remember('new', page('new'), bytes);
    expect(visible.has('ahead')).toBe(false);
    expect(offScreen.has('oldest')).toBe(true);
    visible.remember('newest', page('newest'), bytes);
    expect(offScreen.has('oldest')).toBe(false);
    expect(visible.has('open')).toBe(true);
  } finally { visible.clear(); offScreen.clear(); }
});

test('discarded ids only invalidate reads registered for that visit', () => {
  const cache = new ReadingCache();
  const discarded = cache.mark('visit');
  const completed = cache.mark('visit');
  completed.release();
  cache.delete('visit');
  expect(discarded.dropped).toBe(true);
  expect(completed.dropped).toBe(false);
  const next = cache.mark('visit');
  discarded.release();
  for (let index = 0; index < 4000; index++) cache.delete(`uncached-${index}`);
  expect(next.dropped).toBe(false);
  cache.clear();
  expect(next.dropped).toBe(true);
  next.release();
});
