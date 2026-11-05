import { expect, test } from 'vitest';
import { bandStarts, compareThreads } from './thread-order';

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
