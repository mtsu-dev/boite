import type { AgentProfile, AgentStatus, ThreadSummary } from '@boite/contracts';
import type { Delegated } from './thread-state';
import { storeNeedsKeys, type HeldAsks } from './activity-feed';

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

type WaitingStore = HeldAsks & {
  threads: readonly ThreadSummary[];
  subagents(threadId: string): Delegated;
};

/**
 * What needs the user on every machine: the rows of Activity's Needs you
 * section (a thread that asks or failed, a helper's question once, on its
 * parent; a bot's own conversation counts on its picture, a team's or a
 * salon's nowhere). The rail's Activity badge and the phone's Activity tab
 * add what contacts ask, as the section lists it above. `seen` leaves out the rows a middle click on the rail's
 * Activity already saw, by their keys (`storeNeedsKeys`, lib/activity-seen.svelte.ts).
 */
export function threadsNeedingYou<S extends WaitingStore>(stores: readonly S[], seen: (store: S, key: string) => boolean = () => false): number {
  return stores.reduce((total, store) => total + storeNeedsKeys(store, store.threads).filter(key => !seen(store, key)).length, 0);
}
