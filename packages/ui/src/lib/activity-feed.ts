import type { PermissionRequest, Project, QuestionRequest, ThreadSummary } from '@boite/contracts';
import { projectName } from './format';
import { fill, strings } from './strings';
import { threadState, type Delegated, type ThreadState } from './thread-state';
import { NEEDS_RANK, rowAsks, statusRank, type RowSource } from './status-order';
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
export type FeedKind = 'permission' | 'question' | 'failed' | 'stopped' | 'done';
type Requests = { pendingQuestions: readonly QuestionRequest[]; pendingPermissions: readonly PermissionRequest[] };
type Owner = Requests & { subagents: (id: ThreadSummary['id']) => Delegated };

/** The states Activity lists: the user's turn and failures (its Needs you), then news. Their order is lib/status-order.ts's. */
const LISTED: ReadonlySet<ThreadState> = new Set(['waiting', 'error', 'interrupted', 'done']);

/** What Activity reads: every live thread but team chats and council salons, which have no turn of their own to answer. */
export function feedThread(thread: ThreadSummary): boolean {
  return !thread.archived && !thread.incognito && !thread.teamId && !thread.councilId;
}

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

/** The row's kind from the same facts as its verb. */
function kindOf(verb: FeedVerb | null, kind: ThreadState | null): FeedKind | null {
  if (verb === 'allow') return 'permission';
  if (verb === 'answer') return 'question';
  return kind === 'error' ? 'failed' : kind === 'interrupted' ? 'stopped' : kind === 'done' ? 'done' : null;
}

/** A thread outside any project: a bot's worker names its bot, through `place`, a draft says Drafts. */
export type FeedPlace<M> = (entry: FeedSource<M>) => string | null | undefined;

/** The states of work still going: the parent of a failed sub-agent that is in one of them deals with it. */
const LIVE: ReadonlySet<ThreadState> = new Set(['working', 'delegating', 'monitoring', 'background', 'watching', 'queued']);

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

/** One Activity row: the thread that leads it and the threads whose event it shares, with its rank. */
type Event<M> = { lead: FeedSource<M>; helpers: FeedSource<M>[]; rank: number };

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
 * the phone's tab and a project's "Needs you" count, so none of them can disagree. A sub-agent hangs under its
 * parent's row only when it asks for the same thing (a permission beside a permission, a question beside a
 * question); any other event of it is a row of its own, so a permission never shares a row with a stopped helper.
 */
function feedEvents<M extends { id: string; store: RowSource<Delegated> }>(all: readonly FeedSource<M>[]): Event<M>[] {
  const entries = all.filter(entry => !entry.thread.agentSessionId);
  const stateOf = (entry: FeedSource<M>) => threadState(entry.thread, rowAsks(entry.machine.store, entry.thread.id));
  const key = (entry: FeedSource<M>, id = entry.thread.id) => `${entry.machine.id}\n${id}`;
  const byKey = new Map(entries.map(entry => [key(entry), entry]));
  const parentOf = (entry: FeedSource<M>) => entry.thread.parentThreadId ? byKey.get(key(entry, entry.thread.parentThreadId)) : undefined;
  const listedKind = (entry: FeedSource<M>): ThreadState | null => { const kind = stateOf(entry); return kind !== null && LISTED.has(kind) ? kind : null; };
  // A sub-agent that failed while its parent still works is the parent's to handle: nothing asks the user yet.
  const listed = entries.filter(entry => {
    const kind = listedKind(entry);
    if (kind === null) return false;
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
  const events: Event<M>[] = [];
  for (const top of tops.values()) {
    const own = listedKind(top);
    // The parent's own event first, then its sub-agents', one row per kind of event.
    const byKind = new Map<string, FeedSource<M>[]>();
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
  const stateOf = (entry: FeedSource<M>) => threadState(entry.thread, rowAsks(entry.machine.store, entry.thread.id));
  return feedEvents(all).flatMap(({ lead, helpers, rank }) => {
    const section: FeedSection = rank <= NEEDS_RANK ? 'needs' : 'updates';
    const row = (entry: FeedSource<M>, nested: boolean): FeedRow<M> => {
      const kind = stateOf(entry);
      const verb = section === 'needs' ? verbOf(entry.machine.store, entry.thread, kind) : null;
      return { ...entry, nested, section, ...reasonOf(entry.machine.store, entry, kind, place), verb, kind: kindOf(verb, kind) };
    };
    return [row(lead, false), ...helpers.map(helper => row(helper, true))];
  });
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
