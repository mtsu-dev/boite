import type { ThreadSummary } from '@boite/contracts';
import type { ProjectEntry } from './project-view.svelte';
import { archiveCount } from './project-threads.svelte';
import { threadState } from './thread-state';
import { inbox, storeSources, threadLiveKind, waitingSince, type OrderStore } from './inbox';
import type { Machine } from './workspace.svelte';
import { compareThreads, type OrderKey } from './thread-order';

/** The four lifecycle buttons over the thread list, in drawn order. */
export const LIFECYCLES = ['waiting', 'working', 'done', 'archived'] as const;
export type Lifecycle = (typeof LIFECYCLES)[number];

/** The lifecycle the sidebar is filtered to, shared by desktop and phone for the session. */
class LifecycleFilter {
  current = $state<Lifecycle | null>(null);

  toggle(kind: Lifecycle): void {
    this.current = this.current === kind ? null : kind;
  }

  clear(): void {
    this.current = null;
  }

  show(kind: Lifecycle): void {
    this.current = kind;
  }
}

export const lifecycleFilter = new LifecycleFilter();

/**
 * Whether a listed thread belongs to a live lifecycle: needs you (a question,
 * a failure or work that stopped short, all waiting on the user's hand) or
 * working (the rows the working fold groups). Done and archived threads are
 * out of the store's open list and come from the project's counts.
 */
export function inLifecycle(entry: ProjectEntry, thread: ThreadSummary, kind: 'waiting' | 'working'): boolean {
  // The count rule's own population (`countKind`): a team or debate room under a project is not counted.
  if (thread.teamId || thread.debateId) return false;
  // The count's own classification, so a parent carrying a remote child's question lists where it counts.
  return threadLiveKind(thread, threadState(thread, entry.machine.store.subagents(thread.id))) === (kind === 'waiting' ? 'needs' : 'working');
}

/**
 * The counts over every listed project, on every machine the sidebar shows.
 * Needs you and Working are the project threads of the one count rule
 * (`inbox`'s tally, which `workTally` serves to every badge), so the strip,
 * the Inbox, the switch and the tabs never disagree; a machine that is not
 * connected counts nothing. Done and archived are the projects' own counts,
 * the numbers their folds list.
 */
export function lifecycleCounts(entries: readonly ProjectEntry[]): Record<Lifecycle, number> {
  const counts: Record<Lifecycle, number> = { waiting: 0, working: 0, done: 0, archived: 0 };
  const machines = new Set<Machine>();
  for (const entry of entries) {
    counts.done += archiveCount(entry.project, 'done');
    counts.archived += archiveCount(entry.project, 'archived');
    machines.add(entry.machine);
  }
  const { threads } = inbox(storeSources([...machines])).tally;
  counts.waiting = threads.needs;
  counts.working = threads.working;
  return counts;
}

/** The projects a filter keeps, each with the rows it shows: a live filter lists threads, done and archived list the project's fold. */
export function lifecycleProjects(entries: readonly ProjectEntry[], kind: Lifecycle): { entry: ProjectEntry; threads: ThreadSummary[] }[] {
  const kept: { entry: ProjectEntry; threads: ThreadSummary[] }[] = [];
  for (const entry of entries) {
    if (kind === 'done' || kind === 'archived') {
      if (archiveCount(entry.project, kind) > 0) kept.push({ entry, threads: [] });
      continue;
    }
    if (entry.machine.store.connection !== 'ready') continue;
    const threads = entry.machine.store.threadsOf(entry.project.id).filter(thread => inLifecycle(entry, thread, kind));
    if (threads.length > 0) kept.push({ entry, threads });
  }
  return kept;
}

/** The count classification every row of a live filter carries, so its order is Recent's band order; none for done and archived. */
export function filterLive(kind: Lifecycle): 'needs' | 'working' | undefined {
  return kind === 'waiting' ? 'needs' : kind === 'working' ? 'working' : undefined;
}

/** A live filter row's sort key: its filter's classification and, under Needs you, the age the row shows. */
export function filterOrder(store: OrderStore, thread: ThreadSummary, kind: Lifecycle): OrderKey | undefined {
  const live = filterLive(kind);
  return live && { live, waited: live === 'needs' ? waitingSince(store, thread) : null };
}

/**
 * The Recent view under a live filter: the same flat rows as unfiltered, in the
 * same order, only those of the filter's lifecycle. Grouping by project
 * belongs to the Projects view.
 */
export function lifecycleRows(entries: readonly ProjectEntry[], kind: 'waiting' | 'working'): (ProjectEntry & { thread: ThreadSummary })[] {
  return lifecycleProjects(entries, kind)
    .flatMap(({ entry, threads }) => threads.map(thread => ({ ...entry, thread })))
    .map(row => ({ row, key: filterOrder(row.machine.store, row.thread, kind) }))
    .sort((a, b) => compareThreads(a.row.thread, b.row.thread, a.key, b.key))
    .map(({ row }) => row);
}
