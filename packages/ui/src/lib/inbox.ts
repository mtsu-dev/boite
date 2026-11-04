import { requestExcerpt, type Account, type PermissionRequest, type Project, type QuestionRequest, type SecretRequest, type ThreadSummary } from '@boite/contracts';
import { needsUser, threadState, type Delegated } from './thread-state';
import { liveState } from './thread-lanes.svelte';
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
}

export interface InboxRow<M> {
  machine: M;
  thread: ThreadSummary;
  project: Project | undefined;
  /** When the work the row counts started. */
  since: number;
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
    subagents: (id: string) => machine.store.subagents(id)
  }));
}

/** The cards the home shows before folding the rest under `n more`. */
export const INBOX_CARDS = 4;

/** The threads a list of the user's work shows: no archive, no incognito, no team or debate room. */
export function listed(thread: ThreadSummary): boolean {
  return !thread.archived && !thread.incognito && !thread.teamId && !thread.debateId;
}

/**
 * The needs-you cards, longest wait first, then the working rows, longest
 * running first. A delegated agent's thread is left to its parent, which
 * carries its question (`subagentQuestions`) and its work.
 */
export function inbox<M>(sources: readonly InboxSource<M>[]): { needs: InboxCard<M>[]; working: InboxRow<M>[] } {
  const needs: InboxCard<M>[] = [];
  const working: InboxRow<M>[] = [];
  for (const source of sources) {
    const projects = new Map(source.projects.map(project => [project.id, project]));
    const ids = new Set(source.threads.map(thread => thread.id));
    for (const thread of source.threads) {
      if (!listed(thread)) continue;
      if (thread.parentThreadId && ids.has(thread.parentThreadId)) continue;
      const project = thread.projectId === null ? undefined : projects.get(thread.projectId);
      const state = threadState(thread, source.subagents?.(thread.id) ?? 0);
      const card = cardOf(source, thread, state);
      if (card) needs.push({ machine: source.machine, thread, project, ...card });
      else if (liveState(state)) {
        working.push({ machine: source.machine, thread, project, since: thread.requestSince ?? thread.runningSince ?? thread.updatedAt });
      }
    }
  }
  needs.sort((a, b) => a.since - b.since || b.thread.updatedAt - a.thread.updatedAt);
  working.sort((a, b) => a.since - b.since);
  return { needs, working };
}

/**
 * The same threads the sidebar's Needs you counts (`needsHand`): a question,
 * a permission, a key, a child asking, a failed turn read or not, and work
 * that stopped short. Only the words are the Inbox's own.
 */
function cardOf<M>(source: InboxSource<M>, thread: ThreadSummary, state: ReturnType<typeof threadState>): Pick<InboxCard<M>, 'reason' | 'detail' | 'since'> | null {
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
  if (state === 'interrupted') return { reason: 'interrupted', detail: thread.backgroundWait?.for ?? null, since: thread.updatedAt };
  return null;
}
