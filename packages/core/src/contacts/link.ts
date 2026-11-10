/*
 * The link between two contacts: one WebSocket the guest keeps open to its
 * host, which carries the signed requests of both and their answers.
 *
 * The host cannot dial its guest (only the host's machine is shared, or on
 * Funnel), so its requests go down the link. The guest's go up it too, once
 * the host said it answers them there (`caps`): a connection of its own for
 * each one is a DNS lookup, a TCP and a TLS handshake through Tailscale's
 * relay every time. The guest watches the link (`beat`): a path that went
 * silent without closing is hung up and dialed again.
 */
import { randomUUID } from 'node:crypto';
import type { CoordinationBridgeResponse, RpcEvents } from '@boite/contracts';
import type { BridgeRoute } from '../coordination-bridge.ts';
import type { Core } from '../core.ts';
import { unavailable } from '../errors.ts';
import { SyncBackoff } from '../group/backoff.ts';
import { clockGap } from '../peer-clock.ts';
import { UpgradeError, type TextSocket } from '../ws-client.ts';
import { dialContact, helloClock, type ContactSocketData } from './link-hello.ts';

/**
 * What crosses a link, each way: a signed request and its answer. `caps` is
 * the host's first word: `duplex` says it answers the guest's requests on the
 * link too, which a guest asks then there rather than on a connection of its own.
 */
type Frame = { t: 'req'; id: string; body: string; signature: string } | { t: 'res'; id: string; status: number; body: string; signature: string } | { t: 'caps'; duplex: 1 };

export interface LinkSocket { send(data: string): unknown; close(code?: number, reason?: string): void; terminate?(): void }
/** The guest's end of a link: `since` is when it opened, `pingedAt` when the host was last asked for a sign of life. */
interface DialedLink { socket: TextSocket | null; state: 'connecting' | 'connected'; routeId: string; since: number; pingedAt: number }
/** A lost link is dialed again at once, once in this long: a host that takes the dial and drops it is not hammered. */
const REDIAL_AT_ONCE_MS = 5_000;

/** The first wait after a dial that failed, doubled each time up to a minute. */
const REDIAL_FIRST_MS = 1000;

/** What the links read and change of the contacts they carry (`ContactStore`). */
export interface LinkOwner {
  readonly isClosed: boolean;
  readonly started: boolean;
  find(coreId: string): { coreId: string; name: string; role: 'host' | 'guest'; url?: string; publicKey: string } | undefined;
  has(coreId: string): boolean;
  /** The contact was just heard from on a new link: its sync goes again. */
  seen(coreId: string): void;
  members: { mark(members: Iterable<string>): void; holdersOf(coreId: string): string[] };
  flush(coreId: string): void;
  changed(): void;
  background(job: Promise<unknown>): void;
  helloHeaders(to: string): Record<string, string>;
}

export class ContactLinks {
  readonly #core: Core;
  readonly #store: LinkOwner;
  /** Guest side: the link this core keeps to each host. */
  readonly #dialed = new Map<string, DialedLink>();
  /** When each host was last dialed again at once. */
  readonly #redialed = new Map<string, number>();
  /** Host side: the link each guest keeps to this core, by the guest's id. */
  readonly #hosted = new Map<string, { routeId: string; socket: LinkSocket; heardAt: number; beats: boolean }>();
  /**
   * A guest asks its host for a sign of life this often, and hangs up a link
   * that gave none for `linkDeadMs`: a path that went silent without closing
   * (a laptop asleep, a NAT that forgot the flow, a relay that moved) is then
   * dialed again within half a minute, where nothing told the guest before.
   * A host drops a guest that stopped asking after twice as long.
   */
  linkBeatMs = 10_000;
  linkDeadMs = 25_000;
  readonly #backoff = new SyncBackoff(REDIAL_FIRST_MS, 60_000);

  constructor(core: Core, store: LinkOwner) { this.#core = core; this.#store = store; }

  /** The guest's socket is open: it becomes the bridge route for that contact, replacing an older one. */
  attach(data: ContactSocketData['contact'], socket: LinkSocket): void {
    const contact = this.#store.find(data.coreId);
    if (this.#store.isClosed || this.#core.policy.networkOff('contacts') || !contact || contact.role !== 'host') { socket.close(1008, 'not a contact'); return; }
    // A probe's only frame proves this core's key (`dialProven`), which hangs up on any other; a link is told it carries both ways.
    if (data.proof) socket.send(JSON.stringify({ t: 'proof', signature: data.proof }));
    else socket.send(JSON.stringify({ t: 'caps', duplex: 1 } satisfies Frame));
    const previous = this.#hosted.get(data.coreId);
    if (previous) {
      this.#core.coordination.bridge.disconnect(previous.routeId);
      previous.socket.close(1000, 'replaced by a newer link');
    }
    this.#hosted.set(data.coreId, { routeId: data.routeId, socket, heardAt: Date.now(), beats: false });
    const route: BridgeRoute = {
      id: data.routeId,
      sendEvent: (_name, payload: RpcEvents['collaboration.bridge.request']) => {
        this.#core.policy.assert(this.#core.policy.networkOff('contacts'), 'network.contacts');
        socket.send(JSON.stringify({ t: 'req', id: payload.requestId, body: payload.body, signature: payload.signature } satisfies Frame));
      },
    };
    this.#core.coordination.bridge.register(data.coreId, true, route);
    this.#store.seen(data.coreId);
    this.#store.members.mark(this.#store.members.holdersOf(data.coreId));
    this.#store.flush(data.coreId);
  }

  /** A frame from a guest: the answers to this core's requests, and the guest's own, answered as if posted to this core. */
  frame(data: ContactSocketData['contact'], raw: string | Buffer): void {
    let frame: Partial<Extract<Frame, { t: 'res' }>> | Partial<Extract<Frame, { t: 'req' }>>;
    try { frame = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8')) as typeof frame; } catch { return; }
    this.heard(data);
    if (this.#core.policy.networkOff('contacts') || typeof frame?.id !== 'string' || typeof frame.body !== 'string' || typeof frame.signature !== 'string') return;
    if (frame.t === 'req') { this.#store.background(this.#answer(data, { id: frame.id, body: frame.body, signature: frame.signature })); return; }
    if (frame.t !== 'res' || typeof frame.status !== 'number') return;
    try { this.#core.coordination.bridge.reply(frame.id, { status: frame.status, body: frame.body, signature: frame.signature }, { id: data.routeId }); } catch { /* A late or unknown answer. */ }
  }

  /** The guest gave a sign of life on its link: a frame, or the ping it sends when it has nothing to say. */
  heard(data: ContactSocketData['contact'], ping = false): void {
    const hosted = this.#hosted.get(data.coreId);
    if (hosted?.routeId !== data.routeId) return;
    hosted.heardAt = Date.now();
    if (ping) hosted.beats = true;
  }

  /** A guest's request, carried up its link: the desk checks it as one posted here, and the answer goes back on the same socket. */
  async #answer(data: ContactSocketData['contact'], request: { id: string; body: string; signature: string }): Promise<void> {
    let response: CoordinationBridgeResponse;
    try { response = await this.#core.coordination.forward({ coreId: data.coreId, body: request.body, signature: request.signature }); }
    catch { response = { status: 400, body: '', signature: '' }; }
    const hosted = this.#hosted.get(data.coreId);
    if (hosted?.routeId !== data.routeId) return;
    try { hosted.socket.send(JSON.stringify({ t: 'res', id: request.id, ...response } satisfies Frame)); } catch { /* The link closed meanwhile: the guest asks again at this core's address. */ }
  }

  detach(data: ContactSocketData['contact']): void {
    this.#core.coordination.bridge.disconnect(data.routeId);
    if (this.#hosted.get(data.coreId)?.routeId !== data.routeId) return;
    this.#hosted.delete(data.coreId);
    if (!this.#store.isClosed) { this.#store.changed(); this.#store.members.mark(this.#store.members.holdersOf(data.coreId)); }
  }

  // -- The link: the guest's side.

  dial(contact: NonNullable<ReturnType<LinkOwner['find']>>): void {
    if (this.#store.isClosed || !this.#store.started || contact.role !== 'guest' || contact.url === undefined || this.#dialed.has(contact.coreId) || this.#core.policy.networkOff('contacts')) return;
    const headers = this.#store.helloHeaders(contact.coreId);
    const coreId = contact.coreId;
    const link: DialedLink = { socket: null, state: 'connecting', routeId: `link:${randomUUID()}`, since: 0, pingedAt: 0 };
    this.#dialed.set(coreId, link);
    // A link that fails counts whatever was heard before: the mark is now.
    const lost = (error?: unknown) => {
      if (this.#dialed.get(coreId) !== link) return;
      this.#dialed.delete(coreId);
      this.#core.coordination.bridge.disconnect(link.routeId);
      if (this.#store.isClosed) return;
      this.#store.changed();
      if (link.state === 'connected') this.#store.members.mark(this.#store.members.holdersOf(coreId));
      // The host refused a hello dated by another clock and said its own time: the next dial is dated by it.
      const clock = error instanceof UpgradeError ? helloClock(error.head, headers, contact.publicKey) : null;
      const taught = clock !== null && this.#core.coordination.clocks.learn(coreId, clock);
      if (taught) this.#core.log('warn', `contacts: ${contact.name}'s clock and this machine's are ${clockGap(clock - Date.now())} apart; what goes to it is dated by its clock from now on`, { source: 'contacts' });
      // A link that carried and then dropped is dialed again now: the host restarted, or the path changed under it.
      const now = Date.now();
      // So is one whose hello the host's clock corrected. Each at most once in a while: a host that drops every link,
      // or signs another time at each hello, is dialed at the backoff's pace.
      const why = taught ? `clock:${coreId}` : link.state === 'connected' ? coreId : null;
      const again = why !== null && now - (this.#redialed.get(why) ?? 0) >= REDIAL_AT_ONCE_MS ? this.#store.find(coreId) : undefined;
      if (again && why !== null) { this.#redialed.set(why, now); this.dial(again); return; }
      this.#backoff.failed(coreId, 'link', this.#backoff.mark());
    };
    // The hello rides in the upgrade's headers. The name is checked again at each dial (its DNS answer may have left
    // the tailnet since the join), and the policy once the link opens: contacts turned off drop it, to be dialed later.
    const url = contact.url;
    dialContact(this.#core, url, headers).then(socket => {
      if (this.#store.isClosed || this.#dialed.get(coreId) !== link || (this.#core.policy.networkOff('contacts') && this.#dialed.delete(coreId))) { socket.close(1000); return; }
      link.socket = socket;
      link.state = 'connected';
      link.since = link.pingedAt = Date.now();
      this.#backoff.heard(coreId);
      if (this.#store.has(coreId)) this.#store.seen(coreId);
      this.#store.members.mark(this.#store.members.holdersOf(coreId));
      this.#store.flush(coreId);
      socket.onMessage(text => { this.#store.background(this.#serve(coreId, link, socket, text)); });
      socket.onClose(() => lost());
    }, lost);
  }

  /**
   * A frame of the host. Its request, carried down the link, is answered by the same handler as one posted to
   * this core. Its `caps` opens the link to this core's own requests, and its `res` answers one of them.
   */
  async #serve(hostId: string, link: DialedLink, socket: TextSocket, data: string): Promise<void> {
    let frame: { t?: unknown; id?: unknown; body?: unknown; signature?: unknown; status?: unknown; duplex?: unknown };
    try { frame = JSON.parse(data) as typeof frame; } catch { return; }
    if (frame?.t === 'caps') {
      if (frame.duplex !== 1 || this.#dialed.get(hostId) !== link || !socket.open) return;
      this.#core.coordination.bridge.register(hostId, true, {
        id: link.routeId,
        sendEvent: (_name, payload: RpcEvents['collaboration.bridge.request']) => {
          this.#core.policy.assert(this.#core.policy.networkOff('contacts'), 'network.contacts');
          if (!socket.open) throw unavailable('the link to this contact closed');
          socket.send(JSON.stringify({ t: 'req', id: payload.requestId, body: payload.body, signature: payload.signature } satisfies Frame));
        },
      });
      return;
    }
    if (frame?.t === 'res') {
      if (typeof frame.id !== 'string' || typeof frame.status !== 'number' || typeof frame.body !== 'string' || typeof frame.signature !== 'string') return;
      try { this.#core.coordination.bridge.reply(frame.id, { status: frame.status, body: frame.body, signature: frame.signature }, { id: link.routeId }); } catch { /* A late or unknown answer. */ }
      return;
    }
    if (frame?.t !== 'req' || typeof frame.id !== 'string' || typeof frame.body !== 'string' || typeof frame.signature !== 'string') return;
    let response: CoordinationBridgeResponse;
    try { response = await this.#core.coordination.forward({ coreId: hostId, body: frame.body, signature: frame.signature }); }
    catch { response = { status: 400, body: '', signature: '' }; }
    if (socket.open) socket.send(JSON.stringify({ t: 'res', id: frame.id, ...response } satisfies Frame));
  }

  /** Closes this core's side of a contact's link. */
  unlink(coreId: string): void {
    const dialed = this.#dialed.get(coreId);
    if (dialed) { this.#dialed.delete(coreId); this.#core.coordination.bridge.disconnect(dialed.routeId); dialed.socket?.close(1000, 'contact removed'); }
    this.#core.coordination.clocks.forget(coreId);
    this.#redialed.delete(coreId);
    this.#redialed.delete(`clock:${coreId}`);
    const hosted = this.#hosted.get(coreId);
    if (hosted) {
      this.#hosted.delete(coreId);
      this.#core.coordination.bridge.disconnect(hosted.routeId);
      hosted.socket.close(1000, 'contact removed');
    }
    this.#backoff.heard(coreId);
  }

  /** Signs of life on the links: asked of each host, and a link that gave none hung up, each side for its own. */
  beat(): void {
    const now = Date.now();
    for (const link of [...this.#dialed.values()]) {
      const socket = link.socket;
      if (link.state !== 'connected' || socket === null) continue;
      // Hung up without a close handshake: the path carries none. `lost` dials again at once.
      if (now - Math.max(socket.heardAt, link.since) > this.linkDeadMs) { socket.drop('the host gave no sign of life'); continue; }
      if (now - link.pingedAt >= this.linkBeatMs) { link.pingedAt = now; socket.ping(); }
    }
    for (const [coreId, hosted] of [...this.#hosted]) {
      // Only a guest that asks for signs of life is held to giving them: an older one says nothing while idle.
      if (!hosted.beats || now - hosted.heardAt <= 2 * this.linkDeadMs) continue;
      try { if (hosted.socket.terminate) hosted.socket.terminate(); else hosted.socket.close(1001, 'the guest gave no sign of life'); } catch { /* Gone already. */ }
      this.detach({ coreId, routeId: hosted.routeId });
    }
  }

  // -- What the store reads.

  hosts(coreId: string): boolean { return this.#hosted.has(coreId); }
  /** The state of the link this core dials to `coreId`, undefined while none is. */
  dialing(coreId: string): 'connecting' | 'connected' | undefined { return this.#dialed.get(coreId)?.state; }
  /** Whether a guest link to `coreId` may be dialed now: none is, and its last failure's wait is over. */
  due(coreId: string): boolean { return !this.#dialed.has(coreId) && !this.#backoff.waiting(coreId, 'link'); }

  close(): void {
    for (const { socket, routeId } of this.#dialed.values()) { this.#core.coordination.bridge.disconnect(routeId); socket?.close(1001, 'core stopping'); }
    this.#dialed.clear();
    for (const { socket } of this.#hosted.values()) socket.close(1001, 'core stopping');
    this.#hosted.clear();
  }
}
