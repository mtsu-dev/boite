import { delegationNeeds, threadBusy, type AgentLetter, type DelegatedAgent, type ThreadSummary } from '@boite/contracts';
import type { Core } from '../core.ts';
import { withLoad } from '../threads/records.ts';
import { pendingComposerFollowUp, taskTurn } from './completion.ts';
import type { ChildState, RemoteChild } from './remote-wire.ts';
import { turnResult } from './results.ts';

/** Load and the derived live fields arrive in thread.updated without changing team history. */
export function teamState(thread: ThreadSummary): string {
  const { load, progress, runningSince, requestSince, backgroundWork, backgroundWait, pendingMove, moveNote, pendingAnswers, openQuestions, subagentQuestions, remoteSubagents, retry, recovery, pullRequestWatches, wake, ...stored } = thread;
  return JSON.stringify(Object.fromEntries(Object.entries(stored).sort(([left], [right]) => left.localeCompare(right))));
}

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

export function remoteMember(rootId: string, record: RemoteChild): DelegatedAgent {
  const state = record.state!, childId = record.childId!;
  const lastTurn = state.lastTurn;
  const terminal = lastTurn !== null && !['queued', 'running'].includes(lastTurn.status) && !state.restarting;
  const wait = state.thread.backgroundWait?.state;
  return {
    thread: { ...state.thread, parentThreadId: rootId }, profileId: record.profileId, task: record.task, lastTurn, result: state.result,
    ...(terminal && wait !== 'waiting' ? { resultRef: { agentId: childId, turnId: lastTurn.id }, settlement: wait === 'interrupted' ? 'settled' as const : 'result_available' as const } : lastTurn === null ? { settlement: 'settled' as const } : {}),
    ...(state.needsInput?.length ? { needsInput: state.needsInput } : {}), ...(state.worktree ? { worktree: state.worktree } : {}),
    machine: { coreId: record.coreId, name: record.machine },
  };
}

/** An unanswered start may already be working. A restart cut is still at work too. */
export function remoteChildBusy(record: RemoteChild): boolean {
  const state = record.state;
  if (record.childId === null || !state) return !record.stopping;
  return state.restarting === true || (state.lastTurn !== null && ['queued', 'running'].includes(state.lastTurn.status))
    || ['queued', 'running', 'waiting'].includes(state.thread.status) || state.thread.backgroundWait?.state === 'waiting';
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

/** Expire mail about questions the member has already closed. */
export function closeRemoteQuestions(core: Core, sender: string, state: ChildState, update: (letter: AgentLetter, status: 'expired', error: string) => void): void {
  const open = new Set((state.needsInput ?? []).map(need => need.id));
  const rows = core.journal.db.query("SELECT data, request_id FROM delegation_messages WHERE sender_id = ? AND request_id GLOB 'question:*' AND status = 'received'").all(sender) as { data: string; request_id: string }[];
  for (const row of rows) {
    if (!open.has(row.request_id.slice('question:'.length))) update(JSON.parse(row.data) as AgentLetter, 'expired', 'The question closed before it was delivered');
  }
}

/** An unfinished turn or a child between turns with work still pending. */
export function childBusy(core: Core, thread: ThreadSummary): boolean {
  if (threadBusy(thread) || (core.threads.agentState.background.get(thread.id)?.length ?? 0) > 0) return true;
  if (thread.archived || (!core.composer.hasQueuedInput(thread.id) && !core.activity.composerFollowUp(thread.id))) return false;
  const last = taskTurn(core, thread.id);
  return last !== null && pendingComposerFollowUp(core, last);
}
