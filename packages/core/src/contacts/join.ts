/*
 * Joining a contact: the guest spends a one-time invitation on the host's
 * join route, and each side keeps the other's card.
 *
 * Two owners can invite and join each other at once. Both cores then settle
 * on the same single relationship with a rule each computes alone: the core
 * with the smaller core id hosts, the other dials it.
 */
import { randomUUID, verify } from 'node:crypto';
import type { Contact } from '@boite/contracts';
import { boundedBody } from '../coordination-wire.ts';
import type { Core } from '../core.ts';
import { invalidParams, messageOf, refused, RpcFailure, unavailable } from '../errors.ts';
import { openResponse, pack, seal, SEALED, sealResponse, unpack, type Sealing } from '../group/seal.ts';
import { checkCard, checkTailnetName, decodeInvite, tokenHash, type ContactCard, type Invitation } from './invite.ts';
import { funnelFetch, nameNotFound } from './public-dns.ts';
import { clockGap } from '../peer-clock.ts';
import type { ContactStore } from './store.ts';

export const CONTACT_JOIN_ROUTE = '/contacts/join';
export const JOIN_INPUT = 'boite-contact-join\n';
const JOINED_INPUT = 'boite-contact-joined\n';
const JOIN_BODY_MAX = 16_384;
/**
 * How long a guest waits before joining again a host its request did not
 * reach yet: its Funnel name is not published, or its first certificate is
 * still being issued. Short, because the zone's own servers are asked
 * (`public-dns.ts`): the name is found the moment Tailscale publishes it.
 */
export const JOIN_RETRY_MS = 5_000;
const JOIN_TIMEOUT_MS = 10_000;

/**
 * Why a join never reached the inviter's Funnel, in words that name the one
 * thing to check. `retry`: the same join may go through shortly by itself.
 */
function funnelFailure(error: unknown, invite: Invitation): { message: string; retry: boolean } {
  const at = `${invite.machine} at ${invite.url}`;
  const code = String((error as { code?: unknown } | null)?.code ?? '');
  if (nameNotFound(error)) return { retry: true, message: `could not find ${at}: Tailscale has not published its address on the internet yet, which takes a few minutes; join again shortly` };
  if ((error as { name?: unknown } | null)?.name === 'TimeoutError') return { retry: true, message: `${at} did not answer within ${JOIN_TIMEOUT_MS / 1000} seconds: its machine is off or asleep, or its Tailscale Funnel is still setting up its certificate; join again shortly` };
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET') return { retry: false, message: `${at} refused the connection: Tailscale Funnel is off on that machine; ask the inviter to open Contacts, which turns it on again, then join again` };
  if (code.includes('CERT') || code === 'EPROTO') return { retry: false, message: `${at} did not prove its name (${code}): something on this network stands between the two machines, or this machine's date is wrong; check the date, then join again` };
  return { retry: false, message: `could not reach ${at}: its Boite or its Tailscale Funnel is off; ask the inviter to check, then join again` };
}

/** The guest's side: spends the link's token on its host, then keeps the host as a contact and dials it. */
export async function joinContact(store: ContactStore, core: Core, link: string): Promise<Contact> {
  core.policy.assert(core.policy.networkOff('contacts'), 'network.contacts');
  const invite = decodeInvite(link);
  const self = store.card();
  if (invite.coreId === self.coreId) throw invalidParams('link: this invitation is this core\'s own', { field: 'link' });
  if (store.has(invite.coreId)) throw refused('link: already a contact; remove it first to link again');
  if (core.coordination.trusted().some(peer => peer.coreId === invite.coreId)) throw refused('link: that core is already one of your machines');
  const release = store.reserve(invite.coreId);
  try {
    return await spendInvite(store, core, invite, self);
  } finally {
    release();
  }
}

/** Accepts the share, spends the token and keeps the host, while the join holds its slot. */
async function spendInvite(store: ContactStore, core: Core, invite: Invitation, self: ContactCard): Promise<Contact> {
  if (invite.share !== null && store.tailscale.hasKey()) {
    try { await store.tailscale.acceptShare(invite.share); } catch (error) {
      core.log('warn', `contacts: the Tailscale share of ${invite.machine} was not accepted: ${messageOf(error)}`, { source: 'contacts' });
    }
  }
  await checkTailnetName(invite.url, 'link.url');
  core.policy.assert(core.policy.networkOff('contacts'), 'network.contacts');
  type Reply = { nonce?: unknown; card?: unknown; error?: unknown; now?: unknown };
  /** One signed join, dated by what is known of the inviter's clock, and its signed answer. */
  const ask = async (): Promise<Reply> => {
    const nonce = randomUUID();
    const body = JSON.stringify({ nonce, at: core.coordination.clocks.now(invite.coreId), token: invite.token, card: self });
    const signature = core.coordination.signature(Buffer.from(`${JOIN_INPUT}${body}`)).toString('base64');
    const context = { from: self.coreId, to: invite.coreId };
    const sealed = seal(pack(body, signature), invite.box, context);
    let response: Response;
    try {
      response = await funnelFetch(`${invite.url}${CONTACT_JOIN_ROUTE}`, {
        method: 'POST', redirect: 'error',
        headers: { 'content-type': 'application/json', 'x-boite-peer': self.coreId, 'x-boite-signature': SEALED },
        body: sealed.body,
      }, JOIN_TIMEOUT_MS);
    } catch (error) {
      // An https origin is the inviter's Funnel: no share to accept. The token is unspent: the same join works later.
      if (!invite.url.startsWith('https:')) throw unavailable(`could not reach ${invite.machine} at ${invite.url}: accept its Tailscale share, or ask for an invitation for another network, then join again`);
      const failure = funnelFailure(error, invite);
      core.log('warn', `contacts: join of ${invite.machine} did not reach its Funnel (${messageOf(error).slice(0, 200)})`, { source: 'contacts' });
      throw unavailable(failure.message, failure.retry ? { retryAfterMs: JOIN_RETRY_MS } : undefined);
    }
    const raw = await boundedBody(response.body, JOIN_BODY_MAX).catch(() => '');
    core.policy.assert(core.policy.networkOff('contacts'), 'network.contacts');
    if (response.headers.get('x-boite-signature') !== SEALED) throw refused(`${invite.machine} refused the join (${response.status}: ${raw.slice(0, 200)})`);
    let reply: Reply;
    try {
      const opened = unpack(openResponse(raw, sealed.responseKey, context));
      if (!verify(null, Buffer.from(`${JOINED_INPUT}${opened.body}`), invite.publicKey, Buffer.from(opened.signature, 'base64'))) throw new Error('signature');
      reply = JSON.parse(opened.body) as Reply;
    } catch {
      throw unavailable(`${invite.machine} answered the join with something it did not sign`);
    }
    if (reply.nonce !== nonce) throw unavailable(`${invite.machine} answered another join`);
    return reply;
  };
  let reply = await ask();
  // The inviter's clock is not this machine's: it said its time, signed, and the join goes again dated by it.
  // The first one spent nothing: the date is checked before the token.
  if (typeof reply.error === 'string' && typeof reply.now === 'number') {
    const apart = `${invite.machine}'s clock and this machine's are ${clockGap(reply.now - Date.now())} apart`;
    if (core.coordination.clocks.learn(invite.coreId, reply.now)) {
      core.log('warn', `contacts: ${apart}; the join is dated by its clock`, { source: 'contacts' });
      reply = await ask();
    }
    if (typeof reply.error === 'string' && typeof reply.now === 'number') throw refused(`${invite.machine} refused the join: ${apart}; turn automatic time on on both machines, then join again`);
  }
  if (typeof reply.error === 'string') throw refused(`${invite.machine} refused the join: ${reply.error.slice(0, 500)}`);
  const card = checkCard(reply.card, 'card');
  if (card.coreId !== invite.coreId || card.box !== invite.box) throw unavailable(`${invite.machine} answered with keys other than its invitation's`);
  // Checked again after the answer: the host may have joined this core meanwhile.
  const existing = store.find(card.coreId);
  if (existing?.role === 'guest') throw refused('link: already a contact; remove it first to link again');
  const contact = existing ? store.reciprocal(card.coreId, invite.url) : store.store({ ...card, machine: invite.machine }, 'guest', invite.url);
  store.arm();
  store.dial(contact);
  return store.view(contact);
}

/** `POST /contacts/join`: a guest spends an invitation token and leaves its card. Every refusal is a 403 the server counts. */
export async function joinRequest(store: ContactStore, core: Core, request: Request): Promise<Response> {
  if (store.isClosed || core.policy.networkOff('contacts') || request.method !== 'POST' || request.headers.has('origin')) return new Response('forbidden', { status: 403 });
  const guest = request.headers.get('x-boite-peer') ?? '';
  if (!/^[0-9a-f]{64}$/.test(guest)) return new Response('x-boite-peer: expected a core id', { status: 403 });
  if (request.headers.get('x-boite-signature') !== SEALED) return new Response('contacts exchange sealed requests only', { status: 400 });
  let opened: { plaintext: string } & Sealing;
  let body: { nonce?: unknown; at?: unknown; token?: unknown; card?: unknown };
  let signature: string;
  let raw: string;
  try {
    opened = core.group.unseal(await boundedBody(request.body, JOIN_BODY_MAX), guest);
    ({ body: raw, signature } = unpack(opened.plaintext));
    body = JSON.parse(raw) as typeof body;
  } catch {
    return new Response('invalid join request', { status: 403 });
  }
  const nonce = typeof body.nonce === 'string' && body.nonce.length <= 100 ? body.nonce : '';
  const answer = (reply: { card?: ContactCard; error?: string; now?: number }, status: number): Response => {
    const signed = JSON.stringify({ nonce, ...reply });
    const signatureOut = core.coordination.signature(Buffer.from(`${JOINED_INPUT}${signed}`)).toString('base64');
    return new Response(sealResponse(pack(signed, signatureOut), opened.responseKey, opened.context), {
      status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-boite-signature': SEALED },
    });
  };
  try {
    core.policy.assert(core.policy.networkOff('contacts'), 'network.contacts');
    const card = checkCard(body.card, 'card');
    if (card.coreId !== guest) throw invalidParams('card.coreId: expected the core named by x-boite-peer');
    // A live invitation first: a caller without one leaves no nonce behind.
    const hash = typeof body.token === 'string' && /^[0-9a-f]{64}$/.test(body.token) ? tokenHash(body.token) : '';
    if (!store.liveInvites().some(([live]) => live === hash)) throw refused('token: this invitation was already used, cancelled or expired; ask for a new one');
    if (!verify(null, Buffer.from(`${JOIN_INPUT}${raw}`), card.publicKey, Buffer.from(signature, 'base64'))) throw invalidParams('signature: expected the card\'s key to sign the join');
    store.fresh(guest, nonce, body.at);
    // Spent before anything else changes: a second join with the same link finds nothing.
    if (!store.spendInvite(hash)) throw refused('token: this invitation was already used, cancelled or expired; ask for a new one');
    if (card.coreId === core.coordination.card().coreId) throw refused('card: this is the inviting core itself');
    const existing = store.find(card.coreId);
    if (existing?.role === 'host') throw refused('card: already a contact of this core');
    // Contacts are trusted peers too: only another kind of peer is one of this owner's machines.
    if (!existing && core.coordination.trusted().some(peer => peer.coreId === card.coreId)) throw refused('card: that core is already one of this owner\'s machines');
    if (existing) {
      // This core joined the guest's own invitation meanwhile: one relationship stays.
      store.reciprocal(card.coreId, existing.url);
    } else {
      // Outgoing joins in flight hold their slots: this guest cannot take one of them.
      if (store.occupied(card.coreId) >= store.maxContacts) throw refused(`this core has ${store.maxContacts} contacts already`);
      store.store(card, 'host');
    }
    store.arm();
    store.relisten();
    return answer({ card: store.card() }, 200);
  } catch (error) {
    // `now`: a join its sender signed, dated by another clock, hears this core's time (`peer-clock.ts`).
    const clock = error instanceof RpcFailure ? (error.data as { clock?: unknown } | undefined)?.clock : undefined;
    return answer({ error: error instanceof RpcFailure ? error.message : 'the join could not be processed', ...(typeof clock === 'number' ? { now: clock } : {}) }, 403);
  }
}
