import { afterEach, expect, test } from 'vitest';
import { FakeClient } from './fake-client';
import { Store } from './store.svelte';
import { agentsAtWork, subagentsAtWork, threadsAtWork } from './work-counts';

const stores: Store[] = [];
afterEach(() => { for (const store of stores.splice(0)) { store.client?.close(); store.detach(); } });

async function ready() {
  const store = new Store();
  store.attach(new FakeClient({ delayMs: 0 }));
  await store.connect();
  stores.push(store);
  return store;
}

test('an entrusted thread mid-turn counts once among the agents at work', async () => {
  const store = await ready();
  const { agentDirectory } = await import('./agent-directory.svelte');
  store.threads = store.threads.map(thread => ({ ...thread, status: thread.id === 't-scheduler' ? 'running' : 'idle', openQuestions: 0, backgroundWork: null }));
  const snapshot = { profiles: [{ id: 'agent-1', name: 'Mira', status: 'active' }], sessions: [], runs: [], work: [], entrusted: [] };
  agentDirectory(store).snapshot = snapshot as never;
  expect(agentsAtWork([store])).toEqual({ count: 0, waiting: false });
  // Entrusted, and the agent's own work runs in that same thread: one thread, one count.
  agentDirectory(store).snapshot = { ...snapshot, entrusted: [{ threadId: 't-scheduler', agentId: 'agent-1', at: 0 }],
    work: [{ id: 'w-1', agentId: 'agent-1', status: 'running', runId: 'r-1' }], runs: [{ id: 'r-1', threadId: 't-scheduler', startedAt: 0 }] } as never;
  // The fake holds a question for this thread that its summary does not count yet: it still counts, in the waiting colour,
  // as its row shows it (lib/status-order.ts rowAsks), not dropped as neither working nor asking.
  expect(agentsAtWork([store])).toEqual({ count: 1, waiting: true });
});

test('an agent whose own thread rests but asks the user counts, in the waiting colour', async () => {
  const store = await ready();
  const { agentDirectory } = await import('./agent-directory.svelte');
  store.threads = store.threads.map(thread => ({ ...thread, status: 'idle', openQuestions: 0, backgroundWork: null, unread: false,
    ...(thread.id === 't-trace' ? { agentSessionId: 'session-1', openQuestions: 1 } : {}) }));
  agentDirectory(store).snapshot = { profiles: [{ id: 'agent-1', name: 'Mira', status: 'active' }], sessions: [{ id: 'session-1', agentId: 'agent-1' }], work: [], runs: [], entrusted: [] } as never;
  expect(agentsAtWork([store])).toEqual({ count: 1, waiting: true });
});

test("the Threads button counts every listed conversation at work, a bot's own thread and an archived project's left out", async () => {
  const store = await ready();
  // The seed's two rows with nothing held for the user (a question or permission makes a running row ask instead), one per project.
  const at = (ids: string[]) => store.threads.map(thread => ({ ...thread, status: ids.includes(thread.id) ? 'running' as const : 'idle' as const, openQuestions: 0, backgroundWork: null, unread: false }));
  store.threads = at([]);
  expect(threadsAtWork([store])).toBe(0);
  store.threads = at(['t-trace', 't-descriptors']);
  expect(threadsAtWork([store, store])).toBe(4);
  // A bot's own conversation is the bot's picture's to show, not the threads'.
  store.threads = store.threads.map(thread => thread.id === 't-trace' ? { ...thread, agentSessionId: 'session-1' } : thread);
  expect(threadsAtWork([store])).toBe(1);
  store.projects = store.projects.map(entry => entry.id === 'p-notes' ? { ...entry, archived: true } : entry);
  expect(threadsAtWork([store])).toBe(0);
});

test("the Threads button's second number counts the subagents at work, a bot's helper and an archived project's left out", async () => {
  const store = await ready();
  const rest = { status: 'idle' as const, openQuestions: 0, backgroundWork: null, backgroundWait: null, unread: false };
  // t-descriptors becomes t-trace's subagent, mid-turn: off the Threads count, on the subagents one.
  store.threads = store.threads.map(thread => thread.id === 't-descriptors'
    ? { ...thread, ...rest, status: 'running' as const, parentThreadId: 't-trace', projectId: 'p-boite' }
    : { ...thread, ...rest });
  expect(subagentsAtWork([store])).toBe(1);
  expect(subagentsAtWork([store, store])).toBe(2);
  // Its parent counts once, delegating; the subagent itself never reaches the Threads count.
  expect(threadsAtWork([store])).toBe(1);
  // At rest it stops counting; waiting on its own background work it counts again.
  const child = (patch: object) => { store.threads = store.threads.map(thread => thread.id === 't-descriptors' ? { ...thread, ...patch } : thread); };
  child({ status: 'idle' });
  expect(subagentsAtWork([store])).toBe(0);
  child({ backgroundWait: { state: 'waiting', since: 0 } });
  expect(subagentsAtWork([store])).toBe(1);
  // A bot's helper is a listed conversation: the Threads count holds it, never both.
  const bot = (agentSessionId: string | null) => { store.threads = store.threads.map(thread => thread.id === 't-trace' ? { ...thread, agentSessionId } as typeof thread : thread); };
  child({ status: 'running', backgroundWait: null });
  bot('session-1');
  expect(subagentsAtWork([store])).toBe(0);
  expect(threadsAtWork([store])).toBe(1);
  bot(null);
  expect(subagentsAtWork([store])).toBe(1);
  store.projects = store.projects.map(entry => entry.id === 'p-boite' ? { ...entry, archived: true } : entry);
  expect(subagentsAtWork([store])).toBe(0);
});
