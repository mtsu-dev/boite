import { randomUUID } from 'node:crypto';
import type { AgentContact, AgentLetter, ContactRequest } from '@boite/contracts';
import type { Core } from '../core.ts';
import { RESIDENT_LETTER_TTL_MS } from '../coordination-letter.ts';
import { projectName } from '../coordination-relation.ts';

/* The letters this core writes to its own threads about a contact's request. */

/**
 * A contact's owner or core decided a project request (`collaboration.ask`):
 * this core writes the answer and preserves who made the decision.
 */
export function contactAnswer(core: Core, request: ContactRequest, name: string, threads: AgentContact[]): void {
  const list = threads.slice(0, 20).map(entry => `${JSON.stringify(entry.title)} (${entry.machine.replace(/\s+/g, '-')}/${entry.threadId}${entry.status === 'idle' ? '' : `, ${entry.status}`})`);
  const responder = request.decidedBy === 'owner' ? name : request.decidedBy === 'bot' ? `${name}'s Operator` : `${name}'s Boite${request.decidedBy === 'match' || request.decidedBy === 'concierge' ? ' automatically' : ''}`;
  const peer = request.relation?.remote, at = peer ? `${name.replace(/\s+/g, '-')}/${peer.threadId}` : '';
  const body = request.status !== 'accepted' ? `${responder} refused your request: ${request.reason ?? 'no reason given'}`
    : peer ? `${responder} put you in touch with ${JSON.stringify(peer.title)} (${at}). Write to it with boite threads send ${at} <text>.`
    : `${responder} opened its project ${JSON.stringify(request.project?.name ?? '')} to you. ${list.length ? `Its threads: ${list.join('; ')}.` : 'No thread of it can be reached yet.'} Write to one with boite threads send <contact>/<thread-id> <text>; boite threads shows them.`;
  if (core.coordination.mailboxes.answer(request, name, body.slice(0, 4000))) return;
  contactNotice(core, request.coreId, name, request.id, request.from.threadId, `Answer to your request to ${name}`, body);
}

/** A letter this core writes to one of its threads about a contact's request (`ContactRequests.ownsAnswer` admits it). */
export function contactNotice(core: Core, coreId: string, name: string, requestId: string, threadId: string, title: string, body: string): void {
  const thread = core.journal.getThread(threadId);
  if (!thread || thread.archived) return;
  const now = Date.now();
  const from: AgentContact = { coreId, threadId: requestId, title: title.slice(0, 200), machine: name, resources: '', status: 'idle', mode: 'brief' };
  const letter: AgentLetter = { origin: 'contact', contact: { coreId, name }, id: randomUUID(), from, to: { coreId: core.coordination.card().coreId, threadId }, toTitle: thread.title.slice(0, 200), toProject: projectName(core, threadId),
    toMachine: core.info().hostname ?? 'Boite', text: body.slice(0, 4000), replyTo: null, createdAt: now, expiresAt: now + RESIDENT_LETTER_TTL_MS, status: 'received', error: null };
  core.coordination.acceptLetter(letter);
}
