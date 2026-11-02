import { SvelteSet } from 'svelte/reactivity';
import type { AgentProfile } from '@boite/contracts';
import { moveEnded, moveRefusedForGood, moveRequestId } from './agent-move';
import { openAgent } from './agents.svelte';
import { confirm } from './confirm.svelte';
import { errorText } from './errors';
import { GroupLinks } from './group-links.svelte';
import type { MenuItem } from './menu';
import { RpcFailure } from './rpc-error';
import type { Store } from './store.svelte';
import { fill, strings } from './strings';
import { listedName, workspace, type Machine } from './workspace.svelte';

/**
 * The Bots page's one way to move a bot, from the Machine row of its settings
 * or from its row's menu: the other members of its group, each a menu row
 * shut with why while it cannot take the bot, then the app's dialog,
 * `agents.move` on the machine that holds the bot, and the page following it
 * to its new machine. A refusal is told in the toast. A try that did not
 * finish keeps its `requestId` for the next one (`agent-move`).
 */

/** The bots on their way, by the machine they leave: both places that start a move show it. */
const moving = new SvelteSet<string>();
const keyOf = (store: Store, agentId: string) => JSON.stringify([machineOf(store)?.id ?? store.machineId, agentId]);

function machineOf(store: Store): Machine | undefined {
  return workspace.machines.find(machine => machine.store === store);
}

/** A machine as the move names it: its listed name, this PC when the window holds no list. */
export function moveName(machine: Machine | undefined): string {
  return machine ? listedName(machine) : strings.machines.local;
}

/** Whether a move of this bot from this machine runs now. */
export function botMoving(store: Store, agentId: string): boolean {
  return moving.has(keyOf(store, agentId));
}

/** The bot's machine, and the other members of its group this window holds, connected or not. */
export function moveMachines(store: Store): { here: Machine | undefined; others: Machine[] } {
  const group = store.group?.id;
  const others = group ? workspace.machines.filter(machine => machine.store !== store && (machine.store.group?.id ?? machine.groupId) === group) : [];
  return { here: machineOf(store), others };
}

/** Why the bot cannot go there now, or null when it can. */
function shut(machine: Machine): { hint: string; title?: string } | null {
  if (machine.store.connection !== 'ready') return { hint: strings.connection[machine.store.connection] };
  if (!machine.store.owner) return { hint: strings.agents.machineNotOwner };
  if (machine.store.core?.features?.botMove !== true) return { hint: strings.agents.move.olderShort, title: fill(strings.agents.move.older, { machine: moveName(machine) }) };
  return null;
}

/** The picker's rows: where the bot lives, checked, then each other member, shut with why while it cannot take the bot. */
export function moveItems(store: Store, agentId: string): MenuItem[] {
  const { here, others } = moveMachines(store);
  const busy = botMoving(store, agentId);
  return [
    { id: here?.id ?? '', label: moveName(here), active: true, disabled: true },
    ...others.map(machine => {
      const why = shut(machine);
      return why ? { id: machine.id, label: moveName(machine), disabled: true, ...why } : { id: machine.id, label: moveName(machine), disabled: busy };
    }),
  ];
}

/**
 * Moves the bot to the picked machine once the owner confirmed it. True once
 * it lives there and the Bots page shows it there; false when cancelled,
 * refused (the toast of `report`, the page on screen, says why) or the
 * machine cannot take it. `store` is the bot's machine.
 */
export async function moveBot(store: Store, agent: Pick<AgentProfile, 'id' | 'name'>, machineId: string, report: Store = store): Promise<boolean> {
  const { here, others } = moveMachines(store);
  const target = others.find(machine => machine.id === machineId);
  if (!target || shut(target) || botMoving(store, agent.id)) return false;
  const coreId = GroupLinks.coreOf(target);
  if (!coreId) return false;
  const ok = await confirm.ask({
    title: fill(strings.agents.move.title, { name: agent.name, machine: moveName(target) }),
    body: fill(strings.agents.move.body, { name: agent.name, machine: moveName(target), source: moveName(here) }),
    confirmLabel: strings.agents.move.confirm,
    cancelLabel: strings.common.cancel,
  });
  if (!ok) return false;
  const client = store.client;
  if (!client) { report.error = strings.connection.unavailable; return false; }
  const key = keyOf(store, agent.id);
  if (moving.has(key)) return false;
  moving.add(key);
  const source = here?.id ?? store.machineId;
  try {
    await client.call('agents.move', { agentId: agent.id, machine: coreId, requestId: moveRequestId(source, agent.id, coreId) });
  } catch (error) {
    if (moveRefusedForGood(error)) moveEnded(source, agent.id, coreId);
    const busy = error instanceof RpcFailure && (error.data as { reason?: unknown } | undefined)?.reason === 'turn-in-flight';
    report.error = busy ? fill(strings.agents.move.turnInFlight, { name: agent.name }) : errorText(error);
    return false;
  } finally { moving.delete(key); }
  moveEnded(source, agent.id, coreId);
  // The bot now lives there: the Bots page follows it.
  workspace.showAgents(target.store);
  await openAgent(target.store, agent.id);
  return true;
}
