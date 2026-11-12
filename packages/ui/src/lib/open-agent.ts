import type { DelegatedAgent } from '@boite/contracts';
import type { Store } from './store.svelte';
import { workspace } from './workspace.svelte';

/**
 * A subagent reads like any conversation: its own, on the machine that runs
 * it, with the phone's back arrow to the parent. One whose machine is out of
 * reach opens the team, which says why.
 */
export function openAgent(store: Store, agent: DelegatedAgent): void {
  if (!agent.machine) { void store.open(agent.thread.id); return; }
  const machine = workspace.machineOf(agent.machine.coreId);
  if (machine?.store.connection === 'ready') void workspace.select(machine.store, agent.thread.id);
  else store.showTeam();
}
