import { threadState, type Delegated, type ThreadState } from './thread-state';

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
