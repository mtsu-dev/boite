import type { ThreadId } from './ids';
import { pullRequestWatchWaits } from './pull-requests';
import { threadBusy } from './questions';
import type { ThreadSummary } from './threads';

/*
 * Activity's derivation, shared by the app (lib/activity-feed.ts, the rail,
 * every badge) and the core's `boite state inbox`, so the two cannot list
 * different threads: a thread's state, the status order and which threads
 * Activity lists.
 */

/**
 * What a thread row says in place of its time: the agent works, needs the
 * user, failed, finished something not read yet, waits for a slot, ended its
 * turn waiting on the agents it delegated to, or ended it with work still
 * running in the background (a monitor, a shell), or watching a pull request
 * whose checks still run. A delegated agent whose
 * background work ended without waking it is `interrupted`. Null for a thread
 * at rest the user has seen, which shows when it was last used.
 */
export type ThreadState = 'working' | 'waiting' | 'error' | 'interrupted' | 'done' | 'queued' | 'delegating' | 'monitoring' | 'background' | 'watching';

export type ThreadStateFields = Pick<ThreadSummary, 'status' | 'unread' | 'backgroundWork' | 'openQuestions'> & Partial<Pick<ThreadSummary, 'backgroundWait' | 'pullRequestWatches'>>;

/**
 * The thread waits on the user: a card that stopped its turn, or a question
 * the agent asked without stopping (`boite ask`), which leaves the status at
 * `running` or `idle`.
 */
export function needsUser(thread: Pick<ThreadSummary, 'status' | 'openQuestions'>): boolean {
  return thread.status === 'waiting' || (thread.openQuestions ?? 0) > 0;
}

/** What a parent's delegated agents add to its state: how many are at work, and how many wait on the user. */
export type Delegated = number | { count: number; asking: number } | null;

/**
 * `delegated`: how many of the thread's delegated agents still have a turn
 * under way, or that count with how many of them ask the user. A sub-agent's
 * question is the user's turn on its parent too, which the sidebar shows when
 * the child has no row of its own; only the parent's own failure outranks it.
 */
export function threadState(thread: ThreadStateFields, delegated: Delegated = 0): ThreadState | null {
  const working = typeof delegated === 'number' ? delegated : delegated?.count ?? 0;
  const asking = typeof delegated === 'number' ? 0 : delegated?.asking ?? 0;
  if (needsUser(thread)) return 'waiting';
  if (asking > 0 && thread.status !== 'error') return 'waiting';
  switch (thread.status) {
    case 'running':
      return 'working';
    case 'waiting':
      return 'waiting';
    case 'error':
      return 'error';
    case 'queued':
      return 'queued';
    case 'idle': {
      // The parent's turn ended, its work did not: its result comes back with the sub-agents'.
      if (working > 0) return 'delegating';
      const wait = thread.backgroundWait;
      if (wait?.state === 'interrupted') return 'interrupted';
      const kinds = thread.backgroundWork?.kinds ?? [];
      // Not finished while the agent still watches or runs something, read or not.
      if (kinds.length > 0) return kinds.every(kind => kind === 'monitor') ? 'monitoring' : 'background';
      // The work ended a moment ago and its wake turn has not started yet.
      if (wait?.state === 'waiting') return 'background';
      // A pull request whose checks still run will wake it: not done yet, read or not.
      if (thread.pullRequestWatches?.some(pullRequestWatchWaits)) return 'watching';
      return thread.unread ? 'done' : null;
    }
  }
}

/**
 * A parent's delegated agents still at work, a turn under way or a wait on
 * their own background work, and when the first of them started (null before
 * any has); `asking`, those waiting on the user, busy or not.
 */
export type WorkingChildren = { count: number; since: number | null; asking: number };

/** Each parent with a working or asking child, shared by every row of this machine. */
export function workingChildren(threads: readonly ThreadSummary[]): Map<ThreadId, WorkingChildren> {
  const parents = new Map<ThreadId, WorkingChildren>();
  for (const thread of threads) {
    const parent = thread.parentThreadId;
    if (!parent || thread.archived) continue;
    const busy = threadBusy(thread), asks = needsUser(thread);
    if (!busy && !asks) continue;
    const held = parents.get(parent) ?? { count: 0, since: null, asking: 0 };
    const wait = thread.backgroundWait;
    const started = busy ? thread.runningSince ?? (wait?.state === 'waiting' ? wait.since : null) : null;
    parents.set(parent, {
      count: held.count + (busy ? 1 : 0),
      since: started === null ? held.since : held.since === null ? started : Math.min(held.since, started),
      asking: held.asking + (asks ? 1 : 0)
    });
  }
  return parents;
}

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

/** The last rank "Needs you" holds. */
export const NEEDS_RANK = 1;

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

/** The states Activity lists: the user's turn and failures (its Needs you), then news. Their order is `statusRank`'s. */
const LISTED: ReadonlySet<ThreadState> = new Set(['waiting', 'error', 'interrupted', 'done']);

/** The states of work still going: the parent of a failed sub-agent that is in one of them deals with it. */
const LIVE: ReadonlySet<ThreadState> = new Set(['working', 'delegating', 'monitoring', 'background', 'watching', 'queued']);

/** What Activity reads: every live thread but team chats and council salons, which have no turn of their own to answer. */
export function feedThread(thread: ThreadSummary): boolean {
  return !thread.archived && !thread.incognito && !thread.teamId && !thread.councilId;
}

/** A thread Activity may list, with the machine that holds it. */
export type ActivitySource<M> = { machine: M; thread: ThreadSummary };
/** One Activity row: the thread that leads it and the threads whose event it shares, with its rank. */
export type ActivityEvent<E> = { lead: E; helpers: E[]; rank: number };

/**
 * What the user does about a listed thread, the line between two events: allow a permission, answer a question,
 * or the state itself (a failure, a stop, news). Two threads share a row only when this is the same.
 */
function eventKind(store: RowSource<Delegated>, thread: ThreadSummary, kind: ThreadState): string {
  if (kind !== 'waiting') return kind;
  const held = (asks: RowSource<Delegated>['pendingQuestions']) => asks?.some(ask => ask.threadId === thread.id) ?? false;
  return held(store.pendingPermissions) && !held(store.pendingQuestions) ? 'allow' : 'answer';
}

/**
 * Activity's rows in its order, each one event: the one derivation behind the page, its sections, the rail's badge,
 * the phone's tab, a project's "Needs you" count and `boite state inbox`, so none of them can disagree. It keeps only
 * the threads `feedThread` keeps, whatever `all` holds. A mochi's own conversation (`agentSessionId`) stays out. A failure or a stop is
 * news until it is read, as a finish is. A sub-agent hangs under its parent's row only when it asks for the same
 * thing (a permission beside a permission, a question beside a question); any other event of it is a row of its
 * own, so a permission never shares a row with a stopped helper.
 */
export function activityEvents<E extends ActivitySource<{ id: string; store: RowSource<Delegated> }>>(all: readonly E[]): ActivityEvent<E>[] {
  const entries = all.filter(entry => feedThread(entry.thread) && !entry.thread.agentSessionId);
  const stateOf = (entry: E) => threadState(entry.thread, rowAsks(entry.machine.store, entry.thread.id));
  const key = (entry: E, id = entry.thread.id) => `${entry.machine.id}\n${id}`;
  const byKey = new Map(entries.map(entry => [key(entry), entry]));
  const parentOf = (entry: E) => entry.thread.parentThreadId ? byKey.get(key(entry, entry.thread.parentThreadId)) : undefined;
  const listedKind = (entry: E): ThreadState | null => {
    const kind = stateOf(entry);
    if (kind === null || !LISTED.has(kind)) return null;
    // A failure or a stop is news until it is read, as a finish is: opening the thread or Mark all as read clears it.
    return (kind === 'error' || kind === 'interrupted') && !entry.thread.unread ? null : kind;
  };
  // A sub-agent that failed while its parent still works is the parent's to handle: nothing asks the user yet.
  const listed = entries.filter(entry => {
    const kind = listedKind(entry);
    if (kind === null) return false;
    const parent = kind === 'error' || kind === 'interrupted' ? parentOf(entry) : undefined;
    const parentKind = parent && stateOf(parent);
    return !parentKind || !LIVE.has(parentKind);
  });
  // A sub-agent hangs under its parent: the parent comes in for it.
  const children = new Map<string, E[]>();
  const tops = new Map<string, E>();
  for (const entry of listed) {
    const parent = parentOf(entry);
    if (!parent) { tops.set(key(entry), entry); continue; }
    children.set(key(parent), [...children.get(key(parent)) ?? [], entry]);
    if (!tops.has(key(parent))) tops.set(key(parent), parent);
  }
  const events: ActivityEvent<E>[] = [];
  for (const top of tops.values()) {
    const own = listedKind(top);
    // The parent's own event first, then its sub-agents', one row per kind of event.
    const byKind = new Map<string, E[]>();
    for (const entry of own ? [top, ...children.get(key(top)) ?? []] : children.get(key(top)) ?? []) {
      const kind = eventKind(entry.machine.store, entry.thread, listedKind(entry)!);
      byKind.set(kind, [...byKind.get(kind) ?? [], entry]);
    }
    [...byKind.values()].forEach((members, index) => {
      const rank = statusRank(listedKind(members[0]!));
      // The parent leads its own event, or the first of its sub-agents' when it is only listed for them (at work,
      // say); any other event is led by its first sub-agent, its own title and mark.
      if (members[0] === top || (index === 0 && !own)) events.push({ lead: top, helpers: members.filter(entry => entry !== top), rank });
      else events.push({ lead: members[0]!, helpers: members.slice(1), rank });
    });
  }
  return events.sort((a, b) => a.rank - b.rank || b.lead.thread.updatedAt - a.lead.thread.updatedAt);
}

/** What a row's first line names it: a permission or a question to decide, a failure, a stop, news. */
export type ActivityKind = 'permission' | 'question' | 'failed' | 'stopped' | 'done';

/** A row's kind from its state and the requests held for it: a permission alone is allowed, any question answered. */
export function activityKind(store: RowSource<Delegated>, threadId: ThreadId, state: ThreadState | null): ActivityKind | null {
  if (state === 'waiting') {
    const held = (asks: RowSource<Delegated>['pendingQuestions']) => asks?.some(ask => ask.threadId === threadId) ?? false;
    return held(store.pendingPermissions) && !held(store.pendingQuestions) ? 'permission' : 'question';
  }
  return state === 'error' ? 'failed' : state === 'interrupted' ? 'stopped' : state === 'done' ? 'done' : null;
}
