/*
 * Relations: two threads, one here and one on a contact's core, that the
 * Contacts bots put in touch. Each may write to the other for as long as the
 * relation lasts, whatever projects are opened; a relation carries letters,
 * never files, reads or commands. Either side ends it, and tells the other
 * with a sealed `contact.relation`, retried with the contact's other news.
 */
import type { AgentContact, ContactRelation, ThreadSummary } from '@boite/contracts';
import type { Core } from '../core.ts';
import { invalidParams, refused } from '../errors.ts';
import { newId } from '../ids.ts';

const RELATIONS = 'contacts:relations';
/** Relations ended here the contact has not heard of yet, by its core id. */
const ENDED = 'contacts:relations-ended';
export const MAX_RELATIONS = 64;

export class ContactRelations {
  readonly #core: Core;

  constructor(core: Core) {
    this.#core = core;
    // A thread archived or deleted ends its relations: nobody answers there any more.
    core.bus.onAny((name, payload) => {
      if (name === 'thread.updated' && (payload as ThreadSummary).archived === true) this.#threadGone((payload as ThreadSummary).id);
      else if (name === 'thread.removed') this.#threadGone((payload as { threadId: string }).threadId);
    });
  }

  list(): ContactRelation[] { return (this.#core.journal.getSetting(RELATIONS) as ContactRelation[] | undefined) ?? []; }
  find(id: unknown): ContactRelation | undefined { return typeof id === 'string' ? this.list().find(relation => relation.id === id) : undefined; }
  of(coreId: string): ContactRelation[] { return this.list().filter(relation => relation.coreId === coreId); }

  /** A live relation joins this thread here with that contact's thread (any of its threads when `remote` is not given). */
  joins(coreId: string, localThreadId: string, remoteThreadId?: string): boolean {
    return this.list().some(relation => relation.coreId === coreId && relation.local.threadId === localThreadId && (remoteThreadId === undefined || relation.remote.threadId === remoteThreadId));
  }

  /** The newest relation a request made, either side. */
  forRequest(coreId: string, requestId: string): ContactRelation | undefined {
    return this.list().find(relation => relation.coreId === coreId && relation.requestId === requestId);
  }

  #save(relations: ContactRelation[]): void {
    this.#core.journal.setSetting(RELATIONS, relations.sort((a, b) => b.createdAt - a.createdAt));
    this.#core.contacts.changed();
  }

  /** `id` comes from the side that accepted, so both sides name the relation the same way. */
  add(input: { id?: string; coreId: string; contact: string; local: { threadId: string; title: string }; remote: AgentContact; requestId: string }): ContactRelation {
    const relations = this.list();
    const same = relations.find(relation => relation.coreId === input.coreId && relation.local.threadId === input.local.threadId && relation.remote.threadId === input.remote.threadId);
    if (same) return same;
    if (relations.filter(relation => relation.coreId === input.coreId).length >= MAX_RELATIONS) {
      throw refused(`at most ${MAX_RELATIONS} relations with ${input.contact}; cut one first with boite contacts cut`);
    }
    const relation: ContactRelation = {
      id: input.id ?? newId('crel_'), coreId: input.coreId, contact: input.contact,
      local: { threadId: input.local.threadId, title: input.local.title.slice(0, 200) }, remote: input.remote,
      requestId: input.requestId, createdAt: Date.now(),
    };
    this.#save([...relations, relation]);
    return relation;
  }

  /**
   * Ends the relations `which` picks. `tell`: the contact hears it on the next
   * flush; false when the contact ended them itself or is gone. Letters that no
   * longer reach their thread are refused with `reason`.
   */
  end(which: (relation: ContactRelation) => boolean, reason: string, tell = true): ContactRelation[] {
    const relations = this.list();
    const ended = relations.filter(which);
    if (!ended.length) return [];
    this.#save(relations.filter(relation => !ended.includes(relation)));
    if (tell) {
      const queue = this.#ended();
      for (const relation of ended) queue[relation.coreId] = [...new Set([...(queue[relation.coreId] ?? []), relation.id])].slice(-MAX_RELATIONS);
      this.#core.journal.setSetting(ENDED, queue);
    }
    for (const coreId of new Set(ended.map(relation => relation.coreId))) {
      this.#core.coordination.rejectContactLetters(coreId, reason);
      if (tell) this.#core.contacts.flush(coreId);
    }
    return ended;
  }

  /** The contact ended one of its relations with this core. */
  endedByContact(coreId: string, payload: unknown): { ok: true } {
    const body = payload as { id?: unknown; ended?: unknown } | null;
    if (typeof body?.id !== 'string' || body.id.length > 100 || body.ended !== true) throw invalidParams('relation: expected { id, ended: true }');
    const name = this.#core.contacts.known(coreId)?.name ?? 'the contact';
    this.end(relation => relation.coreId === coreId && relation.id === body.id, `Relation ended by ${name}`, false);
    return { ok: true };
  }

  #ended(): Record<string, string[]> { return (this.#core.journal.getSetting(ENDED) as Record<string, string[]> | undefined) ?? {}; }
  /** What the contact must still hear: relation ids ended here. */
  untold(coreId: string): string[] { return this.#ended()[coreId] ?? []; }
  told(coreId: string, id: string): void {
    const queue = this.#ended();
    const left = (queue[coreId] ?? []).filter(entry => entry !== id);
    if (left.length) queue[coreId] = left; else delete queue[coreId];
    this.#core.journal.setSetting(ENDED, queue);
  }

  /** The contact is removed: its relations end without telling it, and nothing waits to be told. */
  forget(coreId: string): void {
    const queue = this.#ended();
    if (coreId in queue) { delete queue[coreId]; this.#core.journal.setSetting(ENDED, queue); }
    this.end(relation => relation.coreId === coreId, 'Contact removed', false);
  }

  #threadGone(threadId: string): void {
    if (!this.list().some(relation => relation.local.threadId === threadId)) return;
    this.end(relation => relation.local.threadId === threadId, 'The thread in relation was archived');
  }
}
