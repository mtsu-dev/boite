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
  threads: readonly (Parameters<typeof threadState>[0] & { id: string; archived?: boolean; incognito?: boolean; agentSessionId?: string | null; teamId?: string | null; councilId?: string | null; parentThreadId?: string | null; parentIsBot?: boolean })[];
  subagents(threadId: string): Delegated;
}

/**
 * The threads of every machine that wait on the user: the one count the rail's
 * Activity, the phone's Activity tab and the list's marks all carry, so they
 * never disagree. It is Activity's top rows that wait (`threadState`): a bot's
 * own conversation counts on its picture, a team's or a salon's nowhere, and a
 * helper's question once, on its parent; a bot's worker has no parent row, so
 * it counts for itself.
 */
export function threadsNeedingYou(stores: readonly WaitingStore[]): number {
  let count = 0;
  for (const store of stores) {
    const bots = new Set(store.threads.filter(thread => thread.agentSessionId).map(thread => thread.id));
    for (const thread of store.threads) {
      if (thread.archived || thread.incognito || thread.agentSessionId || thread.teamId || thread.councilId) continue;
      if (thread.parentThreadId && !thread.parentIsBot && !bots.has(thread.parentThreadId)) continue;
      if (threadState(thread, store.subagents(thread.id)) === 'waiting') count += 1;
    }
  }
  return count;
}
