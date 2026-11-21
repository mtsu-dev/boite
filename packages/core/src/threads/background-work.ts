import type { ThreadId } from '@boite/contracts';
import type { Core } from '../core.ts';
import { backgroundWaitOf } from './records.ts';

/**
 * Whether work the thread started still runs outside its turn: the agent's
 * own background tasks, a Boite child here or on another machine still at
 * work, or a workflow run of the conversation at work. A persistent agent's
 * memory pass is Boite's own housekeeping and never counts; `skip` leaves out
 * other children the caller owns, such as a goal's reviewer and checklist.
 * `ownTasks: false` leaves out the agent's own tasks, which may be a server
 * that runs for hours rather than work that reports back.
 */
export function backgroundWork(core: Core, threadId: ThreadId, options: { ownTasks?: boolean; skip?: (childId: ThreadId) => boolean } = {}): boolean {
  const background = core.threads.agentState.background;
  if (options.ownTasks !== false && (background.get(threadId)?.length ?? 0) > 0) return true;
  if (core.workflows.atWork(threadId) || core.delegation.remote.busy(threadId)) return true;
  const rows = core.journal.db.query('SELECT id, status FROM threads WHERE parent_thread_id = ?').all(threadId) as { id: ThreadId; status: string }[];
  return rows.some(row => {
    if (core.workforce?.memory.owns(row.id) || options.skip?.(row.id)) return false;
    if (row.status === 'queued' || row.status === 'running' || row.status === 'waiting') return true;
    const tasks = background.get(row.id) ?? [];
    if (tasks.length > 0) return true;
    const child = core.journal.getThread(row.id);
    return child !== null && backgroundWaitOf(core, child, tasks)?.state === 'waiting';
  });
}
