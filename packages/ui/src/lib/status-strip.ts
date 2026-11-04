import { requestWork, type Thread, type ThreadSummary } from '@boite/contracts';
import { needsUser } from './thread-state';
import type { Machine } from './workspace.svelte';
import type { Store } from './store.svelte';

/**
 * What the status strip above the composer says for the open thread. One
 * state at a time, the user's turn first: a thread that waits on the user
 * never reads as working, even while its turn is still open.
 */
export type StripState =
  | { kind: 'waiting'; since: number }
  | { kind: 'working'; since: number | null }
  | { kind: 'finished'; at: number }
  | null;

/** The pending cards of this thread, as the core stamped them. */
type Pending = { threadId: string; createdAt: number };

export function stripState(
  thread: Thread,
  pending: { permissions: readonly Pending[]; questions: readonly Pending[] }
): StripState {
  const cards = [...pending.permissions, ...pending.questions].filter(card => card.threadId === thread.id);
  if (needsUser(thread) || cards.length > 0) {
    // The oldest card is when the wait began; without one, the thread's last change is.
    const since = cards.length ? Math.min(...cards.map(card => card.createdAt)) : thread.updatedAt;
    return { kind: 'waiting', since };
  }
  const last = thread.turns.at(-1);
  if (thread.status === 'running' || thread.status === 'queued') {
    if (!last || last.startedAt === null) return { kind: 'working', since: null };
    // A request Boite carried on across turns counts all of its work, as the turn footer does.
    return { kind: 'working', since: last.startedAt - (requestWork(thread.turns).get(last.id) ?? 0) };
  }
  if (thread.status !== 'idle' || thread.archived || thread.backgroundWork?.kinds.length) return null;
  if (!last || last.finishedAt === null || (last.status !== 'done' && last.status !== 'stopped')) return null;
  return { kind: 'finished', at: last.finishedAt };
}

/** Another thread that waits on the user, and the machine whose store owns it. */
export type Waiting = { store: Store; thread: ThreadSummary };

/**
 * Every other thread, on every machine the user sees, that waits on the user,
 * the longest waiting first. Archived threads and the one on screen are out:
 * the link walks the user to work still open elsewhere.
 */
export function waitingElsewhere(machines: readonly Pick<Machine, 'store'>[], open: { store: Store; threadId: string | null }): Waiting[] {
  const rows: Waiting[] = [];
  for (const { store } of machines) {
    for (const thread of store.threads) {
      if (thread.archived || !needsUser(thread)) continue;
      if (store === open.store && thread.id === open.threadId) continue;
      rows.push({ store, thread });
    }
  }
  return rows.sort((a, b) => a.thread.updatedAt - b.thread.updatedAt);
}
