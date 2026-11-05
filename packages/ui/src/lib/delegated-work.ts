import { threadBusy, type ThreadId } from '@boite/contracts';
import { upkeepOf } from './agent-upkeep';
import type { Store } from './store.svelte';
import type { WorkingChildren } from './thread-rows';

/**
 * What the open thread delegated and is still at work: its subagents busy (a
 * persistent agent's memory pass is upkeep, not a subagent), the provider's
 * own agents running, and its workflow runs, each run one unit. The status
 * strip, the panel's Subagents tab and the open thread's row read this one
 * count, so the three never show two numbers for one thread.
 */
export function delegatedWork(store: Store) {
  const thread = store.openThread;
  const view = store.delegation;
  const active = (view?.agents ?? []).filter(agent => threadBusy(agent.thread) && !upkeepOf(store).has(agent.thread.id));
  const native = (view?.nativeAgents ?? []).filter(agent => agent.status === 'running');
  const runs = thread ? store.workflowsOf(thread.id).filter(run => run.status === 'running') : [];
  return { active, native, runs, agents: active.length + native.length };
}

/**
 * A row's delegated agents. The open thread's row, once its delegation is
 * loaded, counts what its strip counts (`delegatedWork`): a workflow is one
 * run there, however many step threads it holds. Any other row counts its
 * busy child threads, the only ones a summary names.
 */
export function rowSubagents(store: Store, threadId: ThreadId): (WorkingChildren & { runs?: number }) | null {
  const children = store.subagents(threadId);
  if (store.openThread?.id !== threadId || store.delegation?.rootThreadId !== threadId) return children;
  const { agents, runs } = delegatedWork(store);
  const count = agents + runs.length;
  if (count === 0 && !children?.asking) return null;
  return { since: children?.since ?? null, asking: children?.asking ?? 0, count, runs: runs.length };
}
