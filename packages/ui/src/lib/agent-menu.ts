import { Archive, ArrowRightLeft, Copy, MessageSquare, Pause, PencilLine, Pin, PinOff, Play, RotateCcw, Settings2 } from '@lucide/svelte';
import type { AgentProfile } from '@boite/contracts';
import { moveBot, moveItems, moveMachines } from './agent-move-flow';
import { resetBuiltin, type AgentsView } from './agents.svelte';
import { confirm } from './confirm.svelte';
import { contextMenu } from './context-menu.svelte';
import { separator, type MenuItem } from './menu';
import type { Store } from './store.svelte';
import { fill, strings } from './strings';

interface AgentMenuOptions {
  /** Its conversation is the one on screen. */
  open: boolean;
  /** A phone's menu: pin, rename, edit, then pause and archive, as a thread's phone menu. */
  phone?: boolean;
}

/**
 * A bot's row menu, cut from the thread menu (`threadMenuItems`): the same
 * groups in the same order, with the same words and glyphs where a thread has
 * the action, and only what a bot has. `store` is the bot's machine. Every
 * action but Open and Copy the path is its owner's, as in the bot's own menu
 * (`AgentHeader`): a paired device keeps those two on a desktop and has no
 * menu on a phone. A built-in bot is never archived: Reset takes its place.
 */
export function agentMenuItems(store: Store, agent: AgentProfile, options: AgentMenuOptions): MenuItem[] {
  const labels = strings.agents;
  const owner = store.owner && agent.status !== 'archived';
  const pin: MenuItem = { id: 'pin', label: agent.pinned ? strings.sidebar.unpin : strings.sidebar.pin, glyph: agent.pinned ? PinOff : Pin };
  const status: MenuItem = agent.status === 'paused' ? { id: 'resume', label: labels.resume, glyph: Play } : { id: 'pause', label: labels.pause, glyph: Pause };
  const archive: MenuItem = agent.builtin ? { id: 'reset', label: labels.builtin.reset, glyph: RotateCcw, danger: true } : { id: 'archive', label: labels.archive, glyph: Archive, danger: true };
  const rename: MenuItem = { id: 'rename', label: strings.common.rename, glyph: PencilLine };
  const edit: MenuItem = { id: 'edit', label: labels.edit, glyph: Settings2 };
  if (options.phone) return owner ? [pin, rename, edit, separator('sep-archive'), status, archive] : [];
  // Like "Move to project": a picker opens where the menu stood.
  const move: MenuItem[] = moveMachines(store).others.length > 0 ? [{ id: 'move', label: labels.move.menu, glyph: ArrowRightLeft }] : [];
  return [
    { id: 'open', label: strings.common.open, glyph: MessageSquare, disabled: options.open },
    ...(owner ? [pin, separator('sep-archive'), status, archive, separator('sep-organize'), rename, edit, ...move] : []),
    separator('sep-tools'),
    { id: 'copy', label: strings.sidebar.copyPath, glyph: Copy }
  ];
}

/** What the list brings to a row's menu: how it opens the bot, its settings, and its own rename field. */
export interface AgentMenuView {
  open: () => void;
  edit: () => void;
  rename: () => void;
  /** The store whose toast says why an action failed: the page on screen, which may not be the bot's machine. */
  report: Store;
}

/** Answers a pick of `agentMenuItems`' rows through the bot's own machine, since ids can collide between machines. */
export function pickAgentAction(owner: AgentsView, agent: AgentProfile, action: string, view: AgentMenuView): void {
  switch (action) {
    case 'open': view.open(); return;
    case 'edit': view.edit(); return;
    case 'rename': view.rename(); return;
    case 'pin': void saveAgent(owner, agent.id, { pinned: !agent.pinned }, view.report); return;
    case 'pause': void saveAgent(owner, agent.id, { status: 'paused' }, view.report); return;
    case 'resume': void saveAgent(owner, agent.id, { status: 'active' }, view.report); return;
    case 'archive': void confirmArchive(agent.name).then(sure => sure && saveAgent(owner, agent.id, { status: 'archived' }, view.report)); return;
    case 'reset': void resetBuiltin(owner, agent); return;
    case 'move': contextMenu.follow(moveItems(owner.store, agent.id), id => void moveBot(owner.store, agent, id, view.report)); return;
    case 'copy': void copyBrainPath(owner, agent.id, view.report); return;
  }
}

/**
 * Changes a few fields of a bot and keeps the rest as its machine last sent
 * them. The value and revision are read when the save runs, after any save
 * queued before it; a change made elsewhere in between is refused rather than
 * written over. False when refused, with the reason in `report`'s toast.
 */
export async function saveAgent(owner: AgentsView, agentId: string, change: Partial<Pick<AgentProfile, 'name' | 'status' | 'pinned'>>, report: Store): Promise<boolean> {
  try {
    await owner.save('agents.profile.save', () => {
      const latest = owner.snapshot?.profiles.find(p => p.id === agentId);
      if (!latest) throw new Error(strings.connection.unavailable);
      const { id, revision, createdAt: _created, updatedAt: _updated, ...value } = latest;
      return { id, expectedRevision: revision, value: { ...value, ...change } };
    });
    return true;
  } catch (error) {
    report.reportError(error, 'minor');
    return false;
  }
}

/** The bot's menu's and its row's one question before it is archived: its exact name, typed. */
export function confirmArchive(name: string): Promise<boolean> {
  const labels = strings.agents;
  return confirm.ask({
    title: fill(labels.archiveTitle, { name }),
    body: labels.archiveBody,
    confirmLabel: labels.archive,
    cancelLabel: strings.common.cancel,
    danger: true,
    requiredText: name,
    inputLabel: labels.archiveName
  });
}

/** The folder of the bot's brain (instructions, memory, skills) on its machine, which creates it if it has none yet. */
async function copyBrainPath(owner: AgentsView, agentId: string, report: Store): Promise<void> {
  try {
    const client = owner.store.client;
    if (!client) throw new Error(strings.connection.unavailable);
    const brain = await client.call('agents.brain.get', { agentId });
    await report.copy(brain.path);
  } catch (error) {
    report.reportError(error, 'minor');
  }
}
