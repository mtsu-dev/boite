/*
 * What crosses between two cores, below any meaning: a bounded body, one
 * signed request to one address, and the reply once its signature holds.
 * `coordination.ts` decides who is asked and what the answer changes.
 */

import { verify } from 'node:crypto';
import { invalidParams } from './errors.ts';
import { openResponse, SEALED, unpack, type Sealing } from './group/seal.ts';

/** What one core asks another. */
export type Operation = 'directory' | 'deliver' | 'receipt' | 'search' | 'read' | 'group.sync' | 'group.push' | 'contact.sync' | 'contact.ask' | 'contact.answer' | 'contact.relation' | 'contact.project' | 'contact.route'
  /** `contact.hand`: between members, a contact's link handed to the group's Bots host; `contact.move`: the old member tells the contact (`contacts/group-link.ts`). */
  | 'contact.hand' | 'contact.move'
  /** Between members of a group, for a contact one of them is linked to (`contacts/members.ts`). */
  | 'relay.project' | 'relay.mirror' | 'relay.in' | 'relay.out'
  /** Between members of a group: a thread one starts on another, the models it can run on there, and the setting that lets it (`threads/group-spawn.ts`); a folder of the other machine one adds as a project there, under the same setting. */
  | 'thread.start' | 'project.add' | 'delegation.catalog' | 'delegation.start' | 'delegation.report' | 'delegation.letter' | 'delegation.read' | 'delegation.stop' | 'setting.read' | 'setting.changed'
  /** Between members of a group: a bot of one looks after projects of another, which hears it while its `groupBots` is on (`agents/group-host.ts`). */
  | BotOperation
  /** Between members of a group: the machine that holds a team and the machines of its members (`teams/peers.ts`). */
  | TeamOperation;
/**
 * The machine holding a team asks who a bot is (`team.bot`) and sends its
 * state and posts (`team.sync`); a member's machine posts, reads, reports and
 * asks for the owner (`team.post`, `team.read`, `team.report`, `team.moved`, `team.owner`).
 */
export const TEAM_OPERATIONS = ['team.bot', 'team.sync', 'team.post', 'team.read', 'team.report', 'team.moved', 'team.owner'] as const;
export type TeamOperation = (typeof TEAM_OPERATIONS)[number];
/**
 * What a bot's core asks the machine whose projects it looks after, and the
 * events that machine sends back; `bot.move` hands a whole bot to another
 * member (`agents/move.ts`), whatever its `groupBots`.
 */
export const BOT_OPERATIONS = ['bot.lease', 'bot.threads', 'bot.thread', 'bot.act', 'bot.answer', 'bot.send', 'bot.start', 'bot.event', 'bot.move'] as const;
export type BotOperation = (typeof BOT_OPERATIONS)[number];
/** A request as signed: who asks whom, when, once, for what. */
export type Envelope = { from: string; to: string; at: number; nonce: string; operation: Operation; payload: unknown };
export const MAX_BODY = 262_144;
/**
 * The most an answer to this core's own request may carry, sealed. A request
 * a stranger can send stays under `MAX_BODY`; an answer comes only from an
 * address this core chose to ask, and some are lists the asker cannot page:
 * a `delegation.catalog` behind Douane routes measured 286 964 bytes of JSON
 * for 1 220 models, 382 798 once sealed (2026-11-04).
 */
export const MAX_ANSWER = 4 * 1024 * 1024;
export const ROUTE = '/agent-messages';

/** The peer signed a refusal: asking again would get the same one. */
export class PeerRefusal extends Error {}
/** The peer answered, signed, that it removed this core from its group. */
export class PeerGone extends Error {}

/**
 * A reply whose signature held: an answer, a refusal the peer signed, or its
 * word, signed and sealed to this exchange, that this core was removed from
 * its group. `url` is the address that answered, null when the owner's app
 * relayed.
 */
export type Answer = { url: string | null; result?: unknown; refusal?: string; gone?: true };

export async function boundedBody(body: ReadableStream<Uint8Array> | null, max = MAX_BODY): Promise<string> {
  if (!body) throw invalidParams('message body required');
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('peer body timed out')), 5000); });
  try {
    while (true) {
      const chunk = await Promise.race([reader.read(), timeout]);
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > max) throw invalidParams(`message body exceeds ${max} bytes`);
      chunks.push(chunk.value);
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally { clearTimeout(timer); await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

/**
 * A reply counts only once the peer's signature on it holds and it answers
 * this request. A request that left sealed takes a sealed answer: one that
 * comes back readable was not made by the machine the request was sealed to.
 */
export function settle(url: string | null, publicKey: string, nonce: string, status: number, raw: string, signature: string, sealing: Sealing | null = null): Answer {
  if (sealing === null && !signature && status === 403) throw new Error('destination refused this core; reconnect the agent link in Machines');
  if (sealing !== null) {
    if (signature !== SEALED) throw new Error(unsealed(url, status, raw));
    ({ body: raw, signature } = unpack(openResponse(raw, sealing.responseKey, sealing.context)));
  }
  if (!verify(null, Buffer.from(raw), publicKey, Buffer.from(signature, 'base64'))) throw new Error('invalid peer response signature');
  const reply = JSON.parse(raw) as { nonce: string; result?: unknown; error?: string; gone?: boolean };
  if (reply.nonce !== nonce) throw new Error('peer response nonce mismatch');
  // "You were removed" is read off the signed body of a sealed answer, never off the
  // status line, which anyone on the path can rewrite, and never off an answer that
  // was not sealed to this very request, which could be one made for another machine.
  if (sealing !== null && reply.gone === true) return { url, gone: true };
  if (reply.error && status === 400) return { url, refusal: reply.error };
  if (status < 200 || status >= 300) throw new Error('peer request failed');
  return { url, result: reply.result };
}

/**
 * What a readable answer to a sealed request says. The peer seals every answer
 * it signs, so one left readable came from whatever stood in its place: a
 * proxy, a server now on that address, or the owner app's relay saying why it
 * could not carry the request. Its status and first words are that reason.
 */
function unsealed(url: string | null, status: number, raw: string): string {
  const from = url ?? 'the owner app relay';
  const said = raw.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 200);
  if (status >= 200 && status < 300) return `${from} answered HTTP ${status} unsealed to a sealed request, so not as the machine it was sealed to`;
  return `${from} answered HTTP ${status}${said ? `: ${said}` : ''}`;
}

/** How long the address that answered last is asked alone before the others are tried. */
export const HEAD_START_MS = 1000;

/**
 * The addresses of a member may all lead to the same core, and asking them all
 * at once would have it do everything several times over. So the first
 * address, the one that answered last, is asked alone. The others are asked
 * once it failed, or has stayed silent for a moment, each with a request of
 * its own, and whichever answers first counts.
 */
export async function firstAnswer<T>(routes: readonly string[], send: (url: string) => Promise<T>, headStartMs = HEAD_START_MS): Promise<T> {
  const first = send(routes[0]!);
  if (routes.length === 1) return first;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const early = await Promise.race([
    first.then((value) => ({ value }), () => null),
    new Promise<undefined>((resolve) => { timer = setTimeout(() => resolve(undefined), headStartMs); }),
  ]);
  clearTimeout(timer);
  if (early) return early.value;
  return Promise.any([...(early === null ? [] : [first]), ...routes.slice(1).map(send)]);
}

/** One signed request to one address of a peer, sealed when `sealing` says the body is. */
export async function post(url: string, from: string, publicKey: string, body: string, signature: string, nonce: string, sealing: Sealing | null = null): Promise<Answer> {
  const response = await fetch(`${url}${ROUTE}`, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
    headers: { 'content-type': 'application/json', 'x-boite-peer': from, 'x-boite-signature': signature },
    body,
  });
  return settle(url, publicKey, nonce, response.status, await boundedBody(response.body, MAX_ANSWER), response.headers.get('x-boite-signature') ?? '', sealing);
}
