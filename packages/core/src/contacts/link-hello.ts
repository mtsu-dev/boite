/** Validate the contact-only WebSocket upgrade before accepting a socket. */
import { randomUUID, verify } from 'node:crypto';
import type { Core } from '../core.ts';
import { refused, RpcFailure } from '../errors.ts';
import type { ContactStore } from './store.ts';
import { TextSocket } from '../ws-client.ts';
import { checkTailnetName } from './invite.ts';

/** What the server keeps on a contact's link socket; `proof`: the host's signature over the hello, its first frame. */
export interface ContactSocketData { contact: { coreId: string; routeId: string; proof?: string } }

export const CONTACT_LINK_ROUTE = '/coordination/contact/link';
export const HELLO_INPUT = 'boite-contact-hello\n';
/** What the dialed core signs back for a dial that asks it to prove its key (`x-boite-probe: 1`). */
export const PROOF_INPUT = 'boite-contact-proof\n';
/** How long the upgrade to a host may take before the link counts as failed. */
const LINK_DIAL_MS = 8000;

/** DNS can yield while an administrator disables contacts; admit the dial afterwards. */
export async function dialContact(core: Core, url: string, headers: Record<string, string>): Promise<TextSocket> {
  await checkTailnetName(url, 'contact.url');
  core.policy.assert(core.policy.networkOff('contacts'), 'network.contacts');
  return TextSocket.connect(`${url.replace(/^http/, 'ws')}${CONTACT_LINK_ROUTE}`, LINK_DIAL_MS, { headers });
}

function proofFrame(text: string): { t?: unknown; signature?: unknown } | null {
  try { return JSON.parse(text) as { t?: unknown; signature?: unknown } | null; } catch { return null; }
}

/**
 * A dial that only counts once the core holding `publicKey` answered: its
 * first frame signs this dial's hello back. An origin that merely takes the
 * upgrade never sends it, and is closed after `ms`.
 */
export async function dialProven(core: Core, url: string, headers: Record<string, string>, publicKey: string, ms: number): Promise<TextSocket> {
  const socket = await dialContact(core, url, { ...headers, 'x-boite-probe': '1' });
  const signed = Buffer.concat([Buffer.from(PROOF_INPUT), Buffer.from(headers['x-boite-hello'] ?? '', 'base64url')]);
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

export function contactHello(core: Core, store: ContactStore, request: Request): ContactSocketData['contact'] | Response {
    if (store.isClosed || core.policy.networkOff('contacts') || request.headers.has('origin')) return new Response('forbidden', { status: 403 });
    const guest = request.headers.get('x-boite-peer') ?? '';
    // A contact another machine of the group handed to this one is checked against the handed record, then kept, and a
    // Bots host a move gave this core's guest seat against the key that signed the move (`group-link.ts`).
    const contact = store.find(guest) ?? store.groupLink.incoming(guest) ?? store.groupLink.seat(guest);
    if (!contact || contact.role !== 'host') return new Response('not a contact that dials this core', { status: 403 });
    try {
      const hello = Buffer.from(request.headers.get('x-boite-hello') ?? '', 'base64url').toString('utf8');
      const signature = request.headers.get('x-boite-signature') ?? '';
      if (!hello || !verify(null, Buffer.from(`${HELLO_INPUT}${hello}`), contact.publicKey, Buffer.from(signature, 'base64'))) throw refused('signature: expected the contact\'s key to sign the hello');
      const parsed = JSON.parse(hello) as { v?: unknown; from?: unknown; to?: unknown; at?: unknown; nonce?: unknown };
      if (parsed.v !== 1 || parsed.from !== guest || parsed.to !== core.coordination.card().coreId) throw refused('hello: expected v 1, from the dialling contact, to this core');
      store.fresh(guest, typeof parsed.nonce === 'string' && parsed.nonce.length <= 100 ? parsed.nonce : '', parsed.at);
    } catch (error) {
      return new Response(error instanceof RpcFailure ? error.message : 'invalid hello', { status: 403 });
    }
    if (!store.has(guest)) store.groupLink.commit(guest);
    if (!store.has(guest)) store.groupLink.seated(guest);
    // A move's probe asks this core to prove it holds its key: the hello signed back, sent once the socket opens (`attach`).
    const probe = request.headers.get('x-boite-probe') === '1';
    const proof = probe ? core.coordination.signature(Buffer.concat([Buffer.from(PROOF_INPUT), Buffer.from(request.headers.get('x-boite-hello') ?? '', 'base64url')])).toString('base64') : undefined;
    return { coreId: guest, routeId: `contact:${randomUUID()}`, ...(proof ? { proof } : {}) };
}
