import { afterEach, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { FakeClient } from '../lib/fake-client';
import { Store, store as primary } from '../lib/store.svelte';
import { strings } from '../lib/strings';
import { inbox } from '../lib/inbox.svelte';
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
  document.body.innerHTML = '';
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

const marked = (call: { mock: { calls: unknown[][] } }) => call.mock.calls
  .filter(([method]) => method === 'threads.markRead')
  .map(([, params]) => (params as { threadId: string }).threadId);

test("a middle click on the rail's Activity clears the finished rows on every machine and leaves the rest", async () => {
  const [local, remote] = [await machine('local'), await machine('home')];
  workspace.machines = [{ id: 'local', label: 'Local', store: local }, { id: 'home', label: 'Workstation', store: remote }];
  workspace.active = local;
  const calls = stores.map(store => vi.spyOn(store.client!, 'call'));
  mounted = mount(AppRail, { target: document.body, props: { store: local } });
  await settle();
  const button = document.querySelector<HTMLButtonElement>('[data-testid=nav-activity]')!;
  const badge = () => document.querySelector('[data-testid=rail-activity-waiting]')?.textContent ?? null;
  const asks = { questions: local.pendingQuestions.length, permissions: local.pendingPermissions.length };
  const before = badge();
  expect(before).not.toBeNull();
  // Its name card says the gesture.
  expect(button.parentElement!.querySelector('.rail-name')!.textContent).toContain(strings.app.rail.middleClickFinished);

  const press = new MouseEvent('mousedown', { button: 1, bubbles: true, cancelable: true });
  button.dispatchEvent(press);
  await settle();
  // The press alone stops the browser's scrolling and clears nothing: the release on the button does.
  expect(press.defaultPrevented).toBe(true);
  for (const call of calls) expect(marked(call)).toEqual([]);
  button.dispatchEvent(new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true }));
  await settle();
  // Activity does not open.
  expect(inbox.open).toBe(false);
  // Each machine's own core is told about its finish alone, the same id on both since ids collide between machines.
  for (const call of calls) expect(marked(call)).toEqual(['t-descriptors']);
  for (const store of stores) {
    const unread = (id: string) => store.threads.find(thread => thread.id === id)!.unread;
    expect([unread('t-descriptors'), unread('t-trace')]).toEqual([false, true]);
  }
  // The failure, the questions and the permissions stay, and so does the badge that counts them.
  expect({ questions: local.pendingQuestions.length, permissions: local.pendingPermissions.length }).toEqual(asks);
  expect(badge()).toBe(before);
});

test("the rail's Activity still opens on a left click and clears nothing", async () => {
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
  expect(marked(call)).toEqual([]);
  expect(local.threads.find(thread => thread.id === 't-descriptors')!.unread).toBe(true);
});
