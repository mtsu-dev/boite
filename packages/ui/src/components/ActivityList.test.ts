import { afterEach, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { FakeClient } from '../lib/fake-client';
import { Store } from '../lib/store.svelte';
import { workspace } from '../lib/workspace.svelte';
import ActivityList from './ActivityList.svelte';

let mounted: ReturnType<typeof mount> | undefined;
let client: FakeClient;
let store: Store;
const settle = async () => { for (let i = 0; i < 20; i++) { await Promise.resolve(); flushSync(); } };
afterEach(async () => {
  if (mounted) await unmount(mounted);
  mounted = undefined;
  store?.detach(); client?.close();
  workspace.machines = [];
  document.body.innerHTML = ''; localStorage.clear();
});

test('Mark all as read empties Activity of failures and news on the core, and leaves what asks the user', async () => {
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  // The seed's two idle threads become a failure and a finish; t-scheduler waits on a question and t-bench on a permission.
  const byId = (id: string) => store.threads.find(thread => thread.id === id)!;
  const [failed, done, asks, allow] = [byId('t-trace'), byId('t-descriptors'), byId('t-scheduler'), byId('t-bench')];
  store.threads = store.threads.map(thread =>
    thread.id === failed.id ? { ...thread, status: 'error', unread: true }
      : thread.id === done.id ? { ...thread, status: 'idle', unread: true, backgroundWork: null, backgroundWait: null }
        : thread);
  const call = vi.spyOn(client, 'call');
  workspace.machines = [{ id: 'local', label: 'Local', store }];
  mounted = mount(ActivityList, { target: document.body, props: { store } });
  await settle();
  const listed = () => [...document.querySelectorAll<HTMLElement>('[data-thread-id]')].map(row => row.dataset.threadId);
  expect(listed()).toEqual(expect.arrayContaining([failed.id, done.id, asks.id, allow.id]));

  document.querySelector<HTMLButtonElement>('[data-testid=activity-mark-all-read]')!.click();
  await settle();
  // Only the question and the permission are left, and nothing else is left to clear.
  expect(new Set(listed())).toEqual(new Set([asks.id, allow.id]));
  expect(document.querySelector('[data-testid=activity-mark-all-read]')).toBeNull();
  // The core is told, thread by thread, so every client of the machine drops the same rows.
  const marked = call.mock.calls.filter(([method]) => method === 'threads.markRead').map(([, params]) => (params as { threadId: string }).threadId);
  expect(marked.sort()).toEqual([failed.id, done.id].sort());
});
