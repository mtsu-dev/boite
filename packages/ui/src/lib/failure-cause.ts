import type { DelegatedAgent, WorkflowRun } from '@boite/contracts';
import { fill, strings } from './strings';

/** An error's first line: the cause, without the trace a provider may append under it. */
function firstLine(text: string | null | undefined): string {
  return text?.split('\n').map((line) => line.trim()).find(Boolean) ?? '';
}

/**
 * Why a subagent stopped or failed, in the words Activity uses for the same thread: its background work that ended
 * without reporting back (a stop), or its last turn's error; "Failed" when the core says nothing more.
 */
export function agentFailure(agent: DelegatedAgent): string {
  const wait = agent.thread.backgroundWait;
  if (wait?.state === 'interrupted') {
    const said = fill(strings.sidebar.state.interruptedBy, { what: wait.for, reason: strings.sidebar.state.interruption[wait.reason] });
    return said.charAt(0).toLocaleUpperCase() + said.slice(1);
  }
  return firstLine(agent.lastTurn?.error) || strings.delegation.rowState.failed;
}

/** Why a workflow run failed: the step that failed and its error, else the run's own; "Failed" when neither says. */
export function workflowFailure(run: WorkflowRun): string {
  const node = run.nodes.find((step) => step.status === 'failed');
  const error = firstLine(node?.error ?? node?.instances.find((instance) => instance.status === 'failed')?.error) || firstLine(run.error);
  if (node && error) return fill(strings.workflow.stepFailed, { step: node.title, error });
  return error || strings.workflow.status.failed;
}
