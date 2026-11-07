// A loop's next round reuses each execution's conversation, so its agent keeps what it did and read.
import type { WorkflowInstance, WorkflowNode } from '@boite/contracts';
import type { Core } from '../core.ts';

/** The conversation and route of the execution `key` had last round, unless that conversation is archived or gone. */
export function reused(core: Core, node: WorkflowNode, key: string): Partial<WorkflowInstance> {
  const last = node.previous?.find(inst => inst.key === key && inst.threadId !== null);
  if (!last || core.journal.getThread(last.threadId!)?.archived !== false) return {};
  return { threadId: last.threadId, providerId: last.providerId, model: last.model, ...(last.effort === undefined ? {} : { effort: last.effort }) };
}
