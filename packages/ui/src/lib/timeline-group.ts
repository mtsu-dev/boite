import type { Message, Turn } from '@boite/contracts';
import { groupAgentMail, withAgentMail, type AgentMail, type AgentMailGroup } from './agent-mail';

/** Rows that follow the message sharing their millisecond: agent mail and a launch card, anchored with `<=`. */
const after = (row: Message) => row.id.startsWith('coordination:') || row.id.startsWith('delegation:') || row.id.startsWith('contact-request:');
/** A row of its own at its time: a launch card, a workflow run, a contact request. */
const marker = (threadId: string, id: string, createdAt: number): Message => ({ id, threadId, turnId: id, role: 'system', parts: [], state: 'complete', createdAt });

/**
 * The thread's messages with what else happened among them placed by time:
 * agent mail (grouped) and cards (`timelineCards`). Memory stops are machine
 * news for the notification corner (`MemoryCorner.svelte`), not rows here.
 * The messages come back as they are when there is none.
 */
export function groupTimeline(messages: Message[], threadId: string, turns: Turn[], mail: AgentMail[],
  cards: ReadonlyMap<string, { at: number }>): { timeline: Message[]; groups: Map<string, AgentMailGroup> } {
  if (mail.length === 0 && cards.size === 0) return { timeline: messages, groups: new Map() };
  const rows = [...cards].map(([id, card]) => marker(threadId, id, card.at));
  // Output that already existed in this millisecond precedes its exchange.
  const sorted = [...withAgentMail(messages, mail, threadId, turns), ...rows].sort((a, b) =>
    a.createdAt - b.createdAt || Number(after(a)) - Number(after(b)) || a.id.localeCompare(b.id));
  return groupAgentMail(sorted, mail);
}
