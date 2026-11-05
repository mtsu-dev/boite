import { requestWork, type Thread, type ThreadSummary } from '@boite/contracts';
import { needsUser } from './thread-state';
import { inbox, storeSources } from './inbox';
import type { Machine } from './workspace.svelte';
import type { Store } from './store.svelte';

/**
 * What the status strip above the composer says for the open thread. One
 * state at a time, the user's turn first: a thread blocked on the user never
 * reads as working, even while its turn is still open. A question asked
 * without stopping, while the turn runs, reads as work with a question.
 */
export type StripState =
  | { kind: 'waiting'; since: number }
  | { kind: 'working'; since: number | null }
  /** At work with a question open beside the turn (`boite ask`): an answer is asked, nothing is blocked. */
  | { kind: 'asking'; since: number | null; asked: number }
  | { kind: 'finished'; at: number }
  | null;

/** The pending cards of this thread, as the core stamped them; `async` marks a question asked without stopping. */
type Pending = { threadId: string; createdAt: number; async?: boolean };

export function stripState(
  thread: Thread,
  pending: { permissions: readonly Pending[]; questions: readonly Pending[] }
): StripState {
  const cards = [...pending.permissions, ...pending.questions].filter(card => card.threadId === thread.id);
  const oldest = (list: readonly Pending[], fallback: number) => list.length ? Math.min(...list.map(card => card.createdAt)) : fallback;
  const last = thread.turns.at(-1);
  const runs = thread.status === 'running' || thread.status === 'queued';
  // A request Boite carried on across turns counts all of its work, as the turn footer does.
  const workSince = !last || last.startedAt === null ? null : last.startedAt - (requestWork(thread.turns).get(last.id) ?? 0);
  // Blocked on the user: a card that stopped the turn, a permission, or a question once no turn runs.
  const blocking = cards.filter(card => card.async !== true);
  if (blocking.length > 0 || thread.status === 'waiting' || (!runs && (needsUser(thread) || cards.length > 0))) {
    // The oldest card is when the wait began; without one, the thread's last change is.
    return { kind: 'waiting', since: oldest(blocking.length ? blocking : cards, thread.updatedAt) };
  }
  // The turn goes on while a question waits beside it: still work, with an answer asked.
  if (needsUser(thread) || cards.length > 0) return { kind: 'asking', since: workSince, asked: oldest(cards, thread.updatedAt) };
  if (runs) return { kind: 'working', since: workSince };
  if (thread.status !== 'idle' || thread.archived || thread.backgroundWork?.kinds.length) return null;
  if (!last || last.finishedAt === null || (last.status !== 'done' && last.status !== 'stopped')) return null;
  return { kind: 'finished', at: last.finishedAt };
}

/** Another thread that waits on the user, and the machine whose store owns it. */
export type Waiting = { store: Store; thread: ThreadSummary };

/**
 * Every other thread, on every machine the user sees, that waits on the user,
 * in the Inbox's order (Recent's Needs you order) and by the Inbox's rule, so
 * the walk and the home count the same threads. The one on screen is out:
 * the link walks the user to work still open elsewhere.
 */
export function waitingElsewhere(machines: readonly Pick<Machine, 'store'>[], open: { store: Store; threadId: string | null }): Waiting[] {
  return inbox(storeSources(machines)).needs
    .filter(card => !(card.machine.store === open.store && card.thread.id === open.threadId))
    .map(card => ({ store: card.machine.store, thread: card.thread }));
}
