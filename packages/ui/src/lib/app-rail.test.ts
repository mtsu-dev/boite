import { expect, test } from 'vitest';
import type { ThreadSummary } from '@boite/contracts';
import { railBotState, threadsNeedingYou } from './app-rail';
import { activityFeed } from './activity-feed';

test("a bot's picture reads its thread first, then its snapshot, a question outranking work", () => {
  const active = { status: 'active' } as const;
  expect(railBotState(active, null, { status: 'running' }, false)).toBe('working');
  expect(railBotState(active, null, { status: 'running' }, true)).toBe('waiting');
  expect(railBotState(active, null, { status: 'queued' }, false)).toBe('queued');
  expect(railBotState(active, null, { status: 'idle' }, true)).toBe('waiting');
  expect(railBotState(active, { state: 'error' } as never, null, false)).toBe('failed');
  expect(railBotState({ status: 'paused' }, null, null, false)).toBe('paused');
  expect(railBotState(active, null, null, false)).toBe('idle');
});

test("the needs-you count is Activity's waiting rows: a bot's, a team's, a helper's and an archived thread count elsewhere, a bot's worker for itself", () => {
  const base = { unread: false, backgroundWork: undefined, openQuestions: undefined };
  const waiting = { ...base, status: 'waiting' as const };
  const store = {
    threads: [
      { id: 'a', ...waiting },
      { id: 'b', ...base, status: 'running' as const },
      { id: 'c', ...waiting, archived: true },
      { id: 'd', ...waiting, agentSessionId: 'bot' },
      { id: 'e', ...waiting, teamId: 'team' },
      { id: 'f', ...waiting, parentThreadId: 'a' },
      { id: 'g', ...waiting, parentThreadId: 'd' },
    ] as unknown as ThreadSummary[],
    subagents: (id: string) => (id === 'b' ? { count: 1, asking: 1 } : 0),
  };
  expect(threadsNeedingYou([store, { threads: [{ id: 'a', ...waiting }] as unknown as ThreadSummary[], subagents: () => 0 }])).toBe(4);
});

test("the rail's badge is the number of Activity's Needs you rows: a failure counts, a sub-agent under its parent once, news never", () => {
  const thread = (id: string, fields: Partial<ThreadSummary>) => ({ id, title: id, status: 'idle', unread: false, parentThreadId: null, projectId: null, updatedAt: 1, ...fields }) as ThreadSummary;
  const threads = [
    thread('asks', { status: 'waiting' }),
    // Asks without stopping: the user's turn, not work.
    thread('question', { status: 'running', openQuestions: 1 }),
    thread('failed', { status: 'error' }),
    // A parent that asks, its sub-agent interrupted under it: two events, the stop a row of Updates of its own.
    thread('parent', { status: 'waiting' }),
    thread('child', { status: 'idle', unread: true, backgroundWait: { state: 'interrupted', for: 'tests', reason: 'core-restarted', at: 1 }, parentThreadId: 'parent' as ThreadSummary['parentThreadId'] }),
    thread('done', { unread: true }),
    thread('busy', { status: 'running' })
  ];
  const store = { threads, pendingQuestions: [], pendingPermissions: [], subagents: () => 0 as const };
  const needs = activityFeed(threads.map(t => ({ machine: { id: 'm', store }, thread: t, project: undefined }))).filter(row => row.section === 'needs');
  expect(needs.map(row => row.thread.id)).toEqual(['asks', 'question', 'parent', 'failed']);
  expect(threadsNeedingYou([store])).toBe(needs.filter(row => !row.nested).length);
  expect(threadsNeedingYou([store])).toBe(4);
});
