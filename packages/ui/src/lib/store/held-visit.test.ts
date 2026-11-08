import { afterEach, expect, test, vi } from 'vitest';
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
