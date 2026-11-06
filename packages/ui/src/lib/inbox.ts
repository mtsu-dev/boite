import { requestExcerpt, type Account, type PermissionRequest, type Project, type QuestionRequest, type SecretRequest, type ThreadSummary } from '@boite/contracts';
import { needsUser, shortAgo, threadState, type Delegated, type ThreadState } from './thread-state';
import { compareThreads, type LiveKind, type OrderKey } from './thread-order';
import { liveState, needsHand } from './thread-lanes.svelte';
import { projectThread } from './thread-rows';
import type { Store } from './store.svelte';

/**
 * What the home's Inbox and the phone's Inbox tab list: the threads that wait
 * on the user, on every machine shown, and the ones at work. Pure, so the
 * order and the cap are tested without a component.
 */

/** Why a thread waits on the user, in the words of its card. */
export type InboxReason = 'question' | 'permission' | 'secret' | 'sign-in' | 'failed' | 'interrupted';

export interface InboxSource<M> {
  machine: M;
  threads: readonly ThreadSummary[];
  projects: readonly Project[];
  questions: readonly QuestionRequest[];
  permissions: readonly PermissionRequest[];
  secrets?: readonly SecretRequest[];
  accounts?: readonly Pick<Account, 'id' | 'status'>[];
  /** The thread's delegated agents at work or asking, as the sidebar reads them, so both count the same threads. */
  subagents?: (threadId: string) => Delegated;
  /** False once the machine stopped answering: its threads are listed as offline and never counted. Defaults to true. */
  connected?: boolean;
}

export interface InboxCard<M> {
  machine: M;
  thread: ThreadSummary;
  project: Project | undefined;
  reason: InboxReason;
  /** The question's or permission's first line, when the core sent it. */
  detail: string | null;
  /** Since when it waits: the request's time, else the turn's. */
  since: number;
  /** A project row of the thread list, or a bot's own thread. */
  kind: CountKind;
}

export interface InboxRow<M> {
  machine: M;
  thread: ThreadSummary;
  project: Project | undefined;
  /** When the work the row counts started. */
  since: number;
  kind: CountKind;
}

/** Which count a thread belongs to: a row of a listed project, a bot's own thread, or neither. */
export type CountKind = 'threads' | 'bots';

/** How much needs the user and how much works, in one count. */
export interface Tally { needs: number; working: number }

/** Every live count of the app, from one pass: the project threads and the bots' threads apart. */
export interface LiveTally { threads: Tally; bots: Tally }

/**
 * The one rule for what a count holds. A project thread is what the sidebar
 * draws under a listed project (`threadsByProject`): not archived, not
 * incognito, top level or entrusted by a bot, in a project that is not
 * archived. A bot's own thread counts apart. A team or debate room is neither.
 */
export function countKind(thread: ThreadSummary, project: Project | undefined, parent: ThreadSummary | undefined): CountKind | null {
  if (thread.archived || thread.incognito || thread.teamId || thread.councilId) return null;
  if (thread.agentSessionId) return 'bots';
  if (!projectThread(thread, parent)) return null;
  return project && project.archived !== true ? 'threads' : null;
}

/** Where a state counts: needs you (`needsHand`), working (`liveState`), or nowhere. */
export function liveKind(state: ThreadState | null): keyof Tally | null {
  return needsHand(state) ? 'needs' : liveState(state) ? 'working' : null;
}

/**
 * Where one thread counts, for the tallies and the lists that show them: a
 * child's question rides on its parent's row while the parent's turn runs, so
 * that parent needs the user and is not at work.
 */
export function threadLiveKind(thread: ThreadSummary, state: ThreadState | null): keyof Tally | null {
  return thread.subagentQuestions?.length ? 'needs' : liveKind(state);
}

/**
 * Where a thread of this store counts, with its delegated agents read: the
 * classification Recent's sort and bands take, so a band holds every row its
 * tab counts, on desktop and phone.
 */
export function storeLiveKind(store: Pick<Store, 'subagents'>, thread: ThreadSummary): LiveKind {
  return threadLiveKind(thread, threadState(thread, store.subagents(thread.id)));
}

/** What a store holds that says where a thread counts and since when it waits. */
export type OrderStore = Pick<Store, 'subagents' | 'pendingQuestions' | 'pendingPermissions' | 'pendingSecrets' | 'accounts'>;

/**
 * A thread's sort key from its store (`compareThreads`): where it counts, and
 * for a row that needs the user the age its row shows (`waitingSince`), so
 * Recent, the phone, the Projects cards and the home queue order one Needs you
 * band alike.
 */
export function storeOrder(store: OrderStore, thread: ThreadSummary): OrderKey {
  const state = threadState(thread, store.subagents(thread.id) ?? 0);
  const live = threadLiveKind(thread, state);
  if (live !== 'needs') return { live, waited: null };
  const source = { questions: store.pendingQuestions ?? [], permissions: store.pendingPermissions ?? [], secrets: store.pendingSecrets, accounts: store.accounts };
  return { live, waited: cardOf(source, thread, state).since };
}

/** What each machine's store holds for the Inbox: the home, the phone's tab and the status strip's Next read the same lists. */
export function storeSources<M extends { store: Store }>(machines: readonly M[]): InboxSource<M>[] {
  return machines.map(machine => ({
    machine,
    threads: machine.store.threads,
    projects: machine.store.projects,
    questions: machine.store.pendingQuestions ?? [],
    permissions: machine.store.pendingPermissions ?? [],
    secrets: machine.store.pendingSecrets,
    accounts: machine.store.accounts,
    subagents: (id: string) => machine.store.subagents(id),
    connected: machine.store.connection === 'ready'
  }));
}

/** The cards the home always shows before `See all`: three keep the home a glance, not a list; the room adds up to three more (`inbox-fit`). */
export { NEEDS_CARDS as INBOX_CARDS } from './inbox-fit';

/** The threads a list of the user's work shows: no archive, no incognito, no team or debate room. */
export function listed(thread: ThreadSummary): boolean {
  return !thread.archived && !thread.incognito && !thread.teamId && !thread.councilId;
}

export interface InboxLists<M> {
  /** What waits on the user on a connected machine, in Recent's order: pins, then the newest wait first. */
  needs: InboxCard<M>[];
  /** What works on a connected machine, in the order of Recent's Working band. */
  working: InboxRow<M>[];
  /** The last known needs of a machine that stopped answering: listed, muted, never counted. */
  offline: InboxCard<M>[];
  /** The counts every badge reads: `needs` and `working` split between project threads and bots. */
  tally: LiveTally;
}

/**
 * The needs-you cards in the order of Recent's Needs you band
 * (`compareThreads`: pins, then the newest wait first), so the home's
 * `See all` continues the list the sidebar shows beside it; then the working
 * rows in the order of Recent's Working band, under the count rule of `countKind` and `liveKind`, so the
 * lifecycle strip, the switch, the tab badges and Next read the same numbers.
 * A delegated agent's thread is left to its parent, which carries its
 * question (`subagentQuestions`) and its work.
 */
export function inbox<M>(sources: readonly InboxSource<M>[]): InboxLists<M> {
  const needs: InboxCard<M>[] = [];
  const working: InboxRow<M>[] = [];
  const offline: InboxCard<M>[] = [];
  const tally: LiveTally = { threads: { needs: 0, working: 0 }, bots: { needs: 0, working: 0 } };
  for (const source of sources) {
    const connected = source.connected !== false;
    const projects = new Map(source.projects.map(project => [project.id, project]));
    const byId = new Map(source.threads.map(thread => [thread.id, thread]));
    for (const thread of source.threads) {
      const project = thread.projectId === null ? undefined : projects.get(thread.projectId);
      const kind = countKind(thread, project, thread.parentThreadId ? byId.get(thread.parentThreadId) : undefined);
      if (!kind) continue;
      const state = threadState(thread, source.subagents?.(thread.id) ?? 0);
      const live = threadLiveKind(thread, state);
      if (!live) continue;
      if (live === 'needs') {
        const card = { machine: source.machine, thread, project, kind, ...cardOf(source, thread, state) };
        if (!connected) { offline.push(card); continue; }
        needs.push(card);
      } else {
        // A machine away says nothing true about work: its last turn may have ended long ago.
        if (!connected) continue;
        working.push({ machine: source.machine, thread, project, kind, since: thread.requestSince ?? thread.runningSince ?? thread.updatedAt });
      }
      tally[kind][live] += 1;
    }
  }
  const byRecent = (a: InboxCard<M>, b: InboxCard<M>) => compareThreads(a.thread, b.thread, { live: 'needs', waited: a.since }, { live: 'needs', waited: b.since });
  needs.sort(byRecent);
  offline.sort(byRecent);
  // Recent's Working band and the palette list the same threads in this order; the row's timer is its run time.
  working.sort((a, b) => compareThreads(a.thread, b.thread, 'working', 'working'));
  return { needs, working, offline, tally };
}

/**
 * What a needs-you thread (`needsHand`) waits on: a question, a permission, a
 * key, a child asking, a failed turn read or not, or work that stopped short.
 * Only the words are the Inbox's own.
 */
function cardOf(source: Pick<InboxSource<unknown>, 'questions' | 'permissions' | 'secrets' | 'accounts'>, thread: ThreadSummary, state: ThreadState | null): Pick<InboxCard<unknown>, 'reason' | 'detail' | 'since'> {
  const turn = thread.runningSince ?? thread.updatedAt;
  const question = source.questions.find(request => request.threadId === thread.id);
  if (question) return { reason: 'question', detail: requestExcerpt(question), since: question.createdAt };
  const permission = source.permissions.find(request => request.threadId === thread.id);
  if (permission) return { reason: 'permission', detail: requestExcerpt(permission), since: permission.createdAt };
  const secret = source.secrets?.find(request => request.threadId === thread.id);
  if (secret) return { reason: 'secret', detail: secret.name, since: secret.createdAt };
  if (needsUser(thread)) return { reason: 'question', detail: null, since: turn };
  const asked = thread.subagentQuestions?.[0];
  if (asked) return { reason: 'question', detail: asked.title, since: turn };
  if (state === 'waiting') return { reason: 'question', detail: null, since: turn };
  if (state === 'error') {
    const account = source.accounts?.find(entry => entry.id === thread.accountId);
    return { reason: account?.status === 'unauthenticated' ? 'sign-in' : 'failed', detail: null, since: thread.updatedAt };
  }
  return { reason: 'interrupted', detail: thread.backgroundWait?.for ?? null, since: thread.updatedAt };
}

/**
 * Since when a thread of this store waits on the user, the `since` of its
 * Inbox card; null when it does not need the user. A Recent or project row
 * reads its age from it, so the row beside the home card says the same time
 * ("now" on both, never "now" and "1m").
 */
export function waitingSince(store: OrderStore, thread: ThreadSummary): number | null {
  return storeOrder(store, thread).waited ?? null;
}

/**
 * `12m`, `2h`, `3d`: how long a card has waited, in the words of a Recent row
 * (`shortAgo`), so one thread never reads `4h 00m` on the home and `4h` in the
 * sidebar beside it; the desktop and phone Inbox share it.
 */
export function waitedFor(now: number, since: number): string {
  return shortAgo(since, now);
}
