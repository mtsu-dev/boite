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
 */
import type { AgentContact, ContactRequest, CoordinationPeer, RpcParams } from '@boite/contracts';
import { text } from '../coordination-letter.ts';
import { PeerRefusal } from '../coordination-wire.ts';
import type { Core } from '../core.ts';
import { invalidParams, messageOf, refused } from '../errors.ts';
import { newId } from '../ids.ts';
import { contactsBot } from './bot.ts';
import { checkNormalizedRemote, gitRemoteOf } from './git-remote.ts';
import { GROUP_LETTER_TTL_MS } from './group-link.ts';
import { given, MAX_PENDING, NO_BOT, THREAD_ID, want, type HostAsk, type StoredRequest } from './requests.ts';
import type { ContactStore } from './store.ts';

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
  waiting(): boolean { return this.#store.requests.list().some(request => request.pendingHost !== undefined || request.pendingMember === true); }

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

  /** The ask ends here, and its thread reads why. */
  #refuse(id: string, reason: string): void {
    const request = this.#settle(id, current => {
      delete current.pendingHost;
      delete current.stage;
      Object.assign(current, { status: 'refused', reason: reason.slice(0, 500), decidedAt: Date.now() });
    });
    if (!request) return;
    this.#core.coordination.contactNotice(request.coreId, 'Contacts', request.id, request.from.threadId, 'Your request to a contact', `Your request ${request.id} was not sent: ${request.reason}`);
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

  close(): Promise<unknown> { this.#closed = true; return Promise.allSettled([...this.#pending]); }
}
