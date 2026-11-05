import { afterEach, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { FakeClient } from '../lib/fake-client';
import { Store } from '../lib/store.svelte';
import { workspace } from '../lib/workspace.svelte';
import Sidebar from './Sidebar.svelte';

/**
 * A row never moves under the pointer: a thread that changes state while the
 * pointer rests on the list keeps its place, its ring already showing the new
 * state, and takes its new lane once the pointer leaves.
 */
let app: ReturnType<typeof mount> | undefined;
let opened: Store | undefined;
const previousActive = workspace.active;
afterEach(async () => {
  if (app) await unmount(app);
  app = undefined;
  opened?.detach(); opened?.client?.close(); opened = undefined;
  workspace.machines = []; workspace.active = previousActive;
  document.body.innerHTML = ''; localStorage.clear();
});

const settle = async () => { for (let i = 0; i < 30; i++) { await Promise.resolve(); flushSync(); } };
const order = (projectId: string) => [...document.querySelectorAll<HTMLElement>(`section[data-testid=project][data-project-id="${projectId}"] [data-testid=thread-row]`)].map(row => row.dataset.threadId);
const ring = (threadId: string) => document.querySelector<HTMLElement>(`[data-testid=thread-row][data-thread-id="${threadId}"] [data-testid=state-ring]`)?.dataset.ring;

test('a row that starts to need the user holds its place while the pointer is on the list, then moves up once it leaves', async () => {
  const store = new Store();
  store.machineId = 'local';
  store.attach(new FakeClient({ delayMs: 0 }));
  await store.connect();
  opened = store;
  // Every p-boite row at rest, so the one that starts to ask has rows to pass.
  store.threads = store.threads.map(thread => thread.projectId === 'p-boite' && !thread.parentThreadId ? { ...thread, status: 'idle', requestSince: undefined, subagentQuestions: undefined } as typeof thread : thread);
  workspace.machines = [{ id: 'local', label: 'Local', store }];
  workspace.active = store;
  // The home's composer on p-boite: its project draws its rows at work and at rest, not only its asks.
  store.startDraft('p-boite', { fresh: true });
  app = mount(Sidebar, { target: document.body, props: { store } });
  await vi.waitFor(async () => { await settle(); expect(order('p-boite').length).toBeGreaterThan(2); });

  const before = order('p-boite');
  // The last row at rest starts to ask: fresh lanes would draw it first, with the asks.
  const resting = before.filter(id => ring(id!) === 'rest');
  const moved = resting.at(-1)!;
  expect(moved).toBeDefined();
  const list = document.querySelector<HTMLElement>('[data-testid=sidebar] .scroll')!;
  const pointer = (type: string) => list.dispatchEvent(Object.assign(new Event(type), { pointerType: 'mouse' }));
  pointer('pointerenter');
  await settle();
  store.threads = store.threads.map(thread => thread.id === moved ? { ...thread, status: 'waiting', requestSince: Date.now() } : thread);
  await settle();
  expect(order('p-boite')).toEqual(before);
  expect(ring(moved)).toBe('waiting');

  pointer('pointerleave');
  await settle();
  const after = order('p-boite');
  expect(after).not.toEqual(before);
  expect(after.indexOf(moved)).toBeLessThan(before.indexOf(moved));
});
