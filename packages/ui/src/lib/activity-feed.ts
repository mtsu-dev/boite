import type { PermissionRequest, Project, QuestionRequest, ThreadSummary } from '@boite/contracts';
import { projectName } from './format';
import { fill, strings } from './strings';
import { threadState, type Delegated, type ThreadState } from './thread-state';
import { describeTool, permissionSentence } from './tool-summary';

/**
 * Activity: what needs the user, what failed and what finished, each with
 * why and since when. A sub-agent's row sits under its parent's, which is
 * listed for it even when the parent itself only waits on it.
 */
export type FeedSource<M> = { machine: M; thread: ThreadSummary; project: Project | undefined };
export type FeedRow<M> = FeedSource<M> & { reason: string; at: number; nested: boolean };
type Requests = { pendingQuestions: readonly QuestionRequest[]; pendingPermissions: readonly PermissionRequest[] };
type Owner = Requests & { subagents: (id: ThreadSummary['id']) => Delegated };

/** The states Activity lists, in its order: the user's turn, then failures, then news. */
const RANK: Partial<Record<ThreadState, number>> = { waiting: 0, error: 1, interrupted: 1, done: 2 };

/** Why the thread waits on the user, in a few words, and since when; null when its request is not known here. */
export function waitingReason(owner: Requests, thread: ThreadSummary): { text: string; since: number } | null {
  const question = owner.pendingQuestions.find(q => q.threadId === thread.id);
  if (question) return { text: fill(strings.mobile.feed.asks, { text: question.text.split('\n')[0]!.trim() }), since: question.createdAt };
  const permission = owner.pendingPermissions.find(p => p.threadId === thread.id);
  if (permission) {
    const { family, subject } = describeTool(permission.toolName, permission.input);
    const text = family === 'command' && subject ? fill(strings.mobile.feed.run, { command: subject.split('\n')[0]! }) : permissionSentence(permission.toolName, permission.input);
    return { text, since: permission.createdAt };
  }
  const child = thread.subagentQuestions?.[0];
  return child ? { text: fill(strings.mobile.feed.helperAsks, { title: child.title }), since: thread.updatedAt } : null;
}

/** The row's second line: what the thread wants, or else where it lives, and since when. */
function reasonOf(owner: Owner, entry: FeedSource<unknown>, kind: ThreadState | null): { reason: string; at: number } {
  const { thread, project } = entry;
  const asked = kind === 'waiting' ? waitingReason(owner, thread) : null;
  const wait = thread.backgroundWait;
  const stopped = kind === 'interrupted' && wait?.state === 'interrupted' ? fill(strings.sidebar.state.interruptedBy, { what: wait.for, reason: strings.sidebar.state.interruption[wait.reason] }) : null;
  const reason = asked?.text ?? (stopped && stopped.charAt(0).toLocaleUpperCase() + stopped.slice(1))
    ?? (kind === 'waiting' ? strings.sidebar.state.waiting : project ? projectName(project) : strings.drafts.name);
  return { reason, at: asked?.since ?? thread.updatedAt };
}

export function activityFeed<M extends { id: string; store: Owner }>(entries: readonly FeedSource<M>[]): FeedRow<M>[] {
  const stateOf = (entry: FeedSource<M>) => threadState(entry.thread, entry.machine.store.subagents(entry.thread.id));
  const key = (entry: FeedSource<M>, id = entry.thread.id) => `${entry.machine.id}\n${id}`;
  const listed = entries.filter(entry => RANK[stateOf(entry)!] !== undefined);
  const byKey = new Map(entries.map(entry => [key(entry), entry]));
  // A sub-agent hangs under its parent: the parent comes in for it.
  const children = new Map<string, FeedSource<M>[]>();
  const tops = new Map<string, FeedSource<M>>();
  for (const entry of listed) {
    const parent = entry.thread.parentThreadId ? byKey.get(key(entry, entry.thread.parentThreadId)) : undefined;
    if (!parent) { tops.set(key(entry), entry); continue; }
    children.set(key(parent), [...children.get(key(parent)) ?? [], entry]);
    if (!tops.has(key(parent))) tops.set(key(parent), parent);
  }
  // A parent ranks with its most urgent child: one that asks lifts it to the top.
  const rank = (entry: FeedSource<M>): number => Math.min(RANK[stateOf(entry)!] ?? 3, ...(children.get(key(entry)) ?? []).map(rank));
  const order = (a: FeedSource<M>, b: FeedSource<M>) => rank(a) - rank(b) || b.thread.updatedAt - a.thread.updatedAt;
  return [...tops.values()].sort(order).flatMap(top => [
    { ...top, nested: false, ...reasonOf(top.machine.store, top, stateOf(top)) },
    ...(children.get(key(top)) ?? []).sort(order).map(child => ({ ...child, nested: true, ...reasonOf(child.machine.store, child, stateOf(child)) }))
  ]);
}
