import type { AgentProfile, ContactRequest, Message } from '@boite/contracts';
import { discussionKey, type AgentMail } from './agent-mail';
import type { Store } from './store.svelte';

/**
 * A thread's contact requests as its timeline shows them
 * (`CoordinationView.requests`): what it asked the Contacts bot, and on the
 * bot's own thread what it forwarded to a contact and what it settled for one.
 */
export type AskRole = 'asked' | 'forwarded' | 'settled';
/**
 * Where a request stands: kept on this member for the group's Bots machine
 * (`host`), with the Contacts bot (`bot`), waiting for the owner's card
 * (`owner`), sent on to the contact (`sent`), then `answered` or `refused`.
 */
export type AskState = 'host' | 'bot' | 'owner' | 'sent' | 'answered' | 'refused';
export interface ContactAsk {
  /** The timeline row's id, `contact-request:<direction>:<id>`. */
  id: string;
  request: ContactRequest;
  role: AskRole;
  /** Where the row sits: the ask, the forward or the settlement. */
  at: number;
  state: AskState;
}

const PREFIX = 'contact-request:';
export const isAskRow = (id: string): boolean => id.startsWith(PREFIX);

export function askState(request: ContactRequest): AskState {
  if (request.status === 'accepted') return 'answered';
  if (request.status === 'refused') return 'refused';
  return request.stage ?? 'sent';
}

export function contactAsksFor(store: Pick<Store, 'coordination'>, threadId: string): ContactAsk[] {
  const view = store.coordination?.self.threadId === threadId ? store.coordination : null;
  if (!view?.requests?.length) return [];
  return view.requests.map((request): ContactAsk => {
    const own = request.direction === 'out' && request.from.coreId === view.self.coreId && request.from.threadId === threadId;
    const role: AskRole = own ? 'asked' : request.direction === 'out' ? 'forwarded' : 'settled';
    const at = role === 'asked' ? request.createdAt : role === 'forwarded' ? request.forwardedAt ?? request.createdAt : request.decidedAt ?? request.createdAt;
    return { id: `${PREFIX}${request.direction}:${request.id}`, request, role, at, state: askState(request) };
  });
}

/**
 * The rows a timeline shows among `messages`: a held page shows the requests
 * of its span only, the rest wait for their own page.
 */
export function contactAsksIn(store: Pick<Store, 'coordination' | 'openThread'>, threadId: string, messages: readonly Message[]): ContactAsk[] {
  const open = store.openThread?.id === threadId ? store.openThread : null;
  const from = (open?.messagesBefore ?? null) !== null ? messages[0]?.createdAt ?? -Infinity : -Infinity;
  const to = (open?.messagesAfter ?? null) !== null ? messages.at(-1)?.createdAt ?? Infinity : Infinity;
  return contactAsksFor(store, threadId).filter(ask => ask.at >= from && ask.at <= to);
}

/** How an agent writes the thread an answer put it in touch with: `<contact>/<thread-id>`. */
export function askAddress(request: ContactRequest): string | null {
  const remote = request.relation?.remote;
  return remote && request.contact ? `${request.contact.replace(/\s+/g, '-')}/${remote.threadId}` : null;
}

/**
 * The discussion a row opens in the panel: with the thread the answer put it
 * in touch with once they wrote, else the answer's own letter. None while the
 * request waits, or when no letter of it reached this thread.
 */
export function askDiscussion(ask: ContactAsk, mail: readonly AgentMail[]): { peer: string; letterId: string } | null {
  if (ask.role !== 'asked') return null;
  const request = ask.request;
  const remote = request.relation?.remote;
  const self = mail[0]?.self.coreId;
  const touched = remote && mail.find(entry => entry.peer === discussionKey(remote, self ? [self] : []));
  if (touched) return { peer: touched.peer, letterId: touched.letter.id };
  const answer = mail.find(entry => entry.direction === 'incoming' && entry.letter.origin === 'contact' && entry.letter.from.threadId === request.id);
  return answer ? { peer: answer.peer, letterId: answer.letter.id } : null;
}

export type BotFace = { name: string; agent?: Pick<AgentProfile, 'id' | 'name' | 'avatar'> };

/**
 * The Contacts bot as a row draws it: on the thread's machine, else on the
 * group's Bots machine while this window reaches it. `fallback` names it when
 * neither is known, a member whose bot is out of reach included.
 */
export function contactsBotFace(profiles: readonly (readonly AgentProfile[] | undefined)[], fallback: string): BotFace {
  for (const list of profiles) {
    const bot = list?.find(profile => profile.builtin === 'contacts');
    if (bot) return { name: bot.name || fallback, agent: { id: bot.id, name: bot.name || fallback, avatar: bot.avatar } };
  }
  return { name: fallback };
}
