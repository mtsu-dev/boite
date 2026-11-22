import { expect, test } from 'bun:test';
import { retryWorkflowSteps, type WorkflowRun } from '@boite/contracts';

test('a retried execution waits without the error of its failed attempt', () => {
  const inst = { key: 'a', status: 'failed', error: 'the agent crashed', threadId: 'thr_1', startedAt: 1, finishedAt: 2 };
  const run = { plan: { steps: [{ id: 'a' }] }, nodes: [{ id: 'a', status: 'failed', error: 'the agent crashed', instances: [inst] }] } as never as WorkflowRun;
  expect(retryWorkflowSteps(run, 'a')).toBe(true);
  expect(inst).toMatchObject({ status: 'waiting', error: null, threadId: null });
});
