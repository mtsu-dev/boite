import type { ThreadSummary } from '@boite/contracts';
import { afterEach, expect, test, vi } from 'vitest';
import { createRawSnippet, flushSync, mount, unmount } from 'svelte';
import { FakeClient } from '../lib/fake-client';
import { Store } from '../lib/store.svelte';
import { hostMark } from '../lib/machine-host';
import ThreadCard from './ThreadCard.svelte';

let mounted: ReturnType<typeof mount> | undefined;
let client: FakeClient;
let store: Store;
const settle = async () => { for (let i = 0; i < 20; i++) { await Promise.resolve(); flushSync(); } };
afterEach(async () => {
  if (mounted) await unmount(mounted);
  mounted = undefined;
  store?.detach(); client?.close();
  window.dispatchEvent(new Event('pagehide'));
  vi.useRealTimers();
  vi.restoreAllMocks(); document.body.innerHTML = ''; localStorage.clear();
});

/** `store` connected to a fresh fake `client`; the afterEach detaches and closes them. */
async function connect(): Promise<void> {
  client = new FakeClient({ delayMs: 0 });
  store = new Store();
  store.attach(client);
  await store.connect();
}

/** Connects, then picks the first thread with a branch and its project. */
async function connectBranched() {
  await connect();
  const thread = store.threads.find(thread => thread.branch)!;
  const project = store.projects.find(project => project.id === thread.projectId)!;
  return { thread, project };
}

/** Mounts the card of `thread` on the local machine, then settles. */
async function show(project: Store['projects'][number], thread: ThreadSummary, extra: { showProject?: boolean } = {}): Promise<void> {
  mounted = mount(ThreadCard, { target: document.body, props: { machine: { id: 'local', label: 'Local', store }, project, thread, now: Date.now(), ...extra } });
  await settle();
}

test('a thread row names the work it is waiting on without a hover', async () => {
  const { project, thread } = await connectBranched();
  store.pendingQuestions = [];
  const since = Date.now() - 60_000;
  await show(project, { ...thread, status: 'idle', openQuestions: 0, backgroundWait: { state: 'waiting', for: 'release build', since, until: null } });
  const wait = document.querySelector('[data-testid=thread-row] [data-testid=thread-wait]');
  expect(wait?.textContent).toContain('Waiting on release build');
  expect(wait?.querySelector('[data-testid=agent-elapsed]')?.textContent).toMatch(/^1m \d\ds$/);
  expect(document.querySelector('[data-testid=thread-elapsed]')).toBeNull();
});

test('a parent row shows its delegated work and time since the first child started', async () => {
  const { project, thread } = await connectBranched();
  store.pendingQuestions = [];
  const parent = { ...thread, status: 'idle' as const, openQuestions: 0, backgroundWork: null, backgroundWait: null };
  store.threads = [...store.threads, { ...parent, id: 'active-child', parentThreadId: parent.id, status: 'running', runningSince: Date.now() - 60_000 }];
  await show(project, parent);
  const wait = document.querySelector('[data-testid=thread-row] [data-testid=thread-wait]');
  expect(wait?.textContent).toContain('1 subagent');
  expect(wait?.querySelector('[data-testid=agent-elapsed]')?.textContent).toMatch(/^1m \d\ds$/);
  expect(document.querySelector('[data-testid=thread-elapsed]')).toBeNull();
});

test('child question links stay out of sidebar thread rows', async () => {
  await connect();
  const thread = store.threads.find(row => !row.parentThreadId && row.projectId)!;
  const project = store.projects.find(row => row.id === thread.projectId)!;
  thread.subagentQuestions = [{ threadId: 'child', title: 'Check the parser' }];
  vi.spyOn(client, 'call').mockResolvedValue(null as never);
  mounted = mount(ThreadCard, { target: document.body, props: { machine: { id: 'remote', label: 'Remote', store }, project, thread, now: Date.now() } });
  await settle();
  expect(document.querySelector('[data-testid=subagent-question-alert]')).toBeNull();
});

test('cards keep discovering after a merge, pause while hidden, and retain the last answer on errors', async () => {
  await connect();
  const thread = store.threads.find(thread => thread.branch)!;
  thread.branch = 'reused-topic'; thread.status = 'idle';
  const project = store.projects.find(project => project.id === thread.projectId)!;
  const pr = { number: 181, url: 'https://github.com/example/repo/pull/181', state: 'OPEN' as 'OPEN' | 'MERGED' };
  const next = { ...pr, number: 182, url: 'https://github.com/example/repo/pull/182' };
  let answer: typeof pr | null = null;
  const call = vi.spyOn(client, 'call').mockImplementation(async () => answer);
  vi.useFakeTimers();
  await show(project, thread);
  expect(call).toHaveBeenCalledTimes(1);
  expect(document.querySelector('[data-testid=thread-pr]')).toBeNull();
  answer = pr;
  await vi.advanceTimersByTimeAsync(60_000); await settle();
  expect(call).toHaveBeenCalledTimes(2);
  expect(document.querySelector('[data-testid=thread-pr]')?.textContent).toContain('#181');
  call.mockRejectedValueOnce(new Error('offline'));
  await vi.advanceTimersByTimeAsync(60_000); await settle();
  expect(document.querySelector('[data-testid=thread-pr]')?.textContent).toContain('#181');
  expect(store.error).toBeNull();
  thread.status = 'running'; await settle();
  const working = call.mock.calls.length;
  await vi.advanceTimersByTimeAsync(15_000); await settle();
  expect(call).toHaveBeenCalledTimes(working + 1);
  const visibility = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  document.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(120_000); await settle();
  expect(call).toHaveBeenCalledTimes(working + 1);
  answer = { ...pr, state: 'MERGED' };
  visibility.mockReturnValue(false); document.dispatchEvent(new Event('visibilitychange')); await settle();
  expect(document.querySelector('[data-testid=thread-pr]')?.getAttribute('data-state')).toBe('MERGED');
  // A new PR on the same branch appears without another turn or a remount.
  thread.status = 'idle'; await settle();
  answer = next;
  await vi.advanceTimersByTimeAsync(60_000); await settle();
  expect(document.querySelector('[data-testid=thread-pr]')?.textContent).toContain('#182');
  const { contextMenu } = await import('../lib/context-menu.svelte');
  document.querySelector('[data-testid=thread-row]')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 4, clientY: 4 }));
  contextMenu.current!.onpick('pr'); contextMenu.close(); await settle();
  expect(call).toHaveBeenLastCalledWith('threads.pullRequest', { threadId: thread.id, refresh: true });
  await unmount(mounted!); mounted = undefined;
  const ended = call.mock.calls.length;
  await vi.advanceTimersByTimeAsync(120_000); await settle();
  expect(call).toHaveBeenCalledTimes(ended);
  mounted = mount(ThreadCard, { target: document.body, props: { machine: { id: 'local', label: 'Local', store }, project, thread, now: Date.now() } });
  flushSync();
  expect(document.querySelector('[data-testid=thread-pr]')?.textContent).toContain('#182');
  await settle();
  expect(call).toHaveBeenCalledTimes(ended + 1);
});

test('cards on screen share one round a minute, none while the page is hidden, and one on return', async () => {
  await connect();
  const source = store.threads.find(thread => thread.branch)!;
  const project = store.projects.find(project => project.id === source.projectId)!;
  const call = vi.spyOn(client, 'call').mockResolvedValue(null);
  const lookups = () => call.mock.calls.filter(([method]) => method === 'threads.pullRequest').length;
  vi.useFakeTimers();
  const card = (index: number) => mount(ThreadCard, { target: document.body,
    props: { machine: { id: 'local', label: 'Local', store }, project, thread: { ...source, id: `t-card-${index}`, branch: `topic-${index}`, status: 'idle' as const }, now: Date.now(), showProject: false } });
  const cards = Array.from({ length: 10 }, (_, index) => card(index));
  try {
    await settle();
    expect(lookups()).toBe(10);
    await vi.advanceTimersByTimeAsync(1_000);
    cards.push(card(10)); await settle();
    expect(lookups()).toBe(11);
    call.mockClear();
    // The later card still takes part in the next shared round.
    await vi.advanceTimersByTimeAsync(59_000); await settle();
    expect(lookups()).toBe(11);
    await vi.advanceTimersByTimeAsync(60_000); await settle();
    expect(lookups()).toBe(22);
    call.mockClear();
    const visibility = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(120_000); await settle();
    expect(lookups()).toBe(0);
    visibility.mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange')); await settle();
    expect(lookups()).toBe(11);
    // Back again before a round is due: nothing more until it is.
    visibility.mockReturnValue(true); document.dispatchEvent(new Event('visibilitychange'));
    visibility.mockReturnValue(false); document.dispatchEvent(new Event('visibilitychange')); await settle();
    expect(lookups()).toBe(11);
    await vi.advanceTimersByTimeAsync(60_000); await settle();
    expect(lookups()).toBe(22);
  } finally {
    for (const card of cards) await unmount(card);
  }
});

test('moving a thread clears its PR and ignores the previous checkout lookup', async () => {
  const { thread, project } = await connectBranched();
  const original = { branch: thread.branch, cwd: thread.cwd };
  const previous = { number: 180, url: 'https://github.com/example/repo/pull/180', state: 'OPEN' as const };
  let answer!: (value: typeof previous) => void;
  const pending = new Promise<typeof previous>(resolve => { answer = resolve; });
  const call = vi.spyOn(client, 'call').mockResolvedValue(null).mockResolvedValueOnce(previous).mockReturnValueOnce(pending);
  await show(project, thread);
  expect(call).toHaveBeenCalledWith('threads.pullRequest', { threadId: thread.id });
  expect(document.querySelector('[data-testid=thread-pr]')?.textContent).toContain('#180');
  thread.branch = 'new-topic';
  thread.cwd = '/new-worktree';
  await settle();
  expect(document.querySelector('[data-testid=thread-pr]')).toBeNull();
  expect(call).toHaveBeenCalledTimes(2);
  Object.assign(thread, original);
  await settle();
  expect(call).toHaveBeenCalledTimes(3);
  thread.branch = null;
  thread.cwd = project.path;
  await settle();
  answer(previous); await settle();
  expect(document.querySelector('[data-testid=thread-pr]')).toBeNull();
});

test('a reconnect reuses a fresh PR and keeps it on screen during a stale lookup', async () => {
  const { thread, project } = await connectBranched();
  thread.status = 'idle';
  vi.useFakeTimers();
  const held = { number: 181, url: 'https://github.com/example/repo/pull/181', state: 'OPEN' as const };
  const pending = new Promise<typeof held>(() => undefined);
  const call = vi.spyOn(client, 'call').mockResolvedValueOnce(held).mockReturnValueOnce(pending);
  await show(project, thread);
  expect(document.querySelector('[data-testid=thread-pr]')?.textContent).toContain('#181');
  store.connection = 'connecting';
  await settle();
  expect(document.querySelector('[data-testid=thread-pr]')?.textContent).toContain('#181');
  store.connection = 'ready';
  await settle();
  expect(call).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(60_000); await settle();
  expect(call).toHaveBeenCalledTimes(2);
  expect(document.querySelector('[data-testid=thread-pr]')?.textContent).toContain('#181');
});

test('remounting the sidebar reuses both PR matches and misses', async () => {
  const { thread, project } = await connectBranched();
  const missing = { ...thread, id: 'no-pr', branch: 'no-pr' };
  const pr = { number: 183, url: 'https://github.com/example/repo/pull/183', state: 'OPEN' as const };
  const call = vi.spyOn(client, 'call').mockImplementation(async (_method, params) =>
    params && 'threadId' in params && params.threadId === thread.id ? pr : null);
  for (let visit = 0; visit < 3; visit++) {
    await show(project, thread);
    expect(document.querySelector('[data-testid=thread-pr]')?.textContent).toContain('#183');
    await unmount(mounted!);
    await show(project, missing);
    expect(document.querySelector('[data-testid=thread-pr]')).toBeNull();
    await unmount(mounted!); mounted = undefined;
  }
  expect(call).toHaveBeenCalledTimes(2);
});

test('incognito PR lookups and link events leave no entry on disk', async () => {
  const { thread, project } = await connectBranched();
  const hidden = { ...thread, id: 'private-pr', incognito: true as const };
  const pr = { number: 184, url: 'https://github.com/example/repo/pull/184', state: 'OPEN' as const };
  vi.spyOn(client, 'call').mockResolvedValue(pr);
  const listeners = vi.spyOn(client, 'on');
  await show(project, hidden);
  expect(document.querySelector('[data-testid=thread-pr]')?.textContent).toContain('#184');
  const receive = listeners.mock.calls.find(([event]) => event === 'threads.pullRequestsChanged')![1] as
    (event: { threadId: string; pullRequests: NonNullable<ThreadSummary['pullRequest']>[] }) => void;
  receive({ threadId: hidden.id, pullRequests: [{ ...pr, state: 'MERGED' }] });
  await settle();
  expect(document.querySelector('[data-testid=thread-pr]')?.getAttribute('data-state')).toBe('MERGED');
  window.dispatchEvent(new Event('pagehide'));
  expect(Object.keys(localStorage).filter(key => key.startsWith('boite.pull-requests.v1'))).toEqual([]);
});

test('a turn left running on a machine that went away loses its work mark until the machine is back', async () => {
  await connect();
  vi.spyOn(client, 'call').mockResolvedValue(null);
  const thread = store.threads.find(thread => thread.status === 'idle')!;
  thread.status = 'running';
  thread.runningSince = Date.now() - 3 * 3_600_000;
  const project = store.projects.find(project => project.id === thread.projectId)!;
  mounted = mount(ThreadCard, { target: document.body, props: { machine: { id: 'laptop', label: 'Laptop', store }, project, thread, now: Date.now() } });
  await settle();
  const state = () => document.querySelector<HTMLElement>('[data-testid=thread-state]');
  expect(state()?.dataset.state).toBe('working');
  expect(state()?.querySelector('.work-ring')).not.toBeNull();
  store.connection = 'connecting'; await settle();
  expect(state()?.dataset.state).toBe('unreachable');
  expect(state()?.querySelector('.work-ring')).toBeNull();
  expect(state()?.getAttribute('title')).toBe('Machine offline. Last known state: Working');
  // "Offline" said once, by the row's own state: no chip repeats it on a place line.
  expect(state()?.querySelector('.word')?.textContent).toBe('Offline');
  expect(document.querySelector('[data-testid=thread-offline]')).toBeNull();
  store.connection = 'ready'; await settle();
  expect(state()?.dataset.state).toBe('working');
});

test('a question or a permission that arrives mid-run turns a working row into Needs you, and an archived one shows no state', async () => {
  await connect();
  vi.spyOn(client, 'call').mockResolvedValue(null);
  const thread = store.threads.find(thread => thread.status === 'idle' && !thread.parentThreadId && thread.projectId)!;
  thread.status = 'running'; thread.runningSince = Date.now() - 60_000; thread.openQuestions = 0;
  const project = store.projects.find(project => project.id === thread.projectId)!;
  await show(project, thread);
  const state = () => document.querySelector<HTMLElement>('[data-testid=thread-state]');
  expect(state()?.dataset.state).toBe('working');
  // The summary has not counted the ask yet: the machine's own request decides.
  store.pendingQuestions = [{ id: 'q-mid', threadId: thread.id, turnId: 'turn', text: 'Which file?', options: [], allowText: true, multiple: false, async: true } as never];
  await settle();
  expect(state()?.dataset.state).toBe('waiting');
  expect(state()?.querySelector('.dot')).not.toBeNull();
  store.pendingQuestions = [];
  store.pendingPermissions = [{ id: 'p-mid', threadId: thread.id, toolName: 'Bash', input: {} } as never];
  await settle();
  expect(state()?.dataset.state).toBe('waiting');
  store.pendingPermissions = [];
  await settle();
  expect(state()?.dataset.state).toBe('working');
  thread.archived = true; await settle();
  expect(state()).toBeNull();
});

test('a branchless conversation discovers its linked PR and a merge event updates the badge immediately', async () => {
  await connect();
  const thread = store.threads.find(thread => thread.status === 'idle')!;
  thread.branch = null;
  const project = store.projects.find(project => project.id === thread.projectId)!;
  const url = 'https://github.com/example/repo/pull/77';
  const list = await client.call('threads.linkPullRequest', { threadId: thread.id, url });
  const listeners = vi.spyOn(client, 'on');
  await show(project, thread);
  expect(document.querySelector('[data-testid=thread-pr]')?.textContent).toContain('#77');
  const receive = listeners.mock.calls.find(([event]) => event === 'threads.pullRequestsChanged')?.[1] as (event: { threadId: string; pullRequests: typeof list }) => void;
  receive({ threadId: thread.id, pullRequests: [{ ...list[0]!, state: 'MERGED' }] });
  await settle();
  const badge = document.querySelector('[data-testid=thread-pr]');
  expect(badge?.getAttribute('data-state')).toBe('MERGED');
  expect(badge?.getAttribute('aria-label')).toContain('merged');
});

test('empty link event must fence the lookup it replaces', async () => {
  const { thread, project } = await connectBranched();
  const old = {number: 9871, url: 'https://github.com/example/repo/pull/9871', state: 'OPEN' as const};
  let release!: (value: typeof old) => void;
  const pending = new Promise<typeof old>(resolve => { release = resolve; });
  vi.spyOn(client, 'call').mockReturnValueOnce(pending).mockResolvedValue(null);
  const listeners = vi.spyOn(client, 'on');
  await show(project, thread, { showProject: false });
  const receive = listeners.mock.calls.find(([name]) => name === 'threads.pullRequestsChanged')![1] as (event: { threadId: string; pullRequests: typeof old[] }) => void;
  receive({threadId: thread.id, pullRequests: []});
  await settle();
  release(old); await settle();
  expect(document.querySelector('[data-testid=thread-pr]')).toBeNull();
});

test('terminal link event must allow newer OPEN discovery in same response', async () => {
  const { thread, project } = await connectBranched();
  vi.spyOn(Date, 'now').mockReturnValue(Date.now());
  const old = {number: 9872, url: 'https://github.com/example/repo/pull/9872', state: 'CLOSED' as const};
  const opened = {...old, number: 9873, url: 'https://github.com/example/repo/pull/9873', state: 'OPEN' as const};
  let release!: (value: typeof opened) => void;
  const pending = new Promise<typeof opened>(resolve => { release = resolve; });
  vi.spyOn(client, 'call').mockReturnValue(pending);
  const listeners = vi.spyOn(client, 'on');
  await show(project, thread, { showProject: false });
  const receive = listeners.mock.calls.find(([name]) => name === 'threads.pullRequestsChanged')![1] as (event: { threadId: string; pullRequests: typeof old[] }) => void;
  receive({threadId: thread.id, pullRequests: [old]});
  window.dispatchEvent(new Event('pagehide'));
  release(opened); await settle();
  expect(document.querySelector('[data-testid=thread-pr]')?.textContent).toContain('#9873');
  // A poll's identical linked-list event must not replace automatic discovery.
  receive({ threadId: thread.id, pullRequests: [old] }); await settle();
  expect(document.querySelector('[data-testid=thread-pr]')?.textContent).toContain('#9873');
  window.dispatchEvent(new Event('pagehide'));
  const key = Object.keys(localStorage).find(key => key.startsWith('boite.pull-requests.v1:'))!;
  expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject({ pullRequest: opened });
});

test('removing one of two links must fence its pending answer', async () => {
  const { thread, project } = await connectBranched();
  const old = {number: 9981, url: 'https://github.com/example/repo/pull/9981', state: 'OPEN' as const};
  const other = {...old, number: 9982, url: 'https://github.com/example/repo/pull/9982', state: 'MERGED' as const};
  let release!: (value: typeof old) => void;
  const pending = new Promise<typeof old>(resolve => { release = resolve; });
  vi.spyOn(client, 'call').mockReturnValueOnce(pending).mockResolvedValue(other);
  const listeners = vi.spyOn(client, 'on');
  await show(project, thread, { showProject: false });
  const receive = listeners.mock.calls.find(([name]) => name === 'threads.pullRequestsChanged')![1] as (event: { threadId: string; pullRequests: NonNullable<ThreadSummary['pullRequest']>[] }) => void;
  receive({threadId: thread.id, pullRequests: [other, old]});
  receive({threadId: thread.id, pullRequests: [other]});
  await settle();
  release(old); await settle();
  expect(document.querySelector('[data-testid=thread-pr]')?.textContent).toContain('#9982');
});

test('merge event compares GitHub URLs without case sensitivity', async () => {
  const { thread, project } = await connectBranched();
  const old = {number: 9983, url: 'https://github.com/example/repo/pull/9983', state: 'OPEN' as const};
  let release!: (value: typeof old) => void;
  const pending = new Promise<typeof old>(resolve => { release = resolve; });
  vi.spyOn(client, 'call').mockReturnValue(pending);
  const listeners = vi.spyOn(client, 'on');
  await show(project, thread, { showProject: false });
  const receive = listeners.mock.calls.find(([name]) => name === 'threads.pullRequestsChanged')![1] as (event: { threadId: string; pullRequests: NonNullable<ThreadSummary['pullRequest']>[] }) => void;
  receive({threadId: thread.id, pullRequests: [{...old, url: 'https://github.com/Example/Repo/pull/9983', state: 'MERGED'}]});
  release(old); await settle();
  expect(document.querySelector('[data-testid=thread-pr]')?.getAttribute('data-state')).toBe('MERGED');
});

test('a card unmounted with its rename open still writes the title typed so far', async () => {
  await connect();
  const thread = store.threads.find(row => !row.archived && row.projectId)!;
  const project = store.projects.find(row => row.id === thread.projectId)!;
  vi.spyOn(client, 'call').mockResolvedValue(null as never);
  const rename = vi.spyOn(store, 'rename').mockResolvedValue();
  await show(project, thread);
  document.querySelector('[data-testid=thread-row]')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  flushSync();
  const input = document.querySelector<HTMLInputElement>('[data-testid=thread-rename]')!;
  input.value = 'Typed before it left';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
  await unmount(mounted!);
  mounted = undefined;
  await settle();
  expect(rename.mock.calls).toEqual([[thread.id, 'Typed before it left']]);
});

test('a list row ends its title line with its mark, then its one time, the way a phone row does', async () => {
  await connect();
  vi.spyOn(client, 'call').mockResolvedValue(null);
  const thread = store.threads.find(thread => thread.status === 'idle' && !thread.parentThreadId && thread.projectId)!;
  thread.openQuestions = 0; thread.lastUserMessageAt = Date.now() - 2 * 3_600_000;
  const project = store.projects.find(project => project.id === thread.projectId)!;
  await show(project, thread);
  const headline = () => document.querySelector<HTMLElement>('[data-testid=thread-row] .headline')!;
  // At rest, a quiet row still says when it last moved.
  expect(headline().querySelector('time.at')?.textContent).toBe('2h');
  expect(headline().querySelectorAll('time')).toHaveLength(1);
  store.pendingQuestions = [{ id: 'q-time', threadId: thread.id, turnId: 'turn', text: 'Which file?', options: [], allowText: true, multiple: false, async: true } as never];
  await settle();
  // A mark comes first, the same time after it: one time per row in one place.
  const state = headline().querySelector('[data-testid=thread-state]')!;
  expect(state.getAttribute('data-state')).toBe('waiting');
  expect(state.nextElementSibling?.matches('time.at')).toBe(true);
  expect(headline().querySelectorAll('time')).toHaveLength(1);
  // A turn that ended unread says "Done" in words, then the same time.
  store.pendingQuestions = []; thread.unread = true;
  await settle();
  const done = headline().querySelector('[data-testid=thread-state]')!;
  expect([done.getAttribute('data-state'), done.textContent?.trim()]).toEqual(['done', 'Done']);
  expect(done.nextElementSibling?.matches('time.at')).toBe(true);
  expect(headline().querySelectorAll('time')).toHaveLength(1);
});

test('a thread a mochi started keeps its provider before the title and names the mochi below it', async () => {
  await connect();
  const started = store.threads.find(row => row.id === 't-trace')!;
  const followed = store.threads.find(row => row.id === 't-descriptors')!;
  const project = store.projects.find(row => row.id === started.projectId)!;
  const { agentDirectory } = await import('../lib/agent-directory.svelte');
  const watch = (thread: ThreadSummary, origin: 'started' | 'followed') => ({ agentId: 'a-nova', threadId: thread.id, title: thread.title, projectId: thread.projectId, origin, since: 0, state: 'idle' as const, stalledSince: null, pullRequest: null });
  agentDirectory(store).snapshot = {
    profiles: [{ id: 'a-nova', name: 'Nova', avatar: '', status: 'active' }], sessions: [], watches: [watch(started, 'started'), watch(followed, 'followed')]
  } as never;
  const props = { machine: { id: 'local', label: 'Local', store }, project, now: Date.now(), classic: true };
  mounted = mount(ThreadCard, { target: document.body, props: { ...props, thread: started } });
  await settle();
  expect(document.querySelector('.headline [data-testid=thread-provider] + .title')).not.toBeNull();
  expect(document.querySelector('.headline [data-testid=thread-bot]')).toBeNull();
  const bot = document.querySelector('[data-testid=thread-where] [data-testid=thread-bot]');
  expect(bot?.getAttribute('title')).toBe('Nova');
  expect(bot?.textContent).toContain('Nova');
  await unmount(mounted);
  await client.call('threads.subscribe', { threadId: started.id });
  const detail = createRawSnippet(() => ({ render: () => '<span>Activity detail</span>' }));
  mounted = mount(ThreadCard, { target: document.body, props: { ...props, classic: false, detail, thread: started } });
  await settle();
  const row = document.querySelector<HTMLButtonElement>('[data-testid=thread-row]')!;
  row.focus();
  const url = 'https://github.com/example/boite/pull/482';
  await client.call('threads.linkPullRequest', { threadId: started.id, url });
  await settle();
  expect(document.activeElement).toBe(row);
  const activityMeta = document.querySelector('[data-testid=thread-where]');
  expect(activityMeta?.querySelector('[data-testid=thread-bot]')?.textContent).toContain('Nova');
  const pr = activityMeta?.querySelector('a[data-testid=thread-pr]');
  expect(pr?.getAttribute('href')).toBe(url);
  expect(pr?.closest('button')).toBeNull();
  await unmount(mounted);
  mounted = mount(ThreadCard, { target: document.body, props: { ...props, thread: followed } });
  await settle();
  expect(document.querySelector('[data-testid=thread-bot]')).toBeNull();
  agentDirectory(store).snapshot = null;
});

test('an unreachable machine is said once: by the card head above, by its place, or by one chip on the place line', async () => {
  await connect();
  vi.spyOn(client, 'call').mockResolvedValue(null);
  const thread = store.threads.find(thread => thread.status === 'idle' && !thread.parentThreadId && thread.projectId)!;
  const project = store.projects.find(project => project.id === thread.projectId)!;
  store.connection = 'closed';
  const machine = { id: 'laptop', label: 'Laptop', store };
  const showRow = async (props: Record<string, unknown>) => {
    if (mounted) await unmount(mounted);
    document.body.innerHTML = '';
    mounted = mount(ThreadCard, { target: document.body, props: { machine, project, thread, now: Date.now(), ...props } });
    await settle();
    const row = document.querySelector<HTMLElement>('[data-testid=thread-row]')!;
    return {
      muted: row.closest('.offline') !== null,
      chips: document.querySelectorAll('[data-testid=thread-offline]').length,
      places: document.querySelectorAll('[data-testid=machine-away]').length,
      title: row.querySelector('.headline')?.textContent ?? ''
    };
  };
  // Under a card head that names the machine and says Offline: the row only mutes its title.
  expect(await showRow({ placed: true })).toMatchObject({ muted: true, chips: 0, places: 0 });
  // A row with no head above (a flat list): one chip, on the place line, never beside the title.
  const flat = await showRow({});
  expect(flat).toMatchObject({ muted: true, chips: 1 });
  expect(flat.title).not.toContain('Offline');
  expect(document.querySelector('[data-testid=thread-where] [data-testid=thread-offline]')).not.toBeNull();
  // Recent names the machine as a place, with its state: no second chip.
  const host = hostMark(machine.label, 'offline');
  expect(await showRow({ where: { project: project.name, host, text: `${project.name} ${host.text}` } })).toMatchObject({ chips: 0, places: 1 });
});
