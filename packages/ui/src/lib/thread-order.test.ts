import { expect, test } from 'vitest';
import { compareEntries, compareThreads } from './thread-order';

const base = { pinned: false, status: 'idle' as const, lastUserMessageAt: null, createdAt: 0 };

test('a waiting thread sorts above an idle one with a newer message', () => {
  const idle = { ...base, id: 'idle', lastUserMessageAt: 2_000 };
  const waiting = { ...base, id: 'waiting', status: 'waiting' as const, lastUserMessageAt: 1_000 };
  expect([idle, waiting].sort(compareThreads).map((t) => t.id)).toEqual(['waiting', 'idle']);
});

test('pinned first, then waiting, running, queued, idle, then the last message', () => {
  const rows = [
    { ...base, id: 'old-idle', lastUserMessageAt: 1 },
    { ...base, id: 'new-idle', lastUserMessageAt: 9 },
    { ...base, id: 'running', status: 'running' as const },
    { ...base, id: 'queued', status: 'queued' as const },
    { ...base, id: 'waiting', status: 'waiting' as const },
    { ...base, id: 'pinned', pinned: true, createdAt: 5 }
  ];
  expect(rows.sort(compareThreads).map((t) => t.id)).toEqual(['pinned', 'waiting', 'running', 'queued', 'new-idle', 'old-idle']);
});

test('one status order: the user\'s turn (a question asked at work, a helper that asks), then a failure, then work', () => {
  const rows = [
    { ...base, id: 'running', status: 'running' as const, lastUserMessageAt: 9 },
    { ...base, id: 'failed', status: 'error' as const, lastUserMessageAt: 8 },
    { ...base, id: 'asks-at-work', status: 'running' as const, openQuestions: 1, lastUserMessageAt: 1 },
    { ...base, id: 'helper-asks', status: 'running' as const, lastUserMessageAt: 2 }
  ];
  const store = { subagents: (id: string) => (id === 'helper-asks' ? { count: 1, asking: 1 } : 0) };
  const entries = rows.map(thread => ({ thread, machine: { store } }));
  expect(entries.sort(compareEntries).map(entry => entry.thread.id)).toEqual(['helper-asks', 'asks-at-work', 'failed', 'running']);
  // Without the helpers, a thread's own state decides.
  expect(rows.sort(compareThreads).map(t => t.id)).toEqual(['asks-at-work', 'failed', 'running', 'helper-asks']);
});
