/*
 * Contacts: other owners' Boites, linked so their agents and this core's work
 * together on the projects each side opens to the other, and on nothing else.
 *
 * The inviting core (`host`) shares its machine through Tailscale, or opens
 * its contact routes to the internet through Tailscale Funnel for an invitee
 * on another network (`funnel.ts`), and hands out a one-time link. The
 * invitee (`guest`) spends it on the host's join route, each side keeps the
 * other's signing and sealing keys, and the guest keeps a WebSocket open to
 * the host: a shared machine answers connections but opens none, so the
 * host's requests to the guest go down that link as a coordination bridge
 * route. Every request between contacts is signed and
 * sealed (`group/seal.ts`), whichever way it travels.
 *
 * What a contact reaches is decided here, on the core that answers: the
 * threads of the projects opened to it, each with its own coordination
 * settings, and a thread that wrote to it in the last 7 days.
 */
import { randomUUID } from 'node:crypto';
import type { AgentContact, AgentLetter, Contact, ContactInvite, ContactRequest, ContactSettings, ContactsState, ContactTailscale, CoordinationBridgeResponse, CoordinationPeer, ModelTier, RpcEvents, RpcParams, RpcResult } from '@boite/contracts';
import { text } from '../coordination-letter.ts';
import type { BridgeRoute } from '../coordination-bridge.ts';
import { PeerRefusal, ROUTE } from '../coordination-wire.ts';
import type { Core } from '../core.ts';
import { invalidParams, messageOf, refused, RpcFailure, unavailable } from '../errors.ts';
import { tailnetAddress } from '../group/addresses.ts';
import { SyncBackoff } from '../group/backoff.ts';
import { seal, type Sealing } from '../group/seal.ts';
import { contactsBot } from './bot.ts';
import { ContactFlags } from './flags.ts';
import { ContactFunnel } from './funnel.ts';
import { ContactMembers, type LinkedContacts } from './members.ts';
import { ContactRelations } from './relations.ts';
import { ContactRequests } from './requests.ts';
import { checkMachine, type ContactCard } from './invite.ts';
import { createInvite, INVITES, liveInvites, tailnetOrigin } from './invitations.ts';
import { CONTACT_JOIN_ROUTE, joinContact, joinRequest } from './join.ts';
import { TailscaleClient } from './tailscale.ts';
import { ContactReach } from './reach.ts';
import { checkTier } from './tier.ts';
import { fingerprintWords } from './words.ts';
import type { TextSocket } from '../ws-client.ts';
import { contactHello, CONTACT_LINK_ROUTE, dialContact, HELLO_INPUT, type ContactSocketData } from './link-hello.ts';
import { checkedContactOffers, contactOffers } from './offers.ts';
import { contactFace, groupFace } from './face.ts';
import { ContactGroupLink, GROUP_LETTER_TTL_MS } from './group-link.ts';
import { ContactHostAsks } from './host-asks.ts';
export { CONTACT_JOIN_ROUTE } from './join.ts';
const dashedName = (name: string): string => name.replace(/\s+/g, '-').toLowerCase();
export { CONTACT_LINK_ROUTE } from './link-hello.ts';
const CONTACTS = 'contacts';
const SETTINGS = 'contacts:settings';
const MAX_CONTACTS = 32;
const SKEW_MS = 60_000;
const TICK_MS = 1000;
/** Every this many ticks, what waits to be told to a contact is offered again. */
const FLUSH_TICKS = 30;
const TAILSCALE_CACHE_MS = 60_000;

/** A contact as this core keeps it: the public fields, its keys, and whether its offers are behind. */
export interface StoredContact extends Omit<Contact, 'link'> {
  publicKey: string;
  box: string;
  /** Bumped by every grant change; cleared once the contact heard this one. */
  syncPending?: number;
}
type Frame = { t: 'req'; id: string; body: string; signature: string } | { t: 'res'; id: string; status: number; body: string; signature: string };

interface LinkSocket { send(data: string): unknown; close(code?: number, reason?: string): void }

export class ContactStore implements LinkedContacts {
  readonly tailscale: TailscaleClient;
  /** Requests between this owner's agents and contacts' (`requests.ts`). */
  readonly requests: ContactRequests;
  /** Threads the Contacts bots put in touch (`relations.ts`). */
  readonly relations: ContactRelations;
  /** Contact letters and actions held for the Contacts bot (`flags.ts`). */
  readonly flags: ContactFlags;
  readonly funnel: ContactFunnel;
  /** Projects of the other machines of the group, opened through this core, and the contacts other members hold (`members.ts`). */
  readonly members: ContactMembers;
  /** What a contact reaches on this core, and the tiers its traffic takes (`reach.ts`). */
  readonly reach: ContactReach;
  /** Moving contacts to the group's Bots host, and following a contact that moved (`group-link.ts`). */
  readonly groupLink: ContactGroupLink;
  /** A member's asks through the Bots host, and the host's answers to them (`host-asks.ts`). */
  readonly hostAsks: ContactHostAsks;
  readonly maxContacts = MAX_CONTACTS;
  /** The origin an invitation gives: this machine's tailnet name. Tests point it at loopback. */
  selfUrl: (share: boolean) => Promise<string> = share => tailnetOrigin(this, this.#core, share);
  /** The origin an invitation for another network gives: the contact routes on Tailscale Funnel. Tests point it at loopback. */
  internetUrl: () => Promise<string> = () => this.funnel.open();
  /** Guest side: the link this core keeps to each host. */
  readonly #dialed = new Map<string, { socket: TextSocket | null; state: 'connecting' | 'connected' }>();
  /** Host side: the link each guest keeps to this core, by the guest's id. */
  readonly #hosted = new Map<string, { routeId: string; socket: LinkSocket }>();
  /** Join and hello nonces already used, until they would be stale anyway. */
  private readonly nonces = new Map<string, number>();
  readonly #backoff = new SyncBackoff(TICK_MS, 60_000);
  /** Contacts with a flush in flight; true once a change during it asked for another, run when it ends. */
  readonly #flushing = new Map<string, boolean>();
  readonly #pending = new Set<Promise<unknown>>();
  /** Cores this one is joining right now: each holds a contact slot until its join ends. */
  readonly #joining = new Set<string>();
  #peerCache: CoordinationPeer[] | null = null;
  /** The peers `peers()` lists for contacts another member holds: reached through it, never answered directly. */
  #relayPeers = new WeakSet<CoordinationPeer>();
  #tailscaleCache: { at: number; value: ContactTailscale } | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** What `wantsTailnet` last told the group's listener. */
  #listening: boolean | null = null;
  #ticks = 0;
  /** Open invitations at the last tick: one that expires tells the clients. */
  #openSeen = 0;
  #started = false;
  #closed = false;

  readonly #core: Core;

  constructor(core: Core) {
    this.#core = core;
    this.tailscale = new TailscaleClient(core.dataDir, core.policy.fetchUnless(() => core.policy.networkOff('contacts'), 'network.contacts', 'the Tailscale API'));
    this.requests = new ContactRequests(core, this);
    this.relations = new ContactRelations(core);
    this.flags = new ContactFlags(core);
    this.funnel = new ContactFunnel(core, [CONTACT_JOIN_ROUTE, CONTACT_LINK_ROUTE, ROUTE]);
    this.funnel.changed = () => this.changed();
    this.members = new ContactMembers(core, this);
    this.reach = new ContactReach(core, this);
    this.groupLink = new ContactGroupLink(core, this);
    this.hostAsks = new ContactHostAsks(core, this);
    // A member that leaves the group takes the contacts it relayed out of `peers()`; a new Bots host takes this core's contacts.
    core.bus.onAny(name => { if (name === 'group.updated') { this.reset(); if (this.#started) { this.groupLink.sweep(true); this.hostAsks.retry(); } } });
  }

  // -- Storage.

  list(): StoredContact[] { return (this.#core.journal.getSetting(CONTACTS) as StoredContact[] | undefined) ?? []; }
  find(coreId: string | null | undefined): StoredContact | undefined { return coreId ? this.list().find(contact => contact.coreId === coreId) : undefined; }
  has(coreId: string | null | undefined): boolean { return this.find(coreId) !== undefined; }
  /** A contact of this core, or one another member of the group holds and opened some of this core's projects to. */
  isContact(coreId: string | null | undefined): boolean { return this.has(coreId) || (!!coreId && this.members.relayedOf(coreId).length > 0); }
  /** The name this owner gives a contact, wherever it is linked. */
  known(coreId: string | null | undefined): { coreId: string; name: string } | undefined {
    const contact = this.find(coreId) ?? (coreId ? this.members.relayedOf(coreId)[0] : undefined);
    return contact ? { coreId: contact.coreId, name: contact.name } : undefined;
  }
  /**
   * Cores that hold a slot: stored contacts and outgoing joins, each counted
   * once since a reciprocal join can store a core it is still joining, and
   * without the slot `coreId` would fill itself.
   */
  occupied(coreId?: string): number {
    const held = new Set(this.list().map(contact => contact.coreId));
    for (const id of this.#joining) if (id !== coreId) held.add(id);
    return held.size;
  }

  /** Holds a slot for an outgoing join, so joins in flight never exceed the cap together; the caller releases it. */
  reserve(coreId: string): () => void {
    if (this.#joining.has(coreId)) throw refused('link: this core is already joining that contact');
    if (this.occupied() >= this.maxContacts) throw refused(`at most ${this.maxContacts} contacts; remove one first`);
    this.#joining.add(coreId);
    return () => { this.#joining.delete(coreId); };
  }

  #save(contacts: StoredContact[]): void {
    this.#core.journal.setSetting(CONTACTS, contacts);
    this.#peerCache = null;
    this.changed();
  }

  #mutate(coreId: string, change: (contact: StoredContact) => void): StoredContact {
    const contacts = this.list();
    const contact = contacts.find(entry => entry.coreId === coreId);
    if (!contact) throw invalidParams('coreId: expected the core id of one of this core\'s contacts', { field: 'coreId' });
    change(contact);
    this.#save(contacts);
    return contact;
  }

  /** Stores `record`, in place of `replaces` (its own id by default) or added. */
  put(record: StoredContact, replaces = record.coreId): void {
    const contacts = this.list();
    const at = contacts.findIndex(entry => entry.coreId === replaces);
    if (at < 0) {
      const taken = new Set(contacts.map(contact => contact.name.toLowerCase()));
      let name = record.name;
      for (let n = 2; taken.has(name.toLowerCase()); n += 1) name = `${record.name} ${n}`;
      contacts.push({ ...record, name });
    } else contacts[at] = record;
    this.#save(contacts);
    this.relisten();
  }

  /** Forgets a contact's record and link, nothing else: it moved to another core (`group-link.ts`). */
  drop(coreId: string): void {
    this.unlink(coreId);
    this.#save(this.list().filter(entry => entry.coreId !== coreId));
  }

  /**
   * How long a letter to this contact may wait: 7 days when it waits on a Bots
   * host, which may be off for days; undefined otherwise. That is the
   * contact's own group (`group`, sent only while it has a Bots host), or this
   * group's Bots host relaying a member's letter. Supporting `groupLink` alone
   * says nothing: every current core announces it. A reply into a gateway
   * mailbox (`cmb_`, `mailboxes.ts`) keeps the 15 minute route window.
   */
  letterTtl(coreId: string, threadId = ''): number | undefined {
    if (threadId.startsWith('cmb_')) return undefined;
    const contact = this.find(coreId);
    if (contact) return contact.group !== undefined ? GROUP_LETTER_TTL_MS : undefined;
    const host = this.#core.group.roleOf('botsHome');
    return host !== null && this.members.relayedOf(coreId).some(entry => entry.via === host) ? GROUP_LETTER_TTL_MS : undefined;
  }

  /** Only this core mints request letters; peer-origin contact letters remain forbidden. */
  ownsAnswer(letter: AgentLetter): boolean { return this.requests.ownsAnswer(letter); }

  settings(): ContactSettings {
    const saved = this.#core.journal.getSetting(SETTINGS) as Partial<ContactSettings> | undefined;
    return { minTier: saved?.minTier === 2 || saved?.minTier === 3 ? saved.minTier : 1 };
  }

  changed(): void { this.#core.bus.emit('contacts.updated', {}); }

  #background(job: Promise<unknown>): void {
    this.#pending.add(job);
    void job.catch(error => { if (!this.#closed) this.#core.log('warn', `contacts: ${messageOf(error)}`, { source: 'contacts' }); }).finally(() => this.#pending.delete(job));
  }

  // -- What other parts of the core ask.

  /**
   * Contacts as coordination peers: a host is reached through the link its
   * guest keeps, a guest dials its host's URL, and a contact another member
   * holds is reached through that member (`members.ts`).
   */
  peers(): CoordinationPeer[] {
    if (this.#peerCache === null) {
      const own = this.list();
      const direct: CoordinationPeer[] = own.map(contact => ({
        coreId: contact.coreId, name: contact.name, url: contact.url ?? '', publicKey: contact.publicKey, readThreads: false, viaClient: contact.role === 'host',
      }));
      const relayed: CoordinationPeer[] = [];
      for (const entry of this.members.relayed()) {
        if (own.some(contact => contact.coreId === entry.coreId) || relayed.some(peer => peer.coreId === entry.coreId)) continue;
        const peer: CoordinationPeer = { coreId: entry.coreId, name: entry.name, url: '', publicKey: '', readThreads: false };
        this.#relayPeers.add(peer);
        relayed.push(peer);
      }
      this.#peerCache = [...direct, ...relayed];
    }
    return this.#peerCache;
  }

  /** A peer `peers()` lists for a contact another member holds: it never signs a request to this core. */
  isRelayPeer(peer: CoordinationPeer): boolean { return this.#relayPeers.has(peer); }

  /** The relayed copies changed. */
  reset(): void { this.#peerCache = null; this.changed(); }

  /** A signed message sealed to a contact, or null for a core that is not one. */
  sealFor(coreId: string, plaintext: string): ({ body: string } & Sealing) | null {
    const contact = this.find(coreId);
    if (!contact) return null;
    const context = { from: this.#core.coordination.card().coreId, to: coreId };
    return { ...seal(plaintext, contact.box, context), context };
  }

  /** The host side keeps no URL: it reaches a guest only while the guest's link is open. */
  linked(coreId: string): boolean {
    const contact = this.find(coreId);
    return contact?.role === 'guest' || this.#hosted.has(coreId);
  }

  /** Listens on the tailnet while a contact may dial in: one is linked as guest, or an invitation is out. */
  wantsTailnet(): boolean {
    return this.list().some(contact => contact.role === 'host') || this.liveInvites().length > 0 || this.groupLink.waiting();
  }

  granted(coreId: string): string[] { return this.reach.granted(coreId); }
  mayReach(coreId: string, threadId: string, fromThreadId?: string): boolean { return this.reach.mayReach(coreId, threadId, fromThreadId); }
  mayRead(coreId: string, threadId: string): boolean { return this.reach.mayRead(coreId, threadId); }
  noteSent(threadId: string, coreId: string): void { this.reach.noteSent(threadId, coreId); }
  checkSendTier(threadId: string, coreId?: string): void { this.reach.checkSendTier(threadId, coreId); }
  checkAttestedTier(agent: string | undefined, coreId?: string): void { this.reach.checkAttestedTier(agent, coreId); }
  linkOf(coreId: string): Contact['link'] {
    const contact = this.find(coreId);
    return contact ? this.#linkState(contact) : this.members.relayedOf(coreId).some(entry => entry.link === 'connected') ? 'connected' : 'offline';
  }
  #linkState(contact: StoredContact): Contact['link'] {
    if (contact.role === 'host') return this.#hosted.has(contact.coreId) ? 'connected' : 'offline';
    return this.#dialed.get(contact.coreId)?.state ?? (this.#started && !this.#closed ? 'connecting' : 'offline');
  }

  view(contact: StoredContact): Contact {
    const { publicKey: _key, box: _box, syncPending: _sync, ...shown } = contact;
    return { ...shown, link: this.#linkState(contact) };
  }

  /** One of this core's own contacts by name (any case, spaces or dashes) or core id, or nothing. */
  lookup(value: string): StoredContact | undefined {
    const wanted = value.trim().toLowerCase();
    return this.list().find(contact => contact.coreId === wanted || contact.name.toLowerCase() === wanted || dashedName(contact.name) === wanted);
  }

  /** A contact by name (any case) or core id; the agent's `boite threads ask` takes either. */
  named(value: unknown): StoredContact {
    if (typeof value !== 'string' || !value.trim()) throw invalidParams('contact: expected the name or core id of a contact; see boite threads contacts', { field: 'contact' });
    const wanted = value.trim().toLowerCase();
    const found = this.lookup(value);
    const relayed = found ? undefined : this.members.relayed().find(entry => entry.coreId === wanted || entry.name.toLowerCase() === wanted || entry.name.replace(/\s+/g, '-').toLowerCase() === wanted);
    const via = relayed ? this.#core.group.peers().find(peer => peer.coreId === relayed.via) : undefined;
    if (via) throw refused(`contact: ${relayed!.name} is linked to ${via.name}; ask it from a thread there`, { field: 'contact' });
    if (!found) throw invalidParams(`contact: ${value} is not one of this core's contacts; see boite threads contacts`, { field: 'contact' });
    return found;
  }

  // -- Owner methods.

  async state(): Promise<ContactsState> {
    const bot = contactsBot(this.#core);
    return {
      self: { coreId: this.#core.coordination.card().coreId, machine: this.#machine() },
      contacts: [...this.list().map(contact => this.view(contact)), ...this.#heldElsewhere()],
      requests: this.requests.shown(),
      settings: this.settings(),
      tailscale: await this.tailscaleState(),
      invitations: this.liveInvites().length,
      internet: true,
      funnel: this.funnel.state(),
      bot: bot ? { agentId: bot.agentId, threadId: bot.threadId } : null,
      relations: this.relations.list(),
      flags: this.flags.shown(),
    };
  }

  #machine(): string { return (this.#core.info().hostname ?? 'Boite').slice(0, 100); }

  /** On the Bots host, the contacts other members still hold, for the owner: each names the member as `heldBy`. */
  #heldElsewhere(): Contact[] {
    if (this.#core.group.roleOf('botsHome') !== this.#core.coordination.card().coreId) return [];
    const shown = new Set(this.list().map(contact => contact.coreId));
    return this.members.relayed().filter(entry => !shown.has(entry.coreId) && shown.add(entry.coreId)).map(entry => ({
      coreId: entry.coreId, name: entry.name, machine: entry.name, fingerprint: '', role: 'host', trusted: false,
      grants: entry.grants.map(grant => ({ ...grant, grantedAt: 0, machine: entry.via })), offers: entry.projectOffers ?? [], link: entry.link,
      lastSeenAt: null, addedAt: 0, ...(entry.capabilities ? { capabilities: entry.capabilities } : {}), heldBy: entry.via,
    }));
  }

  card(): ContactCard {
    const { coreId, publicKey } = this.#core.coordination.card();
    return { coreId, publicKey, box: this.#core.group.boxPublic(), machine: contactFace(this.#core) };
  }

  liveInvites(): [string, { expiresAt: number }][] { return liveInvites(this.#core); }

  /** `share` false: the invitee is on this Tailscale already; `internet`: on another network, reached through Funnel (`invitations.ts`). */
  invite(share: unknown = true, internet: unknown = false): Promise<ContactInvite> { return createInvite(this, this.#core, share, internet); }

  /** Every open invitation spent unused: a join with one is refused like a used one. The listener closes when nothing else needs it. */
  cancelInvites(): { cancelled: number } {
    const cancelled = this.liveInvites().length;
    this.#core.journal.setSetting(INVITES, {});
    this.relisten();
    this.changed();
    return { cancelled };
  }

  async tailscaleState(fresh = false): Promise<ContactTailscale> {
    const now = Date.now();
    if (!fresh && this.#tailscaleCache !== null && now - this.#tailscaleCache.at < TAILSCALE_CACHE_MS) return this.#tailscaleCache.value;
    const value = await this.tailscale.state(tailnetAddress(), this.#core.boundEndpoint().port, message => this.#core.log('warn', message, { source: 'contacts' }));
    this.#tailscaleCache = { at: now, value };
    return value;
  }

  async setTailscaleKey(key: string | null): Promise<ContactTailscale> {
    if (key !== null && typeof key !== 'string') throw invalidParams('key: expected a Tailscale API key or null', { field: 'key' });
    this.tailscale.setKey(key);
    this.#tailscaleCache = null;
    this.changed();
    return this.tailscaleState(true);
  }

  join(link: string): Promise<Contact> { return joinContact(this, this.#core, link); }

  /** An invitation's token, spent: false when it was not live. */
  spendInvite(hash: string): boolean {
    const invites = Object.fromEntries(this.liveInvites());
    if (!(hash in invites)) return false;
    delete invites[hash];
    this.#core.journal.setSetting(INVITES, invites);
    // The join may still be refused after this: the count changes either way.
    this.changed();
    return true;
  }

  /**
   * Each owner joined the other: one relationship stays, the same on both
   * cores. The smaller core id hosts and the other dials it with `url`.
   */
  reciprocal(coreId: string, url: string | undefined): StoredContact {
    const hosts = this.#core.coordination.card().coreId < coreId;
    const before = this.find(coreId)?.role;
    const contact = this.#mutate(coreId, entry => {
      if (hosts) { entry.role = 'host'; delete entry.url; } else if (url !== undefined) { entry.role = 'guest'; entry.url = url; }
    });
    if (contact.role !== before) this.unlink(coreId);
    this.relisten();
    return contact;
  }

  /** The card a join brought, stored with the role this core plays for it. */
  store(card: ContactCard, role: 'host' | 'guest', url?: string): StoredContact {
    const contacts = this.list();
    const taken = new Set(contacts.map(contact => contact.name.toLowerCase()));
    let name = card.machine;
    for (let n = 2; taken.has(name.toLowerCase()); n += 1) name = `${card.machine} ${n}`;
    const contact: StoredContact = {
      coreId: card.coreId, name, machine: card.machine, fingerprint: fingerprintWords(this.#core.coordination.card().publicKey, card.publicKey),
      role, ...(url === undefined ? {} : { url }), trusted: false, grants: [], offers: [], lastSeenAt: null, addedAt: Date.now(), syncPending: 1,
      publicKey: card.publicKey, box: card.box,
    };
    this.#save([...contacts, contact]);
    return contact;
  }

  update(params: RpcParams<'contacts.update'>): Contact {
    if (params.trusted !== undefined && typeof params.trusted !== 'boolean') throw invalidParams('trusted: expected a boolean', { field: 'trusted' });
    const name = params.name === undefined ? undefined : text(params.name, 'name', 100).trim();
    if (name !== undefined && this.list().some(contact => contact.coreId !== params.coreId && contact.name.toLowerCase() === name.toLowerCase())) {
      throw invalidParams('name: expected a name no other contact has', { field: 'name' });
    }
    const contact = this.#mutate(params.coreId, entry => {
      if (name !== undefined) entry.name = name;
      if (params.trusted !== undefined) entry.trusted = params.trusted;
    });
    if (name !== undefined) this.members.mark(this.members.holdersOf(contact.coreId));
    // Trusted now: what waited for the owner's card goes back to the bot.
    if (params.trusted === true) this.requests.trusted(contact.coreId);
    return this.view(contact);
  }

  #policyKey(coreId: string, projectId: string): string { return `contact-policy-revoked:${JSON.stringify([coreId, projectId])}`; }
  policyRevoked(coreId: string, projectId: string): boolean { return this.#core.journal.getSetting(this.#policyKey(coreId, projectId)) === true; }
  restoreForOwner(coreId: string, projectId: string): void { this.#core.journal.deleteSetting(this.#policyKey(coreId, projectId)); }
  /** The contact moved to another core (`group-link.ts`): what policy closed to it stays closed. */
  movePolicy(from: string, to: string): void {
    for (const project of this.#core.journal.listProjects()) {
      if (!this.policyRevoked(from, project.id)) continue;
      this.restoreForOwner(from, project.id);
      this.#core.journal.setSetting(this.#policyKey(to, project.id), true);
    }
  }
  revokeForPolicy(params: RpcParams<'contacts.revoke'>): void {
    this.#core.journal.setSetting(this.#policyKey(params.coreId, params.projectId), true);
    if (this.has(params.coreId)) this.revoke(params);
    else { this.reach.closed(params.coreId, [params.projectId]); this.reset(); }
  }
  async grant(params: RpcParams<'contacts.grant'>): Promise<Contact> {
    if (params.readThreads !== undefined && typeof params.readThreads !== 'boolean') throw invalidParams('readThreads: expected a boolean', { field: 'readThreads' });
    const member = this.members.member(params.machine);
    if (member === null) return this.grantHere(params);
    if (!this.has(params.coreId)) throw invalidParams('coreId: expected the core id of one of this core\'s contacts', { field: 'coreId' });
    const project = await this.members.project(member, params.projectId);
    const contact = this.#mutate(params.coreId, entry => {
      const existing = entry.grants.find(grant => grant.projectId === project.projectId && grant.machine === member.coreId);
      if (existing) Object.assign(existing, { readThreads: params.readThreads ?? existing.readThreads, name: project.name });
      else entry.grants.push({ projectId: project.projectId, readThreads: params.readThreads ?? false, grantedAt: Date.now(), machine: member.coreId, name: project.name });
      entry.syncPending = (entry.syncPending ?? 0) + 1;
    });
    this.members.mark([member.coreId]);
    this.flush(contact.coreId);
    return this.view(contact);
  }

  grantHere(params: Omit<RpcParams<'contacts.grant'>, 'machine'>, automatic = false): Contact {
    const project = typeof params.projectId === 'string' ? this.#core.journal.getProject(params.projectId) : null;
    if (!project || project.archived) throw invalidParams('projectId: expected an unarchived project of this core', { field: 'projectId' });
    if (automatic && this.policyRevoked(params.coreId, project.id)) throw refused('projectId: policy-revoked access requires an explicit owner grant');
    const contact = this.#mutate(params.coreId, entry => {
      if (!automatic) this.#core.journal.deleteSetting(this.#policyKey(params.coreId, project.id));
      const existing = entry.grants.find(grant => grant.projectId === project.id && !grant.machine);
      if (existing) existing.readThreads = params.readThreads ?? existing.readThreads;
      else entry.grants.push({ projectId: project.id, readThreads: params.readThreads ?? false, grantedAt: Date.now() });
      entry.syncPending = (entry.syncPending ?? 0) + 1;
    });
    this.flush(contact.coreId);
    return this.view(contact);
  }

  /** A member that left the group may still be named: its grants are closed all the same. */
  revoke(params: RpcParams<'contacts.revoke'>): Contact {
    if (typeof params.projectId !== 'string') throw invalidParams('projectId: expected a project id', { field: 'projectId' });
    const machine = params.machine === undefined || params.machine === null || params.machine === '' || params.machine === this.#core.coordination.card().coreId ? undefined : text(params.machine, 'machine', 100);
    const contact = this.#mutate(params.coreId, entry => {
      entry.grants = entry.grants.filter(grant => grant.projectId !== params.projectId || grant.machine !== machine);
      entry.syncPending = (entry.syncPending ?? 0) + 1;
    });
    if (machine !== undefined) this.members.mark([machine]);
    else {
      // Its threads stop hearing back from this contact too; only a later letter of theirs opens that again.
      this.reach.forgetReplies(contact.coreId, threadId => this.#core.journal.getThread(threadId)?.projectId === params.projectId);
      this.#core.coordination.rejectContactLetters(contact.coreId, 'Project closed to this contact');
    }
    this.flush(contact.coreId);
    return this.view(contact);
  }

  /** A member no longer opens these of its projects to a contact another member holds, or none (`null`). */
  projectsClosed(coreId: string, projectIds: string[] | null): void { this.reach.closed(coreId, projectIds); }

  remove(coreId: string): { ok: true } {
    const contact = this.find(coreId);
    if (!contact) throw invalidParams('coreId: expected the core id of one of this core\'s contacts', { field: 'coreId' });
    const holders = this.members.holdersOf(coreId);
    this.unlink(coreId);
    this.#save(this.list().filter(entry => entry.coreId !== coreId));
    this.requests.save(this.requests.list().filter(request => request.coreId !== coreId));
    this.relations.forget(coreId);
    this.flags.cut(coreId);
    this.reach.forgetReplies(coreId, () => true);
    // No longer trusted anywhere: pending letters both ways are rejected and the bridge route is dropped.
    this.#core.coordination.untrust(coreId, true);
    this.members.mark(holders);
    this.relisten();
    return { ok: true };
  }

  setSettings(settings: ContactSettings): ContactSettings {
    if (!settings || typeof settings !== 'object') throw invalidParams('settings: expected { minTier }', { field: 'settings' });
    const minTier: ModelTier = checkTier(settings.minTier, 'settings.minTier');
    this.#core.journal.setSetting(SETTINGS, { minTier });
    this.changed();
    this.members.mark(new Set(this.list().flatMap(contact => this.members.holdersOf(contact.coreId))));
    return { minTier };
  }

  decide(params: RpcParams<'contacts.decide'>): ContactRequest {
    if (typeof params.accept !== 'boolean') throw invalidParams('accept: expected a boolean', { field: 'accept' });
    return this.requests.settle(params.id, params.accept, params.projectId, params.reason, 'owner');
  }

  // -- Agent methods.

  /** The contacts this thread's agent may write to, with what each opened to this core. */
  forThread(threadId: string): RpcResult<'collaboration.contacts'> {
    this.#core.threads.require(threadId);
    const config = this.#core.coordination.config(threadId);
    if (config.mode === 'off' || !config.remote) return [];
    // With a Contacts bot, only it sees what each contact opened: the others ask it by name.
    const bot = contactsBot(this.#core);
    return bot === null || bot.threadId === threadId ? this.available() : this.available().map(contact => ({ ...contact, projects: [] }));
  }

  /** Public summaries only, also carried to another member of this owner's group. */
  available(): RpcResult<'collaboration.contacts'> {
    const own = this.list().map(contact => ({ name: contact.name, coreId: contact.coreId, projects: contact.offers.map(offer => offer.name), link: this.#linkState(contact) }));
    const relayed = this.members.relayed().filter((entry, index, all) => !own.some(contact => contact.coreId === entry.coreId) && all.findIndex(other => other.coreId === entry.coreId) === index)
      .map(entry => ({ name: entry.name, coreId: entry.coreId, projects: entry.offers, link: entry.link }));
    return [...own, ...relayed];
  }

  ask(params: RpcParams<'collaboration.ask'>): ContactRequest { return this.requests.ask(params); }
  /** A virtual mailbox carries a group member's attested sender without a real local thread. */
  askFrom(from: AgentContact, ask: Parameters<ContactRequests['askFrom']>[1], gitRemote?: string): ContactRequest { return this.requests.askFrom(from, ask, gitRemote); }

  // -- What a contact's core tells this one (`coordination.ts` checked the signature, the seal and `from`).

  /** The projects the contact opened to this core. */
  synced(coreId: string, payload: unknown): { ok: true } {
    const checked = checkedContactOffers(coreId, payload);
    const contact = this.find(coreId);
    const raw = payload as { capabilities?: { sharedProjects?: unknown; humanLetters?: unknown; contactsBot?: unknown; groupLink?: unknown }; bot?: { threadId?: unknown; title?: unknown } | null; group?: unknown };
    const rawCaps = raw.capabilities;
    const capabilities = { ...(rawCaps?.sharedProjects === 1 ? { sharedProjects: 1 as const } : {}), ...(rawCaps?.humanLetters === 1 ? { humanLetters: 1 as const } : {}), ...(rawCaps?.contactsBot === 1 ? { contactsBot: 1 as const } : {}), ...(rawCaps?.groupLink === 1 ? { groupLink: 1 as const } : {}) };
    // A group with a Bots host names itself after the group: the contact shows that name, never a machine's.
    const group = raw.group === undefined || raw.group === null ? undefined : checkMachine(raw.group, 'sync.group');
    const bot = raw.bot === undefined || raw.bot === null ? undefined : { threadId: text(raw.bot.threadId, 'bot.threadId', 128), title: text(raw.bot.title, 'bot.title', 200) };
    if (contact && (JSON.stringify(contact.offers) !== JSON.stringify(checked) || JSON.stringify(contact.capabilities) !== JSON.stringify(capabilities) || JSON.stringify(contact.bot) !== JSON.stringify(bot) || contact.group !== group)) {
      this.#mutate(coreId, entry => {
        entry.offers = checked; entry.capabilities = capabilities; if (bot) entry.bot = bot; else delete entry.bot;
        if (group !== undefined) { if (entry.name === entry.machine) entry.name = group; entry.machine = group; entry.group = group; } else delete entry.group;
      });
      this.members.mark(this.members.holdersOf(coreId));
      if (capabilities.groupLink === 1) this.groupLink.sweep(true);
    }
    return { ok: true };
  }

  asked(coreId: string, payload: unknown, from: AgentContact): { id: string } { return this.requests.asked(coreId, payload, from); }
  answered(coreId: string, payload: unknown, threads: AgentContact[], relation?: { id: unknown; thread: AgentContact }): { ok: true } { return this.requests.answered(coreId, payload, threads, relation); }

  // -- Telling the contact: grants, asks and answers, retried until heard.

  /** Every contact hears this core's sync again: its Contacts bot came, went or changed. */
  announce(): void {
    for (const contact of this.list()) {
      this.#mutate(contact.coreId, entry => { entry.syncPending = (entry.syncPending ?? 0) + 1; });
      this.flush(contact.coreId);
    }
  }

  flush(coreId: string): void {
    if (this.#closed || !this.#started || !this.linked(coreId)) return;
    if (this.#flushing.has(coreId)) { this.#flushing.set(coreId, true); return; }
    this.#flushing.set(coreId, false);
    this.#background(this.#tell(coreId).finally(() => { const again = this.#flushing.get(coreId); this.#flushing.delete(coreId); if (again) this.flush(coreId); }));
  }

  async #tell(coreId: string): Promise<void> {
    await this.#core.sharedProjects.flush(coreId);
    const peer = (): CoordinationPeer => {
      const found = this.peers().find(entry => entry.coreId === coreId);
      if (!found) throw new Error('no longer a contact');
      return found;
    };
    const contact = this.find(coreId);
    if (!contact) return;
    if (contact.syncPending) {
      const version = contact.syncPending;
      const bot = contactsBot(this.#core);
      const own = bot ? { bot: { threadId: bot.threadId, title: this.#core.journal.getThread(bot.threadId)?.title.slice(0, 200) || bot.name } } : {};
      try { await this.#core.coordination.request(peer(), 'contact.sync', { offers: contactOffers(this.#core, contact), capabilities: { sharedProjects: 1, humanLetters: 1, contactsBot: 1, groupLink: 1 }, ...own, ...(groupFace(this.#core) ? { group: groupFace(this.#core) } : {}) }); }
      catch (error) { if (!(error instanceof PeerRefusal)) throw error; }
      if (this.find(coreId)?.syncPending === version) this.#mutate(coreId, entry => { delete entry.syncPending; });
    }
    await this.requests.tell(coreId, peer, () => this.#closed);
    // A grant can change while this flush awaited sync/answers; send its queued revision now.
    await this.#core.sharedProjects.flush(coreId);
  }

  // -- Join: the host's side.

  /** `POST /contacts/join` (`join.ts`). */
  http(request: Request): Promise<Response> { return joinRequest(this, this.#core, request); }

  get isClosed(): boolean { return this.#closed; }

  /** Refused unless `at` is within a minute and `nonce` was never used by this core: a request recorded and sent again goes nowhere. */
  fresh(coreId: string, nonce: string, at: unknown): void {
    const now = Date.now();
    if (!nonce) throw invalidParams('nonce: expected 1 to 100 characters');
    if (!Number.isSafeInteger(at) || Math.abs(now - (at as number)) > SKEW_MS) throw refused('at: expected the current time, within a minute');
    for (const [key, seen] of this.nonces) if (now - seen > 2 * SKEW_MS) this.nonces.delete(key);
    const key = `${coreId}:${nonce}`;
    if (this.nonces.has(key)) throw refused('nonce: already used; this request was replayed');
    this.nonces.set(key, now);
  }

  // -- The link: the host's side.

  hello(request: Request): ContactSocketData['contact'] | Response { return contactHello(this.#core, this, request); }

  /** The guest's socket is open: it becomes the bridge route for that contact, replacing an older one. */
  attach(data: ContactSocketData['contact'], socket: LinkSocket): void {
    const contact = this.find(data.coreId);
    if (this.#closed || this.#core.policy.networkOff('contacts') || !contact || contact.role !== 'host') { socket.close(1008, 'not a contact'); return; }
    const previous = this.#hosted.get(data.coreId);
    if (previous) {
      this.#core.coordination.bridge.disconnect(previous.routeId);
      previous.socket.close(1000, 'replaced by a newer link');
    }
    this.#hosted.set(data.coreId, { routeId: data.routeId, socket });
    const route: BridgeRoute = {
      id: data.routeId,
      sendEvent: (_name, payload: RpcEvents['collaboration.bridge.request']) => {
        this.#core.policy.assert(this.#core.policy.networkOff('contacts'), 'network.contacts');
        socket.send(JSON.stringify({ t: 'req', id: payload.requestId, body: payload.body, signature: payload.signature } satisfies Frame));
      },
    };
    this.#core.coordination.bridge.register(data.coreId, true, route);
    this.#mutate(data.coreId, entry => { entry.lastSeenAt = Date.now(); entry.syncPending = (entry.syncPending ?? 0) + 1; });
    this.members.mark(this.members.holdersOf(data.coreId));
    this.flush(data.coreId);
  }

  /** A frame from a guest: only the answers to this core's requests. */
  frame(data: ContactSocketData['contact'], raw: string | Buffer): void {
    let frame: Partial<Extract<Frame, { t: 'res' }>>;
    try { frame = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8')) as typeof frame; } catch { return; }
    if (this.#core.policy.networkOff('contacts') || frame?.t !== 'res' || typeof frame.id !== 'string' || typeof frame.status !== 'number' || typeof frame.body !== 'string' || typeof frame.signature !== 'string') return;
    try { this.#core.coordination.bridge.reply(frame.id, { status: frame.status, body: frame.body, signature: frame.signature }, { id: data.routeId }); } catch { /* A late or unknown answer. */ }
  }

  detach(data: ContactSocketData['contact']): void {
    this.#core.coordination.bridge.disconnect(data.routeId);
    if (this.#hosted.get(data.coreId)?.routeId !== data.routeId) return;
    this.#hosted.delete(data.coreId);
    if (!this.#closed) { this.changed(); this.members.mark(this.members.holdersOf(data.coreId)); }
  }

  // -- The link: the guest's side.

  dial(contact: StoredContact): void {
    if (this.#closed || !this.#started || contact.role !== 'guest' || contact.url === undefined || this.#dialed.has(contact.coreId) || this.#core.policy.networkOff('contacts')) return;
    const headers = this.helloHeaders(contact.coreId);
    const coreId = contact.coreId;
    const link: { socket: TextSocket | null; state: 'connecting' | 'connected' } = { socket: null, state: 'connecting' };
    this.#dialed.set(coreId, link);
    // A link that fails counts whatever was heard before: the mark is now.
    const lost = () => {
      if (this.#dialed.get(coreId) !== link) return;
      this.#dialed.delete(coreId);
      this.#backoff.failed(coreId, 'link', this.#backoff.mark());
      if (!this.#closed) { this.changed(); if (link.state === 'connected') this.members.mark(this.members.holdersOf(coreId)); }
    };
    // The hello rides in the upgrade's headers. The name is checked again at each dial (its DNS answer may have left
    // the tailnet since the join), and the policy once the link opens: contacts turned off drop it, to be dialed later.
    const url = contact.url;
    dialContact(this.#core, url, headers).then(socket => {
      if (this.#closed || this.#dialed.get(coreId) !== link || (this.#core.policy.networkOff('contacts') && this.#dialed.delete(coreId))) { socket.close(1000); return; }
      link.socket = socket;
      link.state = 'connected';
      this.#backoff.heard(coreId);
      if (this.has(coreId)) this.#mutate(coreId, entry => { entry.lastSeenAt = Date.now(); entry.syncPending = (entry.syncPending ?? 0) + 1; });
      this.members.mark(this.members.holdersOf(coreId));
      this.flush(coreId);
      socket.onMessage(text => { this.#background(this.#serve(coreId, socket, text)); });
      socket.onClose(lost);
    }, lost);
  }

  /** The signed hello a dial to `to` carries in its upgrade's headers. */
  helloHeaders(to: string): Record<string, string> {
    const self = this.#core.coordination.card();
    const hello = JSON.stringify({ v: 1, from: self.coreId, to, at: Date.now(), nonce: randomUUID() });
    return {
      'x-boite-peer': self.coreId,
      'x-boite-hello': Buffer.from(hello).toString('base64url'),
      'x-boite-signature': this.#core.coordination.signature(Buffer.from(`${HELLO_INPUT}${hello}`)).toString('base64'),
    };
  }

  /** A request of the host, carried down the link: answered by the same handler as one posted to this core. */
  async #serve(hostId: string, socket: TextSocket, data: string): Promise<void> {
    let frame: Partial<Extract<Frame, { t: 'req' }>>;
    try { frame = JSON.parse(data) as typeof frame; } catch { return; }
    if (frame?.t !== 'req' || typeof frame.id !== 'string' || typeof frame.body !== 'string' || typeof frame.signature !== 'string') return;
    let response: CoordinationBridgeResponse;
    try { response = await this.#core.coordination.forward({ coreId: hostId, body: frame.body, signature: frame.signature }); }
    catch { response = { status: 400, body: '', signature: '' }; }
    if (socket.open) socket.send(JSON.stringify({ t: 'res', id: frame.id, ...response } satisfies Frame));
  }

  /** Closes this core's side of a contact's link. */
  unlink(coreId: string): void {
    const dialed = this.#dialed.get(coreId);
    if (dialed) { this.#dialed.delete(coreId); dialed.socket?.close(1000, 'contact removed'); }
    const hosted = this.#hosted.get(coreId);
    if (hosted) {
      this.#hosted.delete(coreId);
      this.#core.coordination.bridge.disconnect(hosted.routeId);
      hosted.socket.close(1000, 'contact removed');
    }
    this.#backoff.heard(coreId);
  }

  // -- Lifecycle.

  /** Called once the server listens. Nothing runs without a contact or an open invitation. */
  start(): void {
    if (this.#closed) return;
    this.#started = true;
    this.flags.watch();
    this.#listening = this.wantsTailnet();
    this.funnel.start(this.#listening && !this.#core.policy.networkOff('contacts'));
    if (this.list().length > 0 || this.liveInvites().length > 0 || this.members.behind() || this.hostAsks.waiting()) this.arm();
    this.members.push();
    this.groupLink.sweep();
    this.hostAsks.retry();
  }

  arm(): void {
    if (this.#closed || !this.#started || this.timer !== null) return;
    this.timer = setInterval(() => this.#tick(), TICK_MS);
    this.timer.unref?.();
    queueMicrotask(() => this.#tick());
  }

  #tick(): void {
    if (this.#closed) return;
    const contacts = this.list();
    // An invitation that expired may have been the last reason to listen on the tailnet.
    this.relisten();
    const open = this.liveInvites().length;
    if (open < this.#openSeen) this.changed();
    this.#openSeen = open;
    // A member's copy still to push keeps the timer, even once the last contact went.
    if (contacts.length === 0 && open === 0 && !this.members.behind() && !this.hostAsks.waiting()) {
      if (this.timer !== null) clearInterval(this.timer);
      this.timer = null;
      return;
    }
    this.#ticks += 1;
    for (const contact of contacts) if (contact.role === 'guest' && !this.#dialed.has(contact.coreId) && !this.#backoff.waiting(contact.coreId, 'link')) this.dial(contact);
    if (this.#ticks % FLUSH_TICKS === 0) {
      this.requests.expire();
      for (const contact of contacts) this.flush(contact.coreId);
      this.members.push();
      this.groupLink.sweep();
      this.hostAsks.retry();
    }
  }

  /** Opens or closes the tailnet listener when `wantsTailnet` changed, and takes Funnel down once nothing needs it. */
  relisten(): void {
    const wants = this.wantsTailnet();
    if (!wants && !this.#closed) this.funnel.release();
    if (wants === this.#listening) return;
    this.#listening = wants;
    this.#core.group.relisten();
  }

  beginClose(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.funnel.stop();
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    for (const { socket } of this.#dialed.values()) socket?.close(1001, 'core stopping');
    this.#dialed.clear();
    for (const { socket } of this.#hosted.values()) socket.close(1001, 'core stopping');
    this.#hosted.clear();
    this.members.beginClose();
    void this.groupLink.close();
    void this.hostAsks.close();
    this.flags.close();
  }

  async close(): Promise<void> {
    this.beginClose();
    await Promise.allSettled([...this.#pending, this.funnel.settled(), this.members.settled(), this.groupLink.close(), this.hostAsks.close()]);
  }
}
