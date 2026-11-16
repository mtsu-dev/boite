import { expect, test } from 'vitest';
import type { Message } from '@boite/contracts';
import { markdownAnswer } from './fake-client/markdown-thread';
import { HistoryPrepare, SliceWarmth, WARM_SLICE_MS } from './row-cost';
import { TimelineRows } from './timeline-rows';

function answers(count: number): Message[] {
  let seed = 11;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  return Array.from({ length: count }, (_, index) => [
    { id: `q-${index}`, threadId: 't-1', turnId: `turn-${index}`, role: 'user', parts: [{ type: 'text', text: 'Explain' }], state: 'complete', createdAt: index },
    { id: `a-${index}`, threadId: 't-1', turnId: `turn-${index}`, role: 'assistant', parts: [{ type: 'text', text: markdownAnswer(random, 30_000), complete: true }], state: 'complete', createdAt: index }
  ] as Message[]).flat();
}

test('the slices of the answers at the window edges mount, then lay out, in idle periods, a step only while a period has room for it, up to their answers\' ends', () => {
  const rows = new TimelineRows().build(answers(3));
  const middle = rows.filter(row => row.message.id === 'a-1');
  expect(middle.length).toBeGreaterThanOrEqual(5);
  // The window holds two slices in the middle of answer a-1.
  const start = rows.indexOf(middle[2]!), end = start + 2;
  const painted: (() => void)[] = [];
  const warmth = new SliceWarmth(run => painted.push(run));
  const idle: ((left: () => number) => void)[] = [];
  // A slice takes 20 ms to mount and 20 ms more to lay out on this clock.
  let clock = 0, grew = 0;
  const laid: string[] = [];
  const wake = () => warmth.wake(() => ({ rows, ...warmth.widen(rows, start, end) }), () => { grew += 1; clock += 20; }, id => { laid.push(id); clock += 20; }, run => { idle.push(run); return () => {}; }, () => clock);
  // Nothing before the opened thread has painted, then one idle period asked for, however often the window wakes it.
  wake();
  wake();
  expect(idle.length).toBe(0);
  expect(painted.length).toBe(1);
  painted.shift()!();
  wake();
  expect(idle.length).toBe(1);
  // A period with less left than a slice costs mounts nothing and asks for the next one.
  idle.shift()!(() => WARM_SLICE_MS - 1);
  expect(grew).toBe(0);
  expect(idle.length).toBe(1);
  for (let round = 0; round < 40 && idle.length; round += 1) {
    const from = clock;
    idle.shift()!(() => 50 - (clock - from));
    // 50 ms: one step at the first guess, a second once timed at 20 ms, not a third with 10 ms left.
    expect(clock - from).toBeLessThanOrEqual(50);
    // A mounted slice is laid out before the next one mounts.
    expect(grew - laid.length).toBeLessThanOrEqual(1);
    wake();
  }
  // The whole answer is mounted, and nothing of the messages around it.
  const { start: first, end: last } = warmth.widen(rows, start, end);
  expect(rows.slice(first, last).map(row => row.id)).toEqual(middle.map(row => row.id));
  expect(grew).toBe(middle.length - 2);
  expect(laid).toEqual([...middle.slice(4), ...middle.slice(0, 2).reverse()].map(row => row.id));
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
