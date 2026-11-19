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
  if (!machine || !turn || !usage || turn.finishedAt == null) return false;
  const counts = [usage.inputTokens, usage.outputTokens, usage.cacheReadTokens, usage.cacheWriteTokens, usage.cacheWriteHourTokens ?? 0];
  if (!counts.every(count => Number.isSafeInteger(count) && count >= 0)) return false;
  const cost = usage.costUsdEquivalent ?? null;
  if (cost !== null && (!Number.isFinite(cost) || cost < 0)) return false;
  // An older first attempt with one measured turn has enough data to recover its snapshot.
  const legacyId = inst.attempts === 1 && machine.usageTurnIds?.length === 1 ? machine.usageTurnIds[0] : undefined;
  const legacyUsage = !machine.usageLedger && legacyId && inst.usage ? { id: legacyId, usage: inst.usage } : null;
  if (!legacyUsage && machine.usageTurnIds?.includes(turn.id)) return false;
  const ledger = machine.usageLedger ?? (legacyUsage
    ? { prior: null, turns: [legacyUsage] }
    : { prior: inst.usage ?? null, turns: [] });
  const next = { ...usage, costUsdEquivalent: cost };
  const existing = ledger.turns.find(entry => entry.id === turn.id);
  if (JSON.stringify(existing?.usage) === JSON.stringify(next)) return false;
  if (existing) existing.usage = next;
  else ledger.turns.push({ id: turn.id, usage: next });
  if (legacyUsage) delete machine.usageTurnIds;
  machine.usageLedger = ledger;
  inst.usage = ledger.turns.reduce<Usage | null>((total, entry) => total ? sumUsage(total, entry.usage) : entry.usage, ledger.prior);
  return true;
}

/** Aggregate once per execution key, retaining turns from children replaced by a retry. */
export function workflowUsage(core: Core, run: WorkflowRun): WorkflowRun {
  const rows = usageGroups(core.journal.db, {
    key: 'steps.step_key',
    join: 'JOIN workflow_steps steps ON steps.thread_id = t.thread_id',
    where: `steps.run_id = ? AND (t.usage IS NOT NULL OR (t.started_at IS NOT NULL AND t.finished_at IS NOT NULL
      AND COALESCE(json_extract(t.execution, '$.operation'), '') NOT IN ('compact', 'keepalive')))`,
    includeUnreported: true,
  }, run.id);
  const groups = rows.filter(row => row.reported > 0);
  const partial = new Set(rows.flatMap(row => row.key !== null && row.reported < row.turns ? [row.key.split('#', 1)[0]!] : []));
  const byKey = sumGroups(core, groups) as Map<string | null, Usage>;
  const byNode = new Map<string, Usage>();
  for (const [key, measured] of byKey) {
    if (key === null) continue;
    const id = key.split('#', 1)[0]!;
    const prior = byNode.get(id);
    byNode.set(id, prior ? sumUsage(prior, measured) : measured);
  }
  let usage = usageTotal(core, groups);
  const nodes = run.nodes.map(node => ({ ...node, ...((node.round ?? 1) > 1 ? { usage: byNode.get(node.id), usagePartial: partial.has(node.id) } : {}), instances: node.instances.map(inst => {
    if (inst.machine && inst.usage) usage = sumUsage(usage, inst.usage);
    return { ...inst, usage: inst.usage ?? byKey.get(inst.key) ?? null };
  }) }));
  return { ...run, usage, nodes };
}
