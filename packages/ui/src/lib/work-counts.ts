import { threadBusy, type ThreadId, type ThreadSummary } from '@boite/contracts';
import type { Store } from './store.svelte';
import { needsUser } from './thread-state';
import { inbox, storeSources, type LiveTally, type Tally } from './inbox';

/**
 * What one side of a badge shows: the needs-you count in the waiting colour
 * when anything there needs the user, else the working count in the accent.
 * A badge never adds the two: each number counts one thing.
 */
export interface Badge {
  count: number;
  waiting: boolean;
  /** The words for its tooltip and accessible name come from the caller; this says what the number is. */
  counts: 'needs' | 'working';
}

export function badgeOf(tally: Tally): Badge {
  return tally.needs > 0 ? { count: tally.needs, waiting: true, counts: 'needs' } : { count: tally.working, waiting: false, counts: 'working' };
}

/** Every count the app shows, the project threads and the bots apart, with the delegated agents at work under the project threads. */
export interface WorkTally extends LiveTally {
  subagents: number;
}

/**
 * The one selector behind every live count: the lifecycle strip, the Inbox
 * headers and its tab badge, the switch on both sides, the phone tabs and
 * Next. It is the Inbox's own pass (`inbox`), so the lists and the numbers
 * never disagree. A machine that is not connected counts nothing: a laptop
 * gone to sleep mid-turn would otherwise count as at work for hours.
 * `subagents` counts the delegated agents at work or asking under the counted
 * project threads, at any depth: seven sub-agents are seven agents running,
 * but they are no rows, so they ride apart behind their own glyph.
 */
export function workTally(stores: readonly Store[]): WorkTally {
  const { tally } = inbox(storeSources(stores.map(store => ({ store }))));
  let subagents = 0;
  for (const store of stores) {
    if (store.connection !== 'ready') continue;
    const children = new Map<ThreadId, ThreadSummary[]>();
    for (const thread of store.threads) {
      if (!thread.parentThreadId || thread.archived) continue;
      const held = children.get(thread.parentThreadId);
      if (held) held.push(thread);
      else children.set(thread.parentThreadId, [thread]);
    }
    const seen = new Set<ThreadId>();
    const descend = (parent: ThreadId) => {
      for (const child of children.get(parent) ?? []) {
        if (seen.has(child.id)) continue;
        seen.add(child.id);
        if (needsUser(child) || threadBusy(child)) subagents++;
        descend(child.id);
      }
    };
    for (const project of store.projects) {
      if (project.archived) continue;
      for (const thread of store.threadsOf(project.id)) descend(thread.id);
    }
  }
  return { ...tally, subagents };
}
