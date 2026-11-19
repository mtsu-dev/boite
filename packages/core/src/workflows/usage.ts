import type { Turn, Usage, WorkflowInstance, WorkflowRun } from '@boite/contracts';
import type { Core } from '../core.ts';
import { usageGroups } from '../journal/usage-sums.ts';
import { sumGroups, sumUsage, usageTotal } from '../usage.ts';

/** Reports carry the last turn and can replay it before or after the attempt settles. */
export function recordMachineUsage(inst: WorkflowInstance, turn: Turn | null | undefined): boolean {
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
  let usage = usageTotal(core, groups);
  const nodes = run.nodes.map(node => ({ ...node, instances: node.instances.map(inst => {
    if (inst.machine && inst.usage) usage = sumUsage(usage, inst.usage);
    return { ...inst, usage: inst.usage ?? byKey.get(inst.key) ?? null };
  }) }));
  return { ...run, usage, nodes };
}
