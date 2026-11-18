import { AGENT_HANDOFF_MAX, threadActive, type AgentProfile } from '@boite/contracts';
import { threadOfAgent, type AgentsView } from './agents.svelte';
import { confirm } from './confirm.svelte';
import type { Store } from './store.svelte';
import { fill, strings } from './strings';

/** Whether the mochi has a conversation a new one can follow: the menus offer the action only then. */
export function hasConversation(owner: Pick<AgentsView, 'snapshot'>, agentId: string): boolean {
  return threadOfAgent(owner.snapshot, agentId) !== null;
}

/**
 * The menus' "New conversation" (`agents.session.new`), asked through the
 * mochi's own machine: one confirm with an optional handoff note, whose button
 * says "After this turn" while the mochi works, since the core waits for the
 * turn's end. A refusal is reported in `report`'s toast. True once asked.
 */
export async function startNewConversation(owner: AgentsView, agent: AgentProfile, report: Store): Promise<boolean> {
  const labels = strings.agents.newConversation;
  const threadId = threadOfAgent(owner.snapshot, agent.id);
  const thread = threadId ? owner.store.threads.find(t => t.id === threadId) : undefined;
  const busy = thread ? threadActive(thread.status) : false;
  const note = await confirm.note({
    title: fill(labels.title, { name: agent.name }),
    body: fill(labels.body, { name: agent.name }),
    confirmLabel: busy ? labels.afterTurn : labels.confirm,
    cancelLabel: strings.common.cancel,
    note: { label: labels.noteLabel, placeholder: fill(labels.notePlaceholder, { name: agent.name }), hint: labels.noteHint, count: labels.count, max: AGENT_HANDOFF_MAX }
  });
  if (note === null) return false;
  try {
    const client = owner.store.client;
    if (!client) throw new Error(strings.connection.unavailable);
    await client.call('agents.session.new', { agentId: agent.id, ...(note ? { note } : {}) });
    return true;
  } catch (error) {
    report.reportError(error, 'minor');
    return false;
  }
}
