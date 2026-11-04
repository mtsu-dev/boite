/*
 * A thread on a group member without a Contacts bot asks through the group's
 * Bots host (`Group.botsHome`), where the bot lives. The member keeps the
 * request (`stage: 'host'`) and offers it to the host (`contact.route`,
 * `host-ask`, sealed between members) until the host filed it for its bot,
 * for up to 7 days. The host files it under the member's own thread and
 * request id, so the contact reads the thread at `<thread>~<prefix>` and the
 * answer, with the relation it made, comes back to that thread
 * (`requests.ts`, `group-link.ts`). The host keeps an answer the member has
 * not heard (`pendingMember`) and offers it again on the same timer.
 *
 * A contact another member still holds (`held.ts`) is asked through that
 * member: the host's bot forwards as usual, the host offers the ask to the
 * holder (`held-ask`, `pendingHolder`) on the same timer, and the holder sends
 * it as the asking thread's, at that thread's address on the holder when the
 * thread is not its own. The contact's answer comes back to the holder, which
 * tells the host (`askedBy`), which tells the asking thread or its member.
 */
import type { AgentContact, ContactRelation, ContactRequest, CoordinationPeer, RpcParams } from '@boite/contracts';
import { text } from '../coordination-letter.ts';
import { checkRemoteContact } from '../coordination-lookup.ts';
import { PeerRefusal } from '../coordination-wire.ts';
import type { Core } from '../core.ts';
import { invalidParams, messageOf, refused } from '../errors.ts';
import { newId } from '../ids.ts';
import { contactsBot } from './bot.ts';
import { checkNormalizedRemote, gitRemoteOf } from './git-remote.ts';
import { GROUP_LETTER_TTL_MS } from './group-link.ts';
import { given, MAX_PENDING, NO_BOT, THREAD_ID, want, type HostAsk, type StoredRequest } from './requests.ts';
import type { ContactStore } from './store.ts';
import { contactNotice } from './answers.ts';
import { memberAdmission } from './admission.ts';
import { contactFace } from './face.ts';

/** The member's first offer must come back before the caller's own request times out. */
const OFFER_MS = 3500;
const ID = /^[A-Za-z0-9_-]{1,100}$/;
export const HOST_GONE = 'Not delivered: the group\'s Bots host stayed unreachable for 7 days';

function within<T>(job: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([job, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`no answer in ${ms} ms`)), ms); })]).finally(() => clearTimeout(timer));
}

export class ContactHostAsks {
  readonly #core: Core;
  readonly #store: ContactStore;
  readonly #busy = new Set<string>();
  readonly #pending = new Set<Promise<unknown>>();
  #closed = false;

  constructor(core: Core, store: ContactStore) {
    this.#core = core;
    this.#store = store;
  }

  #self(): string { return this.#core.coordination.card().coreId; }

  /** This member's threads ask through the Bots host: it has no bot of its own and another member hosts the bots. */
  relays(): boolean {
    if (contactsBot(this.#core) !== null) return false;
    const home = this.#core.group.roleOf('botsHome');
    return home !== null && home !== this.#self();
  }

  /** Something still waits on a member: an ask to file, or an answer to tell. The contacts' timer keeps running for it. */
  waiting(): boolean { return this.#store.requests.list().some(request => request.pendingHost !== undefined || request.pendingMember === true || request.pendingHolder === true); }

  // -- The member.

  /** `collaboration.ask` on a member that relays: kept here, offered to the host now and until it files it. */
  async ask(params: RpcParams<'collaboration.ask'>): Promise<ContactRequest> {
    const from = this.#core.coordination.describe(params.threadId);
    const config = this.#core.coordination.config(params.threadId);
    if (!config.remote) throw refused('threadId: cross-machine coordination is disabled for this thread', { field: 'threadId' });
    if (config.paused) throw refused('coordination paused by the owner');
    this.#store.checkSendTier(params.threadId);
    const body = text(params.text, 'text', 4000).trim();
    const named: HostAsk = {};
    if (given(params.contact)) named.contact = text(params.contact, 'contact', 100);
    let threadId: string | undefined;
    if (given(params.target)) {
      const raw = typeof params.target === 'string' ? params.target.trim() : '';
      const slash = raw.lastIndexOf('/');
      threadId = raw.slice(slash + 1);
      if (slash <= 0 || !THREAD_ID.test(threadId)) throw invalidParams('target: expected <contact>/<thread-id>', { field: 'target' });
      named.target = raw;
    }
    const wanted = given(params.want) ? want(params.want, 'want') : threadId ? 'talk' : 'thread';
    const requests = this.#store.requests.list();
    if (requests.filter(request => request.pendingHost !== undefined).length >= MAX_PENDING) throw refused(`at most ${MAX_PENDING} requests may wait for the group's Bots host; wait for an answer`);
    const gitRemote = gitRemoteOf(this.#core.threads.require(params.threadId).cwd) ?? undefined;
    const request: StoredRequest = {
      id: newId('creq_'), direction: 'out', coreId: '', contact: '', want: wanted, ...(threadId ? { target: { threadId } } : {}), stage: 'host',
      from, text: body, ...(gitRemote ? { gitRemote } : {}), createdAt: Date.now(), status: 'pending', pendingHost: named,
    };
    this.#store.requests.save([...requests, request]);
    this.#store.changed();
    this.#store.arm();
    await this.#offer(request.id);
    const now = this.#find(request.id);
    return this.#store.requests.view(now ?? request);
  }

  #find(id: string): StoredRequest | undefined { return this.#store.requests.list().find(request => request.id === id && request.direction === 'out'); }

  /** Every ask still to file and every answer still to tell, once each. */
  retry(): void {
    if (this.#closed) return;
    for (const request of this.#store.requests.list()) {
      if (request.direction !== 'out' || this.#busy.has(request.id)) continue;
      if (request.pendingHost !== undefined) this.#run(request.id, () => this.#offer(request.id));
      else if (request.pendingHolder) this.#run(request.id, () => this.#hold(request.id));
      else if (request.pendingMember) this.#run(request.id, () => this.#store.requests.tellMember(this.#store.requests.view(request), request.contact));
    }
  }

  #run(id: string, work: () => Promise<unknown>): void {
    const job = work();
    this.#pending.add(job);
    void job.catch(error => { if (!this.#closed) this.#core.log('info', `contacts: request ${id} waits (${messageOf(error)})`, { source: 'contacts' }); })
      .finally(() => this.#pending.delete(job));
  }

  async #offer(id: string): Promise<void> {
    const request = this.#find(id);
    if (!request?.pendingHost || this.#busy.has(id)) return;
    this.#busy.add(id);
    try {
      if (Date.now() - request.createdAt > GROUP_LETTER_TTL_MS) { this.#refuse(id, HOST_GONE); return; }
      const self = this.#self();
      const home = this.#core.group.roleOf('botsHome');
      if (home === null || home === self || contactsBot(this.#core) !== null) {
        // The bot lives here now, or no machine hosts it any more: this core files it, or refuses as any core without a bot.
        if (contactsBot(this.#core) !== null) this.#fileHere(request);
        else if (home === null) this.#refuse(id, NO_BOT);
        return;
      }
      const host = this.#core.group.peers().find(peer => peer.coreId === home);
      if (!host) return;
      let answer: unknown;
      try {
        answer = await within(this.#core.coordination.request(host, 'contact.route', {
          action: 'host-ask', id, from: request.from, text: request.text, ...request.pendingHost, want: request.want,
          ...(request.gitRemote ? { gitRemote: request.gitRemote } : {}),
        }), OFFER_MS);
      } catch (error) {
        // The host's signed refusal is final; silence is retried.
        if (error instanceof PeerRefusal) this.#refuse(id, error.message);
        return;
      }
      const filed = answer as Partial<ContactRequest> | null;
      if (!filed || (filed as { retry?: unknown }).retry === true || filed.id !== id) return;
      this.#settle(id, current => {
        // The host sent it through this core meanwhile (`sendFor`): that record is the newer one.
        if (!current.pendingHost) return;
        delete current.pendingHost;
        Object.assign(current, { coreId: typeof filed.coreId === 'string' ? filed.coreId : '', contact: typeof filed.contact === 'string' ? filed.contact : '' });
        if (filed.stage === 'bot' || filed.stage === 'owner') current.stage = filed.stage; else delete current.stage;
      });
    } finally { this.#busy.delete(id); }
  }

  /** The bot came here meanwhile: the ask is this core's own again. */
  #fileHere(request: StoredRequest): void {
    this.#store.requests.save(this.#store.requests.list().filter(entry => !(entry.id === request.id && entry.direction === 'out')));
    try {
      this.#store.requests.askFrom(request.from, { text: request.text, contact: request.pendingHost?.contact, target: request.pendingHost?.target, want: request.want }, request.gitRemote, request.id);
    } catch (error) {
      this.#store.requests.save([...this.#store.requests.list(), request]);
      this.#refuse(request.id, messageOf(error));
    }
  }

  #settle(id: string, change: (request: StoredRequest) => void): StoredRequest | undefined {
    const requests = this.#store.requests.list();
    const current = requests.find(entry => entry.id === id && entry.direction === 'out');
    if (!current) return undefined;
    change(current);
    this.#store.requests.save(requests);
    this.#store.changed();
    return current;
  }

  /** The ask ends here, and its thread reads why: here, or on its member. */
  #refuse(id: string, reason: string): void {
    const request = this.#settle(id, current => {
      delete current.pendingHost;
      delete current.pendingHolder;
      delete current.stage;
      Object.assign(current, { status: 'refused', reason: reason.slice(0, 500), decidedAt: Date.now() });
    });
    if (!request) return;
    if (request.from.coreId !== this.#self()) { this.#store.requests.notify(this.#store.requests.view(request), request.contact, []); return; }
    contactNotice(this.#core, request.coreId, 'Contacts', request.id, request.from.threadId, 'Your request to a contact', `Your request ${request.id} was not sent: ${request.reason}`);
  }

  // -- The Bots host.

  /** `host-ask` from a member: filed for this core's bot under the member's thread and id, once. */
  filed(peer: CoordinationPeer, from: AgentContact, payload: unknown): ContactRequest | { retry: true } {
    const p = payload as { id?: unknown; text?: unknown; contact?: unknown; target?: unknown; want?: unknown; gitRemote?: unknown } | null;
    const id = text(p?.id, 'route.ask.id', 100);
    if (!ID.test(id)) throw invalidParams('route.ask.id: expected 1 to 100 letters, digits, - or _');
    // Another member hosts the bots now: the member asks it at its next try.
    if (this.#core.group.roleOf('botsHome') !== this.#self()) return { retry: true };
    const known = this.#find(id);
    if (known) {
      if (known.from.coreId !== peer.coreId || known.from.threadId !== from.threadId) throw refused('route.ask.id: already the id of another request');
      return this.#store.requests.view(known);
    }
    this.#store.checkAttestedTier(from.agent);
    // The bot is on its way here (`bot-home.ts`): the member waits for it.
    if (contactsBot(this.#core) === null) return { retry: true };
    const gitRemote = p?.gitRemote === undefined ? undefined : checkNormalizedRemote(p.gitRemote, 'route.ask.gitRemote');
    return this.#store.requests.askFrom(from, { text: p?.text, contact: p?.contact, target: p?.target, want: p?.want }, gitRemote, id);
  }

  // -- The Bots host, for a contact another member holds.

  /** The bot sent an ask to a contact a member holds: offered to that member now, and on the timer until it takes it. */
  toHolder(id: string): void {
    this.#store.arm();
    this.#run(id, () => this.#hold(id));
  }

  async #hold(id: string): Promise<void> {
    const request = this.#find(id);
    if (!request?.pendingHolder || this.#busy.has(id)) return;
    this.#busy.add(id);
    try {
      // The contact moved here before the holder took the ask: it goes from here, whether the holder answers or not.
      if (this.#store.has(request.coreId)) { this.#rehome(id, ''); return; }
      const holder = this.#core.group.peers().find(peer => peer.coreId === request.holder);
      if (Date.now() - request.createdAt > GROUP_LETTER_TTL_MS) { this.#refuse(id, `Not delivered: ${holder?.name ?? 'the machine that holds the contact'} stayed unreachable for 7 days`); return; }
      if (!holder) { this.#rehome(id, `Not delivered: the machine that held ${request.contact} left the group`); return; }
      // A member that left and joined again holds its contacts under a new admission: the ask is not carried over.
      let stamp: string | undefined;
      try { stamp = memberAdmission(this.#core, holder.coreId); } catch { /* No group now. */ }
      const admission = request.holderAdmission;
      if (!admission || stamp !== admission.member) { this.#rehome(id, `Not delivered: ${holder.name} joined the group again since this ask; ask again`); return; }
      let answer: unknown;
      try {
        answer = await within(this.#core.coordination.request(holder, 'contact.route', {
          action: 'held-ask', id, from: request.from, coreId: request.coreId, admission: admission.contact, text: request.text, want: request.want,
          ...(request.target ? { target: request.target } : {}), ...(request.gitRemote ? { gitRemote: request.gitRemote } : {}),
        }), OFFER_MS);
      } catch (error) {
        // The holder's signed refusal is final for it; silence is retried.
        if (error instanceof PeerRefusal) this.#rehome(id, error.message);
        return;
      }
      if ((answer as { id?: unknown } | null)?.id !== id) return;
      this.#settle(id, current => { delete current.pendingHolder; });
    } finally { this.#busy.delete(id); }
  }

  /**
   * The holder refused or left: a contact that moved to this core since is
   * sent from here, on the same link. Another member's link to it is another
   * admission, so the ask ends there with the reason.
   */
  #rehome(id: string, reason: string): void {
    const request = this.#find(id);
    if (!request) return;
    if (this.#store.has(request.coreId)) {
      this.#settle(id, current => { delete current.holder; delete current.pendingHolder; delete current.holderAdmission; current.pendingSend = true; });
      this.#store.flush(request.coreId);
      return;
    }
    this.#refuse(id, reason);
  }

  /**
   * The holder heard the contact's answer to an ask this Bots host sent
   * through it (`contact.hand`, `answer`). Null for any other answer
   * (`group-link.ts`). The asking thread hears it here, or on its member; the
   * holder's own thread heard it there.
   */
  heldAnswer(peer: CoordinationPeer, payload: unknown): { ok: true } | null {
    const raw = payload as { request?: Partial<ContactRequest>; name?: unknown; threads?: unknown } | null;
    const answer = raw?.request;
    const requests = this.#store.requests.list();
    const current = requests.find(entry => entry.id === answer?.id && entry.direction === 'out' && entry.holder === peer.coreId);
    if (!current) return null;
    if (current.status !== 'pending') return { ok: true };
    if (answer!.coreId !== current.coreId) throw invalidParams('hand.request.coreId: expected the contact the ask went to');
    if (answer!.status !== 'accepted' && answer!.status !== 'refused') throw invalidParams('hand.request.status: expected accepted or refused');
    // A refusal the cores made themselves (the contact's tier or queue, an expiry) names no decider.
    const decided = answer!.decidedBy !== undefined || answer!.status !== 'refused';
    if (decided && !['owner', 'bot', 'match', 'concierge'].includes(answer!.decidedBy as string)) throw invalidParams('hand.request.decidedBy: expected owner, bot, match or concierge');
    const name = text(raw!.name, 'hand.name', 100);
    Object.assign(current, { status: answer!.status, ...(decided ? { decidedBy: answer!.decidedBy } : {}), decidedAt: Number.isSafeInteger(answer!.decidedAt) ? answer!.decidedAt : Date.now() });
    if (answer!.status === 'refused') current.reason = text(answer!.reason, 'hand.request.reason', 500);
    if (answer!.project !== undefined) current.project = { id: text(answer!.project?.id, 'hand.request.project.id', 128), name: text(answer!.project?.name, 'hand.request.project.name', 200) };
    if (answer!.relation !== undefined) current.relation = this.#relation(answer!.relation, current, name);
    delete current.pendingHolder;
    this.#store.requests.save(requests);
    this.#store.changed();
    const threads = Array.isArray(raw!.threads) ? raw!.threads.slice(0, 20) as AgentContact[] : [];
    if (current.from.coreId !== peer.coreId) this.#store.requests.notify(this.#store.requests.view(current), name, threads);
    return { ok: true };
  }

  /** The relation the contact made, as the holder keeps it: the asking thread reads the contact's thread from it. */
  #relation(value: unknown, request: StoredRequest, name: string): ContactRelation {
    const raw = value as Partial<ContactRelation> | null;
    const contact: CoordinationPeer = { coreId: request.coreId, name, url: '', publicKey: '' };
    return {
      id: text(raw?.id, 'hand.request.relation.id', 100), coreId: request.coreId, contact: name, requestId: request.id,
      local: { threadId: text(raw?.local?.threadId, 'hand.request.relation.local.threadId', 160), title: text(raw?.local?.title, 'hand.request.relation.local.title', 200) },
      remote: checkRemoteContact(raw?.remote as AgentContact, contact), createdAt: Number.isSafeInteger(raw?.createdAt) ? raw!.createdAt! : Date.now(),
    };
  }

  // -- The member that holds the contact.

  /**
   * `held-ask` from the Bots host: an ask its bot forwarded to a contact this
   * core holds, sent from here as the asking thread's, once. A thread of this
   * core asked through the host under the same id: its own request goes.
   */
  sendFor(peer: CoordinationPeer, payload: unknown): ContactRequest {
    const p = payload as { id?: unknown; from?: unknown; coreId?: unknown; admission?: unknown; text?: unknown; want?: unknown; target?: { threadId?: unknown } | null; gitRemote?: unknown } | null;
    const id = text(p?.id, 'route.held.id', 100);
    if (!ID.test(id)) throw invalidParams('route.held.id: expected 1 to 100 letters, digits, - or _');
    if (this.#core.group.roleOf('botsHome') !== peer.coreId) throw refused('route.held: only the group\'s Bots host sends an ask through this machine');
    const requests = this.#store.requests.list();
    const known = requests.find(entry => entry.id === id && entry.direction === 'out');
    if (known?.askedBy === peer.coreId) return this.#store.requests.view(known);
    const contact = this.#store.find(text(p?.coreId, 'route.held.coreId', 100));
    if (!contact) throw refused(`route.held.coreId: ${contactFace(this.#core)} no longer holds that contact`);
    // The contact was removed and linked again since the ask: the new link never reads an older one's words.
    if (p?.admission !== contact.addedAt) throw refused(`route.held.admission: ${contact.name} was linked again since this ask; ask again`, { field: 'contact' });
    if (contact.capabilities?.contactsBot !== 1) throw refused(`contact: ${contact.name} runs an older Boite; ask its owner to update`, { field: 'contact' });
    const from = this.#heldFrom(p?.from, peer, known);
    if (requests.filter(entry => entry.coreId === contact.coreId && entry.direction === 'out' && entry.status === 'pending' && entry !== known).length >= MAX_PENDING) {
      throw refused(`at most ${MAX_PENDING} requests may wait at ${contact.name}; wait for an answer`);
    }
    const target = p?.target === undefined || p.target === null ? undefined : p.target.threadId;
    if (target !== undefined && (typeof target !== 'string' || !THREAD_ID.test(target))) throw invalidParams('route.held.target: expected { threadId }');
    const gitRemote = p?.gitRemote === undefined ? undefined : checkNormalizedRemote(p.gitRemote, 'route.held.gitRemote');
    const request: StoredRequest = {
      id, direction: 'out', coreId: contact.coreId, contact: contact.name, want: want(p?.want, 'route.held.want'), ...(target ? { target: { threadId: target } } : {}),
      from, text: text(p?.text, 'route.held.text', 4000).trim(), ...(gitRemote ? { gitRemote } : {}), createdAt: known?.createdAt ?? Date.now(), status: 'pending',
      pendingSend: true, askedBy: peer.coreId,
    };
    this.#store.requests.save([...requests.filter(entry => entry !== known), request]);
    this.#store.changed();
    if (from.coreId === this.#self()) this.#store.noteSent(from.threadId, contact.coreId);
    this.#store.flush(contact.coreId);
    return this.#store.requests.view(request);
  }

  /** Who asks: this core's own thread whose request the host filed under `id`, or a thread of a machine of the group, as that machine described it. */
  #heldFrom(value: unknown, host: CoordinationPeer, known: StoredRequest | undefined): AgentContact {
    const raw = value as AgentContact | null;
    if (raw?.coreId === this.#self()) {
      if (!known || known.askedBy !== undefined || known.status !== 'pending' || known.from.threadId !== raw.threadId) throw refused('route.held.from: expected the thread here that asked under this id');
      this.#store.checkSendTier(known.from.threadId);
      return known.from;
    }
    if (known) throw refused('route.held.id: already the id of another request');
    const member = this.#core.group.peers().find(entry => entry.coreId === raw?.coreId);
    if (!member) throw refused('route.held.from: expected a thread of a machine of this group');
    const from = checkRemoteContact(raw!, member.coreId === host.coreId ? host : member);
    this.#store.checkAttestedTier(from.agent);
    return from;
  }

  close(): Promise<unknown> { this.#closed = true; return Promise.allSettled([...this.#pending]); }
}
