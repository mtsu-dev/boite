import type { PermissionRequest, ThreadSummary } from '@boite/contracts';
import { afterEach, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { FakeClient } from '../lib/fake-client';
import { Store } from '../lib/store.svelte';
import { activityFeed, feedGroups } from '../lib/activity-feed';
import ActivityRow from './ActivityRow.svelte';

let mounted: ReturnType<typeof mount> | undefined;
let client: FakeClient;
let store: Store;
const settle = async () => { for (let i = 0; i < 20; i++) { await Promise.resolve(); flushSync(); } };
afterEach(async () => {
  if (mounted) await unmount(mounted);
  mounted = undefined;
  store?.detach(); client?.close();
  document.body.innerHTML = ''; localStorage.clear();
});

async function rows(command: string) {
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  const parent = store.threads.find(thread => !thread.parentThreadId && thread.projectId && thread.id !== store.openThread?.id)!;
  parent.status = 'waiting';
  const child = { ...parent, id: 'helper-child', title: 'Check the parser', status: 'waiting', parentThreadId: parent.id } as ThreadSummary;
  store.threads = [...store.threads, child];
  store.pendingPermissions = [{ id: 'perm', threadId: parent.id, toolName: 'Bash', input: { command }, description: null, createdAt: Date.now() } as unknown as PermissionRequest];
  store.pendingQuestions = [{ id: 'q', threadId: child.id, text: 'Which retry policy?', options: [], createdAt: Date.now() } as never];
  const machine = { id: 'local', label: 'Local', store };
  const project = store.projects.find(project => project.id === parent.projectId);
  const groups = feedGroups(activityFeed([parent, child].map(thread => ({ machine, thread, project }))));
  return { parent, child, groups };
}

test('a permission reads whole under its row, with its sub-agent on a line of its own, and its one action opens the thread', async () => {
  const command = 'git push --force-with-lease origin feature/a-branch-name-long-enough-to-wrap-in-the-row\n&& gh pr create --fill';
  const { parent, child, groups } = await rows(command);
  // One thread, one row: the sub-agent that asks is a line of its parent's row.
  expect(groups).toHaveLength(1);
  expect(groups[0]!.helpers.map(helper => helper.thread.id)).toEqual([child.id]);
  mounted = mount(ActivityRow, { target: document.body, props: { ...groups[0]!, now: Date.now() } });
  await settle();
  expect(document.querySelectorAll('[data-testid=thread-row]')).toHaveLength(1);
  expect(document.querySelector('[data-testid=thread-reason]')?.textContent).toBe('Wants to run:');
  // The command whole, both lines, never cut to its first.
  expect(document.querySelector('[data-testid=thread-operation]')?.textContent).toBe(command);
  expect(document.querySelector('[data-testid=thread-helper]')?.textContent).toBe('Check the parser · Which retry policy?');
  const verbs = document.querySelectorAll<HTMLButtonElement>('[data-testid=thread-verb]');
  expect([...verbs].map(verb => [verb.textContent?.trim(), verb.dataset.verb])).toEqual([['Allow', 'allow']]);
  verbs[0]!.click(); await settle();
  await vi.waitFor(() => expect(store.openThread?.id).toBe(parent.id));
});

test('a command too long to read in the row asks for Review before any Allow', async () => {
  const { groups } = await rows(Array.from({ length: 12 }, (_, line) => `echo step ${line}`).join('\n'));
  mounted = mount(ActivityRow, { target: document.body, props: { ...groups[0]!, now: Date.now() } });
  await settle();
  expect(document.querySelector('[data-testid=thread-operation]')?.classList.contains('long')).toBe(true);
  const verb = document.querySelector<HTMLButtonElement>('[data-testid=thread-verb]')!;
  expect([verb.textContent?.trim(), verb.dataset.verb]).toEqual(['Review', 'review']);
});
