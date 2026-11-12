import { expect, test } from 'vitest';
import type { PermissionRequest, QuestionRequest, ThreadSummary } from '@boite/contracts';
import { activityFeed, feedOperation, needsYouCount, storeNeeds } from './activity-feed';

const NOW = Date.UTC(2026, 10, 7, 12);

function thread(id: string, fields: Partial<ThreadSummary>): ThreadSummary {
  return { id, title: id, status: 'idle', unread: false, parentThreadId: null, projectId: null, updatedAt: NOW - 60_000, ...fields } as ThreadSummary;
}

test('Activity lists what needs the user, failures included, then the updates, each with its reason; sub-agents sit under their parent', () => {
  // The question opens on a blank line: its first written line is still the reason.
  const questions = [{ id: 'q', threadId: 'asks', text: '\n  Which retry policy?\nThe second line stays out.', options: [], createdAt: NOW - 5 * 60_000 }] as unknown as QuestionRequest[];
  const permissions = [{ id: 'p', threadId: 'push', toolName: 'Bash', input: { command: 'git push' }, description: null, createdAt: NOW - 60_000 }] as unknown as PermissionRequest[];
  const threads = [
    thread('done', { unread: true, updatedAt: NOW - 1_000 }),
    thread('failed', { status: 'error', updatedAt: NOW - 2_000 }),
    thread('stopped', { status: 'idle', unread: true, backgroundWait: { state: 'interrupted', for: 'tests', reason: 'core-restarted', at: NOW }, updatedAt: NOW - 500 }),
    thread('asks', { status: 'waiting', openQuestions: 1, updatedAt: NOW - 30_000 }),
    thread('push', { status: 'waiting', updatedAt: NOW - 3_000 }),
    thread('busy', { status: 'running' }),
    thread('quiet', {}),
    // A bot's own conversation: its picture on the rail says how it stands.
    thread('mira', { unread: true, agentSessionId: 'mira' as ThreadSummary['agentSessionId'] }),
    // A parent at work comes in for its sub-agent, which asks.
    thread('parent', { status: 'running', updatedAt: NOW - 90_000 }),
    thread('child', { status: 'waiting', parentThreadId: 'parent' as ThreadSummary['parentThreadId'], updatedAt: NOW - 4_000 })
  ];
  const store = { pendingQuestions: questions, pendingPermissions: permissions, subagents: () => null };
  const machine = { id: 'local', store };
  const feed = activityFeed(threads.map(t => ({ machine, thread: t, project: undefined })));

  // The user's turn first, newest first; a parent pulled in by an asking child ranks with it, the child right under it.
  expect(feed.map(row => row.thread.id)).toEqual(['push', 'asks', 'parent', 'child', 'failed', 'stopped', 'done']);
  // Two sections: the user acts on asks and failures, reads what finished or stopped short; a child keeps its parent's.
  expect(feed.map(row => row.section)).toEqual(['needs', 'needs', 'needs', 'needs', 'needs', 'updates', 'updates']);
  // Each Needs you row offers what the user does there: allow a permission, answer a question (a sub-agent's
  // through its parent), review a failure; a parent pulled in at work has nothing of its own to do.
  expect(feed.map(row => row.verb)).toEqual(['allow', 'answer', null, 'answer', 'review', null, null]);
  expect(feed.find(row => row.thread.id === 'child')?.nested).toBe(true);
  expect(feed.filter(row => row.nested)).toHaveLength(1);
  // Work in progress, threads at rest and a bot's own conversation are not news.
  expect(feed.some(row => ['busy', 'quiet', 'mira'].includes(row.thread.id))).toBe(false);

  const row = (id: string) => feed.find(row => row.thread.id === id)!;
  // A question is its own reason: the row's state already says it waits on the user.
  expect(row('asks').reason).toBe('Which retry policy?');
  // A command is said in words; the command itself reads whole under the row (feedOperation), never cut into the line.
  expect(row('push').reason).toBe('Wants to run:');
  expect(feedOperation(store, 'push' as ThreadSummary['id'])).toBe('git push');
  expect(feedOperation(store, 'asks' as ThreadSummary['id'])).toBeNull();
  // Since when: the request's own time, not the thread's last change.
  expect(row('asks').at).toBe(NOW - 5 * 60_000);
  expect(row('push').at).toBe(NOW - 60_000);
  // A failure or news says where it lives, and when it last changed.
  expect(row('failed')).toMatchObject({ reason: 'Drafts', at: NOW - 2_000 });
  // Every row knows where it comes from for its place line, the decisions included, not only the news.
  expect(feed.map(row => row.place)).toEqual(feed.map(() => 'Drafts'));
});

test('a sub-agent that failed under a parent still at work is the parent\'s business; a thread outside projects says its bot', () => {
  const threads = [
    thread('parent', { status: 'running' }),
    thread('child', { status: 'error', parentThreadId: 'parent' as ThreadSummary['parentThreadId'] }),
    thread('bot', { status: 'error' })
  ];
  const machine = { id: 'local', store: { pendingQuestions: [], pendingPermissions: [], subagents: () => null } };
  const feed = activityFeed(threads.map(t => ({ machine, thread: t, project: undefined })), entry => entry.thread.id === 'bot' ? 'Scout' : null);
  expect(feed.map(row => [row.thread.id, row.reason, row.place])).toEqual([['bot', 'Scout', 'Scout']]);
  // A project's head counts the same row, and knows it is a failure, so it wears the failure's mark.
  expect(storeNeeds(machine.store, threads)).toEqual({ count: 1, failed: 1 });
});

test('one event per row: a sub-agent shares its parent\'s row only for the same ask, so a permission never carries a stopped helper', () => {
  const permissions = [
    { id: 'p1', threadId: 'parent', toolName: 'Bash', input: { command: 'git push' }, description: null, createdAt: NOW - 60_000 },
    { id: 'p2', threadId: 'same', toolName: 'Bash', input: { command: 'npm test' }, description: null, createdAt: NOW - 50_000 }
  ] as unknown as PermissionRequest[];
  const questions = [{ id: 'q', threadId: 'asks', text: 'Which port?', options: [], createdAt: NOW - 40_000 }] as unknown as QuestionRequest[];
  const child = (id: string, fields: Partial<ThreadSummary>) => thread(id, { parentThreadId: 'parent' as ThreadSummary['parentThreadId'], ...fields });
  const threads = [
    thread('parent', { status: 'waiting', updatedAt: NOW - 10_000 }),
    child('stopped', { unread: true, backgroundWait: { state: 'interrupted', for: 'tests', reason: 'core-restarted', at: NOW }, updatedAt: NOW - 20_000 }),
    child('same', { status: 'waiting', updatedAt: NOW - 30_000 }),
    child('asks', { status: 'waiting', updatedAt: NOW - 40_000 })
  ];
  const store = { pendingQuestions: questions, pendingPermissions: permissions, subagents: () => null };
  const machine = { id: 'local', store };
  const feed = activityFeed(threads.map(t => ({ machine, thread: t, project: undefined })));
  // The two permissions share the parent's row; the question leads its own; the stop is news, a row of Updates.
  expect(feed.map(row => [row.thread.id, row.nested, row.section, row.verb])).toEqual([
    ['parent', false, 'needs', 'allow'], ['same', true, 'needs', 'allow'],
    ['asks', false, 'needs', 'answer'],
    ['stopped', false, 'updates', null]
  ]);
  // Every count says the rows the section lists.
  expect(needsYouCount(threads.map(t => ({ machine, thread: t, project: undefined })))).toBe(2);
});
