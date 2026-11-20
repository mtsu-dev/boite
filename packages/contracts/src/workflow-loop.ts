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
function rewind(run: WorkflowRun, body: Set<string>, fresh = false): void {
  for (const node of run.nodes) {
    if (!body.has(node.id)) continue;
    node.previous = node.instances;
    if (fresh) node.freshRound = true;
    else delete node.freshRound;
    delete node.exhausted;
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
  Object.assign(node, { status: 'failed', exhausted: true, error: `${conditionText(step.repeat.until)} still did not hold after ${round} rounds of the loop from ${step.repeat.from}; a retry runs one more round`, finishedAt: now });
  return 'spent';
}

function canonicalItem(item: unknown): string | undefined {
  return JSON.stringify(item, (_key, value: unknown) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left < right ? -1 : left === right ? 0 : 1))
    : value);
}

/** Only an item unique in both rounds can inherit a conversation and its usage key. */
export function workflowExecutions(run: WorkflowRun, node: WorkflowNode, items: unknown[] | null) {
  if (items === null) return [{ key: node.id, previous: node.previous?.[0], itemIdentity: undefined }];
  const identities = loopOf(run, node.id) ? items.map(canonicalItem) : [];
  const previous = new Map<string, WorkflowInstance | undefined>();
  for (const execution of node.previous ?? []) if (execution.itemIdentity !== undefined) {
    const identity = execution.itemIdentity;
    previous.set(identity, previous.has(identity) ? undefined : execution);
  }
  return items.map((_item, index) => {
    const itemIdentity = identities[index];
    const matched = itemIdentity !== undefined && identities.indexOf(itemIdentity) === identities.lastIndexOf(itemIdentity) ? previous.get(itemIdentity) : undefined;
    return { key: matched?.key ?? `${node.id}#${(node.spent ?? 0) + index}`, previous: matched, itemIdentity };
  });
}

/** The route a round can reuse, or the earlier conversation a fresh round replaces. */
export function workflowContinuation(previous: WorkflowInstance | undefined, fresh: boolean, available: (threadId: string) => boolean): Partial<WorkflowInstance> {
  if (!previous?.threadId) return {};
  if (fresh) return { previousAttempts: [...previous.previousAttempts ?? [], { threadId: previous.threadId, finishedAt: previous.finishedAt }] };
  if (!available(previous.threadId)) return {};
  const { threadId, providerId, model, effort, previousAttempts } = previous;
  return { threadId, providerId, model, effort, previousAttempts };
}

const broken = (status: WorkflowInstance['status']) => status === 'failed' || status === 'stopped';
const NOT_STARTED = 'Not started: another step of the run failed';

/** Reopen selected failures while keeping unrelated outcomes, including failures, in the run. */
export function retryWorkflowSteps(run: WorkflowRun, stepId?: string): boolean {
  const targets = new Set(run.nodes.filter(node =>
    (stepId === undefined || node.id === stepId) && (broken(node.status) || node.instances.some(inst => broken(inst.status)))));
  if (targets.size === 0) return false;
  // The closing step of an exhausted loop failed despite its executions completing. Retry one more round.
  for (const node of targets) {
    if (node.exhausted !== true || node.status !== 'failed') continue;
    const step = run.plan.steps.find(s => s.id === node.id);
    if (step?.repeat) rewind(run, loopBody(run.nodes, step.repeat.from, step.id), true);
  }
  for (const node of run.nodes) {
    for (const inst of node.instances) {
      if (inst.status === 'stopped' && inst.error === NOT_STARTED) {
        // A persisted run from an older scheduler may still have untouched executions.
        Object.assign(inst, { status: 'waiting', error: null, finishedAt: null });
      } else if (targets.has(node) && broken(inst.status)) {
        if (inst.threadId !== null) inst.previousAttempts = [...inst.previousAttempts ?? [], { threadId: inst.threadId, finishedAt: inst.finishedAt }];
        Object.assign(inst, { status: 'waiting', threadId: null, startedAt: null, finishedAt: null });
        delete inst.outputCorrection;
      }
    }
    if (!node.instances.length && ((targets.has(node) && broken(node.status)) || node.status === 'stopped' && run.status === 'stopped')) {
      Object.assign(node, { status: 'waiting', error: null, startedAt: null, finishedAt: null });
    } else if (node.instances.some(inst => inst.status === 'waiting')) {
      Object.assign(node, { status: 'running', error: null, finishedAt: null });
    }
  }
  return true;
}
