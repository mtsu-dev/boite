import type { ThreadSummary } from '@boite/contracts';
import type { Delegated } from './thread-state';
import { threadRank } from './status-order';

/** What the order reads of a thread: its pin, what its state says (lib/status-order.ts) and when the user last spoke. */
type Ordered = Pick<ThreadSummary, 'pinned' | 'status' | 'lastUserMessageAt' | 'createdAt'>
  & Partial<Pick<ThreadSummary, 'unread' | 'backgroundWork' | 'openQuestions' | 'backgroundWait' | 'pullRequestWatches'>>;

/** When the user last spoke in it. `updatedAt` moves on every event, so ordering by it makes rows jitter. */
export function lastActivity(thread: Pick<ThreadSummary, 'lastUserMessageAt' | 'createdAt'>): number {
  return thread.lastUserMessageAt ?? thread.createdAt;
}

/**
 * The lists' order, in both views and on both devices: pinned threads, then the status order (needs you, failed,
 * working, the rest), then the last message. `delegated` reads a thread's helpers, so one whose helper asks ranks as
 * needing the user; without it a thread's own state decides.
 */
export function threadOrder<T extends Ordered>(delegated: (thread: T) => Delegated = () => 0): (a: T, b: T) => number {
  return (a, b) => Number(b.pinned) - Number(a.pinned)
    || threadRank(a as unknown as ThreadSummary, delegated(a)) - threadRank(b as unknown as ThreadSummary, delegated(b))
    || lastActivity(b) - lastActivity(a);
}

/** The order without the helpers' questions, for a list that does not know them. */
export const compareThreads: (a: Ordered, b: Ordered) => number = threadOrder();

type Entry = { thread: Ordered & { id: string }; machine: { store: { subagents(threadId: string): Delegated } } };

/** The same order for rows of several machines: each reads its helpers through the store that holds it. */
export function compareEntries(a: Entry, b: Entry): number {
  return Number(b.thread.pinned) - Number(a.thread.pinned)
    || threadRank(a.thread as ThreadSummary, a.machine.store.subagents(a.thread.id)) - threadRank(b.thread as ThreadSummary, b.machine.store.subagents(b.thread.id))
    || lastActivity(b.thread) - lastActivity(a.thread);
}
