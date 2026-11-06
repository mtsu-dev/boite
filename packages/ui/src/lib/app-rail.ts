import type { AgentProfile, AgentStatus, ThreadSummary } from '@boite/contracts';
import { threadState, type Delegated } from './thread-state';

/** How a bot stands, for its picture in the app rail and its row in the phone's bot list. */
export type RailBotState = 'waiting' | 'failed' | 'working' | 'queued' | 'paused' | 'idle';

/**
 * How a bot stands: its thread's row first, live between two snapshots, then
 * the snapshot's status. `asking` is a question of its thread still open.
 * Paused, by itself or with every bot, it sleeps between the turns you start.
 * The rail and the bot list both read it, so they never disagree.
 */
export function railBotState(profile: Pick<AgentProfile, 'status'>, status: AgentStatus | null, thread: Pick<ThreadSummary, 'status'> | null, asking: boolean): RailBotState {
  if (thread?.status === 'running') return asking ? 'waiting' : 'working';
  if (thread?.status === 'queued') return 'queued';
  if (thread?.status === 'waiting' || asking) return 'waiting';
  const state = status?.state;
  if (state === 'working' || state === 'queued') return state;
  if (state === 'waiting') return 'waiting';
  if (state === 'error' || status?.problem) return 'failed';
  return profile.status === 'paused' || state === 'paused' ? 'paused' : 'idle';
}

interface WaitingStore {
  threads: readonly (Parameters<typeof threadState>[0] & { id: string; archived?: boolean; agentSessionId?: string | null; teamId?: string | null; parentThreadId?: string | null })[];
  subagents(threadId: string): Delegated;
}

/**
 * The threads of every machine that wait on the user, the count the Threads
 * button carries: the sidebar's own test (`threadState`), so the two never
 * disagree. A bot's or a team's conversation counts on its own picture instead,
 * and a subagent's question once, on its parent.
 */
export function threadsNeedingYou(stores: readonly WaitingStore[]): number {
  let count = 0;
  for (const store of stores) {
    for (const thread of store.threads) {
      if (thread.archived || thread.agentSessionId || thread.teamId || thread.parentThreadId) continue;
      if (threadState(thread, store.subagents(thread.id)) === 'waiting') count += 1;
    }
  }
  return count;
}
