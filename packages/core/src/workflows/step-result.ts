import { extractJson, shapeMismatch } from '@boite/contracts';
import type { Turn, WorkflowInstance, WorkflowShape } from '@boite/contracts';
import type { Core } from '../core.ts';
import { tooLong } from './notices.ts';

/** The whole text of a turn's last answer, for JSON that may run past the bounded result. */
export function stepAnswer(core: Core, turn: Turn): string {
  const rows = core.journal.db.query(`SELECT (SELECT group_concat(json_extract(value, '$.text'), char(10))
    FROM json_each(messages.parts) WHERE json_extract(value, '$.type') = 'text') AS answer
    FROM messages WHERE turn_id = ? AND role = 'assistant' ORDER BY rowid DESC LIMIT 8`).all(turn.id) as { answer: string | null }[];
  for (const row of rows) if (row.answer?.trim()) return row.answer.slice(0, 64_000);
  return '';
}

/** The answer's JSON block when it fits the step's output shape, or what is wrong with it. */
export function shapedOutput(answer: string, shape: WorkflowShape): { value: unknown } | { mismatch: string } {
  const parsed = extractJson(answer);
  const mismatch = parsed ? shapeMismatch(parsed.value, shape) ?? tooLong(parsed.value) : 'the answer has no ```json block';
  return mismatch ? { mismatch } : { value: parsed!.value };
}

/**
 * Whether a done turn delivered its step's result, through `boite workflow
 * output` or a JSON block of the step's output shape. Such a turn is the
 * step's answer even when it ended with background work still running.
 */
export function delivered(core: Core, turn: Turn, inst: WorkflowInstance, shape: WorkflowShape | undefined): boolean {
  if (turn.status !== 'done') return false;
  if (inst.output !== null) return true;
  return shape !== undefined && 'value' in shapedOutput(stepAnswer(core, turn), shape);
}

/**
 * Ends a finished step's agent and the background work it left (watchers,
 * builds), so none of it wakes the step after its result. The step's
 * conversation stays: a later message resumes its session.
 */
export function endLeftovers(core: Core, threadId: string): void {
  core.log('info', `workflow step ${threadId}: its result is in, so the background work it left is stopped`);
  core.threads.deferred.pendingWakes.delete(threadId);
  core.threads.releaseAgent(threadId);
  core.procs.killTree(threadId);
}
