import type { ThreadStatus, WorkflowStatus, WorkflowStepStatus } from '@boite/contracts';
import { strings } from './strings';

/** The hue a status mark draws, shared by threads, agents, workflow runs and their steps. */
export type StatusTone = 'running' | 'waiting' | 'queued' | 'error' | 'done' | 'stopped' | 'skipped' | 'paused' | 'unread' | 'idle';
export type StatusMarkProps = { tone: StatusTone; label: string };

/** A thread's mark: an idle thread with news to read shows it, the rest show their status. */
export function threadTone(status: ThreadStatus, unread = false): StatusMarkProps {
  if (status === 'idle' && unread) return { tone: 'unread', label: strings.sidebar.unread };
  return { tone: status, label: strings.threadStatus[status] };
}

/** A run's mark, or a step's: a failure draws a thread's error, a step waiting for its turn an idle ring. */
export function workflowTone(status: WorkflowStatus | WorkflowStepStatus, run = false): StatusMarkProps {
  const label = run ? strings.workflow.status[status as WorkflowStatus] : strings.workflow.stepStatus[status as WorkflowStepStatus];
  return { tone: status === 'failed' ? 'error' : status === 'waiting' ? 'idle' : status, label };
}
