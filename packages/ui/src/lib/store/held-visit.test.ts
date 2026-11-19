import { afterEach, expect, test, vi } from 'vitest';
import { flushSync } from 'svelte';
import type { Message } from '@boite/contracts';
import { FakeClient } from '../fake-client';
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

test.each([100, 1000, 5000])('leaving a thread does not reread the parts of its %s messages', async count => {
  client = new FakeClient({ delayMs: 0, long: true });
  store = new Store(); store.attach(client); await store.connect();
  await store.open('t-long');
  const thread = store.openThread!;
  const original = thread.messages[0]!;
  const parts = [{ type: 'text', text: 'on screen' }] satisfies Message['parts'];
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
