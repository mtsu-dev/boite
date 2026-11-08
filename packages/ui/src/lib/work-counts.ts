import type { ThreadSummary } from '@boite/contracts';
import type { Store } from './store.svelte';
import { agentDirectory } from './agent-directory.svelte';
import { threadState } from './thread-state';
import { workingThread } from './recent.svelte';
import { rowAsks } from './status-order';

/** How many bots are at work, for the phone's Bots tab, and whether one of them waits on the user. */
export interface WorkCount {
  count: number;
  waiting: boolean;
}

/**
 * The agents at work: every persistent agent with a turn under way, a
 * question for the user or work left running, and every entrusted thread
 * mid-turn, one thread counted once. The agents snapshot only loads with the
 * Agents experiment on; without it nothing counts here.
 */
export function agentsAtWork(stores: readonly Store[]): WorkCount {
  let count = 0;
  let waiting = false;
  for (const store of stores) {
    const seen = new Set<string>();
    const add = (thread: ThreadSummary, asks: boolean) => {
      if (seen.has(thread.id)) return;
      seen.add(thread.id);
      count++;
      waiting ||= asks;
    };
    const directory = agentDirectory(store);
    // The user's turn as the rows read it: a question or permission the machine holds counts before the summary does.
    const asking = (thread: ThreadSummary) => threadState(thread, rowAsks(store, thread.id)) === 'waiting';
    for (const { thread, waiting: asks } of directory.atWork) add(thread, asks || asking(thread));
    const busy = (thread: ThreadSummary) => asking(thread) || workingThread(store, thread);
    // An agent's own thread at rest can still ask the user (`boite ask`) or keep work in the background.
    for (const thread of store.threads) {
      if (!thread.archived && thread.agentSessionId && busy(thread) && directory.ownerOf(thread)) add(thread, asking(thread));
    }
    for (const { thread } of directory.entrusted) if (busy(thread)) add(thread, asking(thread));
  }
  return { count, waiting };
}
