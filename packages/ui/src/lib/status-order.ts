import type { ThreadId } from '@boite/contracts';
import { threadState, type Delegated, type ThreadState } from './thread-state';
import type { WorkingChildren } from './thread-rows';

/**
 * The one status order of every list, count and badge: the user's turn, then
 * a failure, then work (running before queued), then the rest. A thread whose
 * agent asks without stopping (`openQuestions`) or whose helper asks ranks as
 * the user's turn, never as work.
 */
export function statusRank(state: ThreadState | null): number {
  switch (state) {
    case 'waiting': return 0;
    case 'error': return 1;
    case 'working': case 'delegating': case 'monitoring': case 'background': case 'watching': return 2;
    case 'queued': return 3;
    default: return 4;
  }
}

/** What "Needs you" holds everywhere (Activity's section, the rail's badge, a project's header): the user's turn and failures to act on. */
export function needsYou(state: ThreadState | null): boolean {
  return statusRank(state) <= NEEDS_RANK;
}

/** The last rank "Needs you" holds. */
export const NEEDS_RANK = 1;

/** A thread's rank, its delegated agents read where the list knows them. */
export function threadRank(thread: Parameters<typeof threadState>[0], delegated: Delegated = 0): number {
  return statusRank(threadState(thread, delegated));
}

type Asks = readonly { threadId?: ThreadId | null }[];
/** What a row reads from its machine besides the summary: its delegated agents and the requests held for it. */
export type RowSource<D> = { subagents(threadId: ThreadId): D; pendingQuestions?: Asks; pendingPermissions?: Asks };

/**
 * A row's delegated agents, plus one asking when the machine holds a question
 * or a permission for the thread itself. The summary may not count that ask
 * yet (a question that came mid-run keeps `running`), and an ask outranks work.
 */
export function rowAsks(store: RowSource<WorkingChildren | null>, threadId: ThreadId): WorkingChildren | null;
export function rowAsks(store: RowSource<Delegated>, threadId: ThreadId): Delegated;
export function rowAsks(store: RowSource<Delegated | WorkingChildren>, threadId: ThreadId): Delegated | WorkingChildren {
  const children = store.subagents(threadId);
  const held = (asks: Asks | undefined) => asks?.some(request => request.threadId === threadId) ?? false;
  if (!held(store.pendingQuestions) && !held(store.pendingPermissions)) return children;
  if (typeof children === 'number') return { count: children, asking: 1 };
  return { count: children?.count ?? 0, since: children && 'since' in children ? children.since : null, asking: (children?.asking ?? 0) + 1 };
}

/**
 * How every list marks a state: the user's own (their turn, a failure) by a
 * dot or a "!" disc, work by the accent arc, news and rest by nothing but the
 * time. A marked state carries its word beside the mark (ThreadState.svelte).
 */
export function stateForm(state: ThreadState | null): 'act' | 'work' | null {
  if (state === 'waiting' || state === 'error' || state === 'interrupted') return 'act';
  return state === null || state === 'done' ? null : 'work';
}
