import { expect, test } from 'vitest';
import type { Project, ThreadSummary } from '@boite/contracts';
import { bandStarts, compareThreads } from './thread-order';
import { inbox, storeLiveKind, storeOrder, type OrderStore } from './inbox';
import { projectThreadLists } from './project-threads.svelte';
import type { ProjectEntry } from './project-view.svelte';

const base = { pinned: false, status: 'idle' as const, lastUserMessageAt: null, createdAt: 0 };

test('a waiting thread sorts above an idle one with a newer message', () => {
  const idle = { ...base, id: 'idle', lastUserMessageAt: 2_000 };
  const waiting = { ...base, id: 'waiting', status: 'waiting' as const, lastUserMessageAt: 1_000 };
  expect([idle, waiting].sort(compareThreads).map((t) => t.id)).toEqual(['waiting', 'idle']);
});

test('pinned first, then waiting and failed together by last message, running, queued, idle, then the last message', () => {
  const rows = [
    { ...base, id: 'old-idle', lastUserMessageAt: 1 },
    { ...base, id: 'new-idle', lastUserMessageAt: 9 },
    { ...base, id: 'running', status: 'running' as const, lastUserMessageAt: 20 },
    { ...base, id: 'queued', status: 'queued' as const },
    { ...base, id: 'waiting', status: 'waiting' as const, lastUserMessageAt: 3 },
    { ...base, id: 'failed', status: 'error' as const, lastUserMessageAt: 4 },
    { ...base, id: 'pinned', pinned: true, createdAt: 5 }
  ];
  // A failed thread needs the user as a waiting one does: it never sorts under the threads at work (round 5 read three failed rows under 13 working ones).
  expect(rows.sort(compareThreads).map((t) => t.id)).toEqual(['pinned', 'failed', 'waiting', 'running', 'queued', 'new-idle', 'old-idle']);
});

test('Recent labels the first row of each band, the pins included, and a list of one band draws no label', () => {
  const rows = [
    { ...base, id: 'pinned', pinned: true, status: 'running' as const },
    { ...base, id: 'pinned-waiting', pinned: true, status: 'waiting' as const },
    { ...base, id: 'failed', status: 'error' as const },
    { ...base, id: 'waiting', status: 'waiting' as const },
    { ...base, id: 'running', status: 'running' as const },
    { ...base, id: 'queued', status: 'queued' as const },
    { ...base, id: 'idle' }
  ];
  const starts = bandStarts(rows, (row) => row, (row) => row.id);
  // Round 6: the pinned group floated over Needs you with no label, a pinned waiting thread outside its band.
  expect([...starts]).toEqual([['pinned', 'pinned'], ['failed', 'needs'], ['running', 'working'], ['idle', 'earlier']]);
  expect([...bandStarts([{ ...base, id: 'p', pinned: true }, { ...base, id: 'i' }], (row) => row, (row) => row.id)]).toEqual([['p', 'pinned'], ['i', 'earlier']]);
  expect(bandStarts([{ ...base, id: 'a' }, { ...base, id: 'b' }], (row) => row, (row) => row.id).size).toBe(0);
});

test('Recent sorts and bands by the count, so the Needs you band holds every row its tab counts', () => {
  const project = { id: 'p', name: 'orbit', path: '/orbit' } as Project;
  const row = (id: string, patch: Partial<ThreadSummary>): ThreadSummary => ({
    id, title: id, projectId: 'p', status: 'idle', pinned: false, openQuestions: 0, unread: false, archived: false, updatedAt: 0, runningSince: null, createdAt: 0, lastUserMessageAt: null, ...patch
  } as ThreadSummary);
  const threads = [
    row('running', { status: 'running', lastUserMessageAt: 90 }),
    // Round 8: a running parent whose remote child asks counted under Needs you 9 yet sat in Working.
    row('child-asks', { status: 'running', lastUserMessageAt: 10, subagentQuestions: [{ threadId: 'c', title: 'Keep the key?' }] }),
    row('local-child-asks', { status: 'running', lastUserMessageAt: 20 }),
    row('stopped', { lastUserMessageAt: 30, backgroundWait: { state: 'interrupted', for: 'the build', reason: 'core-restarted', at: 30 } } as Partial<ThreadSummary>),
    row('delegating', { lastUserMessageAt: 95 }),
    row('waiting', { status: 'waiting', lastUserMessageAt: 5 }),
    row('quiet', { lastUserMessageAt: 99 })
  ];
  const delegated: Record<string, { count: number; asking: number; since: number | null }> = { 'local-child-asks': { count: 1, asking: 1, since: 20 }, delegating: { count: 2, asking: 0, since: 95 } };
  const store = { subagents: (id: string) => delegated[id] ?? null };
  const rows = threads.map(thread => ({ thread, live: storeLiveKind(store, thread) }))
    .sort((a, b) => compareThreads(a.thread, b.thread, a.live, b.live));
  expect(rows.map(r => r.thread.id)).toEqual(['stopped', 'local-child-asks', 'child-asks', 'waiting', 'running', 'delegating', 'quiet']);
  const starts = bandStarts(rows, r => r.thread, r => r.thread.id, r => r.live);
  expect([...starts]).toEqual([['stopped', 'needs'], ['running', 'working'], ['quiet', 'earlier']]);
  const { tally } = inbox([{ machine: 'pc', threads, projects: [project], questions: [], permissions: [], subagents: id => store.subagents(id) }]);
  const band = (from: string, to: string | undefined) => rows.slice(rows.findIndex(r => r.thread.id === from), to ? rows.findIndex(r => r.thread.id === to) : undefined).length;
  expect(band('stopped', 'running')).toBe(tally.threads.needs);
  expect(band('running', 'quiet')).toBe(tally.threads.working);
  // A list with no store reads the child's question on the row too.
  expect([threads[0]!, threads[1]!].sort(compareThreads).map(t => t.id)).toEqual(['child-asks', 'running']);
});

test('two Needs you rows read the age they show, newest wait first, in Recent, the home queue and the Projects card alike', () => {
  const project = { id: 'p', name: 'orbit', path: '/orbit' } as Project;
  const hour = 3_600_000;
  const now = 10 * hour;
  const row = (id: string, patch: Partial<ThreadSummary>): ThreadSummary => ({
    id, title: id, projectId: 'p', status: 'idle', pinned: false, openQuestions: 0, unread: false, archived: false, updatedAt: now, runningSince: null, createdAt: 0, lastUserMessageAt: null, ...patch
  } as ThreadSummary);
  const threads = [
    // Round 9: the band read 3m, 2h, 50m, 2h: rows sorted by the last message while they show how long they waited.
    row('benchmark', { status: 'waiting', runningSince: now - 2 * hour, lastUserMessageAt: now - 3 * hour }),
    row('export', { status: 'waiting', runningSince: now - 50 * 60_000, lastUserMessageAt: now - 9 * hour }),
    row('pick', { status: 'idle', openQuestions: 1, lastUserMessageAt: now - hour }),
    row('migrate', { status: 'waiting', runningSince: now - 3 * 60_000, lastUserMessageAt: now - 8 * hour }),
    row('quiet', { lastUserMessageAt: now })
  ];
  const store: OrderStore = {
    subagents: () => null,
    // An idle thread with an open question needs the user since the question's time.
    pendingQuestions: [{ id: 'q', threadId: 'pick', createdAt: now - 2 * hour - 60_000, questions: [] }] as unknown as OrderStore['pendingQuestions'],
    pendingPermissions: [], pendingSecrets: [], accounts: []
  };
  const recent = threads.map(thread => ({ thread, key: storeOrder(store, thread) }))
    .sort((a, b) => compareThreads(a.thread, b.thread, a.key, b.key)).map(r => r.thread.id);
  expect(recent).toEqual(['migrate', 'export', 'benchmark', 'pick', 'quiet']);
  const { needs } = inbox([{ machine: 'pc', threads, projects: [project], questions: store.pendingQuestions, permissions: [], subagents: () => 0 }]);
  expect(needs.map(card => card.thread.id)).toEqual(recent.slice(0, 4));
  // Round 9: the Projects card sorted on the status alone and dropped the asking idle row to the end of its needs lane.
  const entry = { machine: { id: 'pc', label: 'pc', store: store as never }, project } as ProjectEntry;
  expect(projectThreadLists(entry, threads, false).attention.map(t => t.id)).toEqual(recent);
});
