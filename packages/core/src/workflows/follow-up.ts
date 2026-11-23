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
  const node = run.nodes.find(node => node.id === row.step_key.split('#')[0]);
  const inst = node?.instances.find(entry => entry.key === row.step_key);
  const history = node?.previous?.find(entry => entry.key === row.step_key);
  if (turn === undefined) {
    const last = core.journal.db.query('SELECT id FROM turns WHERE thread_id = ? ORDER BY rowid DESC LIMIT 1').get(threadId) as { id: string } | null;
    turn = last ? core.journal.getTurn(last.id) : null;
  }
  if (!turn) return false;
  if (inst?.threadId === threadId) return inst.status !== 'running' && inst.finishedAt !== null && turn.queuedAt >= inst.finishedAt;
  const attempt = inst?.previousAttempts?.find(entry => entry.threadId === threadId) ?? history?.previousAttempts?.find(entry => entry.threadId === threadId);
  const finishedAt = attempt?.finishedAt ?? (history?.threadId === threadId ? history.finishedAt : null);
  return finishedAt != null && turn.queuedAt >= finishedAt;
}
