import { afterEach, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { FakeClient } from '../lib/fake-client';
import { Store, store as primary } from '../lib/store.svelte';
import { strings } from '../lib/strings';
import { inbox } from '../lib/inbox.svelte';
import { activitySeen } from '../lib/activity-seen.svelte';
import { workspace } from '../lib/workspace.svelte';
import AppRail from './AppRail.svelte';

let mounted: ReturnType<typeof mount> | undefined;
let stores: Store[] = [];
const settle = async () => { for (let i = 0; i < 20; i++) { await Promise.resolve(); flushSync(); } };
afterEach(async () => {
  if (mounted) await unmount(mounted);
  mounted = undefined;
  for (const store of stores) { store.client?.close(); store.detach(); }
  stores = [];
  workspace.machines = [];
  workspace.active = primary;
  inbox.open = false;
  activitySeen.keys = new Set();
  document.body.innerHTML = ''; localStorage.clear();
});

/** A machine over the fake core, its seed's two idle threads a failure and a finish not read yet. */
async function machine(id: string): Promise<Store> {
  const store = new Store();
  store.machineId = id;
  store.attach(new FakeClient({ delayMs: 0 }));
  await store.connect();
  store.threads = store.threads.map(thread =>
    thread.id === 't-trace' ? { ...thread, status: 'error', unread: true }
      : thread.id === 't-descriptors' ? { ...thread, status: 'idle', unread: true, backgroundWork: null, backgroundWait: null }
        : thread);
  stores.push(store);
  return store;
}

test("a middle click on the rail's Activity marks all as read on every machine, keeps the questions and permissions, and opens nothing", async () => {
  const [local, remote] = [await machine('local'), await machine('home')];
  workspace.machines = [{ id: 'local', label: 'Local', store: local }, { id: 'home', label: 'Workstation', store: remote }];
  workspace.active = local;
  const calls = stores.map(store => vi.spyOn(store.client!, 'call'));
  mounted = mount(AppRail, { target: document.body, props: { store: local } });
  await settle();
  const button = document.querySelector<HTMLButtonElement>('[data-testid=nav-activity]')!;
  const card = () => button.parentElement!.querySelector('.rail-name')!.textContent!;
  // Its name card says the gesture while there is something to clear.
  expect(card()).toContain(strings.app.rail.middleClickRead);

  const press = new MouseEvent('mousedown', { button: 1, bubbles: true, cancelable: true });
  button.dispatchEvent(press);
  await settle();
  // The browser's scrolling does not start and Activity does not open.
  expect(press.defaultPrevented).toBe(true);
  expect(inbox.open).toBe(false);
  // Each machine's own core is told, the same ids on both since they collide between machines.
  for (const call of calls) {
    const marked = call.mock.calls.filter(([method]) => method === 'threads.markRead').map(([, params]) => (params as { threadId: string }).threadId);
    expect(marked.sort()).toEqual(['t-descriptors', 't-trace']);
  }
  for (const store of stores) {
    const unread = (id: string) => store.threads.find(thread => thread.id === id)!.unread;
    expect([unread('t-trace'), unread('t-descriptors')]).toEqual([false, false]);
  }
  // Nothing left to clear: the card drops the gesture, and a second middle click asks no core anything.
  expect(card()).not.toContain(strings.app.rail.middleClickRead);
  expect(document.querySelector('[data-testid=rail-activity-waiting]')).toBeNull();
  const before = calls.map(call => call.mock.calls.length);
  button.dispatchEvent(new MouseEvent('mousedown', { button: 1, bubbles: true, cancelable: true }));
  await settle();
  expect(calls.map(call => call.mock.calls.length)).toEqual(before);
});

test("the rail's Activity still opens on a left click and marks nothing read", async () => {
  const local = await machine('local');
  workspace.machines = [{ id: 'local', label: 'Local', store: local }];
  workspace.active = local;
  const call = vi.spyOn(local.client!, 'call');
  mounted = mount(AppRail, { target: document.body, props: { store: local } });
  await settle();
  const button = document.querySelector<HTMLButtonElement>('[data-testid=nav-activity]')!;
  button.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true }));
  button.click();
  await settle();
  expect(inbox.open).toBe(true);
  expect(call.mock.calls.some(([method]) => method === 'threads.markRead')).toBe(false);
  expect(local.threads.find(thread => thread.id === 't-trace')!.unread).toBe(true);
});

test("a middle click takes what Needs you holds off the rail's badge, unanswered, until a thread asks again", async () => {
  const local = await machine('local');
  workspace.machines = [{ id: 'local', label: 'Local', store: local }];
  workspace.active = local;
  mounted = mount(AppRail, { target: document.body, props: { store: local } });
  await settle();
  const badge = () => document.querySelector('[data-testid=rail-activity-waiting]')?.textContent ?? null;
  const button = document.querySelector<HTMLButtonElement>('[data-testid=nav-activity]')!;
  const asks = { questions: local.pendingQuestions.length, permissions: local.pendingPermissions.length };
  expect(asks.questions).toBeGreaterThan(0);
  expect(asks.permissions).toBeGreaterThan(0);
  expect(badge()).not.toBeNull();

  button.dispatchEvent(new MouseEvent('mousedown', { button: 1, bubbles: true, cancelable: true }));
  await settle();
  // The badge goes, its words with it; the questions and permissions stay held, for Activity to list.
  expect(badge()).toBeNull();
  expect(button.getAttribute('aria-label')).toBe(strings.mobile.activity);
  expect({ questions: local.pendingQuestions.length, permissions: local.pendingPermissions.length }).toEqual(asks);
  // This device keeps what it saw, so a reload does not bring the number back.
  expect(JSON.parse(localStorage.getItem('boite.activity.seen')!)).toHaveLength(activitySeen.keys.size);

  // A thread that asks something new counts again, the others stay seen.
  local.pendingQuestions = [...local.pendingQuestions, { ...local.pendingQuestions[0]!, id: 'q-new' as never, threadId: 't-descriptors' as never }];
  await settle();
  expect(badge()).toBe('1');
});
