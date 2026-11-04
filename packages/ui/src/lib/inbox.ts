import { requestExcerpt, type Account, type PermissionRequest, type Project, type QuestionRequest, type SecretRequest, type ThreadSummary } from '@boite/contracts';
import { needsUser } from './thread-state';

/**
 * What the home's Inbox and the phone's Inbox tab list: the threads that wait
 * on the user, on every machine shown, and the ones at work. Pure, so the
 * order and the cap are tested without a component.
 */

/** Why a thread waits on the user, in the words of its card. */
export type InboxReason = 'question' | 'permission' | 'secret' | 'sign-in' | 'failed';

export interface InboxSource<M> {
  machine: M;
  threads: readonly ThreadSummary[];
  projects: readonly Project[];
  questions: readonly QuestionRequest[];
  permissions: readonly PermissionRequest[];
  secrets?: readonly SecretRequest[];
  accounts?: readonly Pick<Account, 'id' | 'status'>[];
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
      const card = cardOf(source, thread);
      if (card) needs.push({ machine: source.machine, thread, project, ...card });
      else if (thread.status === 'running' || thread.status === 'queued') {
        working.push({ machine: source.machine, thread, project, since: thread.requestSince ?? thread.runningSince ?? thread.updatedAt });
      }
    }
  }
  needs.sort((a, b) => a.since - b.since || b.thread.updatedAt - a.thread.updatedAt);
  working.sort((a, b) => a.since - b.since);
  return { needs, working };
}

function cardOf<M>(source: InboxSource<M>, thread: ThreadSummary): Pick<InboxCard<M>, 'reason' | 'detail' | 'since'> | null {
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
  // A failed turn the user has not read yet: once opened, the thread says it itself.
  if (thread.status === 'error' && thread.unread) {
    const account = source.accounts?.find(entry => entry.id === thread.accountId);
    return { reason: account?.status === 'unauthenticated' ? 'sign-in' : 'failed', detail: null, since: thread.updatedAt };
  }
  return null;
}
