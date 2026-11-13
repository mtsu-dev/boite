import type { ThreadSummary } from '@boite/contracts';
import { afterEach, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
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
  vi.useRealTimers();
  vi.restoreAllMocks(); document.body.innerHTML = ''; localStorage.clear();
});

test('child question links stay out of sidebar thread rows', async () => {
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  const thread = store.threads.find(row => !row.parentThreadId && row.projectId)!;
  const project = store.projects.find(row => row.id === thread.projectId)!;
  thread.subagentQuestions = [{ threadId: 'child', title: 'Check the parser' }];
  vi.spyOn(client, 'call').mockResolvedValue(null as never);
  mounted = mount(ThreadCard, { target: document.body, props: { machine: { id: 'remote', label: 'Remote', store }, project, thread, now: Date.now() } });
  await settle();
  expect(document.querySelector('[data-testid=subagent-question-alert]')).toBeNull();
});

test('cards keep discovering after a merge, pause while hidden, and retain the last answer on errors', async () => {
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  const thread = store.threads.find(thread => thread.branch)!;
  thread.branch = 'reused-topic'; thread.status = 'idle';
  const project = store.projects.find(project => project.id === thread.projectId)!;
  const pr = { number: 181, url: 'https://github.com/example/repo/pull/181', state: 'OPEN' as 'OPEN' | 'MERGED' };
  const next = { ...pr, number: 182, url: 'https://github.com/example/repo/pull/182' };
  let answer: typeof pr | null = null;
  const call = vi.spyOn(client, 'call').mockImplementation(async () => answer);
  vi.useFakeTimers();
  mounted = mount(ThreadCard, { target: document.body, props: { machine: { id: 'local', label: 'Local', store }, project, thread, now: Date.now() } });
  await settle();
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
  await unmount(mounted); mounted = undefined;
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
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  const source = store.threads.find(thread => thread.branch)!;
  const project = store.projects.find(project => project.id === source.projectId)!;
  const call = vi.spyOn(client, 'call').mockResolvedValue(null);
  const lookups = () => call.mock.calls.filter(([method]) => method === 'threads.pullRequest').length;
  vi.useFakeTimers();
  const cards = Array.from({ length: 10 }, (_, index) => mount(ThreadCard, { target: document.body,
    props: { machine: { id: 'local', label: 'Local', store }, project, thread: { ...source, id: `t-card-${index}`, branch: `topic-${index}`, status: 'idle' as const }, now: Date.now(), showProject: false } }));
  try {
    await settle();
    expect(lookups()).toBe(10);
    call.mockClear();
    await vi.advanceTimersByTimeAsync(120_000); await settle();
    expect(lookups()).toBe(20);
    call.mockClear();
    const visibility = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(120_000); await settle();
    expect(lookups()).toBe(0);
    visibility.mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange')); await settle();
    expect(lookups()).toBe(10);
    // Back again before a round is due: nothing more until it is.
    visibility.mockReturnValue(true); document.dispatchEvent(new Event('visibilitychange'));
    visibility.mockReturnValue(false); document.dispatchEvent(new Event('visibilitychange')); await settle();
    expect(lookups()).toBe(10);
    await vi.advanceTimersByTimeAsync(60_000); await settle();
    expect(lookups()).toBe(20);
  } finally {
    for (const card of cards) await unmount(card);
  }
});

test('moving a thread clears its PR and ignores the previous checkout lookup', async () => {
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  const thread = store.threads.find(thread => thread.branch)!;
  const project = store.projects.find(project => project.id === thread.projectId)!;
  const previous = { number: 180, url: 'https://github.com/example/repo/pull/180', state: 'OPEN' as const };
  let answer!: (value: typeof previous) => void;
  const pending = new Promise<typeof previous>(resolve => { answer = resolve; });
  const call = vi.spyOn(client, 'call').mockResolvedValue(null).mockResolvedValueOnce(previous).mockReturnValueOnce(pending);
  mounted = mount(ThreadCard, { target: document.body, props: { machine: { id: 'local', label: 'Local', store }, project, thread, now: Date.now() } });
  await settle();
  expect(call).toHaveBeenCalledWith('threads.pullRequest', { threadId: thread.id });
  expect(document.querySelector('[data-testid=thread-pr]')?.textContent).toContain('#180');
  thread.branch = 'new-topic';
  thread.cwd = '/new-worktree';
  await settle();
  expect(document.querySelector('[data-testid=thread-pr]')).toBeNull();
  expect(call).toHaveBeenCalledTimes(2);
  thread.branch = null;
  thread.cwd = project.path;
  await settle();
  answer(previous); await settle();
  expect(document.querySelector('[data-testid=thread-pr]')).toBeNull();
});

test('a reconnect keeps the PR mark on screen while the core is asked again', async () => {
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  const thread = store.threads.find(thread => thread.branch)!;
  const project = store.projects.find(project => project.id === thread.projectId)!;
  const held = { number: 181, url: 'https://github.com/example/repo/pull/181', state: 'OPEN' as const };
  const pending = new Promise<typeof held>(() => undefined);
  const call = vi.spyOn(client, 'call').mockResolvedValueOnce(held).mockReturnValueOnce(pending);
  mounted = mount(ThreadCard, { target: document.body, props: { machine: { id: 'local', label: 'Local', store }, project, thread, now: Date.now() } });
  await settle();
  expect(document.querySelector('[data-testid=thread-pr]')?.textContent).toContain('#181');
  store.connection = 'connecting';
  await settle();
  expect(document.querySelector('[data-testid=thread-pr]')?.textContent).toContain('#181');
  store.connection = 'ready';
  await settle();
  // The second lookup is out and unanswered: the mark it will confirm never left.
  expect(call).toHaveBeenCalledTimes(2);
  expect(document.querySelector('[data-testid=thread-pr]')?.textContent).toContain('#181');
});

test('a turn left running on a machine that went away loses its work mark until the machine is back', async () => {
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
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
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  vi.spyOn(client, 'call').mockResolvedValue(null);
  const thread = store.threads.find(thread => thread.status === 'idle' && !thread.parentThreadId && thread.projectId)!;
  thread.status = 'running'; thread.runningSince = Date.now() - 60_000; thread.openQuestions = 0;
  const project = store.projects.find(project => project.id === thread.projectId)!;
  mounted = mount(ThreadCard, { target: document.body, props: { machine: { id: 'local', label: 'Local', store }, project, thread, now: Date.now() } });
  await settle();
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
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  const thread = store.threads.find(thread => thread.status === 'idle')!;
  thread.branch = null;
  const project = store.projects.find(project => project.id === thread.projectId)!;
  const url = 'https://github.com/example/repo/pull/77';
  const list = await client.call('threads.linkPullRequest', { threadId: thread.id, url });
  const listeners = vi.spyOn(client, 'on');
  mounted = mount(ThreadCard, { target: document.body, props: { machine: { id: 'local', label: 'Local', store }, project, thread, now: Date.now() } });
  await settle();
  expect(document.querySelector('[data-testid=thread-pr]')?.textContent).toContain('#77');
  const receive = listeners.mock.calls.find(([event]) => event === 'threads.pullRequestsChanged')?.[1] as (event: { threadId: string; pullRequests: typeof list }) => void;
  receive({ threadId: thread.id, pullRequests: [{ ...list[0]!, state: 'MERGED' }] });
  await settle();
  const badge = document.querySelector('[data-testid=thread-pr]');
  expect(badge?.getAttribute('data-state')).toBe('MERGED');
  expect(badge?.getAttribute('aria-label')).toContain('merged');
});

test('empty link event must fence the lookup it replaces', async () => {
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  const thread = store.threads.find(thread => thread.branch)!;
  const project = store.projects.find(project => project.id === thread.projectId)!;
  const old = {number: 9871, url: 'https://github.com/example/repo/pull/9871', state: 'OPEN' as const};
  let release!: (value: typeof old) => void;
  const pending = new Promise<typeof old>(resolve => { release = resolve; });
  vi.spyOn(client, 'call').mockReturnValueOnce(pending).mockResolvedValue(null);
  const listeners = vi.spyOn(client, 'on');
  mounted = mount(ThreadCard, {target: document.body, props: {machine: {id: 'local', label: 'Local', store}, project, thread, now: Date.now(), showProject: false}});
  await settle();
  const receive = listeners.mock.calls.find(([name]) => name === 'threads.pullRequestsChanged')![1] as (event: { threadId: string; pullRequests: typeof old[] }) => void;
  receive({threadId: thread.id, pullRequests: []});
  await settle();
  release(old); await settle();
  expect(document.querySelector('[data-testid=thread-pr]')).toBeNull();
});

test('terminal link event must allow newer OPEN discovery in same response', async () => {
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  const thread = store.threads.find(thread => thread.branch)!;
  const project = store.projects.find(project => project.id === thread.projectId)!;
  const old = {number: 9872, url: 'https://github.com/example/repo/pull/9872', state: 'CLOSED' as const};
  const opened = {...old, number: 9873, url: 'https://github.com/example/repo/pull/9873', state: 'OPEN' as const};
  let release!: (value: typeof opened) => void;
  const pending = new Promise<typeof opened>(resolve => { release = resolve; });
  vi.spyOn(client, 'call').mockReturnValue(pending);
  const listeners = vi.spyOn(client, 'on');
  mounted = mount(ThreadCard, {target: document.body, props: {machine: {id: 'local', label: 'Local', store}, project, thread, now: Date.now(), showProject: false}});
  await settle();
  const receive = listeners.mock.calls.find(([name]) => name === 'threads.pullRequestsChanged')![1] as (event: { threadId: string; pullRequests: typeof old[] }) => void;
  receive({threadId: thread.id, pullRequests: [old]});
  release(opened); await settle();
  expect(document.querySelector('[data-testid=thread-pr]')?.textContent).toContain('#9873');
  // A poll's identical linked-list event must not replace automatic discovery.
  receive({ threadId: thread.id, pullRequests: [old] }); await settle();
  expect(document.querySelector('[data-testid=thread-pr]')?.textContent).toContain('#9873');
});

test('removing one of two links must fence its pending answer', async () => {
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  const thread = store.threads.find(thread => thread.branch)!;
  const project = store.projects.find(project => project.id === thread.projectId)!;
  const old = {number: 9981, url: 'https://github.com/example/repo/pull/9981', state: 'OPEN' as const};
  const other = {...old, number: 9982, url: 'https://github.com/example/repo/pull/9982', state: 'MERGED' as const};
  let release!: (value: typeof old) => void;
  const pending = new Promise<typeof old>(resolve => { release = resolve; });
  vi.spyOn(client, 'call').mockReturnValueOnce(pending).mockResolvedValue(other);
  const listeners = vi.spyOn(client, 'on');
  mounted = mount(ThreadCard, {target: document.body, props: {machine: {id: 'local', label: 'Local', store}, project, thread, now: Date.now(), showProject: false}});
  await settle();
  const receive = listeners.mock.calls.find(([name]) => name === 'threads.pullRequestsChanged')![1] as (event: { threadId: string; pullRequests: NonNullable<ThreadSummary['pullRequest']>[] }) => void;
  receive({threadId: thread.id, pullRequests: [other, old]});
  receive({threadId: thread.id, pullRequests: [other]});
  await settle();
  release(old); await settle();
  expect(document.querySelector('[data-testid=thread-pr]')?.textContent).toContain('#9982');
});

test('merge event compares GitHub URLs without case sensitivity', async () => {
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  const thread = store.threads.find(thread => thread.branch)!;
  const project = store.projects.find(project => project.id === thread.projectId)!;
  const old = {number: 9983, url: 'https://github.com/example/repo/pull/9983', state: 'OPEN' as const};
  let release!: (value: typeof old) => void;
  const pending = new Promise<typeof old>(resolve => { release = resolve; });
  vi.spyOn(client, 'call').mockReturnValue(pending);
  const listeners = vi.spyOn(client, 'on');
  mounted = mount(ThreadCard, {target: document.body, props: {machine: {id: 'local', label: 'Local', store}, project, thread, now: Date.now(), showProject: false}});
  await settle();
  const receive = listeners.mock.calls.find(([name]) => name === 'threads.pullRequestsChanged')![1] as (event: { threadId: string; pullRequests: NonNullable<ThreadSummary['pullRequest']>[] }) => void;
  receive({threadId: thread.id, pullRequests: [{...old, url: 'https://github.com/Example/Repo/pull/9983', state: 'MERGED'}]});
  release(old); await settle();
  expect(document.querySelector('[data-testid=thread-pr]')?.getAttribute('data-state')).toBe('MERGED');
});

test('a card unmounted with its rename open still writes the title typed so far', async () => {
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  const thread = store.threads.find(row => !row.archived && row.projectId)!;
  const project = store.projects.find(row => row.id === thread.projectId)!;
  vi.spyOn(client, 'call').mockResolvedValue(null as never);
  const rename = vi.spyOn(store, 'rename').mockResolvedValue();
  mounted = mount(ThreadCard, { target: document.body, props: { machine: { id: 'local', label: 'Local', store }, project, thread, now: Date.now() } });
  await settle();
  document.querySelector('[data-testid=thread-row]')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  flushSync();
  const input = document.querySelector<HTMLInputElement>('[data-testid=thread-rename]')!;
  input.value = 'Typed before it left';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
  await unmount(mounted);
  mounted = undefined;
  await settle();
  expect(rename.mock.calls).toEqual([[thread.id, 'Typed before it left']]);
});

test('a list row ends its title line with its mark, then its one time, the way a phone row does', async () => {
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  vi.spyOn(client, 'call').mockResolvedValue(null);
  const thread = store.threads.find(thread => thread.status === 'idle' && !thread.parentThreadId && thread.projectId)!;
  thread.openQuestions = 0; thread.lastUserMessageAt = Date.now() - 2 * 3_600_000;
  const project = store.projects.find(project => project.id === thread.projectId)!;
  mounted = mount(ThreadCard, { target: document.body, props: { machine: { id: 'local', label: 'Local', store }, project, thread, now: Date.now() } });
  await settle();
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
});

test('a thread a mochi started shows that mochi\'s face before its title, grey at rest; one it only follows shows none', async () => {
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  const [started, followed] = store.threads.filter(row => !row.parentThreadId && row.projectId);
  const project = store.projects.find(row => row.id === started!.projectId)!;
  const { agentDirectory } = await import('../lib/agent-directory.svelte');
  const watch = (thread: ThreadSummary, origin: 'started' | 'followed') => ({ agentId: 'a-nova', threadId: thread.id, title: thread.title, projectId: thread.projectId, origin, since: 0, state: 'idle' as const, stalledSince: null, pullRequest: null });
  agentDirectory(store).snapshot = {
    profiles: [{ id: 'a-nova', name: 'Nova', avatar: '', status: 'active' }], sessions: [], watches: [watch(started!, 'started'), watch(followed!, 'followed')]
  } as never;
  mounted = mount(ThreadCard, { target: document.body, props: { machine: { id: 'local', label: 'Local', store }, project, thread: started!, now: Date.now() } });
  await settle();
  const face = document.querySelector('[data-testid=thread-bot]');
  expect(face?.getAttribute('title')).toBe('Nova');
  expect(face?.nextElementSibling?.classList.contains('title')).toBe(true);
  await unmount(mounted);
  mounted = mount(ThreadCard, { target: document.body, props: { machine: { id: 'local', label: 'Local', store }, project, thread: followed!, now: Date.now() } });
  await settle();
  expect(document.querySelector('[data-testid=thread-bot]')).toBeNull();
  agentDirectory(store).snapshot = null;
});

test('an unreachable machine is said once: by the card head above, by its place, or by one chip on the place line', async () => {
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  vi.spyOn(client, 'call').mockResolvedValue(null);
  const thread = store.threads.find(thread => thread.status === 'idle' && !thread.parentThreadId && thread.projectId)!;
  const project = store.projects.find(project => project.id === thread.projectId)!;
  store.connection = 'closed';
  const machine = { id: 'laptop', label: 'Laptop', store };
  const show = async (props: Record<string, unknown>) => {
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
  expect(await show({ placed: true })).toMatchObject({ muted: true, chips: 0, places: 0 });
  // A row with no head above (a flat list): one chip, on the place line, never beside the title.
  const flat = await show({});
  expect(flat).toMatchObject({ muted: true, chips: 1 });
  expect(flat.title).not.toContain('Offline');
  expect(document.querySelector('[data-testid=thread-where] [data-testid=thread-offline]')).not.toBeNull();
  // Recent names the machine as a place, with its state: no second chip.
  const host = hostMark(machine.label, 'offline');
  expect(await show({ where: { project: project.name, host, text: `${project.name} ${host.text}` } })).toMatchObject({ chips: 0, places: 1 });
});
