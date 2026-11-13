import { expect, test } from 'vitest';
import type { AgentsView } from './agents.svelte';
import type { Store } from './store.svelte';
import { awaitsFirstTask } from './bot-first-task';

const thread = (over: Record<string, unknown> = {}) => ({ id: 't1', agentSessionId: 's1', messages: [], status: 'idle', ...over });
const store = (open: unknown, over: Record<string, unknown> = {}) => ({ openThread: open, loadingThreadId: null, staged: {}, ...over }) as unknown as Store;
const view = (watches: { agentId: string }[]) => ({ snapshot: { watches } }) as unknown as AgentsView;

test('the first-task prompt waits for a mochi with an empty desk and a conversation with nothing in it or on its way', () => {
  expect(awaitsFirstTask(store(thread()), view([]), 'a')).toBe(true);
  // Another bot's desk says nothing about this one.
  expect(awaitsFirstTask(store(thread()), view([{ agentId: 'b' }]), 'a')).toBe(true);
  expect(awaitsFirstTask(store(thread()), view([{ agentId: 'a' }]), 'a')).toBe(false);
  expect(awaitsFirstTask(store(thread({ messages: [{}] })), view([]), 'a')).toBe(false);
  expect(awaitsFirstTask(store(thread({ status: 'running' })), view([]), 'a')).toBe(false);
  // Still loading, or a first prompt on its way: not yet empty.
  expect(awaitsFirstTask(store(thread(), { loadingThreadId: 't1' }), view([]), 'a')).toBe(false);
  expect(awaitsFirstTask(store(thread(), { staged: { t1: {} } }), view([]), 'a')).toBe(false);
  // An ordinary thread is no bot's conversation.
  expect(awaitsFirstTask(store(thread({ agentSessionId: undefined })), view([]), 'a')).toBe(false);
});
