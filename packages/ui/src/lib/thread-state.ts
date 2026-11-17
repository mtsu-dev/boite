import { threadState, type Delegated, type ThreadState, type ThreadStateFields } from '@boite/contracts';

/** A thread's state and whether it needs the user: Activity's derivation, shared with the core (contracts/src/activity.ts). */
export { needsUser, threadState, type Delegated, type ThreadState } from '@boite/contracts';

/** What a folded project says for the threads it hides, most urgent first: the user's turn, a failure, work, work waiting for a slot, then news. */
const ROLLUP_ORDER: ThreadState[] = ['waiting', 'error', 'interrupted', 'working', 'delegating', 'monitoring', 'background', 'watching', 'queued', 'done'];

/**
 * The most urgent state among a project's threads and how many threads are in
 * it; null when every one is at rest. `delegated` gives a thread's delegated
 * agents, as `threadState` takes them.
 */
export function projectRollup<T extends ThreadStateFields>(threads: readonly T[], delegated: (thread: T) => Delegated = () => 0): { kind: ThreadState; count: number } | null {
  const states = threads.map(thread => threadState(thread, delegated(thread)));
  for (const kind of ROLLUP_ORDER) {
    const count = states.filter(state => state === kind).length;
    if (count > 0) return { kind, count };
  }
  return null;
}
