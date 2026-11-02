import { SvelteSet } from 'svelte/reactivity';
import type { AgentProfile, AgentQueuedMove, Project } from '@boite/contracts';
import { moveEnded, moveRefusedForGood, moveRequestId, moveResumable } from './agent-move';
import { openAgent, statusOf, type AgentsView } from './agents.svelte';
import { confirm } from './confirm.svelte';
import { errorText } from './errors';
import { projectName } from './format';
import { GroupLinks } from './group-links.svelte';
import type { MenuItem } from './menu';
import { RpcFailure } from './rpc-error';
import type { Store } from './store.svelte';
import { fill, strings } from './strings';
import { listNames } from './teams.svelte';
import { listedName, workspace, type Machine } from './workspace.svelte';

/**
 * The Bots page's one way to move a bot, from the Machine row of its settings
 * or from its row's menu: the other members of its group, each a menu row
 * shut with why while it cannot take the bot, then the app's dialog, which
 * names the bot's projects the target does not have, `agents.move` on the
 * machine that holds the bot, and the page following it to its new machine.
 * A bot at work leaves once its turn ends (`agents.move.queue`): its row says
 * where it goes until then, and the move can be cancelled. A refusal is told
 * in the toast. A try that did not finish keeps its `requestId` for the next
 * one (`agent-move`).
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

/** The move this bot waits to make once its turn ends, or null. */
export function botLeaving(view: AgentsView, agentId: string): AgentQueuedMove | null {
  return statusOf(view.snapshot, agentId)?.leaving ?? null;
}

/** "Moves to {machine} after this turn" while the bot waits to leave, else null. */
export function leavingLine(view: AgentsView, agentId: string): string | null {
  const leaving = botLeaving(view, agentId);
  if (!leaving) return null;
  // Named as the picker names it, else as its group does.
  const machine = workspace.machines.find(entry => GroupLinks.coreOf(entry) === leaving.machine);
  const name = machine ? moveName(machine) : view.store.group?.cores.find(core => core.coreId === leaving.machine)?.name ?? leaving.machine;
  return fill(strings.agents.move.leaving, { machine: name });
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

/** Its machine moves a bot at work once the turn ends; an older one refuses the move until then. */
function queues(store: Store): boolean {
  return store.core?.features?.botMoveQueue === true;
}

/** Whether the bot has a turn running, queued, or waiting on its owner: a move now would be refused. */
function atWork(view: AgentsView, agentId: string): boolean {
  const state = statusOf(view.snapshot, agentId)?.state;
  return state === 'working' || state === 'queued' || state === 'waiting';
}

function reasonOf(error: unknown): unknown {
  return error instanceof RpcFailure ? (error.data as { reason?: unknown } | undefined)?.reason : undefined;
}

/**
 * The dialog's lines on the bot's projects, read as its machine hands them
 * over (`BotMoves` in the core): one of the machine it leaves stays there,
 * even when the target lists one of the same name (ids are each machine's),
 * and is reached from the target only while that machine lets the group's
 * bots in; one it had from the target goes back there, or is left when the
 * target no longer has it. Other machines' projects stay as they are.
 */
function projectsReport(store: Store, target: Machine, coreId: string, projectIds: readonly string[], names: Record<string, string>): string[] {
  const labels = strings.agents.move;
  const listed = (projects: readonly Project[], id: string) => projects.find(project => project.id === id && project.kind !== 'drafts');
  const twinOf = (project: Project) => target.store.projects.some(entry => entry.kind !== 'drafts' && (entry.path === project.path || entry.name.toLowerCase() === project.name.toLowerCase()));
  const absent: string[] = [];
  const twins: string[] = [];
  const lost: string[] = [];
  for (const id of projectIds) {
    const slash = id.indexOf('/');
    if (slash <= 0 || slash === id.length - 1) {
      const project = listed(store.projects, id);
      if (project) (twinOf(project) ? twins : absent).push(projectName(project));
    } else if (id.slice(0, slash) === coreId) {
      const there = id.slice(slash + 1);
      if (!listed(target.store.projects, there)) lost.push(there);
    }
  }
  const lines: string[] = [];
  if (absent.length) lines.push(fill(labels.projectsAbsent, { ...names, projects: listNames(absent) }));
  if (twins.length) lines.push(fill(labels.projectsTwin, { ...names, projects: listNames(twins) }));
  if (absent.length || twins.length) {
    const words = store.settings?.groupBots === true ? labels.projectsReach : labels.projectsReachOff;
    lines.push(fill(words, { ...names, setting: strings.machines.groupBots, page: strings.settings.tabs.machines }));
  }
  if (lost.length) lines.push(fill(labels.projectsLost, { ...names, projects: listNames(lost) }));
  return lines;
}

/**
 * Moves the bot to the picked machine once the owner confirmed it. True once
 * it lives there and the Bots page shows it there, or once it waits to leave
 * at the end of its turn; false when cancelled, refused (the toast of
 * `report`, the page on screen, says why) or the machine cannot take it.
 * `view` is the bot's machine's.
 */
export async function moveBot(view: AgentsView, agent: Pick<AgentProfile, 'id' | 'name' | 'projectIds'>, machineId: string, report: Store = view.store): Promise<boolean> {
  const store = view.store;
  const labels = strings.agents.move;
  const { here, others } = moveMachines(store);
  const target = others.find(machine => machine.id === machineId);
  if (!target || shut(target) || botMoving(store, agent.id) || botLeaving(view, agent.id)) return false;
  const coreId = GroupLinks.coreOf(target);
  if (!coreId) return false;
  const names = { name: agent.name, machine: moveName(target), source: moveName(here) };
  const later = queues(store) && atWork(view, agent.id);
  const ok = await confirm.ask({
    title: fill(labels.title, names),
    body: [...(later ? [fill(labels.later, names)] : []), fill(labels.body, names), ...projectsReport(store, target, coreId, agent.projectIds ?? [], names)].join('\n\n'),
    confirmLabel: later ? labels.confirmLater : labels.confirm,
    cancelLabel: strings.common.cancel,
  });
  if (!ok) return false;
  const client = store.client;
  if (!client) { report.error = strings.connection.unavailable; return false; }
  const key = keyOf(store, agent.id);
  if (moving.has(key)) return false;
  moving.add(key);
  const source = here?.id ?? store.machineId;
  const params = { agentId: agent.id, machine: coreId, requestId: moveRequestId(source, agent.id, coreId) };
  let moved: boolean;
  try {
    moved = later ? false : await client.call('agents.move', params).then(() => true, (error: unknown) => {
      // Its turn started since the dialog opened: the move waits for it, as when asked while it worked.
      if (queues(store) && reasonOf(error) === 'turn-in-flight') return false;
      throw error;
    });
    if (!moved) await client.call('agents.move.queue', params);
  } catch (error) {
    if (moveRefusedForGood(error)) moveEnded(source, agent.id, coreId);
    report.error = reasonOf(error) === 'turn-in-flight' ? fill(labels.turnInFlight, { name: agent.name }) : errorText(error);
    return false;
  } finally { moving.delete(key); }
  // Moved, or its machine now holds the move and its id, and tries again by itself until it ends.
  moveEnded(source, agent.id, coreId);
  if (!moved) { void view.refresh(); return true; }
  // The bot now lives there: the Bots page follows it.
  workspace.showAgents(target.store);
  await openAgent(target.store, agent.id);
  return true;
}

/**
 * Drops the move the bot waits to make. False when it has none, or has
 * already left (`report`'s toast says so). Its machine may have sent the bot
 * once, unanswered: the next move there by hand keeps that move's id.
 */
export async function cancelMove(view: AgentsView, agent: Pick<AgentProfile, 'id' | 'name'>, report: Store = view.store): Promise<boolean> {
  const leaving = botLeaving(view, agent.id);
  if (!leaving) return false;
  const client = view.store.client;
  if (!client) { report.error = strings.connection.unavailable; return false; }
  try {
    const { cancelled } = await client.call('agents.move.cancel', { agentId: agent.id });
    if (!cancelled) { report.error = fill(strings.agents.move.cancelLate, { name: agent.name }); return false; }
  } catch (error) {
    report.reportError(error, 'minor');
    return false;
  }
  moveResumable(machineOf(view.store)?.id ?? view.store.machineId, agent.id, leaving.machine, leaving.requestId);
  void view.refresh();
  return true;
}
