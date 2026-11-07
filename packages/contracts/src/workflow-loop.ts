/**
 * What the core and the in-memory client share once a run is going: the values
 * steps read, the executions a run has spent, and the loops of `repeat`. Pure,
 * so both engines turn a loop the same way.
 */
import type { WorkflowInstance, WorkflowNode, WorkflowRun, WorkflowStepPlan } from './workflows';
import { conditionHolds, conditionText, loopBody } from './workflow-plan';

const valueOf = (inst: WorkflowInstance) => inst.output ?? inst.result;

/** Each step's value: its structured output, else its answer; a list for a fan-out; null when skipped. */
export function workflowValues(run: WorkflowRun): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const node of run.nodes) {
    if (node.status === 'skipped') values[node.id] = null;
    else if (node.status === 'done') values[node.id] = node.forEach ? node.instances.map(valueOf) : node.instances[0] ? valueOf(node.instances[0]) : null;
  }
  return values;
}

/** Executions the run has used, earlier rounds of its loops included: what `maxSteps` holds. */
export function executionsUsed(run: WorkflowRun): number {
  return run.nodes.reduce((n, node) => n + node.instances.length + (node.spent ?? 0), 0);
}

/** The step that closes the loop `nodeId` runs in, and that loop's steps, or null outside loops. */
export function loopOf(run: WorkflowRun, nodeId: string): { step: WorkflowStepPlan & { repeat: NonNullable<WorkflowStepPlan['repeat']> }; body: Set<string> } | null {
  for (const step of run.plan.steps) {
    if (!step.repeat) continue;
    const body = loopBody(run.nodes, step.repeat.from, step.id);
    if (body.has(nodeId)) return { step: step as never, body };
  }
  return null;
}

/** What the last round of the closing step ended with, for the steps of its loop to read in the next one. */
export function lastRound(run: WorkflowRun, closing: string): unknown {
  const node = run.nodes.find(n => n.id === closing);
  const previous = node?.previous ?? [];
  if (!node || !previous.length) return null;
  return node.forEach ? previous.map(valueOf) : valueOf(previous[0]!);
}

/** Every step of the loop waits again, one round further, its executions kept to reuse their conversations. */
function rewind(run: WorkflowRun, body: Set<string>): void {
  for (const node of run.nodes) {
    if (!body.has(node.id)) continue;
    if (node.instances.length) node.previous = node.instances;
    Object.assign(node, { spent: (node.spent ?? 0) + node.instances.length, round: (node.round ?? 1) + 1, instances: [], status: 'waiting', error: null, startedAt: null, finishedAt: null });
  }
}

/**
 * Called once a step that closes a loop has ended done. `over`: its condition
 * holds and it stays done. `again`: the loop runs another round. `spent`: the
 * last round passed and the step failed, which a retry turns into one round more.
 */
export function closeLoop(run: WorkflowRun, node: WorkflowNode, now: number): 'over' | 'again' | 'spent' {
  const step = run.plan.steps.find(s => s.id === node.id);
  if (!step?.repeat || node.status !== 'done') return 'over';
  if (conditionHolds(step.repeat.until, workflowValues(run))) return 'over';
  const round = node.round ?? 1;
  if (round < step.repeat.max) {
    rewind(run, loopBody(run.nodes, step.repeat.from, step.id));
    return 'again';
  }
  Object.assign(node, { status: 'failed', error: `${conditionText(step.repeat.until)} still did not hold after ${round} rounds of the loop from ${step.repeat.from}; a retry runs one more round`, finishedAt: now });
  return 'spent';
}

/** A loop that ran out of rounds: its closing step failed though every execution of it ended done. */
export function loopSpent(run: WorkflowRun, node: WorkflowNode): boolean {
  const step = run.plan.steps.find(s => s.id === node.id);
  return !!step?.repeat && node.status === 'failed' && node.instances.length > 0 && node.instances.every(inst => inst.status === 'done');
}

/** A retry of a loop that ran out of rounds: one round more. */
export function loopAgain(run: WorkflowRun, node: WorkflowNode): void {
  const step = run.plan.steps.find(s => s.id === node.id)!;
  rewind(run, loopBody(run.nodes, step.repeat!.from, step.id));
}
