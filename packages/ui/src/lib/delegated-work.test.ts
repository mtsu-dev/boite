import { expect, test } from 'vitest';
import type { Store } from './store.svelte';
import { delegatedWork, rowSubagents } from './delegated-work';
import { delegatedChip } from './thread-state';

const agent = (id: string, status: string, backgroundWait: unknown = null) => ({ thread: { id, status, backgroundWait } });

test('the open thread\'s row counts what its strip and panel tab count: a workflow is one run, not its step threads', () => {
  // Round 8: the row read 4 (two subagents busy and two workflow step threads) beside a strip and a tab reading 3.
  const store = {
    openThread: { id: 'parent' },
    delegation: {
      rootThreadId: 'parent',
      agents: [agent('busy', 'running'), agent('waits-on-tests', 'idle', { state: 'waiting', for: 'tests', since: 1 }), agent('done', 'idle'), agent('failed', 'error')],
      nativeAgents: []
    },
    workflowsOf: (id: string) => id === 'parent' ? [{ id: 'run', status: 'running' }] : [],
    subagents: (id: string) => id === 'parent' ? { count: 4, asking: 0, since: 10 } : id === 'other' ? { count: 2, asking: 1, since: 5 } : null
  } as unknown as Store;
  const strip = delegatedWork(store);
  expect(strip.agents + strip.runs.length).toBe(3);
  const row = rowSubagents(store, 'parent');
  expect(row).toEqual({ count: 3, asking: 0, since: 10, runs: 1 });
  expect(delegatedChip(row)).toMatchObject({ shown: 3, label: '2 subagents at work · 1 workflow' });
  // A row whose delegation is not loaded counts its busy child threads, as before.
  expect(rowSubagents(store, 'other')).toEqual({ count: 2, asking: 1, since: 5 });
});
