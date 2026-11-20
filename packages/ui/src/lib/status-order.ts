import { NEEDS_RANK, statusRank, threadState, type Delegated, type ThreadState } from '@boite/contracts';

/** The status order and a row's asks: Activity's derivation, shared with the core (contracts/src/activity.ts). */
export { rowAsks, type RowSource } from '@boite/contracts';

/** What "Needs you" holds everywhere (Activity's section, the rail's badge, a project's header): the user's turn and failures to act on. */
export function needsYou(state: ThreadState | null): boolean {
  return statusRank(state) <= NEEDS_RANK;
}

/** A thread's rank, its delegated agents read where the list knows them. */
export function threadRank(thread: Parameters<typeof threadState>[0], delegated: Delegated = 0): number {
  return statusRank(threadState(thread, delegated));
}

/**
 * How every list marks a state: the user's own (their turn, a failure) by a
 * dot or a "!" disc, work by the accent arc, news ("Done") and rest by no
 * mark. A marked state carries its word beside the mark (ThreadState.svelte).
 */
export function stateForm(state: ThreadState | null): 'act' | 'work' | null {
  if (state === 'waiting' || state === 'error' || state === 'interrupted') return 'act';
  return state === null || state === 'done' ? null : 'work';
}

/** A row says this state in words before its time: every marked state, and "Done" (ThreadState.svelte). */
export function rowSaysState(state: ThreadState | null): boolean {
  return state === 'done' || stateForm(state) !== null;
}
