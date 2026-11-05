import { expect, test } from 'vitest';
import type { PermissionRequest, Project, QuestionRequest, ThreadSummary } from '@boite/contracts';
import { INBOX_CARDS, inbox, waitedFor, type InboxSource } from './inbox';
import { shortAgo } from './thread-state';

const project = { id: 'p', name: 'orbit', path: '/orbit' } as Project;
const thread = (id: string, patch: Partial<ThreadSummary> = {}): ThreadSummary => ({
  id, title: id, projectId: 'p', status: 'idle', pinned: false, openQuestions: 0, unread: false, archived: false, updatedAt: 0, runningSince: null, ...patch
} as ThreadSummary);
const source = (machine: string, threads: ThreadSummary[], extra: Partial<InboxSource<string>> = {}): InboxSource<string> => ({
  machine, threads, projects: [project], questions: [], permissions: [], ...extra
});

test('the cards come from every machine in the order of Recent\'s Needs you band, each saying what it waits on', () => {
  const question = { id: 'q', threadId: 'asks', createdAt: 300, text: 'Which icon set?' } as unknown as QuestionRequest;
  const permission = { id: 'r', threadId: 'wants', createdAt: 100, toolName: 'Bash', input: { command: 'bun run bench' } } as unknown as PermissionRequest;
  const { needs, working } = inbox([
    source('pc', [thread('asks', { status: 'waiting', lastUserMessageAt: 290 }), thread('wants', { status: 'waiting', lastUserMessageAt: 90 }), thread('quiet')], { questions: [question], permissions: [permission] }),
    source('server', [
      thread('failed', { status: 'error', unread: true, updatedAt: 200, lastUserMessageAt: 190, accountId: 'a' }),
      thread('signed-out', { status: 'error', unread: true, updatedAt: 400, lastUserMessageAt: 390, accountId: 'b' }),
      thread('read-error', { status: 'error', unread: false, updatedAt: 50, lastUserMessageAt: 40 }),
      thread('pinned', { status: 'error', pinned: true, updatedAt: 10, lastUserMessageAt: 5 })
    ], { accounts: [{ id: 'a', status: 'ok' }, { id: 'b', status: 'unauthenticated' }] })
  ]);
  // Round 6: the home listed these oldest first while the sidebar's band beside it listed them newest first.
  expect(needs.map(card => [card.machine, card.thread.id, card.reason, card.since])).toEqual([
    ['server', 'pinned', 'failed', 10],
    ['server', 'signed-out', 'sign-in', 400],
    ['pc', 'asks', 'question', 300],
    ['server', 'failed', 'failed', 200],
    ['pc', 'wants', 'permission', 100],
    ['server', 'read-error', 'failed', 50]
  ]);
  expect(needs.find(card => card.thread.id === 'asks')!.detail).toContain('Which icon set?');
  expect(needs[1]!.project).toBe(project);
  // A failed turn waits on the user until it is retried, done or archived, read or not,
  // as the sidebar's Needs you counts it; a quiet thread is nowhere.
  expect(working).toEqual([]);
});

test('the work going on is listed longest running first; a sub-agent is left to its parent, and hidden rooms to their lists', () => {
  const { needs, working } = inbox([source('pc', [
    thread('recent', { status: 'running', runningSince: 900 }),
    thread('long', { status: 'queued', requestSince: 100, runningSince: 800 }),
    thread('parent', { status: 'running', runningSince: 500, subagentQuestions: [{ threadId: 'child', title: 'Keep the old key?' }] } as Partial<ThreadSummary>),
    thread('child', { status: 'waiting', parentThreadId: 'parent' }),
    thread('orphan', { status: 'waiting', parentThreadId: 'gone', runningSince: 700 }),
    thread('archived', { status: 'waiting', archived: true }),
    thread('team', { status: 'waiting', teamId: 'team-1' } as Partial<ThreadSummary>),
    thread('secret', { status: 'running', incognito: true })
  ])]);
  // The parent carries its child's question; a child whose parent is not listed is no sidebar row, so the Inbox leaves it out too.
  expect(needs.map(card => [card.thread.id, card.detail])).toEqual([['parent', 'Keep the old key?']]);
  expect(working.map(row => [row.thread.id, row.since])).toEqual([['long', 100], ['recent', 900]]);
});

test('the Inbox counts the threads the sidebar counts: work that stopped short waits on the user, delegated work is at work', () => {
  const { needs, working } = inbox([source('pc', [
    thread('stopped', { updatedAt: 40, backgroundWait: { state: 'interrupted', for: 'the build', reason: 'core-restarted', at: 40 } } as Partial<ThreadSummary>),
    thread('delegating', { updatedAt: 60 }),
    thread('done', { unread: true })
  ], { subagents: id => id === 'delegating' ? { count: 2, asking: 0 } as never : null })]);
  expect(needs.map(card => [card.thread.id, card.reason, card.detail])).toEqual([['stopped', 'interrupted', 'the build']]);
  expect(working.map(row => row.thread.id)).toEqual(['delegating']);
});

test('the home folds the cards past the first three', () => {
  expect(INBOX_CARDS).toBe(3);
  const { needs } = inbox([source('pc', Array.from({ length: 7 }, (_, index) => thread(`t${index}`, { status: 'waiting', runningSince: 10 - index })))]);
  expect(needs).toHaveLength(7);
  // Recent's Needs you order: the newest wait first, the age each card shows.
  expect(needs.slice(0, INBOX_CARDS).map(card => card.thread.id)).toEqual(['t0', 't1', 't2']);
});

test('a machine that is not connected counts nothing; its asks wait apart, muted, and its work is left out', () => {
  const lists = inbox([
    source('pc', [thread('asks', { status: 'waiting' }), thread('runs', { status: 'running', runningSince: 5 })]),
    source('laptop', [thread('stale-ask', { status: 'waiting' }), thread('stale-run', { status: 'running', runningSince: 1 })], { connected: false })
  ]);
  expect(lists.needs.map(card => card.thread.id)).toEqual(['asks']);
  expect(lists.working.map(row => row.thread.id)).toEqual(['runs']);
  expect(lists.offline.map(card => card.thread.id)).toEqual(['stale-ask']);
  expect(lists.tally).toEqual({ threads: { needs: 1, working: 1 }, bots: { needs: 0, working: 0 } });
});

test('a bot\'s own thread is counted apart from the project threads, and a team or debate room is not counted', () => {
  const lists = inbox([source('pc', [
    thread('bot-asks', { projectId: null, agentSessionId: 'session-1', openQuestions: 1 } as Partial<ThreadSummary>),
    thread('bot-runs', { projectId: null, agentSessionId: 'session-2', status: 'running' } as Partial<ThreadSummary>),
    thread('room', { status: 'waiting', debateId: 'd-1' } as Partial<ThreadSummary>),
    thread('asks', { status: 'waiting' })
  ])]);
  expect(lists.tally).toEqual({ threads: { needs: 1, working: 0 }, bots: { needs: 1, working: 1 } });
  expect(lists.needs.map(card => [card.thread.id, card.kind])).toEqual(expect.arrayContaining([['bot-asks', 'bots'], ['asks', 'threads']]));
});

test('a card says how long it waited in the words of its Recent row', () => {
  const now = 10 * 86_400_000;
  // Round 6: the home read `4h 00m` and `2h 57m` beside rows reading `4h` and `2h`.
  for (const ago of [27 * 60_000, 4 * 3_600_000, 2 * 3_600_000 + 57 * 60_000, 3 * 86_400_000]) expect(waitedFor(now, now - ago)).toBe(shortAgo(now - ago, now));
  expect(waitedFor(now, now - 4 * 3_600_000)).not.toMatch(/\d+m$/);
});
