import { afterEach, expect, test } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { DelegatedAgent, WorkflowRun } from '@boite/contracts';
import type { Store } from '../lib/store.svelte';
import WorkflowActivity from './WorkflowActivity.svelte';
import DelegationActivity from './DelegationActivity.svelte';

/**
 * A workflow or launch line in the chat: the live count belongs to the status
 * strip, so only the newest turn's line keeps it. Under an older turn a run
 * still going says when it started, and an ended one reads as its record.
 */
let mounted: Record<string, unknown> | null = null;
afterEach(async () => {
  if (mounted) await unmount(mounted, { outro: false });
  mounted = null;
  document.body.innerHTML = '';
});

const store = {} as Store;
// 03:12 today, so the line keeps its same-day form whatever day the suite runs.
const today = new Date();
const at = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 3, 12).getTime();

function run(status: WorkflowRun['status'], done: number): WorkflowRun {
  const nodes = Array.from({ length: 5 }, (_, index) => ({ id: `s${index}`, status: index < done ? 'done' : index === done && status === 'running' ? 'running' : 'waiting', instances: [] }));
  return { id: 'wfr_1', rootThreadId: 't', name: 'Review the parser', status, nodes, createdAt: at, updatedAt: at, finishedAt: status === 'running' ? null : at + 180_000 } as unknown as WorkflowRun;
}

function agent(id: string, status: 'running' | 'done' | 'interrupted'): DelegatedAgent {
  const turn = { id: `turn-${id}`, status: status === 'running' ? 'running' : 'done', startedAt: at, finishedAt: status === 'running' ? null : at + 60_000 };
  const thread = { id, status: status === 'running' ? 'running' : 'idle', createdAt: at, backgroundWait: status === 'interrupted' ? { state: 'interrupted', at: at + 90_000 } : null };
  return { thread, lastTurn: turn, profileId: 'reviewer', task: id, result: null } as unknown as DelegatedAgent;
}

const text = (testId: string) => document.querySelector(`[data-testid=${testId}]`)!.textContent!.replace(/\s+/g, ' ');

test('the newest turn\'s workflow line keeps its live count while the run goes on', () => {
  mounted = mount(WorkflowActivity, { target: document.body, props: { store, run: run('running', 1) } });
  flushSync();
  expect(text('workflow-activity')).toContain('1/5 steps');
});

test('under an older turn, a run still going says only that it started and when', () => {
  mounted = mount(WorkflowActivity, { target: document.body, props: { store, run: run('running', 1), past: true } });
  flushSync();
  const line = text('workflow-activity');
  expect(line).toContain('Review the parser');
  expect(line).toMatch(/started 0?3:12/);
  expect(line).not.toMatch(/\d\/5|of 5/);
  expect(document.querySelector('[data-testid=activity-started]')).not.toBeNull();
});

test('an ended run reads as its record, under any turn', () => {
  mounted = mount(WorkflowActivity, { target: document.body, props: { store, run: run('done', 5), past: true } });
  flushSync();
  expect(text('workflow-activity')).toContain('5 of 5 steps');
  expect(text('workflow-activity')).not.toContain('started');
  expect(document.querySelector('[data-testid=workflow-activity] [data-testid=agent-elapsed]')).not.toBeNull();
});

test('a launch line: live count on every turn while one runs, the older turn\'s start in its title, how each ended once none runs', async () => {
  const going = [agent('a', 'done'), agent('b', 'running'), agent('c', 'interrupted')];
  mounted = mount(DelegationActivity, { target: document.body, props: { store, agents: going } });
  flushSync();
  expect(text('delegation-progress')).toContain('1/3 completed');
  await unmount(mounted, { outro: false });

  mounted = mount(DelegationActivity, { target: document.body, props: { store, agents: going, past: true } });
  flushSync();
  // The progress words tie "3 subagents" to the strip's count; the start leaves the line for its title.
  expect(text('delegation-progress')).toBe('· 1/3 completed · 1 interrupted');
  expect(text('delegation-activity')).not.toContain('started');
  expect(document.querySelector('[data-testid=delegation-activity]')?.getAttribute('title')).toMatch(/started 0?3:12/);
  await unmount(mounted, { outro: false });

  const ended = [agent('a', 'done'), agent('b', 'done'), agent('c', 'interrupted')];
  mounted = mount(DelegationActivity, { target: document.body, props: { store, agents: ended, past: true } });
  flushSync();
  expect(text('delegation-progress')).toBe('· 2 completed · 1 interrupted');
});
