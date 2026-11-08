import { afterEach, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { ThreadId, ThreadSummary } from '@boite/contracts';
import ThreadState from './ThreadState.svelte';
import { projectRollup, threadState, threadTone, workflowTone } from '../lib/thread-state';
import { workingChildren, type WorkingChildren } from '../lib/thread-rows';

type Shown = Pick<ThreadSummary, 'status' | 'unread' | 'runningSince' | 'requestSince' | 'backgroundWork' | 'lastUserMessageAt' | 'createdAt' | 'backgroundWait'>;

const NOW = Date.UTC(2026, 8, 28, 10, 0, 0);
let running: Record<string, unknown> | null = null;

afterEach(() => {
  if (running) unmount(running, { outro: false });
  running = null;
  document.body.innerHTML = '';
  vi.useRealTimers();
});

function draw(thread: Partial<Shown>, subagents: WorkingChildren | null = null): HTMLElement {
  const shown: Shown = { status: 'idle', unread: false, runningSince: null, backgroundWork: null, lastUserMessageAt: NOW - 120_000, createdAt: NOW - 600_000, ...thread };
  running = mount(ThreadState, { target: document.body, props: { thread: shown, now: NOW, subagents } });
  flushSync();
  return document.body.firstElementChild as HTMLElement;
}

test('a parent whose turn ended waits on its working sub-agents, their count in its tooltip', () => {
  vi.useFakeTimers({ now: NOW });
  const children = [
    { id: 'child-1', parentThreadId: 'parent', status: 'running', runningSince: NOW - 90_000 },
    { id: 'child-2', parentThreadId: 'parent', status: 'queued', runningSince: null },
    { id: 'child-3', parentThreadId: 'parent', status: 'idle', runningSince: null },
    { id: 'child-4', parentThreadId: 'parent', status: 'running', runningSince: NOW - 10_000, archived: true },
    { id: 'parent', parentThreadId: null, status: 'idle', runningSince: null }
  ] as unknown as ThreadSummary[];
  const working = workingChildren(children);
  expect([...working.keys()]).toEqual(['parent']);
  expect(working.get('parent' as ThreadId)).toEqual({ count: 2, since: NOW - 90_000, asking: 0 });

  const state = draw({ status: 'idle', unread: true, backgroundWork: { kinds: ['shell'], since: NOW } }, working.get('parent' as ThreadId)!);
  expect(state.dataset['state']).toBe('delegating');
  // The row reads its word beside a still ring, never a clock: the count and the time stay in the tooltip, so the title keeps its room.
  expect(state.querySelector('.work-ring')).not.toBeNull();
  expect(state.querySelector('.dot')).toBeNull();
  expect(state.textContent?.replace(/\s+/g, ' ').trim()).toBe('Sub-agents');
  expect(state.getAttribute('title')).toBe('Waiting on 2 sub-agents\n1m 30s');
  // Its own turn or a question for the user still come first.
  expect(threadState({ status: 'running', unread: false }, 2)).toBe('working');
  expect(threadState({ status: 'waiting', unread: false }, 2)).toBe('waiting');
  expect(threadState({ status: 'idle', unread: false }, 0)).toBeNull();
  expect(projectRollup([{ status: 'idle', unread: true }, { status: 'idle', unread: false }], thread => thread.unread ? 0 : 1)).toEqual({ kind: 'delegating', count: 1 });
});

test('each status reads as one state, and a thread at rest the user saw has none', () => {
  expect(threadState({ status: 'running', unread: false })).toBe('working');
  expect(threadState({ status: 'waiting', unread: true })).toBe('waiting');
  expect(threadState({ status: 'error', unread: false })).toBe('error');
  expect(threadState({ status: 'queued', unread: false })).toBe('queued');
  expect(threadState({ status: 'idle', unread: true })).toBe('done');
  expect(threadState({ status: 'idle', unread: false })).toBeNull();
});

test('a question asked without stopping reads as needing the user, whether the turn still runs or ended', () => {
  expect(threadState({ status: 'running', unread: false, openQuestions: 1 })).toBe('waiting');
  expect(threadState({ status: 'idle', unread: false, openQuestions: 2, backgroundWork: { kinds: ['shell'], since: NOW } })).toBe('waiting');
  expect(threadState({ status: 'running', unread: false, openQuestions: 0 })).toBe('working');
  expect(projectRollup([{ status: 'running', unread: false }, { status: 'running', unread: false, openQuestions: 1 }])).toEqual({ kind: 'waiting', count: 1 });
});

test('a finished turn whose agent still runs something is not at rest, read or not', () => {
  const monitor = { kinds: ['monitor' as const], since: NOW };
  expect(threadState({ status: 'idle', unread: false, backgroundWork: monitor })).toBe('monitoring');
  expect(threadState({ status: 'idle', unread: true, backgroundWork: monitor })).toBe('monitoring');
  expect(threadState({ status: 'idle', unread: false, backgroundWork: { kinds: ['monitor', 'shell'], since: NOW } })).toBe('background');
  expect(threadState({ status: 'idle', unread: true, backgroundWork: { kinds: [], since: NOW } })).toBe('done');
  // A running turn says working whatever it left in the background.
  expect(threadState({ status: 'running', unread: false, backgroundWork: monitor })).toBe('working');
});

test('a delegated agent waiting on its own background work says what and since when; work that never woke it reads interrupted', () => {
  vi.useFakeTimers({ now: NOW });
  const since = NOW - 12 * 60_000;
  const waiting = draw({ backgroundWork: { kinds: ['shell'], since }, backgroundWait: { state: 'waiting', for: 'test_emotes', since, until: null } });
  expect(waiting.dataset['state']).toBe('background');
  expect(waiting.textContent?.trim()).toBe('In background');
  expect(waiting.getAttribute('title')).toBe('In background for 12m 00s\nWaiting on test_emotes');
  // The task just ended and the wake turn has not started: still at work, not done.
  expect(threadState({ status: 'idle', unread: true, backgroundWait: { state: 'waiting', for: 'test_emotes', since, until: NOW + 30_000 } })).toBe('background');
  unmount(running!, { outro: false });
  running = null;
  const interrupted = draw({ unread: true, backgroundWait: { state: 'interrupted', for: 'test_emotes', reason: 'core-restarted', at: NOW } });
  expect(interrupted.dataset['state']).toBe('interrupted');
  expect(interrupted.textContent?.trim()).toBe('Interrupted');
  expect(interrupted.getAttribute('title')).toBe('Interrupted\ntest_emotes ended without waking it: Boite or the PC restarted');
  expect(projectRollup([{ status: 'idle', unread: true }, { status: 'idle', unread: false, backgroundWait: { state: 'interrupted', for: 'x', reason: 'error', at: NOW } }])).toEqual({ kind: 'interrupted', count: 1 });
});

test('a parent counts a child waiting on its background work among its working sub-agents', () => {
  const child = (id: string, fields: Partial<ThreadSummary>) => ({ id: id as ThreadId, parentThreadId: 'p' as ThreadId, archived: false, status: 'idle', runningSince: null, ...fields }) as ThreadSummary;
  const working = workingChildren([
    child('a', { backgroundWait: { state: 'waiting', for: 'test_emotes', since: NOW - 60_000, until: null } }),
    child('b', { backgroundWait: { state: 'interrupted', for: 'build', reason: 'error', at: NOW } }),
    child('c', {}),
  ]);
  expect(working.get('p' as ThreadId)).toEqual({ count: 1, since: NOW - 60_000, asking: 0 });
});

test('a parent at work reads working, and one whose child asks reads Needs you, with no count on the row', () => {
  vi.useFakeTimers({ now: NOW });
  const child = (id: string, fields: Partial<ThreadSummary>) => ({ id: id as ThreadId, parentThreadId: 'p' as ThreadId, archived: false, status: 'running', runningSince: NOW - 30_000, ...fields }) as ThreadSummary;
  // Its own turn runs: the row says working, its time in the tooltip, the thread view lists the children.
  const working = draw({ status: 'running', runningSince: NOW - 65_000 }, { count: 2, since: NOW - 30_000, asking: 0 });
  expect(working.dataset['state']).toBe('working');
  expect(working.textContent?.trim()).toBe('Working');
  expect(working.getAttribute('title')).toBe('Working for 1m 05s');
  unmount(running!, { outro: false });
  running = null;

  // A question asked without stopping, and a turn stopped on a card: both ask, busy or not; an archived child is gone.
  const asking = workingChildren([
    child('a', { openQuestions: 1 }),
    child('b', { status: 'waiting' }),
    child('c', { status: 'idle', runningSince: null, openQuestions: 1 }),
    child('d', { status: 'waiting', archived: true }),
  ]).get('p' as ThreadId)!;
  expect(asking).toEqual({ count: 2, since: NOW - 30_000, asking: 3 });
  const parent = draw({ status: 'running', runningSince: NOW - 65_000 }, asking);
  expect(parent.dataset['state']).toBe('waiting');
  expect(parent.textContent).toContain('Needs you');
  expect(parent.textContent).not.toMatch(/\d/);
  // Only the parent's own failure outranks a child's question, in the row and the folded project alike.
  expect(threadState({ status: 'error', unread: false }, asking)).toBe('error');
  expect(threadState({ status: 'idle', unread: false }, { count: 0, asking: 1 })).toBe('waiting');
  expect(projectRollup([{ status: 'running', unread: false }, { status: 'idle', unread: false }], thread => thread.status === 'idle' ? asking : 0)).toEqual({ kind: 'waiting', count: 1 });
});

test('a monitoring thread counts from its oldest task and says what still runs', () => {
  vi.useFakeTimers({ now: NOW });
  const state = draw({ status: 'idle', unread: true, backgroundWork: { kinds: ['monitor', 'monitor'], since: NOW - 125_000 } });
  expect(state.dataset['state']).toBe('monitoring');
  expect(state.classList.contains('monitoring')).toBe(true);
  expect(state.querySelector('svg')).not.toBeNull();
  expect(state.textContent?.trim()).toBe('Monitoring');
  expect(state.getAttribute('title')).toBe('Monitoring for 2m 05s\n2 monitors still running');

  vi.advanceTimersByTime(1_000);
  flushSync();
  expect(state.getAttribute('title')).toBe('Monitoring for 2m 06s\n2 monitors still running');
});

test('monitoring and the turn that resumes after it keep counting from the user request', () => {
  vi.useFakeTimers({ now: NOW });
  const request = NOW - 1_800_000;
  const watching = draw({ status: 'idle', requestSince: request, backgroundWork: { kinds: ['monitor'], since: NOW - 60_000 } });
  expect(watching.textContent?.trim()).toBe('Monitoring');
  expect(watching.getAttribute('title')).toBe('Monitoring for 30m 00s\n1 monitor still running');
  unmount(running!, { outro: false });
  running = null;
  const resumed = draw({ status: 'running', runningSince: NOW - 5_000, requestSince: request });
  expect(resumed.getAttribute('title')).toBe('Working for 30m 00s');
  unmount(running!, { outro: false });
  running = null;
  // A request start later than the running turn's, from a clock skew, falls back to the turn's.
  const skewed = draw({ status: 'running', runningSince: NOW - 5_000, requestSince: NOW - 1_000 });
  expect(skewed.getAttribute('title')).toBe('Working for 5s');
  unmount(running!, { outro: false });
  running = null;
  // A shell left running may predate the request: it keeps its own start.
  const shell = draw({ status: 'idle', requestSince: request, backgroundWork: { kinds: ['shell'], since: NOW - 5_000 } });
  expect(shell.getAttribute('title')).toBe('In background for 5s\n1 shell still running');
});

test('a shell left running reads as background work, with a still ring rather than a spinning one', () => {
  vi.useFakeTimers({ now: NOW });
  const state = draw({ status: 'idle', backgroundWork: { kinds: ['shell', 'monitor'], since: NOW - 5_000 } });
  expect(state.dataset['state']).toBe('background');
  expect(state.querySelector('.spinner, .pulse')).toBeNull();
  expect(state.querySelector('.work-ring')).not.toBeNull();
  expect(state.getAttribute('title')).toBe('In background for 5s\n1 shell, 1 monitor still running');
});

test('a working row holds a still ring, the open thread the one spinner, and counts from its turn start, second by second', () => {
  vi.useFakeTimers({ now: NOW });
  const state = draw({ status: 'running', runningSince: NOW - 65_000 });
  expect(state.dataset['state']).toBe('working');
  // A list holds many rows at work: none of their marks moves.
  expect(state.querySelector('.work-ring')).not.toBeNull();
  expect(state.querySelector('svg, .spinner, .pulse')).toBeNull();
  expect(state.textContent?.trim()).toBe('Working');
  expect(state.getAttribute('title')).toBe('Working for 1m 05s');

  vi.advanceTimersByTime(2_000);
  flushSync();
  expect(state.getAttribute('title')).toBe('Working for 1m 07s');
});

test('the other states are words in their own colour class, with no spinner; news adds its check', () => {
  for (const [thread, kind, word] of [
    [{ status: 'waiting' }, 'waiting', 'Needs you'],
    [{ status: 'error' }, 'error', 'Failed'],
    [{ status: 'idle', unread: true }, 'done', 'Done'],
    [{ status: 'queued' }, 'queued', 'Queued']
  ] as const) {
    const state = draw(thread);
    expect(state.dataset['state']).toBe(kind);
    expect(state.classList.contains(kind)).toBe(true);
    // Done carries its check; the user's turn, a failure and a queue read as their word alone.
    expect(state.querySelector('svg') !== null).toBe(kind === 'done');
    expect(state.querySelector('.spinner')).toBeNull();
    expect(state.textContent?.trim()).toBe(word);
    unmount(running!, { outro: false });
    running = null;
  }
});

test('the desktop list draws the user\'s turn as its dot and work as its ring alone, the words kept in their name', () => {
  for (const [thread, kind, dot] of [
    [{ status: 'waiting' }, 'waiting', true],
    [{ status: 'running', runningSince: NOW - 65_000 }, 'working', false],
  ] as const) {
    running = mount(ThreadState, { target: document.body, props: { thread: { unread: false, runningSince: null, backgroundWork: null, lastUserMessageAt: NOW, createdAt: NOW, ...thread }, now: NOW, mark: true } });
    flushSync();
    const state = document.body.firstElementChild as HTMLElement;
    expect(state.dataset['state']).toBe(kind);
    expect(state.textContent?.trim()).toBe('');
    expect(state.getAttribute('role')).toBe('img');
    expect(state.getAttribute('aria-label')).toMatch(kind === 'waiting' ? /^Needs you$/ : /^Working for /);
    expect(state.querySelector('.needs-dot') !== null).toBe(dot);
    unmount(running!, { outro: false });
    running = null;
  }
  // A failure keeps its word on the list.
  running = mount(ThreadState, { target: document.body, props: { thread: { status: 'error', unread: false, runningSince: null, backgroundWork: null, lastUserMessageAt: NOW, createdAt: NOW }, now: NOW, mark: true } });
  flushSync();
  expect(document.body.firstElementChild?.textContent?.trim()).toBe('Failed');
});

test('a thread at rest shows when it was last used', () => {
  const when = draw({});
  expect(when.dataset['testid']).toBeUndefined();
  expect(when.classList.contains('when')).toBe(true);
  expect(when.textContent?.trim().length).toBeGreaterThan(0);
});

test('a folded project names its most urgent state and how many threads share it', () => {
  const idle = { status: 'idle' as const, unread: false };
  expect(projectRollup([idle, idle])).toBeNull();
  expect(projectRollup([{ status: 'idle', unread: true }, idle])).toEqual({ kind: 'done', count: 1 });
  expect(projectRollup([{ status: 'running', unread: false }, { status: 'running', unread: false }, { status: 'idle', unread: true }])).toEqual({ kind: 'working', count: 2 });
  expect(projectRollup([{ status: 'running', unread: false }, { status: 'error', unread: false }])).toEqual({ kind: 'error', count: 1 });
  expect(projectRollup([{ status: 'error', unread: false }, { status: 'waiting', unread: false }])).toEqual({ kind: 'waiting', count: 1 });
  expect(projectRollup([{ status: 'idle', unread: true, backgroundWork: { kinds: ['monitor'], since: NOW } }, { status: 'idle', unread: true }])).toEqual({ kind: 'monitoring', count: 1 });
  // Threads waiting for a slot are work to come: they show, after work under way and before news.
  expect(projectRollup([{ status: 'queued', unread: false }, { status: 'queued', unread: false }])).toEqual({ kind: 'queued', count: 2 });
  expect(projectRollup([{ status: 'queued', unread: false }, { status: 'idle', unread: true }])).toEqual({ kind: 'queued', count: 1 });
});

test('threads, workflow runs and steps share one status mark vocabulary', () => {
  expect(threadTone('idle', true).tone).toBe('unread');
  expect(threadTone('running', true).tone).toBe('running');
  // A failed run or step draws a thread's error; a step not started yet, an idle ring.
  expect(workflowTone('failed', true).tone).toBe('error');
  expect(workflowTone('waiting').tone).toBe('idle');
  expect(workflowTone('skipped').tone).toBe('skipped');
});

test('a thread at rest watching pull requests counts its time until their checks settle, then reads as finished', () => {
  vi.useFakeTimers({ now: NOW });
  const watch = { url: 'https://github.com/example/repo/pull/7', repository: 'example/repo', number: 7, since: NOW - 300_000, seen: null, paused: null };
  const shown = { status: 'idle' as const, unread: true, runningSince: null, backgroundWork: null, lastUserMessageAt: NOW - 120_000, createdAt: NOW - 600_000 };
  running = mount(ThreadState, { target: document.body, props: { thread: { ...shown, requestSince: NOW - 600_000, pullRequestWatches: [watch, { ...watch, number: 9 }] }, now: NOW } });
  flushSync();
  const state = document.body.firstElementChild as HTMLElement;
  expect(state.dataset['state']).toBe('watching');
  // The row counts from the request, like a monitor; the numbers stay in the tooltip, the card's own line links the PR.
  expect(state.textContent?.trim()).toBe('Watching PR');
  expect(state.getAttribute('title')).toBe('Watching 2 PRs\n#7, #9\n10m 00s');
  // Its own turn still comes first; a finished watch leaves the thread done.
  expect(threadState({ status: 'running', unread: false, pullRequestWatches: [watch] })).toBe('working');
  expect(threadState({ status: 'idle', unread: true, pullRequestWatches: [] })).toBe('done');
  // Checks still running: watching. All settled: the agent has its answer, the turn is finished work.
  const seen = { checkedAt: NOW, head: 'abc1234', base: 'main', conflicting: false };
  expect(threadState({ status: 'idle', unread: true, pullRequestWatches: [{ ...watch, seen: { ...seen, checks: { total: 20, running: 3, failed: 0 } } }] })).toBe('watching');
  const settled = { ...watch, seen: { ...seen, checks: { total: 20, running: 0, failed: 0 } } };
  expect(threadState({ status: 'idle', unread: true, pullRequestWatches: [settled] })).toBe('done');
  expect(threadState({ status: 'idle', unread: false, pullRequestWatches: [settled] })).toBeNull();
  // In the merge queue its checks run on the merge group: still watching until it merges or leaves the queue.
  const queued = { ...watch, seen: { ...settled.seen, queue: { position: 2 } } };
  expect(threadState({ status: 'idle', unread: false, pullRequestWatches: [queued] })).toBe('watching');
  expect(threadState({ status: 'idle', unread: false, pullRequestWatches: [{ ...queued, seen: { ...queued.seen, queue: null } }] })).toBeNull();
  unmount(running, { outro: false });
  running = mount(ThreadState, { target: document.body, props: { thread: { ...shown, requestSince: NOW - 600_000, pullRequestWatches: [queued] }, now: NOW } });
  flushSync();
  expect((document.body.firstElementChild as HTMLElement).getAttribute('title')).toBe('Watching PR\n#7 (Merge queue, position 2)\n10m 00s');
  expect(projectRollup([{ status: 'idle', unread: true }, { status: 'idle', unread: false, pullRequestWatches: [watch] }])).toEqual({ kind: 'watching', count: 1 });
});

