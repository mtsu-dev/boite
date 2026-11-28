import { delegationNeeds, threadBusy, type DelegatedAgent, type ThreadSummary } from '@boite/contracts';
import type { Core } from '../core.ts';
import { withLoad } from '../threads/records.ts';
import { pendingComposerFollowUp, taskTurn } from './completion.ts';
import type { ChildState } from './remote-wire.ts';
import { turnResult } from './results.ts';

/** The status of a child here, also reported to a parent on another machine. */
export function childSnapshot(core: Core, threadId: string): Omit<ChildState, 'project'> {
  const thread = withLoad(core, core.threads.require(threadId));
  const lastTurn = taskTurn(core, threadId);
  const needsInput = delegationNeeds(core.threads.listQuestions(threadId), core.threads.listPermissions(threadId));
  const worktree = core.delegation.worktrees.get(threadId);
  const waiting = !thread.archived && lastTurn !== null && pendingComposerFollowUp(core, lastTurn);
  return { thread, lastTurn, result: waiting ? null : turnResult(core, lastTurn), ...(waiting ? { restarting: true as const } : {}),
    ...(needsInput.length ? { needsInput } : {}), ...(worktree ? { worktree } : {}) };
}

export function localMember(core: Core, row: { thread_id: string; profile_id: string; task: string }): DelegatedAgent {
  const { thread, lastTurn, result, needsInput, worktree, restarting } = childSnapshot(core, row.thread_id);
  const terminal = lastTurn !== null && !['queued', 'running'].includes(lastTurn.status) && !restarting;
  const wait = thread.backgroundWait?.state;
  return { thread, profileId: row.profile_id, task: row.task, lastTurn, result,
    ...(terminal && wait !== 'waiting' ? { resultRef: { agentId: row.thread_id, turnId: lastTurn.id }, settlement: wait === 'interrupted' ? 'settled' as const : 'result_available' as const } : lastTurn === null ? { settlement: 'settled' as const } : {}),
    ...(needsInput ? { needsInput } : {}), ...(worktree ? { worktree } : {}) };
}

/** Questions in a child's own conversation that its parent needs to see. */
export function childQuestions(core: Core, rootId: string): NonNullable<ThreadSummary['subagentQuestions']> {
  const local = [...new Set(core.threads.listQuestions().map(question => question.threadId))].flatMap(threadId => {
    const child = core.journal.getThread(threadId);
    return child?.parentThreadId === rootId && !child.archived ? [{ threadId, title: child.title }] : [];
  });
  const remote = core.delegation.remote.members(rootId, true).filter(agent => !agent.thread.archived && agent.needsInput?.some(input => input.kind === 'question'))
    .map(agent => ({ threadId: agent.thread.id, title: agent.thread.title, machine: agent.machine! }));
  return [...local, ...remote];
}

/** An unfinished turn or a child between turns with work still pending. */
export function childBusy(core: Core, thread: ThreadSummary): boolean {
  if (threadBusy(thread) || (core.threads.agentState.background.get(thread.id)?.length ?? 0) > 0) return true;
  if (thread.archived || (!core.composer.hasQueuedInput(thread.id) && !core.activity.composerFollowUp(thread.id))) return false;
  const last = taskTurn(core, thread.id);
  return last !== null && pendingComposerFollowUp(core, last);
}
