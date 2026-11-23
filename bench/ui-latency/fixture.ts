import type { AgentProfile, AgentRecord, Thread } from '../../packages/contracts/src/index.ts';

export const HISTORY = 'latency-history';
export const POOL_SIZE = 32;
export const MOCHI = 'Latency Mochi';
export const SIZES = [100, 1000, 5000];

interface LatencyContext {
  threads: Map<string, Thread>;
  thread(id: string): Thread;
  agents: { seedAgent(profile: Omit<AgentProfile, keyof AgentRecord>, at: number): { threadId: string } };
}

function fillHistory(thread: Thread, count: number, samples: Thread): void {
  const start = Date.now() - 86_400_000;
  thread.turns = Array.from({ length: count / 2 }, (_, index) => {
    const at = start + index * 5000;
    return {
      id: `turn-${thread.id}-${index}`, threadId: thread.id, status: 'done',
      queuedAt: at, startedAt: at, finishedAt: at + 3000, error: null, usage: null,
    };
  });
  thread.messages = Array.from({ length: count }, (_, index) => {
    const sample = samples.messages[index % samples.messages.length]!;
    return {
      ...sample,
      id: `m-${thread.id}-${index}`,
      threadId: thread.id,
      turnId: thread.turns[Math.floor(index / 2)]!.id,
      createdAt: start + index * 2500,
    };
  });
}

/** Runs only in the benchmark bundle, before any client replies or events. */
export function seedLatency(ctx: LatencyContext, makeSample: () => Thread, idle: (count: number) => void): void {
  const params = new URLSearchParams(location.search);
  const count = Number(params.get('latency'));
  if (!SIZES.includes(count)) return;
  const samples = makeSample();
  const history = {
    ...samples, id: HISTORY, title: 'Latency history', pinned: true,
    sessionId: 'latency-history-session', updatedAt: Date.now() - 1000,
  };
  fillHistory(history, count, samples);
  ctx.threads.set(history.id, history);
  if (params.has('typing')) idle(POOL_SIZE - Number(params.get('working') ?? 0));
  if (!params.has('mochi')) return;
  const agent = ctx.agents.seedAgent({
    name: MOCHI, domain: 'Release review', instructions: 'Review the test results.', avatar: '',
    selection: { providerId: 'echo', accountId: 'a-echo', model: null, effort: null, permissionMode: 'default' },
    status: 'active', projectIds: ['p-boite'],
  }, Date.now() - 86_400_000);
  fillHistory(ctx.thread(agent.threadId), count, samples);
}
