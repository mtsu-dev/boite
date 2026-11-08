import type { PermissionRequest, Project, QuestionRequest, ThreadSummary } from '@boite/contracts';
import { projectName } from './format';
import { fill, strings } from './strings';
import { threadState, type Delegated, type ThreadState } from './thread-state';
import { NEEDS_RANK, statusRank } from './status-order';
import { describeTool, permissionSentence } from './tool-summary';

/**
 * Activity, as triage: what needs the user (asks, permissions, failures to
 * act on), then the updates (finished, interrupted), each with why and since
 * when. A sub-agent's row sits under its parent's, which is
 * listed for it even when the parent itself only waits on it. A bot's own
 * conversation stays out: its picture on the rail already says how it stands.
 */
export type FeedSource<M> = { machine: M; thread: ThreadSummary; project: Project | undefined };
/** `needs`: the user acts; `updates`: the user reads. A sub-agent sits in its parent's section. */
export type FeedSection = 'needs' | 'updates';
export type FeedRow<M> = FeedSource<M> & { reason: string; at: number; nested: boolean; section: FeedSection };
type Requests = { pendingQuestions: readonly QuestionRequest[]; pendingPermissions: readonly PermissionRequest[] };
type Owner = Requests & { subagents: (id: ThreadSummary['id']) => Delegated };

/** The states Activity lists: the user's turn and failures (its Needs you), then news. Their order is lib/status-order.ts's. */
const LISTED: ReadonlySet<ThreadState> = new Set(['waiting', 'error', 'interrupted', 'done']);

/** What Activity reads: every live thread but team chats and council salons, which have no turn of their own to answer. */
export function feedThread(thread: ThreadSummary): boolean {
  return !thread.archived && !thread.incognito && !thread.teamId && !thread.councilId;
}

/** Why the thread waits on the user, in a few words, and since when; null when its request is not known here. */
export function waitingReason(owner: Requests, thread: ThreadSummary): { text: string; since: number } | null {
  const question = owner.pendingQuestions.find(q => q.threadId === thread.id);
  if (question) return { text: question.text.split('\n')[0]!.trim(), since: question.createdAt };
  const permission = owner.pendingPermissions.find(p => p.threadId === thread.id);
  if (permission) {
    const { family, subject } = describeTool(permission.toolName, permission.input);
    const text = family === 'command' && subject ? fill(strings.mobile.feed.run, { command: subject.split('\n')[0]! }) : permissionSentence(permission.toolName, permission.input);
    return { text, since: permission.createdAt };
  }
  const child = thread.subagentQuestions?.[0];
  return child ? { text: fill(strings.mobile.feed.helperAsks, { title: child.title }), since: thread.updatedAt } : null;
}

/** A thread outside any project: a bot's worker names its bot, through `place`, a draft says Drafts. */
export type FeedPlace<M> = (entry: FeedSource<M>) => string | null | undefined;

/** The states of work still going: the parent of a failed sub-agent that is in one of them deals with it. */
const LIVE: ReadonlySet<ThreadState> = new Set(['working', 'delegating', 'monitoring', 'background', 'watching', 'queued']);

/** The row's second line: what the thread wants, or else where it lives, and since when. */
function reasonOf<M>(owner: Owner, entry: FeedSource<M>, kind: ThreadState | null, place?: FeedPlace<M>): { reason: string; at: number } {
  const { thread, project } = entry;
  const asked = kind === 'waiting' ? waitingReason(owner, thread) : null;
  const wait = thread.backgroundWait;
  const stopped = kind === 'interrupted' && wait?.state === 'interrupted' ? fill(strings.sidebar.state.interruptedBy, { what: wait.for, reason: strings.sidebar.state.interruption[wait.reason] }) : null;
  const reason = asked?.text ?? (stopped && stopped.charAt(0).toLocaleUpperCase() + stopped.slice(1))
    ?? (kind === 'waiting' ? strings.sidebar.state.waiting : project ? projectName(project) : place?.(entry) || strings.drafts.name);
  return { reason, at: asked?.since ?? thread.updatedAt };
}

type Top<M> = { top: FeedSource<M>; children: FeedSource<M>[]; rank: number };

/**
 * Activity's top rows in its order, each with its sub-agents and its rank: the one derivation behind the page, its
 * sections, the rail's badge, the phone's tab and a project's "Needs you" count, so none of them can disagree.
 */
function feedTops<M extends { id: string; store: Pick<Owner, 'subagents'> }>(all: readonly FeedSource<M>[]): Top<M>[] {
  const entries = all.filter(entry => !entry.thread.agentSessionId);
  const stateOf = (entry: FeedSource<M>) => threadState(entry.thread, entry.machine.store.subagents(entry.thread.id));
  const key = (entry: FeedSource<M>, id = entry.thread.id) => `${entry.machine.id}\n${id}`;
  const byKey = new Map(entries.map(entry => [key(entry), entry]));
  const parentOf = (entry: FeedSource<M>) => entry.thread.parentThreadId ? byKey.get(key(entry, entry.thread.parentThreadId)) : undefined;
  // A sub-agent that failed while its parent still works is the parent's to handle: nothing asks the user yet.
  const listed = entries.filter(entry => {
    const kind = stateOf(entry);
    if (kind === null || !LISTED.has(kind)) return false;
    const parent = kind === 'error' || kind === 'interrupted' ? parentOf(entry) : undefined;
    const parentKind = parent && stateOf(parent);
    return !parentKind || !LIVE.has(parentKind);
  });
  // A sub-agent hangs under its parent: the parent comes in for it.
  const children = new Map<string, FeedSource<M>[]>();
  const tops = new Map<string, FeedSource<M>>();
  for (const entry of listed) {
    const parent = parentOf(entry);
    if (!parent) { tops.set(key(entry), entry); continue; }
    children.set(key(parent), [...children.get(key(parent)) ?? [], entry]);
    if (!tops.has(key(parent))) tops.set(key(parent), parent);
  }
  // A parent ranks with its most urgent listed child: one that asks lifts it to the top. A parent only listed for its
  // child (at work, say) ranks as news by itself.
  const own = (entry: FeedSource<M>): number => { const kind = stateOf(entry); return kind !== null && LISTED.has(kind) ? statusRank(kind) : 4; };
  const rank = (entry: FeedSource<M>): number => Math.min(own(entry), ...(children.get(key(entry)) ?? []).map(rank));
  const order = (a: FeedSource<M>, b: FeedSource<M>) => rank(a) - rank(b) || b.thread.updatedAt - a.thread.updatedAt;
  return [...tops.values()].sort(order).map(top => ({ top, rank: rank(top), children: (children.get(key(top)) ?? []).sort(order) }));
}

/** How many rows Activity's Needs you section lists at its top level: the number its heading and every badge say. */
export function needsYouCount<M extends { id: string; store: Pick<Owner, 'subagents'> }>(all: readonly FeedSource<M>[]): number {
  return feedTops(all).filter(({ rank }) => rank <= NEEDS_RANK).length;
}

/** One machine's Needs you count over some of its threads (a project's, say): the same rows, the same number. */
export function storeNeedsYou(store: Pick<Owner, 'subagents'>, threads: readonly ThreadSummary[]): number {
  const machine = { id: '', store };
  return needsYouCount(threads.filter(feedThread).map(thread => ({ machine, thread, project: undefined })));
}

export function activityFeed<M extends { id: string; store: Owner }>(all: readonly FeedSource<M>[], place?: FeedPlace<M>): FeedRow<M>[] {
  const stateOf = (entry: FeedSource<M>) => threadState(entry.thread, entry.machine.store.subagents(entry.thread.id));
  return feedTops(all).flatMap(({ top, children, rank }) => {
    const section: FeedSection = rank <= NEEDS_RANK ? 'needs' : 'updates';
    return [
      { ...top, nested: false, section, ...reasonOf(top.machine.store, top, stateOf(top), place) },
      ...children.map(child => ({ ...child, nested: true, section, ...reasonOf(child.machine.store, child, stateOf(child), place) }))
    ];
  });
}
