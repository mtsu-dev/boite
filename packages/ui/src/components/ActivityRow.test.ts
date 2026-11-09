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

test('a permission reads whole under its row, its sub-agent\'s question is a row of its own, and each row\'s one action opens its thread', async () => {
  const command = 'git push --force-with-lease origin feature/a-branch-name-long-enough-to-wrap-in-the-row\n&& gh pr create --fill';
  const { parent, child, groups } = await rows(command);
  // One event, one row: a question is not the same ask as a permission, so the sub-agent does not ride its parent's row.
  expect(groups).toHaveLength(2);
  const own = groups.find(group => group.row.thread.id === parent.id)!;
  const asks = groups.find(group => group.row.thread.id === child.id)!;
  expect(own.helpers).toEqual([]);
  expect(asks.helpers).toEqual([]);
  mounted = mount(ActivityRow, { target: document.body, props: { ...own, now: Date.now() } });
  await settle();
  expect(document.querySelectorAll('[data-testid=thread-row]')).toHaveLength(1);
  expect(document.querySelector('[data-testid=thread-reason]')?.textContent).toBe('Wants to run:');
  // What is asked is the headline's second line, under the title, whole in its tooltip.
  expect(document.querySelector('[data-testid=thread-reason]')?.parentElement?.classList.contains('lead')).toBe(true);
  expect(document.querySelector('[data-testid=thread-reason]')?.previousElementSibling?.classList.contains('title')).toBe(true);
  expect(document.querySelector('[data-testid=thread-reason]')?.getAttribute('title')).toBe('Wants to run:');
  // The command whole, both lines, never cut to its first.
  expect(document.querySelector('[data-testid=thread-operation]')?.textContent).toBe(command);
  // It wraps at spaces only: the branch name is one unbreakable word, never cut at a hyphen.
  expect([...document.querySelectorAll('[data-testid=thread-operation] .word')].map(word => word.textContent)).toContain('feature/a-branch-name-long-enough-to-wrap-in-the-row');
  expect(document.querySelector('[data-testid=thread-helper]')).toBeNull();
  const verbs = document.querySelectorAll<HTMLButtonElement>('[data-testid=thread-verb]');
  expect([...verbs].map(verb => [verb.textContent?.trim(), verb.dataset.verb])).toEqual([['Allow once', 'allow']]);
  // The row's action ranks: Allow is the solid neutral fill (button.primary), never the accent's send.
  expect(verbs[0]!.classList.contains('primary')).toBe(true);
  expect(verbs[0]!.classList.contains('send')).toBe(false);
  // One decision pair, the composer's: Deny outlined before Allow, in one right-aligned group.
  const deny = document.querySelector<HTMLButtonElement>('[data-testid=thread-verb-secondary]')!;
  expect([deny.textContent?.trim(), deny.dataset.verb, deny.classList.contains('secondary')]).toEqual(['Deny', 'deny', true]);
  expect(deny.parentElement).toBe(verbs[0]!.parentElement);
  expect(deny.parentElement!.classList.contains('decision-actions')).toBe(true);
  expect(deny.compareDocumentPosition(verbs[0]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  verbs[0]!.click(); await settle();
  await vi.waitFor(() => expect(store.openThread?.id).toBe(parent.id));
  await unmount(mounted); document.body.innerHTML = '';
  // Opening the parent kept only its own requests; Activity holds every thread's (permissionRead 'all').
  store.pendingQuestions = [{ id: 'q', threadId: child.id, text: 'Which retry policy?', options: [], createdAt: Date.now() } as never];
  mounted = mount(ActivityRow, { target: document.body, props: { ...asks, now: Date.now() } });
  await settle();
  const verb = document.querySelector<HTMLButtonElement>('[data-testid=thread-verb]')!;
  expect([verb.textContent?.trim(), verb.dataset.verb]).toEqual(['Answer', 'answer']);
  // Skip settles the question in place, without leaving Activity.
  const answer = vi.spyOn(store, 'skipQuestion').mockResolvedValue(true);
  const skip = document.querySelector<HTMLButtonElement>('[data-testid=thread-verb-secondary]')!;
  expect([skip.textContent?.trim(), skip.dataset.verb]).toEqual(['Skip', 'skip']);
  skip.click(); await settle();
  expect(answer).toHaveBeenCalledWith(child.id, 'q');
});

test('Deny settles the permission in place, with the request the row shows', async () => {
  const { parent, groups } = await rows('bun test');
  const deny = vi.spyOn(store, 'answer').mockResolvedValue(true);
  mounted = mount(ActivityRow, { target: document.body, props: { ...groups.find(group => group.row.thread.id === parent.id)!, now: Date.now() } });
  await settle();
  document.querySelector<HTMLButtonElement>('[data-testid=thread-verb-secondary]')!.click(); await settle();
  expect(deny).toHaveBeenCalledWith('perm', 'deny');
  expect(store.openThread?.id).not.toBe(parent.id);
});

test('a command too long to read in the row asks for Review before any Allow', async () => {
  const { parent, groups } = await rows(Array.from({ length: 12 }, (_, line) => `echo step ${line}`).join('\n'));
  mounted = mount(ActivityRow, { target: document.body, props: { ...groups.find(group => group.row.thread.id === parent.id)!, now: Date.now() } });
  await settle();
  expect(document.querySelector('[data-testid=thread-operation]')?.classList.contains('long')).toBe(true);
  const verb = document.querySelector<HTMLButtonElement>('[data-testid=thread-verb]')!;
  expect([verb.textContent?.trim(), verb.dataset.verb]).toEqual(['Review', 'review']);
  // Reading first is not a decision: an outline button, never plain text, and no Deny beside it.
  expect(verb.classList.contains('secondary')).toBe(true);
  expect(verb.classList.contains('primary')).toBe(false);
  expect(document.querySelector('[data-testid=thread-verb-secondary]')).toBeNull();
});

test('an Updates row has no pair, and its time stands where the Needs you rows\' time stands', async () => {
  const { parent, groups } = await rows('bun test');
  const own = groups.find(group => group.row.thread.id === parent.id)!;
  mounted = mount(ActivityRow, { target: document.body, props: { ...own, row: { ...own.row, section: 'updates', verb: null }, now: Date.now() } });
  await settle();
  // The time ends the title's line on every row; the pair lives under the content, so none is reserved here.
  expect(document.querySelector('.feed-side > time')).not.toBeNull();
  expect(document.querySelector('.feed-side [data-testid=thread-verb]')).toBeNull();
  expect(document.querySelector('[data-testid=thread-verb]')).toBeNull();
});
