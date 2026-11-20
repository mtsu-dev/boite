import { activityEvents, activityKind, activityThreadState, feedThread, NEEDS_RANK, rowAsks, statusRank, threadState, unreadInterruptionAt, type ActivityKind, type Delegated, type PermissionRequest, type Project, type QuestionRequest, type RowSource, type RpcParams, type ThreadState, type ThreadSummary } from '@boite/contracts';
import { projectName } from './format';
import { fill, strings } from './strings';
import { describeTool, permissionSentence } from './tool-summary';

/**
 * Activity, as triage: what needs the user (asks, permissions, failures to
 * act on), then the updates (finished, interrupted), each with why and since
 * when, one event per row. A sub-agent that asks for what its parent asks
 * sits under the parent's row, which is listed for it even when the parent
 * itself only waits on it; any other event of it is its own row. A bot's own
 * conversation stays out: its picture on the rail already says how it stands.
 */
export type FeedSource<M> = { machine: M; thread: ThreadSummary; project: Project | undefined };
/** `needs`: the user acts; `updates`: the user reads. A sub-agent sits in its parent's section. */
export type FeedSection = 'needs' | 'updates';
/** The one thing a Needs you row asks the user to do, offered on the row itself: each opens the thread where it is done. */
export type FeedVerb = 'answer' | 'allow' | 'review';
/** `place`: where the row lives in words (its project, a bot's name, Drafts), for its place line; `reason` repeats it
    when the thread has nothing more to say. */
export type FeedRow<M> = FeedSource<M> & { reason: string; place: string; at: number; nested: boolean; section: FeedSection; verb: FeedVerb | null; kind: FeedKind | null };
/** What a row is, named on its first line: a Needs you row's so its verbs are expected (Allow once a permission, Answer
    a question, Review a failure or a stop), an update's as what happened (a stop, a finish). */
export type FeedKind = ActivityKind;
type Requests = { pendingQuestions: readonly QuestionRequest[]; pendingPermissions: readonly PermissionRequest[] };
type Owner = Requests & { subagents: (id: ThreadSummary['id']) => Delegated };

/** What Activity reads (contracts/src/activity.ts, which the core's `boite state inbox` reads too). */
export { feedThread };

/**
 * The whole command a thread asks to run, when its first held permission is
 * one: Activity shows it in full under the ask, so Allow is never pressed on
 * a cut line.
 */
export function feedOperation(owner: Pick<Requests, 'pendingPermissions'>, threadId: ThreadSummary['id']): string | null {
  const permission = owner.pendingPermissions.find(p => p.threadId === threadId);
  if (!permission) return null;
  const { family, subject } = describeTool(permission.toolName, permission.input);
  return family === 'command' && subject ? subject.trim() : null;
}

/** The other half of a row's decision pair, done in place: Deny a permission, Skip a question. */
export type FeedSecondary = 'deny' | 'skip';
type Answering = Requests & {
  answer(requestId: string, decision: 'allow' | 'deny'): Promise<boolean>;
  skipQuestion(threadId: ThreadSummary['id'], questionId: QuestionRequest['id']): Promise<boolean>;
};

/**
 * The outline action beside a row's primary (Allow once, Answer), as the composer pairs Deny with Allow once: it settles
 * the thread's own request where it is listed. Null when the request is not held here (a sub-agent's only) or the
 * primary is not a decision (Review).
 */
export function feedSecondary(owner: Answering, threadId: ThreadSummary['id'], verb: FeedVerb | null): { kind: FeedSecondary; run: () => Promise<boolean> } | null {
  if (verb === 'allow') {
    const permission = owner.pendingPermissions.find(p => p.threadId === threadId);
    return permission ? { kind: 'deny', run: () => owner.answer(permission.id, 'deny') } : null;
  }
  if (verb === 'answer') {
    const question = owner.pendingQuestions.find(q => q.threadId === threadId);
    return question ? { kind: 'skip', run: () => owner.skipQuestion(threadId, question.id) } : null;
  }
  return null;
}

/** A verb's words on its button: an approval reads "Allow once", the thread's own decision word, so the scope is the same everywhere. */
export function feedVerbLabel(verb: FeedVerb | FeedSecondary): string {
  return verb === 'allow' ? strings.chat.allowOnce : strings.mobile.feed.verb[verb];
}

/** The whole of a thread's held question, every line: Activity shows it above Answer, never its first line alone. */
export function feedQuestion(owner: Pick<Requests, 'pendingQuestions'>, threadId: ThreadSummary['id']): string | null {
  return owner.pendingQuestions.find(q => q.threadId === threadId)?.text.trim() || null;
}

/** Why the thread waits on the user, in a few words, and since when; null when its request is not known here. */
export function waitingReason(owner: Requests, thread: ThreadSummary): { text: string; since: number } | null {
  const question = owner.pendingQuestions.find(q => q.threadId === thread.id);
  if (question) return { text: question.text.trim().split('\n')[0]!.trim(), since: question.createdAt };
  const permission = owner.pendingPermissions.find(p => p.threadId === thread.id);
  if (permission) {
    // A command reads whole under its row (`feedOperation`); the line only says what is asked.
    const text = feedOperation(owner, thread.id) !== null ? strings.mobile.feed.run : permissionSentence(permission.toolName, permission.input);
    return { text, since: permission.createdAt };
  }
  const child = thread.subagentQuestions?.[0];
  return child ? { text: fill(strings.mobile.feed.helperAsks, { title: child.title }), since: thread.updatedAt } : null;
}

/** A permission alone is allowed; a question, its own or a sub-agent's, is answered; a failure is reviewed. */
function verbOf(owner: Requests, thread: ThreadSummary, kind: ThreadState | null): FeedVerb | null {
  if (kind === 'waiting') return owner.pendingPermissions.some(p => p.threadId === thread.id) && !owner.pendingQuestions.some(q => q.threadId === thread.id) ? 'allow' : 'answer';
  return kind === 'error' || kind === 'interrupted' ? 'review' : null;
}

/** A thread outside any project: a bot's worker names its bot, through `place`, a draft says Drafts. */
export type FeedPlace<M> = (entry: FeedSource<M>) => string | null | undefined;

/** The row's second line: what the thread wants, or else where it lives, and since when. */
function reasonOf<M>(owner: Owner, entry: FeedSource<M>, kind: ThreadState | null, place?: FeedPlace<M>): { reason: string; place: string; at: number } {
  const { thread, project } = entry;
  const where = project ? projectName(project) : place?.(entry) || strings.drafts.name;
  const asked = kind === 'waiting' ? waitingReason(owner, thread) : null;
  const wait = thread.backgroundWait;
  const stopped = kind === 'interrupted' && wait?.state === 'interrupted' ? fill(strings.sidebar.state.interruptedBy, { what: wait.for, reason: strings.sidebar.state.interruption[wait.reason] }) : null;
  const reason = asked?.text ?? (stopped && stopped.charAt(0).toLocaleUpperCase() + stopped.slice(1))
    ?? (kind === 'waiting' ? strings.sidebar.state.waiting : where);
  return { reason, place: where, at: asked?.since ?? thread.updatedAt };
}

/** Activity's events: the shared derivation (contracts/src/activity.ts). */
const feedEvents = <M extends { id: string; store: RowSource<Delegated> }>(all: readonly FeedSource<M>[]) => activityEvents(all);

/** How many rows Activity's Needs you section lists at its top level: the number its heading and every badge say. */
export function needsYouCount<M extends { id: string; store: RowSource<Delegated> }>(all: readonly FeedSource<M>[]): number {
  return feedEvents(all).filter(({ rank }) => rank <= NEEDS_RANK).length;
}

/** One machine's Needs you count over some of its threads (a project's, say): the same rows, the same number. */
export function storeNeedsYou(store: RowSource<Delegated>, threads: readonly ThreadSummary[]): number {
  return storeNeeds(store, threads).count;
}

/** The same count with how many of its rows are failures, so a project's head wears the mark of what it counts. */
export function storeNeeds(store: RowSource<Delegated>, threads: readonly ThreadSummary[]): { count: number; failed: number } {
  const machine = { id: '', store };
  const ranks = feedEvents(threads.filter(feedThread).map(thread => ({ machine, thread, project: undefined }))).map(({ rank }) => rank).filter(rank => rank <= NEEDS_RANK);
  return { count: ranks.length, failed: ranks.filter(rank => rank === statusRank('error')).length };
}

export function activityFeed<M extends { id: string; store: Owner }>(all: readonly FeedSource<M>[], place?: FeedPlace<M>): FeedRow<M>[] {
  const stateOf = (entry: FeedSource<M>) => activityThreadState(entry.thread, rowAsks(entry.machine.store, entry.thread.id));
  return feedEvents(all).flatMap(({ lead, helpers, rank }) => {
    const section: FeedSection = rank <= NEEDS_RANK ? 'needs' : 'updates';
    const row = (entry: FeedSource<M>, nested: boolean): FeedRow<M> => {
      const kind = stateOf(entry);
      const verb = section === 'needs' ? verbOf(entry.machine.store, entry.thread, kind) : null;
      return { ...entry, nested, section, ...reasonOf(entry.machine.store, entry, kind, place), verb, kind: activityKind(entry.machine.store, entry.thread.id, kind) };
    };
    return [row(lead, false), ...helpers.map(helper => row(helper, true))];
  });
}

/**
 * The threads "Mark all as read" clears: every row but a decision (a permission, a question), which only the user's
 * answer settles; a sub-agent's row counts as its own. Each machine's threads apart, since ids collide between them.
 */
export function readableThreads<M>(rows: readonly Pick<FeedRow<M>, 'machine' | 'thread' | 'kind'>[]): Map<M, RpcParams<'threads.markRead'>[]> {
  const byMachine = new Map<M, RpcParams<'threads.markRead'>[]>();
  for (const row of rows) {
    if (row.kind !== 'failed' && row.kind !== 'stopped' && row.kind !== 'done') continue;
    const interruptionAt = row.kind === 'stopped' && row.thread.interruptionReadAt !== undefined ? unreadInterruptionAt(row.thread) : undefined;
    const request = { threadId: row.thread.id, ...(interruptionAt === undefined ? {} : { interruptionAt }) };
    byMachine.set(row.machine, [...byMachine.get(row.machine) ?? [], request]);
  }
  return byMachine;
}

/** One event, one row: a lead row with the sub-agent rows that share its event, which it shows as lines of its own. */
export function feedGroups<R extends { nested?: boolean }>(rows: readonly R[]): { row: R; helpers: R[] }[] {
  const groups: { row: R; helpers: R[] }[] = [];
  for (const row of rows) {
    const last = groups.at(-1);
    if (row.nested && last) last.helpers.push(row);
    else groups.push({ row, helpers: [] });
  }
  return groups;
}
