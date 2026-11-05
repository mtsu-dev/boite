import { requestExcerpt, type Account, type PermissionRequest, type Project, type QuestionRequest, type SecretRequest, type ThreadSummary } from '@boite/contracts';
import { needsUser, threadState, type Delegated, type ThreadState } from './thread-state';
import { liveState, needsHand } from './thread-lanes.svelte';
import { projectThread } from './thread-rows';
import type { Store } from './store.svelte';
import { fill, strings } from './strings';

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
  if (thread.archived || thread.incognito || thread.teamId || thread.debateId) return null;
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

/** The cards the home shows before folding the rest under `See all`: three keep the home a glance, not a list. */
export const INBOX_CARDS = 3;

/** The threads a list of the user's work shows: no archive, no incognito, no team or debate room. */
export function listed(thread: ThreadSummary): boolean {
  return !thread.archived && !thread.incognito && !thread.teamId && !thread.debateId;
}

export interface InboxLists<M> {
  /** What waits on the user on a connected machine, longest wait first. */
  needs: InboxCard<M>[];
  /** What works on a connected machine, longest running first. */
  working: InboxRow<M>[];
  /** The last known needs of a machine that stopped answering: listed, muted, never counted. */
  offline: InboxCard<M>[];
  /** The counts every badge reads: `needs` and `working` split between project threads and bots. */
  tally: LiveTally;
}

/**
 * The needs-you cards, longest wait first, then the working rows, longest
 * running first, under the count rule of `countKind` and `liveKind`, so the
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
  const byWait = (a: InboxCard<M>, b: InboxCard<M>) => a.since - b.since || b.thread.updatedAt - a.thread.updatedAt;
  needs.sort(byWait);
  offline.sort(byWait);
  working.sort((a, b) => a.since - b.since);
  return { needs, working, offline, tally };
}

/**
 * What a needs-you thread (`needsHand`) waits on: a question, a permission, a
 * key, a child asking, a failed turn read or not, or work that stopped short.
 * Only the words are the Inbox's own.
 */
function cardOf<M>(source: InboxSource<M>, thread: ThreadSummary, state: ThreadState | null): Pick<InboxCard<M>, 'reason' | 'detail' | 'since'> {
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

/** `12m`, `2h 57m`, `3d`: how long a card has waited, coarse enough to read at a glance; the desktop and phone Inbox share it. */
export function waitedFor(now: number, since: number): string {
  const labels = strings.inbox;
  const minutes = Math.max(1, Math.floor((now - since) / 60_000));
  if (minutes < 60) return fill(labels.minutes, { count: String(minutes) });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return fill(labels.hours, { count: String(hours), minutes: String(minutes % 60).padStart(2, '0') });
  return fill(labels.days, { count: String(Math.floor(hours / 24)) });
}
