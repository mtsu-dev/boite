import { afterEach, expect, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { test } from '../test/fake-client';
import ChatView from './ChatView.svelte';

let view: ReturnType<typeof mount> | undefined;
afterEach(() => {
  if (view) unmount(view, { outro: false });
  view = undefined;
  document.body.replaceChildren();
});

const notice = () => document.querySelector('[data-testid=worktree-gone]');
/** Why, and what became of the branch, sit behind the notice's "i". */
function tipText(testid = 'worktree-gone'): string {
  document.querySelector<HTMLButtonElement>(`[data-testid=${testid}-info]`)!.click();
  flushSync();
  const text = document.querySelector(`[data-testid=${testid}-info-text]`)?.textContent ?? '';
  document.querySelector<HTMLButtonElement>(`[data-testid=${testid}-info]`)!.click();
  flushSync();
  return text;
}

test('a done thread whose worktree was removed says both in one notice, and the box\'s slot holds the way on once moved back to Recent', async ({ ready }) => {
  const { store, client } = await ready();
  const account = (await client.call('accounts.list', {})).find(entry => entry.providerId === 'echo')!;
  const thread = await client.call('threads.create', { projectId: 'p-boite', providerId: 'echo', accountId: account.id, title: 'Merged work', worktree: { branch: 'boite/merged-work' } });
  await client.call('threads.archive', { threadId: thread.id });
  client.removeWorktree(thread.id, { branch: 'boite/merged-work', branchDeleted: true, reason: 'pr-merged', pullRequest: { number: 12, url: 'https://github.com/example/repo/pull/12' }, removedAt: Date.now() - 2 * 3_600_000 });
  await store.open(thread.id);
  view = mount(ChatView, { target: document.body, props: { store } });
  flushSync();

  // One notice while done: one sentence, the why behind its "i", Reopen its one action.
  const done = () => document.querySelector('[data-testid=done-thread-notice]');
  await vi.waitFor(() => expect(done()).not.toBeNull());
  expect(notice()).toBeNull();
  expect(done()!.textContent).toContain('This thread is done and its folder was cleaned up.');
  expect(tipText('done-thread-notice')).toContain('after #12 was merged. Branch boite/merged-work was deleted.');

  document.querySelector<HTMLButtonElement>('[data-testid=done-thread-reopen]')!.click();
  await vi.waitFor(() => expect(document.querySelector('[data-testid=done-thread-notice]')).toBeNull());
  flushSync();
  await vi.waitFor(() => expect(notice()).not.toBeNull());
  expect(tipText()).toContain('after #12 was merged. Branch boite/merged-work was deleted.');
  expect(notice()!.classList.contains('replaces')).toBe(true);
  expect(document.querySelector<HTMLElement>('[data-testid=composer]')?.hidden).toBe(true);
  // In the box's slot: inside the composer's block, after the hidden box.
  expect(notice()!.parentElement?.classList.contains('composer-wrap')).toBe(true);
  // The way on leads: the new thread button is the notice's primary action.
  const start = document.querySelector<HTMLButtonElement>('[data-testid=worktree-gone-new]')!;
  expect(start.classList.contains('primary')).toBe(true);
  expect(start.textContent).toContain('Start a new thread here');
  await expect(client.call('turns.start', { threadId: thread.id, prompt: 'still there?' })).rejects.toThrow();
});

test('a clean removal names no pull request and says when the branch stayed', async ({ ready }) => {
  const { store, client } = await ready();
  const account = (await client.call('accounts.list', {})).find(entry => entry.providerId === 'echo')!;
  const thread = await client.call('threads.create', { projectId: 'p-boite', providerId: 'echo', accountId: account.id, title: 'Clean work', worktree: { branch: 'boite/clean-work' } });
  client.removeWorktree(thread.id, { branch: 'boite/clean-work', branchDeleted: false, reason: 'clean', removedAt: Date.now() });
  await store.open(thread.id);
  view = mount(ChatView, { target: document.body, props: { store } });
  flushSync();

  await vi.waitFor(() => expect(notice()).not.toBeNull());
  expect(tipText()).toContain('every commit in it was already on another branch. Branch boite/clean-work is still there.');
  expect(tipText()).not.toContain('#');
});
