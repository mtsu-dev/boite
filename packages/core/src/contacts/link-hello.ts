/** Validate the contact-only WebSocket upgrade before accepting a socket. */
import { randomUUID, verify } from 'node:crypto';
import type { Core } from '../core.ts';
import { refused, RpcFailure } from '../errors.ts';
import type { ContactStore } from './store.ts';
import { TextSocket, UpgradeError } from '../ws-client.ts';
import { checkTailnetName } from './invite.ts';
import { nameNotFound, publishedAddress } from './public-dns.ts';

/** What the server keeps on a contact's link socket; `proof`: the host's signature over the hello, its first frame. */
export interface ContactSocketData { contact: { coreId: string; routeId: string; proof?: string } }

export const CONTACT_LINK_ROUTE = '/coordination/contact/link';
export const HELLO_INPUT = 'boite-contact-hello\n';
/** What the dialed core signs back for a dial that asks it to prove its key (`x-boite-probe: 1`). */
export const PROOF_INPUT = 'boite-contact-proof\n';
/** What a core signs over the hello of a probe from a core it neither knows nor gave a seat (`x-boite-refusal`). */
export const REFUSAL_INPUT = 'boite-contact-refusal\n';

/** What a host signs, after a hello dated by another clock, over that hello and its own time (`x-boite-clock`, `x-boite-clock-proof`). */
export const CLOCK_INPUT = 'boite-contact-clock\n';

/**
 * The host's clock, read off its refusal of a hello dated wrong: its time
 * under its key, bound to this very hello. Null for any other refusal.
 */
export function helloClock(head: string | undefined, headers: Record<string, string>, publicKey: string): number | null {
  if (head === undefined || !/^HTTP\/1\.1 403\b/.test(head)) return null;
  const now = /^x-boite-clock:\s*(\d{1,16})\s*$/im.exec(head)?.[1];
  const proof = /^x-boite-clock-proof:\s*(\S+)/im.exec(head)?.[1];
  if (now === undefined || proof === undefined) return null;
  const hello = Buffer.from(headers['x-boite-hello'] ?? '', 'base64url').toString('utf8');
  try { return verify(null, Buffer.from(`${CLOCK_INPUT}${hello}\n${now}`), publicKey, Buffer.from(proof, 'base64')) ? Number(now) : null; }
  catch { return null; }
}

/**
 * `dial` with a hello from `hello`, and once more when the dialed core refused
 * its date and said its own time under `peer`'s key: the second is dated by it.
 */
export async function dialDated<T>(core: Core, peer: { coreId: string; publicKey: string }, hello: () => Record<string, string>, dial: (headers: Record<string, string>) => Promise<T>): Promise<T> {
  const headers = hello();
  try { return await dial(headers); }
  catch (error) {
    const clock = error instanceof UpgradeError ? helloClock(error.head, headers, peer.publicKey) : null;
    if (clock === null || !core.coordination.clocks.learn(peer.coreId, clock)) throw error;
    return dial(hello());
  }
}

/** The dialed core refused this hello with its own key: it does not know the dialer, as opposed to a policy, a proxy or an outage. */
export class ContactRefused extends Error {}
/** How long the upgrade to a host may take before the link counts as failed. */
const LINK_DIAL_MS = 8000;

/** DNS can yield while an administrator disables contacts; admit the dial afterwards. */
export async function dialContact(core: Core, url: string, headers: Record<string, string>): Promise<TextSocket> {
  await checkTailnetName(url, 'contact.url');
  core.policy.assert(core.policy.networkOff('contacts'), 'network.contacts');
  const target = `${url.replace(/^http/, 'ws')}${CONTACT_LINK_ROUTE}`;
  try { return await TextSocket.connect(target, LINK_DIAL_MS, { headers }); }
  catch (error) {
    // A resolver that still holds "no such name" from before Tailscale published the host's Funnel name.
    const address = nameNotFound(error) ? await publishedAddress(target) : null;
    if (address === null) throw error;
    core.policy.assert(core.policy.networkOff('contacts'), 'network.contacts');
    return TextSocket.connect(target, LINK_DIAL_MS, { headers, address });
  }
}

/** A JSON frame or hello, or `null` when it does not parse. */
function proofFrame(text: string): Record<string, unknown> | null {
  try { const value: unknown = JSON.parse(text); return value && typeof value === 'object' ? value as Record<string, unknown> : null; } catch { return null; }
}

/**
 * A dial that only counts once the core holding `publicKey` answered: its
 * first frame signs this dial's hello back. An origin that merely takes the
 * upgrade never sends it, and is closed after `ms`.
 */
export async function dialProven(core: Core, url: string, headers: Record<string, string>, publicKey: string, ms: number): Promise<TextSocket> {
  const hello = Buffer.from(headers['x-boite-hello'] ?? '', 'base64url');
  let socket: TextSocket;
  try { socket = await dialContact(core, url, { ...headers, 'x-boite-probe': '1' }); }
  catch (error) {
    const signature = error instanceof UpgradeError && /^HTTP\/1\.1 403\b/.test(error.head ?? '') ? /^x-boite-refusal:\s*(\S+)/im.exec(error.head!)?.[1] : undefined;
    if (signature && verify(null, Buffer.concat([Buffer.from(REFUSAL_INPUT), hello]), publicKey, Buffer.from(signature, 'base64'))) throw new ContactRefused(`${url} refused this core's hello with the contact's key`);
    throw error;
  }
  const signed = Buffer.concat([Buffer.from(PROOF_INPUT), hello]);
  return new Promise<TextSocket>((resolve, reject) => {
    const fail = (reason: string) => { clearTimeout(timer); socket.close(1008, 'no proof'); reject(new Error(`${url} ${reason}`)); };
    const timer = setTimeout(() => fail(`sent no proof of its key in ${ms} ms`), ms);
    socket.onClose(() => fail('closed before proving its key'));
    socket.onMessage(text => {
      const frame = proofFrame(text);
      if (frame?.t !== 'proof' || typeof frame.signature !== 'string' || !verify(null, signed, publicKey, Buffer.from(frame.signature, 'base64'))) { fail('answered without the expected key\'s proof'); return; }
      clearTimeout(timer);
      resolve(socket);
    });
  });
}

/**
 * A probe from a core this one does not know is refused under this core's
 * key, over that probe's own hello: the dialer may then drop a seat this core
 * never took, which a bare 403 (contacts off, a proxy) does not prove.
 */
function unknown(core: Core, request: Request, guest: string, stranger: boolean): Response {
  const body = 'not a contact that dials this core';
  const raw = request.headers.get('x-boite-hello') ?? '';
  if (!stranger || request.headers.get('x-boite-probe') !== '1' || raw.length > 4096) return new Response(body, { status: 403 });
  const parsed = proofFrame(Buffer.from(raw, 'base64url').toString('utf8')) as { v?: unknown; from?: unknown; to?: unknown } | null;
  if (parsed?.v !== 1 || !guest || parsed.from !== guest || parsed.to !== core.coordination.card().coreId) return new Response(body, { status: 403 });
  const signature = core.coordination.signature(Buffer.concat([Buffer.from(REFUSAL_INPUT), Buffer.from(raw, 'base64url')])).toString('base64');
  return new Response(body, { status: 403, headers: { 'x-boite-refusal': signature } });
}

export function contactHello(core: Core, store: ContactStore, request: Request): ContactSocketData['contact'] | Response {
    if (store.isClosed || core.policy.networkOff('contacts') || request.headers.has('origin')) return new Response('forbidden', { status: 403 });
    const guest = request.headers.get('x-boite-peer') ?? '';
    // A contact another machine of the group handed to this one is checked against the handed record, then kept, and a
    // Bots host a move gave this core's guest seat against the key that signed the move (`group-link.ts`).
    // A Bots host's resume (`x-boite-resume`) only finds a contact this core follows already, never a seat it still holds.
    const resume = request.headers.get('x-boite-resume') === '1';
    const contact = store.find(guest) ?? (resume ? undefined : store.groupLink.incoming(guest) ?? store.groupLink.seat(guest));
    if (!contact || contact.role !== 'host') return unknown(core, request, guest, contact === undefined);
    try {
      const hello = Buffer.from(request.headers.get('x-boite-hello') ?? '', 'base64url').toString('utf8');
      const signature = request.headers.get('x-boite-signature') ?? '';
      if (!hello || !verify(null, Buffer.from(`${HELLO_INPUT}${hello}`), contact.publicKey, Buffer.from(signature, 'base64'))) throw refused('signature: expected the contact\'s key to sign the hello');
      const parsed = JSON.parse(hello) as { v?: unknown; from?: unknown; to?: unknown; at?: unknown; nonce?: unknown };
      if (parsed.v !== 1 || parsed.from !== guest || parsed.to !== core.coordination.card().coreId) throw refused('hello: expected v 1, from the dialling contact, to this core');
      store.fresh(guest, typeof parsed.nonce === 'string' && parsed.nonce.length <= 100 ? parsed.nonce : '', parsed.at);
    } catch (error) {
      // A hello the contact signed, dated by another clock: it hears this core's, to date its next dial by (`peer-clock.ts`).
      const now = error instanceof RpcFailure ? (error.data as { clock?: unknown } | undefined)?.clock : undefined;
      const hello = Buffer.from(request.headers.get('x-boite-hello') ?? '', 'base64url').toString('utf8');
      const headers = typeof now === 'number'
        ? { 'x-boite-clock': String(now), 'x-boite-clock-proof': core.coordination.signature(Buffer.from(`${CLOCK_INPUT}${hello}\n${now}`)).toString('base64') }
        : undefined;
      return new Response(error instanceof RpcFailure ? error.message : 'invalid hello', { status: 403, ...(headers ? { headers } : {}) });
    }
    if (!store.has(guest)) store.groupLink.commit(guest);
    if (!store.has(guest)) store.groupLink.seated(guest);
    // A move's probe asks this core to prove it holds its key: the hello signed back, sent once the socket opens (`attach`).
    const probe = request.headers.get('x-boite-probe') === '1';
    const proof = probe ? core.coordination.signature(Buffer.concat([Buffer.from(PROOF_INPUT), Buffer.from(request.headers.get('x-boite-hello') ?? '', 'base64url')])).toString('base64') : undefined;
    return { coreId: guest, routeId: `contact:${randomUUID()}`, ...(proof ? { proof } : {}) };
}
