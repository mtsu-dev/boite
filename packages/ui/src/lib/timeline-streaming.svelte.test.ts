import { expect, test } from 'vitest';
import type { Message } from '@boite/contracts';
import { ReactiveTimelineRows } from './timeline-rows.svelte';

function answer(index: number): Message {
  return { id: `m-${index}`, turnId: `t-${index}`, threadId: 'thread', role: 'assistant', parts: [{ type: 'text', text: 'Work done' }], state: 'complete', createdAt: index };
}

test('a new row from the live answer only rereads the end of the history', () => {
  let historyReads = 0;
  const history = Array.from({ length: 500 }, (_, index) => {
    const { parts, ...fields } = answer(index);
    return { ...fields, get parts() { historyReads++; return parts; } };
  });
  const messages = $state<Message[]>([...history, { ...answer(500), state: 'streaming' }]);
  const timeline = new ReactiveTimelineRows(() => ({ timeline: messages }));
  const rows = $derived(timeline.build());
  const read = () => rows;
  const before = read();
  historyReads = 0;
  messages.at(-1)!.parts.push({ type: 'text', text: 'Another paragraph' });
  expect(read().at(-1)?.to).toBe(2);
  expect(read()[0]).toBe(before[0]);
  expect(historyReads).toBeLessThan(32);
});

test('the live window does not split a run of failed attempts', () => {
  const messages = $state([
    ...Array.from({ length: 40 }, (_, index): Message => ({
      ...answer(index), parts: [{ type: 'error', message: 'Failed attempt' }],
    })),
    { ...answer(40), state: 'streaming' as const },
  ]);
  const timeline = new ReactiveTimelineRows(() => ({ timeline: messages }));
  expect(timeline.build().map(row => row.failures?.length ?? 0)).toEqual([40, 0]);
  messages.at(-1)!.state = 'complete';
  messages.at(-1)!.parts = [{ type: 'error', message: 'Latest failed attempt' }];
  expect(timeline.build().map(row => row.failures?.length)).toEqual([41]);
});
