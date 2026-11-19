import { rowAsks, threadActive, threadState, type BackgroundTask, type PermissionRequest, type QuestionRequest, type RowSource, type ThreadSummary, type WorkingChildren } from '@boite/contracts';
import { pullRequestWait, watchStatus } from './pull-request-watch';
import { fill, strings } from './strings';

/** `1 shell still running`, `2 shells, 1 monitor still running`; empty for no task. */
export function backgroundLabel(kinds: readonly BackgroundTask['kind'][]): string {
  if (kinds.length === 0) return '';
  const counts = new Map<BackgroundTask['kind'], number>();
  for (const kind of kinds) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  const pieces = [...counts].map(([kind, count]) => fill(count === 1 ? strings.chat.backgroundOne[kind] : strings.chat.backgroundMany[kind], { count: String(count) }));
  return fill(strings.chat.backgroundRunning, { what: pieces.join(strings.chat.backgroundJoin) });
}

export interface ThreadWait {
  label: string;
  since: number | null;
}

export function namedWait(what: string, since: number | null): ThreadWait {
  return { label: fill(strings.sidebar.state.awaiting, { what }), since };
}

type Requests = { pendingQuestions: QuestionRequest[]; pendingPermissions: PermissionRequest[] };

export function pendingWait(store: Requests, threadId: string | null | undefined): { what: string; since: number } | null {
  if (!threadId) return null;
  const question = store.pendingQuestions.find(request => request.threadId === threadId);
  if (question) return { what: question.text.split('\n')[0]!.trim(), since: question.createdAt };
  const permission = store.pendingPermissions.find(request => request.threadId === threadId);
  return permission ? { what: permission.description ?? permission.toolName, since: permission.createdAt } : null;
}

/** Use the known start of the wait. A turn's start says only how long the turn has run. */
export function threadWait(thread: ThreadSummary | null, store: Requests & RowSource<WorkingChildren | null>): ThreadWait | null {
  if (!thread || thread.archived) return null;
  const children = rowAsks(store, thread.id);
  const state = threadState(thread, children);
  if (state === 'waiting') {
    const pending = pendingWait(store, thread.id);
    if (pending?.what) return { label: pending.what, since: pending.since };
    const progress = thread.progress?.phase === 'waiting' ? thread.progress : null;
    return { label: strings.sidebar.state.waiting, since: pending?.since ?? progress?.since ?? progress?.at ?? null };
  }
  if (thread.status === 'running' && thread.progress?.phase === 'waiting') {
    return { label: strings.agents.activity.provider, since: thread.progress.since ?? thread.progress.at };
  }
  if (threadActive(thread.status)) return null;
  if (state === 'delegating' && children !== null) {
    const words = strings.app.rail;
    return { label: children.count === 1 ? words.subagentsOne : fill(words.subagentsMany, { count: String(children.count) }), since: children.since };
  }
  if (thread.backgroundWait?.state === 'waiting') return namedWait(thread.backgroundWait.for, thread.backgroundWait.since);
  const { active: watches, paused } = pullRequestWait(thread.pullRequestWatches);
  if (paused) return { label: watchStatus(paused), since: null };
  if (watches.length) {
    const words = strings.sidebar.state.workWord;
    const queue = watches.every(watch => watch.seen?.queue && watch.seen.checks.running === 0);
    return { label: [queue ? words.mergeQueue : words.ci, ...watches.map(watch => `#${watch.number}`)].join(' '), since: Math.min(...watches.map(watch => watch.since)) };
  }
  const work = thread.backgroundWork;
  return work?.kinds.length ? { label: backgroundLabel(work.kinds), since: work.since } : null;
}
