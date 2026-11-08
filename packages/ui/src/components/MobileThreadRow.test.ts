import type { PermissionRequest } from '@boite/contracts';
import { afterEach, expect, test } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { FakeClient } from '../lib/fake-client';
import { Store } from '../lib/store.svelte';
import MobileThreadRow from './MobileThreadRow.svelte';

let mounted: ReturnType<typeof mount> | undefined;
let client: FakeClient;
let store: Store;
afterEach(async () => {
  if (mounted) await unmount(mounted);
  mounted = undefined;
  store?.detach(); client?.close();
  document.body.innerHTML = '';
});

test('a phone row that needs you says it once, by its named dot, and an Activity row reads its command whole', async () => {
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  const thread = store.threads.find(row => !row.parentThreadId && row.projectId && row.id !== store.openThread?.id)!;
  thread.status = 'waiting';
  const command = 'bun run build\n&& bun run deploy --channel nightly';
  store.pendingPermissions = [{ id: 'perm', threadId: thread.id, toolName: 'Bash', input: { command }, description: null, createdAt: Date.now() } as unknown as PermissionRequest];
  const machine = { id: 'local', label: 'Local', store };
  const project = store.projects.find(row => row.id === thread.projectId);
  const props = { machine, thread, project, now: Date.now(), items: [], onopen: () => {}, onaction: () => {} };

  // A list row: the dot in the one slot, named for a screen reader and the pointer, and no "Needs you" word beside it.
  mounted = mount(MobileThreadRow, { target: document.body, props });
  flushSync();
  const mark = document.querySelector('[data-testid=thread-state]')!;
  expect([mark.getAttribute('data-state'), mark.getAttribute('aria-label'), mark.getAttribute('title')]).toEqual(['waiting', 'Needs you', 'Needs you']);
  expect(document.querySelector('[data-testid=mobile-row]')!.textContent).not.toContain('Needs you');
  await unmount(mounted);

  // Activity: what it asks, then the command as it will run, both lines of it.
  mounted = mount(MobileThreadRow, { target: document.body, props: { ...props, compact: true, reason: 'Wants to run:', at: Date.now(), verb: 'allow' } });
  flushSync();
  expect(document.querySelector('[data-testid=mobile-row-reason]')!.textContent?.trim()).toBe('Wants to run:');
  expect(document.querySelector('[data-testid=mobile-row] code')!.textContent).toBe(command);
  expect(document.querySelector<HTMLElement>('[data-testid=thread-verb]')!.dataset['verb']).toBe('allow');
});
