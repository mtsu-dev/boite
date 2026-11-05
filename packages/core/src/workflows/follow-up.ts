/** A workflow step's conversation its parent sent back to work once the step ended. */
import type { Turn, WorkflowRun } from '@boite/contracts';
import type { Core } from '../core.ts';

/**
 * Whether the step's conversation now works for its parent: its execution
 * ended, and `turn`, its last turn when omitted, was queued after that. Such a
 * turn answers the parent as a subagent's does (`delegation.ts`), and the run
 * keeps the step's result. A Stop records the step stopped before the turn it
 * stops ends: that turn, queued earlier, is not one.
 */
export function sentBack(core: Core, threadId: string, turn?: Pick<Turn, 'queuedAt'> | null): boolean {
  const row = core.journal.db.query('SELECT runs.data, steps.step_key FROM workflow_steps steps JOIN workflow_runs runs ON runs.id = steps.run_id WHERE steps.thread_id = ?')
    .get(threadId) as { data: string; step_key: string } | null;
  if (!row) return false;
  const run = JSON.parse(row.data) as WorkflowRun;
  const inst = run.nodes.flatMap(node => node.instances).find(entry => entry.key === row.step_key);
  if (turn === undefined) {
    const last = core.journal.db.query('SELECT id FROM turns WHERE thread_id = ? ORDER BY rowid DESC LIMIT 1').get(threadId) as { id: string } | null;
    turn = last ? core.journal.getTurn(last.id) : null;
  }
  return !!inst && !!turn && inst.threadId === threadId && inst.status !== 'running' && inst.finishedAt !== null && turn.queuedAt >= inst.finishedAt;
}
