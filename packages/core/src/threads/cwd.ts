import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { RpcErrorCode, type Project, type ThreadId, type ThreadSummary } from '@boite/contracts';
import type { Core } from '../core.ts';
import { messageOf, RpcFailure } from '../errors.ts';
import { worktreeRemovalOf } from '../worktree-cleanup-state.ts';

/**
 * A thread whose folder is gone: its worktree was removed under it, or the
 * folder moved. `turns.start` refuses it; a turn Boite starts by itself (a
 * subagent's result, a resume, a PR wake) fails with it instead of the cause
 * the agent gives, which misleads (Claude Code blames its native binary).
 */
export class ThreadCwdGone extends RpcFailure {
  constructor(threadId: ThreadId, cwd: string) {
    super(RpcErrorCode.Refused, `the folder ${cwd} this thread works in does not exist any more: its worktree was removed or the folder moved`, {
      threadId, cwd, field: 'cwd', expected: 'an existing folder',
    });
  }
}

/** Whether `cwd` is a folder. Async, so a share whose host is gone stalls this call only. */
export function folderPresent(cwd: string): Promise<boolean> {
  return stat(cwd).then((found) => found.isDirectory(), () => false);
}

/** Throws `ThreadCwdGone` unless `cwd` is a folder. */
export async function requireThreadCwd(threadId: ThreadId, cwd: string): Promise<void> {
  if (!(await folderPresent(cwd))) throw new ThreadCwdGone(threadId, cwd);
}

/** Verify the execution folder before a user turn, restoring a worktree whose branch survived. */
export async function ensureThreadCwd(core: Core, thread: ThreadSummary): Promise<void> {
  if (await folderPresent(thread.cwd)) return;
  await restoreThreadCwd(core, thread);
  await requireThreadCwd(thread.id, thread.cwd);
}

/**
 * A thread in a worktree of its own whose folder went while its branch stayed
 * (`git worktree remove` from a script, a deleted folder): the branch is
 * checked out there again before the turn, as a subagent's is, with every
 * commit it had. Uncommitted work that went with the folder is not back. A
 * thread in its project folder, an archived one, a deleted branch or a
 * worktree the core's own cleanup removed (`worktreeRemoved`, whose notice
 * replaces the composer) is left as is, and a checkout git refuses is logged:
 * the turn then fails by folder.
 * Null, at once, when there is nothing to do, as `ChildWorktrees.enter`: a
 * turn starts its agent in the same tick as before. A folder still gone after
 * recovery is refused before even a warm agent can answer from it.
 */
export function restoreThreadCwd(core: Core, thread: ThreadSummary): Promise<void> | null {
  const { branch, projectId } = thread;
  if (thread.archived || existsSync(thread.cwd)) return null;
  if (branch === null || projectId === null || worktreeRemovalOf(core.journal, thread) !== null) return requireThreadCwd(thread.id, thread.cwd);
  const project = core.journal.getProject(projectId);
  return project
    ? recover(core, thread, project, branch).then(() => requireThreadCwd(thread.id, thread.cwd))
    : requireThreadCwd(thread.id, thread.cwd);
}

async function recover(core: Core, thread: ThreadSummary, project: Project, branch: string): Promise<void> {
  const context = { source: 'threads', threadId: thread.id, data: { cwd: thread.cwd, branch } };
  try {
    if (!(await core.worktrees.recover(thread.id, project, branch, thread.cwd))) return;
  } catch (error) {
    core.log('warn', `could not check ${branch} out again in ${thread.cwd}, the folder of its thread: ${messageOf(error)}`, context);
    return;
  }
  core.log('info', `checked ${branch} out again in ${thread.cwd}: the folder of its thread was gone`, { ...context, event: 'worktrees.restored' });
}
