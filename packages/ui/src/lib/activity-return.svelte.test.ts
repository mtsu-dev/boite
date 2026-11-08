import type { PermissionRequest } from '@boite/contracts';
import { afterEach, expect, test } from 'vitest';
import { flushSync } from 'svelte';
import { FakeClient } from './fake-client';
import { Store } from './store.svelte';
import { inbox } from './inbox.svelte';
import { activityReturn, followActivityReturn, leaveForAct, restoreActivity } from './activity-return.svelte';

let client: FakeClient;
let store: Store;
let stop: (() => void) | undefined;
afterEach(() => {
  stop?.(); stop = undefined;
  store?.detach(); client?.close();
  activityReturn.away = null; activityReturn.back = null; inbox.open = false;
  document.body.innerHTML = '';
});

test('an Allow pressed in Activity comes back to Activity once its thread no longer waits, the keyboard on the row now in its place', async () => {
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  const thread = store.threads.find(entry => !entry.parentThreadId && entry.projectId && entry.id !== store.openThread?.id)!;
  thread.status = 'waiting';
  store.pendingPermissions = [{ id: 'perm', threadId: thread.id, toolName: 'Bash', input: { command: 'ls' }, createdAt: Date.now() } as unknown as PermissionRequest];
  // Activity as it stood: scrolled, three actions, the second pressed.
  document.body.innerHTML = '<section data-testid="activity-list"><button data-testid="thread-verb"></button><button data-testid="thread-verb"></button><button data-testid="thread-verb"></button></section>';
  const page = document.querySelector<HTMLElement>('[data-testid=activity-list]')!;
  page.scrollTop = 120;
  inbox.open = true;
  stop = $effect.root(() => followActivityReturn());
  leaveForAct(store, thread.id, page.querySelectorAll('[data-testid=thread-verb]')[1]!);
  inbox.open = false;
  // The thread as the action opened it (workspace.select): its page, no history needed here.
  store.openThread = { ...thread, messages: [] } as never;
  flushSync();
  // Still waiting in the thread: the user is reading it, nothing moves.
  expect(inbox.open).toBe(false);
  store.pendingPermissions = [];
  store.threads = store.threads.map(entry => entry.id === thread.id ? { ...entry, status: 'running' } : entry);
  flushSync();
  expect(inbox.open).toBe(true);
  expect(activityReturn.back).toEqual({ scroll: 120, index: 1 });
  // The pressed row left the list: the keyboard lands on the one now at its place.
  page.lastElementChild!.remove();
  await restoreActivity(page);
  expect(document.activeElement).toBe(page.querySelectorAll('[data-testid=thread-verb]')[1]);
  expect(activityReturn.back).toBeNull();
});

test('leaving the thread for something else drops the way back', async () => {
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  const [first, second] = store.threads.filter(entry => !entry.parentThreadId && entry.projectId && entry.id !== store.openThread?.id);
  stop = $effect.root(() => followActivityReturn());
  leaveForAct(store, first!.id, null);
  store.openThread = { ...first!, status: 'waiting', messages: [] } as never;
  store.threads = store.threads.map(entry => entry.id === first!.id ? { ...entry, status: 'waiting' } : entry);
  flushSync();
  expect(activityReturn.away?.arrived).toBe(true);
  store.openThread = { ...second!, messages: [] } as never;
  flushSync();
  expect(activityReturn.away).toBeNull();
  expect(inbox.open).toBe(false);
});

test('on a phone an Allow pressed in Activity brings the Activity screen back once the thread no longer waits, and the desktop frame stays out of it', async () => {
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  const thread = store.threads.find(entry => !entry.parentThreadId && entry.projectId && entry.id !== store.openThread?.id)!;
  thread.status = 'waiting';
  store.pendingPermissions = [{ id: 'perm', threadId: thread.id, toolName: 'Bash', input: { command: 'ls' }, createdAt: Date.now() } as unknown as PermissionRequest];
  document.body.innerHTML = '<section data-testid="mobile-list"><button data-testid="thread-verb"></button><button data-testid="thread-verb"></button></section>';
  const list = document.querySelector<HTMLElement>('[data-testid=mobile-list]')!;
  list.scrollTop = 80;
  const phone = $state({ screen: 'activity' as 'chat' | 'threads' | 'activity' });
  // A browser mounts both frames: the desktop's follower must leave a phone's action alone.
  stop = $effect.root(() => {
    followActivityReturn();
    followActivityReturn({ activity: () => phone.screen === 'activity', chat: () => phone.screen === 'chat', reopen: () => { phone.screen = 'activity'; } });
  });
  leaveForAct(store, thread.id, list.querySelectorAll('[data-testid=thread-verb]')[1]!, true);
  phone.screen = 'chat';
  store.openThread = { ...thread, messages: [] } as never;
  flushSync();
  expect(activityReturn.away?.arrived).toBe(true);
  store.pendingPermissions = [];
  store.threads = store.threads.map(entry => entry.id === thread.id ? { ...entry, status: 'running' } : entry);
  flushSync();
  expect(phone.screen).toBe('activity');
  expect(inbox.open).toBe(false);
  expect(activityReturn.back).toEqual({ scroll: 80, index: 1 });
});
