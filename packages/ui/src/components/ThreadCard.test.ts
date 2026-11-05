import type { ThreadSummary } from '@boite/contracts';
import { afterEach, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { FakeClient } from '../lib/fake-client';
import { Store } from '../lib/store.svelte';
import ThreadCard from './ThreadCard.svelte';
import { inbox, storeSources, waitedFor } from '../lib/inbox';
import { shortAgo } from '../lib/thread-state';

let mounted: ReturnType<typeof mount> | undefined;
let client: FakeClient;
let store: Store;
const settle = async () => { for (let i = 0; i < 20; i++) { await Promise.resolve(); flushSync(); } };
/** The card's pull request as its tooltip names it (`#181 open`): the row draws no badge, the open thread's header does. */
const shownPr = () => document.querySelector<HTMLElement>('[data-testid=thread-row]')?.title.split('\n').find(line => /^#\d+ /.test(line)) ?? null;
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
  mounted = mount(ThreadCard, { target: document.body, props: { machine: { id: 'remote', label: 'Remote', store }, project, thread, now: Date.now(), showProject: false } });
  await settle();
  expect(document.querySelector('[data-testid=subagent-question-alert]')).toBeNull();
});

test('a row across projects keeps its first line for the title: time and machine go under it, beside the project', async () => {
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  const thread = store.threads.find(row => !row.parentThreadId && row.projectId)!;
  const project = store.projects.find(row => row.id === thread.projectId)!;
  vi.spyOn(client, 'call').mockResolvedValue(null as never);
  mounted = mount(ThreadCard, { target: document.body, props: { machine: { id: 'lab', label: 'Lab', store }, project, thread, now: Date.now(), showProject: true, showMachine: true } });
  await settle();
  const headline = document.querySelector<HTMLElement>('[data-testid=thread-row] .headline')!;
  // The title line holds the ring and the title alone; the second line, inside the row's button, names the project and
  // the machine and ends on the time.
  expect(headline.querySelector('.when, [data-testid=thread-state], .machine')).toBeNull();
  const facts = document.querySelector<HTMLElement>('[data-testid=thread-row] .facts')!;
  expect(facts.querySelector('[data-testid=thread-trail] .when')).not.toBeNull();
  expect(facts.querySelector('[data-testid=thread-project] > .ui-label')?.textContent).toBe(project.name);
  // The project reads by its logo, not a folder glyph; another machine is named in plain muted text.
  expect(facts.querySelector('[data-testid=thread-project] .tile')).not.toBeNull();
  expect(facts.querySelector('[data-testid=thread-machine]')?.textContent).toBe('Lab');
  // This PC is never named on its own rows.
  await unmount(mounted);
  mounted = mount(ThreadCard, { target: document.body, props: { machine: { id: 'http://localhost:3773', label: 'This PC', store }, project, thread, now: Date.now(), showProject: true, showMachine: true } });
  await settle();
  expect(document.querySelector('[data-testid=thread-machine]')).toBeNull();
  // Under a project's header the row stays one line, its time at the title's end.
  await unmount(mounted);
  mounted = mount(ThreadCard, { target: document.body, props: { machine: { id: 'lab', label: 'Lab', store }, project, thread, now: Date.now(), showProject: false, showMachine: false } });
  await settle();
  expect(document.querySelector('[data-testid=thread-trail]')).toBeNull();
  expect(document.querySelector('[data-testid=thread-row] .headline > .when, [data-testid=thread-row] .headline > [data-testid=thread-state]')).not.toBeNull();
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
  mounted = mount(ThreadCard, { target: document.body, props: { machine: { id: 'local', label: 'Local', store }, project, thread, now: Date.now(), showProject: false } });
  await settle();
  expect(call).toHaveBeenCalledTimes(1);
  expect(shownPr()).toBeNull();
  answer = pr;
  await vi.advanceTimersByTimeAsync(60_000); await settle();
  expect(call).toHaveBeenCalledTimes(2);
  expect(shownPr()).toContain('#181');
  call.mockRejectedValueOnce(new Error('offline'));
  await vi.advanceTimersByTimeAsync(60_000); await settle();
  expect(shownPr()).toContain('#181');
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
  expect(shownPr()).toMatch(/ merged$/);
  // A new PR on the same branch appears without another turn or a remount.
  thread.status = 'idle'; await settle();
  answer = next;
  await vi.advanceTimersByTimeAsync(60_000); await settle();
  expect(shownPr()).toContain('#182');
  const { contextMenu } = await import('../lib/context-menu.svelte');
  document.querySelector('[data-testid=thread-row]')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 4, clientY: 4 }));
  contextMenu.current!.onpick('pr'); contextMenu.close(); await settle();
  expect(call).toHaveBeenLastCalledWith('threads.pullRequest', { threadId: thread.id, refresh: true });
  await unmount(mounted); mounted = undefined;
  const ended = call.mock.calls.length;
  await vi.advanceTimersByTimeAsync(120_000); await settle();
  expect(call).toHaveBeenCalledTimes(ended);
  mounted = mount(ThreadCard, { target: document.body, props: { machine: { id: 'local', label: 'Local', store }, project, thread, now: Date.now(), showProject: false } });
  flushSync();
  expect(shownPr()).toContain('#182');
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
  mounted = mount(ThreadCard, { target: document.body, props: { machine: { id: 'local', label: 'Local', store }, project, thread, now: Date.now(), showProject: false } });
  await settle();
  expect(call).toHaveBeenCalledWith('threads.pullRequest', { threadId: thread.id });
  expect(shownPr()).toContain('#180');
  thread.branch = 'new-topic';
  thread.cwd = '/new-worktree';
  await settle();
  expect(shownPr()).toBeNull();
  expect(call).toHaveBeenCalledTimes(2);
  thread.branch = null;
  thread.cwd = project.path;
  await settle();
  answer(previous); await settle();
  expect(shownPr()).toBeNull();
  expect(document.querySelector('.metadata')).toBeNull();
});

test('a reconnect keeps the PR in the card while the core is asked again', async () => {
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  const thread = store.threads.find(thread => thread.branch)!;
  const project = store.projects.find(project => project.id === thread.projectId)!;
  const held = { number: 181, url: 'https://github.com/example/repo/pull/181', state: 'OPEN' as const };
  const pending = new Promise<typeof held>(() => undefined);
  const call = vi.spyOn(client, 'call').mockResolvedValueOnce(held).mockReturnValueOnce(pending);
  mounted = mount(ThreadCard, { target: document.body, props: { machine: { id: 'local', label: 'Local', store }, project, thread, now: Date.now(), showProject: false } });
  await settle();
  expect(shownPr()).toContain('#181');
  store.connection = 'connecting';
  await settle();
  expect(shownPr()).toContain('#181');
  store.connection = 'ready';
  await settle();
  // The second lookup is out and unanswered: the PR it will confirm never left.
  expect(call).toHaveBeenCalledTimes(2);
  expect(shownPr()).toContain('#181');
});

test('a turn left running on a machine that went away stops spinning until the machine is back', async () => {
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  vi.spyOn(client, 'call').mockResolvedValue(null);
  const thread = store.threads.find(thread => thread.status === 'idle')!;
  thread.status = 'running';
  thread.runningSince = Date.now() - 3 * 3_600_000;
  const project = store.projects.find(project => project.id === thread.projectId)!;
  mounted = mount(ThreadCard, { target: document.body, props: { machine: { id: 'laptop', label: 'Laptop', store }, project, thread, now: Date.now(), showProject: false } });
  await settle();
  const state = () => document.querySelector<HTMLElement>('[data-testid=thread-state]');
  // The ring around the picture turns while it works; the row's right end counts the time.
  const ring = () => document.querySelector<HTMLElement>('[data-testid=state-ring]');
  expect(state()?.dataset.state).toBe('working');
  expect(ring()?.dataset.ring).toBe('working');
  expect(state()?.textContent).toMatch(/^\s*3h/);
  store.connection = 'connecting'; await settle();
  expect(state()?.dataset.state).toBe('unreachable');
  expect(ring()?.dataset.ring).toBe('rest');
  expect(state()?.getAttribute('title')).toBe('Machine unreachable. Last known state: Working');
  store.connection = 'ready'; await settle();
  expect(state()?.dataset.state).toBe('working');
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
  mounted = mount(ThreadCard, { target: document.body, props: { machine: { id: 'local', label: 'Local', store }, project, thread, now: Date.now(), showProject: false } });
  await settle();
  expect(shownPr()).toContain('#77');
  const receive = listeners.mock.calls.find(([event]) => event === 'threads.pullRequestsChanged')?.[1] as (event: { threadId: string; pullRequests: typeof list }) => void;
  receive({ threadId: thread.id, pullRequests: [{ ...list[0]!, state: 'MERGED' }] });
  await settle();
  expect(shownPr()).toBe('#77 merged');
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
  expect(shownPr()).toBeNull();
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
  expect(shownPr()).toContain('#9873');
  // A poll's identical linked-list event must not replace automatic discovery.
  receive({ threadId: thread.id, pullRequests: [old] }); await settle();
  expect(shownPr()).toContain('#9873');
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
  expect(shownPr()).toContain('#9982');
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
  expect(shownPr()).toMatch(/ merged$/);
});

test('a card unmounted with its rename open still writes the title typed so far', async () => {
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  const thread = store.threads.find(row => !row.archived && row.projectId)!;
  const project = store.projects.find(row => row.id === thread.projectId)!;
  vi.spyOn(client, 'call').mockResolvedValue(null as never);
  const rename = vi.spyOn(store, 'rename').mockResolvedValue();
  mounted = mount(ThreadCard, { target: document.body, props: { machine: { id: 'local', label: 'Local', store }, project, thread, now: Date.now(), showProject: false } });
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

test('a row that needs the user reads the age of its home card, and drops its pin glyph under the Pinned label', async () => {
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  const thread = store.threads.find(row => !row.parentThreadId && !row.agentSessionId && row.projectId)!;
  const project = store.projects.find(row => row.id === thread.projectId)!;
  const now = Date.now();
  // Round 7: "Add CSV import" read "now" on the home card and "1m" in its row; "Export the journal" "50m" and "1h".
  Object.assign(thread, { status: 'waiting', pinned: true, unread: false, subagentQuestions: [], lastUserMessageAt: now - 90 * 60_000, runningSince: now - 10_000 });
  store.pendingQuestions = []; store.pendingPermissions = [];
  vi.spyOn(client, 'call').mockResolvedValue(null as never);
  mounted = mount(ThreadCard, { target: document.body, props: { machine: { id: 'local', label: 'Local', store }, project, thread, now, showProject: false, pin: false } });
  await settle();
  const card = inbox(storeSources([{ store }])).needs.find(entry => entry.thread.id === thread.id)!;
  const shown = document.querySelector('[data-testid=thread-row] [data-testid=thread-state-text]')?.textContent;
  expect(shown).toBe(waitedFor(now, card.since));
  expect(shown).not.toBe(shortAgo(thread.lastUserMessageAt!, now));
  expect(document.querySelector('[data-testid=thread-pinned]')).toBeNull();
});

test('a failed row says Failed after its project, and only a row nothing is live on draws its mark in the muted tier', async () => {
  client = new FakeClient({ delayMs: 0 });
  store = new Store(); store.attach(client); await store.connect();
  const thread = store.threads.find(row => !row.parentThreadId && !row.agentSessionId && row.projectId)!;
  const project = store.projects.find(row => row.id === thread.projectId)!;
  vi.spyOn(client, 'call').mockResolvedValue(null as never);
  const draw = async (fields: Partial<ThreadSummary>) => {
    if (mounted) await unmount(mounted);
    Object.assign(thread, { subagentQuestions: [], backgroundWork: undefined, backgroundWait: undefined, pullRequestWatches: undefined, ...fields });
    mounted = mount(ThreadCard, { target: document.body, props: { machine: { id: 'http://localhost:3773', label: 'This PC', store }, project, thread, now: Date.now(), showProject: true } });
    await settle();
    const facts = document.querySelector<HTMLElement>('[data-testid=thread-row] .facts')!;
    return {
      word: facts.querySelector('[data-testid=thread-failed] .ui-label')?.textContent ?? null,
      afterProject: facts.querySelector('[data-testid=thread-project] ~ [data-testid=thread-failed]') !== null,
      mono: document.querySelector('[data-testid=thread-provider] [data-mono]') !== null,
      slot: document.querySelector<HTMLElement>('[data-testid=state-ring]')!.style.getPropertyValue('--ring-size')
    };
  };
  // Round 11: "Crash when the camera opens" (failed) and "Retry failed syncs" (asks) differed by the badge's colour alone.
  const failed = await draw({ status: 'error', pinned: false });
  expect(failed.word).toBe('Failed');
  expect(failed.afterProject).toBe(true);
  expect((await draw({ status: 'waiting', pinned: false })).word).toBeNull();
  // Live and pinned rows keep the brand's colour; a row at rest in Earlier draws its mark in one muted colour, in the same slot.
  expect(failed.mono).toBe(false);
  expect((await draw({ status: 'running', pinned: false })).mono).toBe(false);
  expect((await draw({ status: 'idle', pinned: true })).mono).toBe(false);
  const quiet = await draw({ status: 'idle', pinned: false });
  expect(quiet.mono).toBe(true);
  expect(quiet.word).toBeNull();
  expect(quiet.slot).toBe(failed.slot);
});
