import { expect, test } from 'vitest';
import type { Message } from '@boite/contracts';
import { markdownAnswer } from './fake-client/markdown-thread';
import { HistoryPrepare, SliceWarmth, WARM_ROWS } from './row-cost';
import { TimelineRows } from './timeline-rows';

function answers(count: number): Message[] {
  let seed = 11;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  return Array.from({ length: count }, (_, index) => [
    { id: `q-${index}`, threadId: 't-1', turnId: `turn-${index}`, role: 'user', parts: [{ type: 'text', text: 'Explain' }], state: 'complete', createdAt: index },
    { id: `a-${index}`, threadId: 't-1', turnId: `turn-${index}`, role: 'assistant', parts: [{ type: 'text', text: markdownAnswer(random, 30_000), complete: true }], state: 'complete', createdAt: index }
  ] as Message[]).flat();
}

test('the slices of the answers at the window edges mount in idle time, a few rows a slice, up to their answers\' ends', () => {
  const rows = new TimelineRows().build(answers(3));
  const middle = rows.filter(row => row.message.id === 'a-1');
  expect(middle.length).toBeGreaterThanOrEqual(5);
  // The window holds two slices in the middle of answer a-1.
  let start = rows.indexOf(middle[2]!), end = start + 2;
  const warmth = new SliceWarmth();
  const idle: (() => void)[] = [];
  let grew = 0;
  const wake = () => warmth.wake(() => ({ rows, ...warmth.widen(rows, start, end) }), () => { grew += 1; }, run => { idle.push(run); return () => {}; });
  wake();
  // One idle slice asked for, however often the window wakes it.
  wake();
  expect(idle.length).toBe(1);
  for (let round = 0; round < 20 && idle.length; round += 1) {
    const before = warmth.widen(rows, start, end);
    idle.shift()!();
    const after = warmth.widen(rows, start, end);
    expect(before.start - after.start).toBeLessThanOrEqual(WARM_ROWS);
    expect(after.end - before.end).toBeLessThanOrEqual(WARM_ROWS);
    wake();
  }
  // The whole answer is mounted, and nothing of the messages around it.
  const { start: from, end: to } = warmth.widen(rows, start, end);
  expect(rows.slice(from, to).map(row => row.id)).toEqual(middle.map(row => row.id));
  expect(grew).toBeGreaterThan(0);
  expect(idle.length).toBe(0);
});

test('the slices next to the window are sent to the worker first, the rest of the page after them', () => {
  const rows = new TimelineRows().build(answers(4));
  const edge = rows.filter(row => row.message.id === 'a-2');
  const start = rows.indexOf(edge[1]!), end = start + 1;
  const batches: string[][] = [];
  const chars = new HistoryPrepare().prepare(rows, start, end, false, async (blocks) => { batches.push([...blocks]); return 'worker'; });
  expect(chars).toBeGreaterThan(0);
  expect(batches.length).toBe(2);
  const sliceOf = (row: (typeof rows)[number]) => { const part = row.message.parts[0]!; return part.type === 'text' ? part.text.slice(row.text!.start, row.text!.end) : ''; };
  // The first batch is the edge answer's other slices, and only them.
  const near = edge.filter(row => row !== edge[1]).map(sliceOf).join('');
  expect(batches[0]!.every(block => near.includes(block.trim()))).toBe(true);
  expect(batches[0]!.length).toBeGreaterThan(0);
  expect(batches[1]!.length).toBeGreaterThan(batches[0]!.length);
});
