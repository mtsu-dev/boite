import { afterEach, expect, vi } from 'vitest';
import { test } from '../test/fake-client';
import { flushSync, mount, unmount } from 'svelte';
import type { AgentLetter, ContactRequest } from '@boite/contracts';
import ContactAskRow from './ContactAskRow.svelte';
import { contactAsksFor, type ContactAsk } from '../lib/contact-asks';
import { agentMailFor, type AgentMail } from '../lib/agent-mail';
import type { Store } from '../lib/store.svelte';

/*
 * A contact request in the timeline: the asking thread reads who has it and
 * where it stands, with the contact's chip once one is named; the Contacts
 * bot's thread reads what it forwarded and settled. One tap opens the answer
 * or unfolds the request, so a phone reaches all of it.
 */

let running: Record<string, unknown> | null = null;
afterEach(() => {
  if (running) unmount(running);
  running = null;
  document.body.innerHTML = '';
});

const self = { coreId: 'core-local', threadId: 't-trace' };
const from = { ...self, title: 'Trace the slow boot', machine: 'This PC', resources: '', status: 'idle' as const, mode: 'brief' as const, agent: 'claude claude-opus-5-5' };
const base = { direction: 'out' as const, from, text: 'Someone who knows how the website loads its descriptors', createdAt: 100, status: 'pending' as const };
const requests: Record<string, ContactRequest> = {
  host: { ...base, id: 'r-host', coreId: '', contact: '', stage: 'host' },
  bot: { ...base, id: 'r-bot', coreId: '', contact: '', stage: 'bot' },
  sent: { ...base, id: 'r-sent', coreId: 'core-chris', contact: 'Chris', forwardedAt: 120 },
  answered: { ...base, id: 'r-answered', coreId: 'core-chris', contact: 'Chris', status: 'accepted', decidedBy: 'bot', decidedAt: 140,
    relation: { id: 'rel', coreId: 'core-chris', contact: 'Chris', local: { threadId: 't-trace', title: 'Trace the slow boot' },
      remote: { ...from, coreId: 'core-chris', machine: 'chris-desktop', threadId: 'chris-loader', title: 'Harden the loader' }, requestId: 'r-answered', createdAt: 140 } },
  refused: { ...base, id: 'r-refused', coreId: 'core-chris', contact: 'Chris', status: 'refused', reason: 'Chris shares no repository', decidedBy: 'bot', decidedAt: 150 }
};

function view(store: Store, threadId: string, list: ContactRequest[], messages: AgentLetter[] = []): void {
  store.coordination = { self: { coreId: 'core-local', threadId }, config: { mode: 'brief', resources: '', remote: true, paused: false }, messages, sent: 0, sendLimit: null, wakes: 0, wakeLimit: null, requests: list };
}

function show(store: Store, ask: ContactAsk, mail: readonly AgentMail[] = []): HTMLButtonElement {
  running = mount(ContactAskRow, { target: document.body, props: { store, ask, mail } });
  flushSync();
  return document.querySelector<HTMLButtonElement>('[data-testid=contact-ask-row]')!;
}

const text = (row: Element, id: string) => row.querySelector(`[data-testid=${id}]`)?.textContent?.replace(/\s+/g, ' ').trim();

test('each state of an asked request reads who has it, with the contact chip once one is named', async ({ createStore }) => {
  const { store, client } = createStore({ delayMs: 0 });
  store.attach(client); await store.connect(); await store.open('t-trace');
  store.group = { id: 'g', name: 'Home', self: 'core-local', cores: [{ coreId: 'core-local', name: 'Laptop' }, { coreId: 'core-bots', name: 'Server' }], devices: [], botsHome: 'core-bots' } as never;
  view(store, 't-trace', Object.values(requests));
  const asks = contactAsksFor(store, 't-trace');
  expect(asks.map(ask => [ask.role, ask.state])).toEqual([['asked', 'host'], ['asked', 'bot'], ['asked', 'sent'], ['asked', 'answered'], ['asked', 'refused']]);
  const seen = asks.map((ask) => {
    const row = show(store, ask);
    const out = { state: row.dataset.state, title: text(row, 'contact-ask-title'), status: text(row, 'contact-ask-status'), chip: text(row, 'agent-remote-chip') ?? null };
    unmount(running!); running = null;
    return out;
  });
  expect(seen).toEqual([
    { state: 'host', title: 'Operator', status: 'Waiting for the Bots machine, Server', chip: null },
    { state: 'bot', title: 'Operator', status: 'With Operator', chip: null },
    { state: 'sent', title: 'Operator', status: 'Sent to Chris, waiting for its answer', chip: 'Chris' },
    { state: 'answered', title: 'Operator', status: 'Answered: write to Chris/chris-loader', chip: 'Chris' },
    { state: 'refused', title: 'Operator', status: 'Refused: Chris shares no repository', chip: 'Chris' }
  ]);
});

test('a tap opens the answer in the panel once it reached the thread, else unfolds the whole request', async ({ createStore }) => {
  const { store, client } = createStore({ delayMs: 0 });
  store.attach(client); await store.connect(); await store.open('t-trace');
  const answer: AgentLetter = { id: 'answer-letter', from: { coreId: 'core-chris', threadId: 'r-answered', title: 'Operator', machine: 'chris-desktop', resources: '', status: 'idle', mode: 'brief' },
    to: self, toTitle: 'Trace the slow boot', text: 'Write to chris/chris-loader', replyTo: null, createdAt: 141, expiresAt: 9_999, status: 'delivered', error: null, origin: 'contact', contact: { coreId: 'core-chris', name: 'Chris' } };
  view(store, 't-trace', [requests.answered!, requests.bot!], [answer]);
  const mail = agentMailFor(store, 't-trace');
  const [answered, waiting] = contactAsksFor(store, 't-trace');
  const opened = vi.spyOn(store.panel, 'openMessages');
  show(store, answered!, mail).click();
  expect(opened).toHaveBeenCalledWith(mail[0]!.peer, 'answer-letter');
  unmount(running!); running = null;

  const row = show(store, waiting!, mail);
  expect(row.getAttribute('aria-expanded')).toBe('false');
  expect(row.querySelector('[data-testid=contact-ask-more]')).toBeNull();
  row.click(); flushSync();
  expect(row.getAttribute('aria-expanded')).toBe('true');
  expect(text(row, 'contact-ask-more')).toContain('Request r-bot');
  expect(opened).toHaveBeenCalledTimes(1);
});

test('the Contacts bot thread shows what it forwarded and what it settled, under the asking thread\'s title', async ({ createStore }) => {
  const { store, client } = createStore({ delayMs: 0 });
  store.attach(client); await store.connect(); await store.open('t-trace');
  const settled: ContactRequest = { ...requests.answered!, direction: 'in', from: { ...from, coreId: 'core-chris', threadId: 'chris-asker', title: 'Fix the login redirect' } };
  view(store, 't-bot', [requests.sent!, settled]);
  const asks = contactAsksFor(store, 't-bot');
  expect(asks.map(ask => [ask.role, ask.at])).toEqual([['forwarded', 120], ['settled', 140]]);
  const forwarded = show(store, asks[0]!);
  expect([text(forwarded, 'contact-ask-kicker'), text(forwarded, 'contact-ask-title'), text(forwarded, 'agent-remote-chip')]).toEqual(['Forwarded', 'Trace the slow boot', 'Chris']);
  unmount(running!); running = null;
  const answered = show(store, asks[1]!);
  expect([text(answered, 'contact-ask-kicker'), text(answered, 'contact-ask-title'), text(answered, 'contact-ask-status')]).toEqual(['Answered', 'Fix the login redirect', 'Put in touch with Trace the slow boot']);
  unmount(running!); running = null;

  // A forward the contact answered keeps its row on the bot thread, with the address it gave.
  view(store, 't-bot', [{ ...requests.answered!, forwardedAt: 130 }]);
  const [done] = contactAsksFor(store, 't-bot');
  expect([done!.role, done!.state]).toEqual(['forwarded', 'answered']);
  expect(text(show(store, done!), 'contact-ask-status')).toBe('Answered: write to Chris/chris-loader');
});
