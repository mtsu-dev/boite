import v8 from 'node:v8';
import vm from 'node:vm';
import { expect, test } from 'vitest';
import type { Message } from '@boite/contracts';
import { flushSync, mount, unmount } from 'svelte';
import MessageOutline from '../components/MessageOutline.svelte';
import { TimelineRows } from './timeline-rows';
import { ReactiveTimelineRows } from './timeline-rows.svelte';

function forceGc(): () => void {
  v8.setFlagsFromString('--expose_gc');
  const fn = vm.runInNewContext('gc');
  expect(typeof fn).toBe('function');
  return fn as () => void;
}

async function waitForCollection(ref: WeakRef<object>): Promise<boolean> {
  const gc = forceGc();
  for (let attempt = 0; attempt < 6; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 0));
    gc();
    if (ref.deref() === undefined) return true;
  }
  return ref.deref() === undefined;
}

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

test('the outline indexes a prompt appended after history without rereading prior blocks', async () => {
  let historyReads = 0;
  const history = Array.from({ length: 512 }, (_, index): Message => ({
    ...answer(index),
    get role() {
      historyReads++;
      return index % 2 === 0 ? 'user' : 'assistant';
    },
  }));
  const messages = $state<Message[]>(history);
  const outline = mount(MessageOutline, {
    target: document.body,
    props: { messages, active: null, jump: () => {}, hasOlder: false, loading: false, loadOlder: () => {} },
  });
  try {
    flushSync();
    const rail = document.querySelector('[data-testid=message-outline]')!;
    expect(rail.getAttribute('data-message-count')).toBe('256');
    historyReads = 0;
    messages.push({ ...answer(512), role: 'user' });
    flushSync();
    expect(historyReads).toBe(0);
    expect(rail.getAttribute('data-message-count')).toBe('257');
    messages.splice(-1);
    flushSync();
    expect(rail.getAttribute('data-message-count')).toBe('256');
  } finally {
    await unmount(outline);
  }
});

test('unmounting the outline releases its reactive links to a long-lived message list', async () => {
  const messages = $state<Message[]>(Array.from({ length: 8 }, (_, index) => ({
    ...answer(index),
    role: index % 2 === 0 ? 'user' : 'assistant',
  })));
  let ref!: WeakRef<object>;
  const mountAndLeave = async () => {
    const sentinel = { tag: 'unmounted-outline' };
    ref = new WeakRef(sentinel);
    const outline = mount(MessageOutline, {
      target: document.body,
      props: {
        get messages() { return messages; },
        active: null,
        jump: () => { void sentinel; },
        hasOlder: false,
        loading: false,
        loadOlder: () => {},
      },
    });
    flushSync();
    await unmount(outline);
    flushSync();
  };
  await mountAndLeave();
  expect(await waitForCollection(ref)).toBe(true);
});

test('streaming parts do not recreate memos or retain them after the timeline stops', async () => {
  let memos = 0;
  const rows = new TimelineRows(read => {
    memos++;
    return read;
  });
  const live: Message = { ...answer(0), state: 'streaming' };
  const list = [live];
  rows.prepare(list);
  const afterPrepare = memos;
  expect(afterPrepare).toBeGreaterThan(0);
  rows.build(list);
  expect(memos).toBe(afterPrepare);
  for (let index = 0; index < 10; index++) {
    live.parts.push({ type: 'text', text: `Part ${index}` });
    rows.prepare(list);
    rows.build(list);
  }
  expect(memos).toBe(afterPrepare);

  // Also verify real Svelte deriveds detach cleanly from a shared reactive message list.
  const shared = $state<Message[]>([{ ...answer(0), state: 'streaming' }]);
  let ref!: WeakRef<object>;
  const runAndStop = () => {
    const sentinel = { id: 'mem-1', messageId: shared[0]!.id, partIndex: 0, kind: 'remembered', text: 'note', at: 1 } as never;
    const memory = new Map([[shared[0]!.id, [sentinel]]]);
    ref = new WeakRef(sentinel);
    let stop: (() => void) | null = $effect.root(() => {
      const timeline = new ReactiveTimelineRows(() => ({ timeline: shared, memory }));
      $effect(() => { void timeline.build(); });
    });
    flushSync();
    for (let index = 0; index < 10; index++) {
      shared[0]!.parts.push({ type: 'text', text: `Chunk ${index}` });
      flushSync();
    }
    stop();
    stop = null;
    flushSync();
  };
  runAndStop();
  expect(await waitForCollection(ref)).toBe(true);
});
