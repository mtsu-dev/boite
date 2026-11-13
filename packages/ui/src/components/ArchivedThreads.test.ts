import { afterEach, expect, test, vi } from 'vitest';
import archivedSource from './ArchivedThreads.svelte?raw';
import { flushSync, mount, tick, unmount } from 'svelte';
import type { ThreadSummary } from '@boite/contracts';
import ArchivedThreads from './ArchivedThreads.svelte';
import ContextMenu from './ContextMenu.svelte';
import { FakeClient } from '../lib/fake-client';
import { Store } from '../lib/store.svelte';
import { projectMenu } from '../lib/project-menu';
import { contextMenu } from '../lib/context-menu.svelte';
import { archivedFocus } from '../lib/archived-focus.svelte';

let running: Record<string, unknown> | null = null;
const cleanups: (() => void)[] = [];

afterEach(() => {
  if (running) unmount(running, { outro: false });
  running = null;
  contextMenu.close();
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

async function ready() {
  const store = new Store(), client = new FakeClient({ delayMs: 0 });
  store.attach(client); await store.connect();
  cleanups.push(() => { store.detach(); client.close(); });
  return { store, client };
}
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

test('the settings archive keeps bot workers across live updates and restores the personal bot', async () => {
  const { store, client } = await ready();
  const bot = await client.call('agents.profile.save', { value: {
    name: 'Scout', domain: '', instructions: '', avatar: '', status: 'active', projectIds: ['p-boite'],
    selection: { providerId: 'echo', accountId: 'a-echo', model: 'echo-1', effort: null, permissionMode: 'default' },
  } });
  const { threadId } = await client.call('agents.open', { agentId: bot.id });
  const child = await client.call('delegation.spawn', { threadId, task: 'Inspect the project', requestId: 'archive-worker' });
  await client.call('delegation.wait', { threadId, agentId: child.thread.id, timeoutMs: 5000 });
  await client.call('threads.archive', { threadId: child.thread.id, onlyIfIdle: true });
  await client.call('threads.archive', { threadId });
  running = mount(ArchivedThreads, { target: document.body, props: { store, eager: true } });
  await settle();
  const row = (id: string) => document.querySelector<HTMLElement>(`[data-testid=archived-list] [data-thread-id="${id}"]`);
  expect(row(child.thread.id)).not.toBeNull();
  await client.call('threads.update', { threadId: child.thread.id, title: 'Updated project result' });
  await settle();
  expect(row(child.thread.id)?.textContent).toContain('Updated project result');
  expect(row(threadId)?.textContent).toContain('Scout');
  row(threadId)!.querySelector<HTMLButtonElement>('[data-testid=archived-restore]')!.click();
  await settle();
  expect((await client.call('threads.get', { threadId })).archived).toBe(false);
  expect(row(threadId)?.querySelector('[data-testid=archived-open]')).toBeTruthy();
});

test('the mounted settings archive shows an older core\'s merged PR identity/time, reloads reason and restores the retained conversation', async () => {
  const { store, client } = await ready();
  const account = (await client.call('accounts.list', {})).find(account => account.providerId === 'echo')!;
  const thread = await client.call('threads.create', { projectId: 'p-boite', providerId: 'echo', accountId: account.id, title: 'Merged conversation', worktree: { branch: 'merged-ui-fixture' } });
  client.setMergedPrFixture(thread.id, { repository: 'github.com/example/repo', branch: thread.branch!, tip: 'a'.repeat(40), clean: true, candidates: [{ repository: 'github.com/example/repo', branch: thread.branch!, sha: 'a'.repeat(40), number: 7, url: 'https://github.com/example/repo/pull/7', mergedAt: '2026-10-01T12:00:00Z' }] });
  const draw = async () => {
    running = mount(ArchivedThreads, { target: document.body, props: { store, eager: true } });
    await settle();
  };
  await client.call('threads.archive', { threadId: 't-parser', archived: false });
  const calls = vi.spyOn(client, 'call');
  await draw();
  expect(document.querySelector('[data-testid=archived-empty]')).not.toBeNull();
  const loaded = calls.mock.calls.length;
  // This version asks the agent; a `pr-merged` archive is one an older core made.
  client.setMergedPrArchive(thread.id, { number: 7, url: 'https://github.com/example/repo/pull/7' });
  await settle();
  expect(calls.mock.calls.slice(loaded).some(([method]) => method === 'threads.list')).toBe(false);
  const row = () => document.querySelector<HTMLElement>(`[data-thread-id="${thread.id}"]`)!;
  expect(row()).not.toBeNull();
  const reason = row().querySelector<HTMLElement>('[data-testid=archive-merged-reason]')!;
  expect(reason.textContent).toContain('Archived after PR #7 merged');
  expect(reason.querySelector('a')?.getAttribute('href')).toBe('https://github.com/example/repo/pull/7');
  expect(reason.querySelector('a')?.getAttribute('rel')).toBe('noopener noreferrer');
  // The row's time, at the end of the title's line as on a live row, is when the merge put it away.
  expect(row().querySelector('.context time')).toBeNull();
  expect(row().querySelector('.title + time.at')?.getAttribute('datetime')).toBe(new Date((await client.call('threads.get', { threadId: thread.id })).archiveReason!.archivedAt).toISOString());
  await unmount(running!, { outro: false }); running = null; document.body.innerHTML = '';
  await draw();
  expect(row().querySelector('[data-testid=archive-merged-reason]')).not.toBeNull();
  row().querySelector<HTMLButtonElement>('[data-testid=archived-restore]')!.click();
  await settle();
  const restored = await client.call('threads.get', { threadId: thread.id });
  expect(restored.archived).toBe(false); expect(restored.archiveReason).toBeUndefined(); expect(restored.cwd).toBe(thread.cwd);
  expect(await client.sweepMergedPrArchives()).toBe(0);
  expect(row().querySelector('[data-testid=archive-merged-reason]')).toBeNull();
  row().querySelector<HTMLButtonElement>('[data-testid=archived-open]')!.click(); await settle();
  expect(store.openThread?.id).toBe(thread.id);
  expect(store.openThread?.cwd).toBe(thread.cwd);
  await client.call('threads.archive', { threadId: thread.id, archived: true }); await settle();
  expect(row().querySelector('[data-testid=archived-restore]')).not.toBeNull();
  await client.call('threads.archive', { threadId: thread.id, archived: false }); await settle();
  expect(row()).toBeNull();
});

test('a mounted settings archive reconciles a late merged-PR question and removal ahead of its initial list response', async () => {
  const { store, client } = await ready();
  const account = (await client.call('accounts.list', {})).find(account => account.providerId === 'echo')!;
  const thread = await client.call('threads.create', { projectId: 'p-boite', providerId: 'echo', accountId: account.id, title: 'Late merged conversation', worktree: { branch: 'late-archive-fixture' } });
  // A finished, read turn: the agent's prompt cache is warm, so the question is worth a turn.
  const turn = await client.call('turns.start', { threadId: thread.id, prompt: 'Work on the change.' });
  await vi.waitFor(async () => expect((await client.call('threads.get', { threadId: thread.id })).turns.find(row => row.id === turn.id)?.status).toBe('done'));
  await client.call('threads.markRead', { threadId: thread.id });
  client.setMergedPrFixture(thread.id, { repository: 'github.com/example/repo', branch: thread.branch!, tip: 'b'.repeat(40), clean: true, candidates: [{ repository: 'github.com/example/repo', branch: thread.branch!, sha: 'b'.repeat(40), number: 8, url: 'https://github.com/example/repo/pull/8', mergedAt: '2026-10-01T13:00:00Z' }] });
  const started = deferred(), released = deferred(), call = client.call.bind(client);
  const calls = vi.spyOn(client, 'call').mockImplementation(async (method, params) => {
    const answer = await call(method, params);
    if (method === 'threads.list' && 'includeArchived' in params && params.includeArchived) { started.resolve(); await released.promise; }
    return answer;
  });
  running = mount(ArchivedThreads, { target: document.body, props: { store, eager: true } });
  flushSync(); await started.promise;
  try {
    expect(await client.sweepMergedPrArchives()).toBe(1);
    await client.call('threads.remove', { threadId: 't-parser' });
  } finally { released.resolve(); }
  await settle();
  // The agent was asked, the thread was not put away: the archive holds neither it nor the removed one.
  expect((await client.call('threads.get', { threadId: thread.id })).archived).toBe(false);
  expect([...document.querySelectorAll('[data-testid=archived-list] li')].map(row => row.getAttribute('data-thread-id'))).toEqual([]);
  expect(document.querySelector('[data-thread-id="' + thread.id + '"]')).toBeNull();
  expect(calls.mock.calls.filter(([method, params]) => method === 'threads.list' && 'includeArchived' in params && params.includeArchived)).toHaveLength(1);
});

test('mounted policy menu keeps its owner during an awaited write and ignores a menu from a replaced client', async () => {
  const { store, client } = await ready();
  const replacement = new FakeClient({ delayMs: 0, coreId: 'replacement' });
  cleanups.push(() => replacement.close());
  running = mount(ContextMenu, { target: document.body }); await settle();
  const open = async () => {
    projectMenu(new MouseEvent('click'), store, store.projects.find(project => project.id === 'p-boite')!);
    await settle(); document.querySelector<HTMLButtonElement>('[data-value=manage]')!.click(); await settle();
  };
  store.projects = store.projects.map(project => project.id === 'p-boite' ? { ...project, autoArchiveMergedPr: undefined } : project);
  await open();
  expect(document.querySelector('[data-value=auto-archive-merged-pr]')).toBeNull();
  store.projects = await client.call('projects.list', {});
  const started = deferred(), released = deferred();
  const call = client.call.bind(client);
  vi.spyOn(client, 'call').mockImplementation(async (method, params) => {
    const answer = await call(method, params);
    if (method === 'projects.setAutoArchiveMergedPr') { started.resolve(); await released.promise; }
    return answer;
  });
  await open();
  document.querySelector<HTMLButtonElement>('[data-value=auto-archive-merged-pr]')!.click(); await started.promise;
  store.attach(replacement); await store.connect();
  released.resolve(); await settle();
  expect(store.projects.find(project => project.id === 'p-boite')?.autoArchiveMergedPr).toBe(true);
  expect((await client.call('projects.list', {})).find(project => project.id === 'p-boite')?.autoArchiveMergedPr).toBe(false);
  await open();
  const stalePick = document.querySelector<HTMLButtonElement>('[data-value=auto-archive-merged-pr]')!;
  const restored = new FakeClient({ delayMs: 0, coreId: 'third-core' }); cleanups.push(() => restored.close());
  store.attach(restored); await store.connect();
  const spy = vi.spyOn(restored, 'call');
  stalePick.click(); await settle();
  expect(spy.mock.calls.some(([method]) => method === 'projects.setAutoArchiveMergedPr')).toBe(false);
  expect(store.error).toBeNull();
});

test('an awaited mounted settings Restore never inserts its old conversation into a replacement machine', async () => {
  const { store, client } = await ready();
  running = mount(ArchivedThreads, { target: document.body, props: { store, eager: true } });
  await settle();
  const started = deferred(), released = deferred(), call = client.call.bind(client);
  vi.spyOn(client, 'call').mockImplementation(async (method, params) => {
    const answer = await call(method, params);
    if (method === 'threads.archive') { started.resolve(); await released.promise; }
    return answer;
  });
  document.querySelector<HTMLButtonElement>(`[data-thread-id=t-parser] [data-testid=archived-restore]`)!.click(); await started.promise;
  const replacement = new FakeClient({ delayMs: 0, coreId: 'replacement' }); cleanups.push(() => replacement.close());
  store.attach(replacement); await store.connect();
  released.resolve(); await settle();
  expect(store.threads.some(thread => thread.id === 't-parser')).toBe(false);
  expect((await replacement.call('threads.get', { threadId: 't-parser' })).archived).toBe(true);
  const title = document.querySelector('[data-testid=archived-list] [data-thread-id=t-parser] .title')!.textContent;
  await client.call('threads.archive', { threadId: 't-parser', archived: true });
  await client.call('threads.update', { threadId: 't-parser', title: 'Old machine archive' });
  await settle();
  expect(document.querySelector('[data-testid=archived-list] [data-thread-id=t-parser] .title')!.textContent).toBe(title);
  expect(store.error).toBeNull();
});

async function settle() {
  for (let i = 0; i < 4; i++) { await tick(); await Promise.resolve(); }
  flushSync();
}

test('a thread archived live takes its place by archive time, not the top', async () => {
  const { store, client } = await ready();
  await store.archive('t-trace');
  let push: ((summary: ThreadSummary) => void) | undefined;
  const on = client.on.bind(client);
  vi.spyOn(client, 'on').mockImplementation(((event: string, handler: (summary: ThreadSummary) => void) => {
    if (event === 'thread.updated') push = handler;
    return on(event as never, handler as never);
  }) as never);
  running = mount(ArchivedThreads, { target: document.body, props: { store, eager: true } });
  await settle();
  const rows = () => [...document.querySelectorAll('[data-testid=archived-list] li')].map(row => row.getAttribute('data-thread-id'));
  expect(rows()).toEqual(['t-trace', 't-parser']);
  // Put away long ago on another computer, announced only now.
  const bench = store.threads.find(thread => thread.id === 't-bench')!;
  push!({ ...bench, archived: true, archivedAt: 1, updatedAt: Date.now() });
  await settle();
  expect(rows()).toEqual(['t-trace', 't-parser', 't-bench']);
  // A row archived again elsewhere moves up with its new time.
  const parser = (await client.call('threads.list', { includeArchived: true })).find(thread => thread.id === 't-parser')!;
  push!({ ...parser, archivedAt: Date.now() + 60_000 });
  await settle();
  expect(rows()).toEqual(['t-parser', 't-trace', 't-bench']);
});

test('an archived row restores as its one action and keeps Delete behind its menu', async () => {
  const { store } = await ready();
  await store.archive('t-trace');
  running = mount(ArchivedThreads, { target: document.body, props: { store, eager: true } });
  await settle();
  const row = () => document.querySelector<HTMLElement>('[data-testid=archived-list] [data-thread-id="t-trace"]');
  // One action on the row; the bin is no longer a second button beside it.
  expect([...row()!.querySelectorAll('.actions > button')].map(button => button.getAttribute('data-testid'))).toEqual(['archived-restore']);
  expect(row()!.querySelector('[data-testid=archived-delete]')).toBeNull();
  row()!.querySelector<HTMLButtonElement>('[data-testid=archived-menu-t-trace]')!.click();
  await settle();
  const remove = document.querySelector<HTMLElement>('[data-testid=archived-delete]')!;
  expect(remove.closest('li')?.dataset['threadId']).toBe('t-trace');
  remove.click();
  await vi.waitFor(() => expect(row()).toBeNull());
});

test('a touch screen shows the row menu at any width, not only a phone\'s', () => {
  const css = archivedSource.replace(/\/\*[\s\S]*?\*\//g, '');
  // Hidden until the pointer comes at rest; a wide touch screen (a tablet) has no pointer, so its query shows it.
  expect(css).toMatch(/li:not\(:hover, :focus-within\) \.actions :global\(\.trigger\) \{ opacity: 0; \}/);
  const touch = css.match(/@media [^{]*\(hover: none\)[^{]*\{([\s\S]*?)\n  \}/)?.[1] ?? '';
  expect(touch).toContain('.archived li:not(:hover, :focus-within) .actions :global(.trigger) { opacity: 1; }');
  // Always shown, it leaves the time's place on the first line for the second line's end, as on a phone.
  expect(touch).toContain('.actions { grid-row: 2;');
  expect(touch).toMatch(/:focus-within\):not\(\.back\) \.at \{ visibility: visible; \}/);
});

test('opened from a project card, the archive shows that project alone until All projects', async () => {
  const { store } = await ready();
  await store.archive('t-descriptors');
  const focus = 'p-notes';
  archivedFocus.store = store;
  archivedFocus.projectId = focus;
  running = mount(ArchivedThreads, { target: document.body, props: { store, eager: true } });
  await settle();
  const rows = () => [...document.querySelectorAll('[data-testid=archived-list] li')].map(row => row.getAttribute('data-thread-id'));
  expect(rows()).toEqual(['t-descriptors']);
  expect(document.querySelector('[data-testid=archived-focus]')?.textContent).toContain(store.projects.find(p => p.id === focus)!.name);
  document.querySelector<HTMLButtonElement>('[data-testid=archived-all]')!.click();
  await settle();
  expect(rows()).toEqual(['t-descriptors', 't-parser']);
  expect(document.querySelector('[data-testid=archived-focus]')).toBeNull();
  // The focused project removed while the archive is open: the list falls back to every project, never an empty
  // list with no All projects to leave it.
  archivedFocus.store = store;
  archivedFocus.projectId = focus;
  await settle();
  expect(rows()).toEqual(['t-descriptors']);
  await store.removeProject(focus as never);
  await settle();
  expect(store.projects.some(p => p.id === focus)).toBe(false);
  expect(document.querySelector('[data-testid=archived-focus]')).toBeNull();
  expect(rows()).toContain('t-parser');
});

test('a thread a plugin marked done names the plugin and when', async () => {
  const store = new Store(), client = new FakeClient({ delayMs: 0, pluginArchiveDemo: true });
  store.attach(client); await store.connect();
  cleanups.push(() => { store.detach(); client.close(); });
  running = mount(ArchivedThreads, { target: document.body, props: { store, eager: true } });
  await settle();
  const reason = document.querySelector<HTMLElement>('[data-thread-id="t-trace"] [data-testid=archive-plugin-reason]')!;
  expect(reason.textContent).toContain('Archived by plugin Bureau');
  expect(reason.title).toBe('bureau');
  expect(reason.querySelector('time')?.getAttribute('datetime')).toBe(new Date((await client.call('threads.get', { threadId: 't-trace' })).archiveReason!.archivedAt).toISOString());
  expect(document.querySelector('[data-thread-id="t-trace"] [data-testid=done-expires]')).not.toBeNull();
});
