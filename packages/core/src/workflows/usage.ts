import type { Turn, Usage, WorkflowInstance, WorkflowRun } from '@boite/contracts';
import type { Core } from '../core.ts';
import { usageGroups } from '../journal/usage-sums.ts';
import { sumGroups, sumUsage, usageTotal } from '../usage.ts';

export function announceWorkflow(core: Core, run: WorkflowRun): void {
  core.bus.emit('workflows.changed', { threadId: run.rootThreadId, runId: run.id });
  // A step's conversation shows its parent's runs and subscribes to that thread alone.
  for (const node of run.nodes) for (const inst of node.instances) {
    if (inst.threadId) core.bus.emit('workflows.changed', { threadId: inst.threadId, runId: run.id });
  }
}

/** A measured turn changed after settlement. Its run's view reads usage from the journal. */
export function announceWorkflowUsage(core: Core, threadId: string): void {
  if (!core.workflows.owns(threadId)) return;
  const row = core.journal.db.query('SELECT r.data FROM workflow_steps s JOIN workflow_runs r ON r.id = s.run_id WHERE s.thread_id = ?').get(threadId) as { data: string } | null;
  if (row) announceWorkflow(core, JSON.parse(row.data) as WorkflowRun);
}

/** Reports carry the last turn and can replay it before or after the attempt settles. */
export function recordMachineUsage(inst: WorkflowInstance, turn: Pick<Turn, 'id' | 'finishedAt' | 'usage'> | null | undefined): boolean {
  const machine = inst.machine;
  const usage = turn?.usage;
  if (!machine || !turn || !usage || turn.finishedAt == null || machine.usageTurnIds?.includes(turn.id)) return false;
  const counts = [usage.inputTokens, usage.outputTokens, usage.cacheReadTokens, usage.cacheWriteTokens, usage.cacheWriteHourTokens ?? 0];
  if (!counts.every(count => Number.isSafeInteger(count) && count >= 0)) return false;
  const cost = usage.costUsdEquivalent ?? null;
  if (cost !== null && (!Number.isFinite(cost) || cost < 0)) return false;
  (machine.usageTurnIds ??= []).push(turn.id);
  inst.usage = inst.usage ? sumUsage(inst.usage, { ...usage, costUsdEquivalent: cost }) : { ...usage, costUsdEquivalent: cost };
  return true;
}

/** Aggregate once per execution key, retaining turns from children replaced by a retry. */
export function workflowUsage(core: Core, run: WorkflowRun): WorkflowRun {
  const groups = usageGroups(core.journal.db, { key: 'steps.step_key', join: 'JOIN workflow_steps steps ON steps.thread_id = t.thread_id', where: 'steps.run_id = ?' }, run.id);
  const byKey = sumGroups(core, groups) as Map<string | null, Usage>;
  const byNode = new Map<string, Usage>();
  for (const [key, measured] of byKey) {
    if (key === null) continue;
    const id = key.split('#', 1)[0]!;
    const prior = byNode.get(id);
    byNode.set(id, prior ? sumUsage(prior, measured) : measured);
  }
  let usage = usageTotal(core, groups);
  const nodes = run.nodes.map(node => ({ ...node, usage: (node.round ?? 1) > 1 ? byNode.get(node.id) : undefined, instances: node.instances.map(inst => {
    if (inst.machine && inst.usage) usage = sumUsage(usage, inst.usage);
    return { ...inst, usage: inst.usage ?? byKey.get(inst.key) ?? null };
  }) }));
  return { ...run, usage, nodes };
}
