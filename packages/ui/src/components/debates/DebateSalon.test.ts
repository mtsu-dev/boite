import { afterEach, expect, test, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import type { Message } from '@boite/contracts';
import { setExperiment } from '../../lib/experiments';
import { FakeClient } from '../../lib/fake-client';
import { Store } from '../../lib/store.svelte';
import { workspace } from '../../lib/workspace.svelte';
import AssistantMessage from '../AssistantMessage.svelte';
import DebateSalon from './DebateSalon.svelte';

const mounted: ReturnType<typeof mount>[] = [];
const closers: (() => void)[] = [];
const previousActive = workspace.active;

afterEach(async () => {
  for (const component of mounted.splice(0)) await unmount(component);
  for (const close of closers.splice(0)) close();
  workspace.machines = []; workspace.active = previousActive;
  setExperiment('debates', false);
  vi.restoreAllMocks(); document.body.innerHTML = ''; localStorage.clear();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 12; i++) { await tick(); await Promise.resolve(); }
  flushSync();
}

function query<T extends Element = HTMLElement>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`no ${selector}`);
  return node;
}

const all = (selector: string) => [...document.querySelectorAll<HTMLElement>(selector)];
const text = (selector: string) => query<HTMLElement>(selector).textContent?.replace(/\s+/g, ' ').trim() ?? '';

/**
 * The demo thread that started two debates (`?fake=1&debates=1`): one done with
 * its votes and summary, one in round 2 of 3 with GPT-6 Astra still writing.
 * `on` is the AI debates experiment, in the app and on the core alike.
 */
async function demo(on = true) {
  setExperiment('debates', on);
  const client = new FakeClient({ delayMs: 0, debatesDemo: true });
  const store = new Store();
  store.attach(client);
  closers.push(() => { store.detach(); client.close(); });
  await store.connect();
  if (on) client.reportDesktopExperiments(['debates']);
  workspace.machines = [{ id: 'local', label: 'Local', store }]; workspace.active = store;
  await store.open('t-debate');
  await vi.waitFor(() => expect(store.openThread?.messages.length).toBeGreaterThan(2));
  return { client, store };
}

/** The thread's message holding a debate's card, drawn as the timeline draws it. */
function card(store: Store, messageId: string) {
  const message = store.openThread!.messages.find(entry => entry.id === messageId) as Message;
  mounted.push(mount(AssistantMessage, { target: document.body, props: { store, threadId: message.threadId, message, signedOut: null, showModel: false } }));
}

function salon(store: Store, debateId: string) {
  mounted.push(mount(DebateSalon, { target: document.body, props: { store, debateId, threadId: 't-debate' } }));
}

function type(value: string) {
  const field = query<HTMLTextAreaElement>('[data-testid=debate-input]');
  field.focus();
  field.value = value;
  field.setSelectionRange(value.length, value.length);
  field.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

function press(key: string) {
  query('[data-testid=debate-input]').dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  flushSync();
}

test('the card says where each debate stands, shows the summary once it is back, and opens the salon in the panel', async () => {
  const { store } = await demo();
  card(store, 'm-debate-2');
  card(store, 'm-debate-3');
  await vi.waitFor(() => expect(all('[data-testid=debate-card-status]')).toHaveLength(2));

  const live = '[data-testid=debate-card][data-debate-id=dbt_demo_live]';
  const done = '[data-testid=debate-card][data-debate-id=dbt_demo_done]';
  expect(text(`${live} [data-testid=debate-card-title]`)).toBe('Debate · How should the phone get the debate posts: push or pull?');
  expect(text(`${live} [data-testid=debate-card-status]`)).toBe('Round 2 of 3');
  expect(query(`${live} [data-testid=debate-card-status]`).classList.contains('live')).toBe(true);
  expect(text(live)).toContain('3 AIs and you');
  // Three debaters and the owner, two by two.
  expect(document.querySelectorAll(`${live} .faces > *`)).toHaveLength(4);
  expect(document.querySelector(`${live} [data-testid=debate-card-summary]`)).toBeNull();

  expect(text(`${done} [data-testid=debate-card-status]`)).toBe('Done · summary ready');
  expect(text(`${done} [data-testid=debate-card-summary]`)).toContain('Summary by Opus 5.5, back in the thread');
  expect(text(`${done} [data-testid=debate-card-summary]`)).toContain('SQLite next to the journal');

  expect(store.panel.isOpen).toBe(false);
  query<HTMLButtonElement>(`${live} [data-testid=debate-card-open]`).click();
  flushSync();
  expect(store.panel.isOpen).toBe(true);
  expect(store.panel.active).toMatchObject({ kind: 'debate', debateId: 'dbt_demo_live' });
  // The other card moves the same tab to its debate.
  query<HTMLButtonElement>(`${done} [data-testid=debate-card-open]`).click();
  flushSync();
  expect(store.panel.surfaces.filter(surface => surface.kind === 'debate')).toHaveLength(1);
  expect(store.panel.active).toMatchObject({ kind: 'debate', debateId: 'dbt_demo_done' });
});

test('with the experiment off, the thread draws no card and the salon says how to turn debates on', async () => {
  const { store } = await demo(false);
  card(store, 'm-debate-3');
  salon(store, 'dbt_demo_live');
  await settle();
  expect(document.body.textContent).toContain('A second debate is under way');
  expect(document.querySelector('[data-testid=debate-card]')).toBeNull();
  expect(query('[data-testid=debate-unavailable]').textContent).toContain('Settings, Experiments');
  expect(document.querySelector('[data-testid=debate-composer]')).toBeNull();
});

test('the app with the experiment on, before the core has it, still draws no salon', async () => {
  setExperiment('debates', true);
  const client = new FakeClient({ delayMs: 0, debatesDemo: true });
  const store = new Store();
  store.attach(client);
  closers.push(() => { store.detach(); client.close(); });
  await store.connect();
  client.reportDesktopExperiments([]);
  salon(store, 'dbt_demo_live');
  await vi.waitFor(() => expect(document.querySelector('[data-testid=debate-unavailable]')).not.toBeNull());
  // Turned on afterwards, the salon reads the debate without being reopened.
  client.reportDesktopExperiments(['debates']);
  await vi.waitFor(() => expect(all('[data-testid=debate-member]')).toHaveLength(3));
});

test('the salon shows who debates with their angle, the summarizer apart, the owner, and the posts round by round', async () => {
  const { store } = await demo();
  salon(store, 'dbt_demo_live');
  await vi.waitFor(() => expect(all('[data-testid=debate-member]')).toHaveLength(3));

  expect(text('[data-testid=debate-round]')).toBe('Round 2 / 3');
  expect(text('[data-testid=debate-anonymous]')).toBe('Anonymous opinions for the AIs');
  expect(all('[data-testid=debate-angle]').map(node => node.textContent)).toEqual(['Battery first', 'Latency first', 'Simplicity first']);
  expect(text('[data-testid=debate-summarizer] .member-name')).toBe('Summary: Opus 5.5 (not in the debate)');
  expect(text('[data-testid=debate-you] .member-name')).toBe('You');
  expect(document.querySelectorAll('[data-testid=debate-rounds] i.on')).toHaveLength(2);

  expect(all('[data-testid=debate-divider]').map(node => node.textContent?.trim())).toEqual([
    'Round 1 · each proposes without reading the others',
    'Round 2 · they answer each other',
  ]);
  const owner = query('[data-testid=debate-post][data-author=owner]');
  expect(owner.dataset.to).toBe('p3');
  expect(owner.querySelector('[data-testid=debate-post-to]')?.textContent).toBe('To Gemini 4 Pro only');
  expect(owner.querySelector('.mention')?.textContent).toBe('@Gemini');
  expect(text('[data-testid=debate-status-line]')).toBe('GPT-6 Astra is writing…');
  expect(document.querySelector('[data-testid=debate-verdict]')).toBeNull();
});

test('a finished salon shows the votes and the summary, and takes no more messages', async () => {
  const { store } = await demo();
  salon(store, 'dbt_demo_done');
  await vi.waitFor(() => expect(document.querySelector('[data-testid=debate-verdict]')).not.toBeNull());
  expect(all('[data-testid=debate-divider]').at(-1)?.textContent?.trim()).toBe('Round 3 · each votes');
  expect(all('[data-testid=debate-post-vote]')).toHaveLength(3);
  expect([...document.querySelectorAll<HTMLTableRowElement>('[data-testid=debate-tally-row]')].map(row => [...row.cells].map(cell => cell.textContent))).toEqual([['SQLite next to the journal', '3 / 3']]);
  expect(text('[data-testid=debate-verdict]')).toContain('Disagreement: GPT-6 Astra would still cap it at 200 MB');
  expect(document.querySelectorAll('[data-testid=debate-rounds] i.on')).toHaveLength(3);
  expect(text('[data-testid=debate-closed]')).toBe('The debate is over: the salon takes no more messages.');
  for (const control of ['debate-composer', 'debate-next', 'debate-conclude', 'debate-stop']) expect(document.querySelector(`[data-testid=${control}]`)).toBeNull();
});

test('@ lists the debaters, Enter picks one, and the message goes to that debater alone', async () => {
  const { client, store } = await demo();
  salon(store, 'dbt_demo_live');
  await vi.waitFor(() => expect(document.querySelector('[data-testid=debate-composer]')).not.toBeNull());

  type('@G');
  expect(all('[data-testid=mention-row]').map(row => row.textContent)).toEqual([
    expect.stringContaining('GPT-6 Astra'),
    expect.stringContaining('Gemini 4 Pro'),
  ]);
  type('@Ge');
  const rows = all('[data-testid=mention-row]');
  expect(rows).toHaveLength(1);
  expect(rows[0]!.textContent).toContain('Simplicity first');
  press('Enter');
  const field = query<HTMLTextAreaElement>('[data-testid=debate-input]');
  expect(field.value).toBe('@Gemini ');
  expect(all('[data-testid=mention-row]')).toHaveLength(0);

  type('@Gemini is an hour of sleep a real case?');
  expect(text('[data-testid=debate-reads]')).toBe('Only Gemini 4 Pro reads it, next round.');
  type('Is an hour of sleep a real case?');
  expect(text('[data-testid=debate-reads]')).toBe('Every AI reads it next round.');
  // Escape closes the list and leaves the text as typed.
  type('@So');
  expect(all('[data-testid=mention-row]')).toHaveLength(1);
  press('Escape');
  expect(document.querySelector('[data-testid=mention-menu]:not(.closing)')).toBeNull();
  expect(field.value).toBe('@So');

  type('@Gemini is an hour of sleep a real case?');
  const sent = vi.spyOn(client, 'call');
  query<HTMLButtonElement>('[data-testid=debate-send]').click();
  await vi.waitFor(() => expect(field.value).toBe(''));
  expect(sent).toHaveBeenCalledWith('debates.post', expect.objectContaining({ debateId: 'dbt_demo_live', text: '@Gemini is an hour of sleep a real case?', id: expect.any(String) }));
  await vi.waitFor(() => expect(all('[data-testid=debate-post][data-author=owner]')).toHaveLength(2));
  const mine = all('[data-testid=debate-post][data-author=owner]').at(-1)!;
  expect(mine.dataset.to).toBe('p3');
  expect(mine.dataset.round).toBe('3');
});

test('Conclude waits for the round, and Next round then closes it and goes to the summary', async () => {
  const { client, store } = await demo();
  salon(store, 'dbt_demo_live');
  await vi.waitFor(() => expect(document.querySelector('[data-testid=debate-next]')).not.toBeNull());
  const calls = vi.spyOn(client, 'call');

  query<HTMLButtonElement>('[data-testid=debate-conclude]').click();
  await vi.waitFor(() => expect(query<HTMLButtonElement>('[data-testid=debate-conclude]').disabled).toBe(true));
  expect(calls).toHaveBeenCalledWith('debates.conclude', { debateId: 'dbt_demo_live' });
  expect(text('[data-testid=debate-status-line]')).toBe('GPT-6 Astra is writing… The summary follows this round.');

  query<HTMLButtonElement>('[data-testid=debate-next]').click();
  expect(calls).toHaveBeenCalledWith('debates.next', { debateId: 'dbt_demo_live' });
  await vi.waitFor(() => expect(query('[data-testid=debate-salon]').dataset.status).not.toBe('running'));
  // Round 2 had two answers: a concluding debate goes to its summary instead of round 3.
  expect(['summarizing', 'done']).toContain(query('[data-testid=debate-salon]').dataset.status);
  expect(document.querySelector('[data-testid=debate-composer]')).toBeNull();
});

test('Stop ends a running debate and closes the composer', async () => {
  const { client, store } = await demo();
  salon(store, 'dbt_demo_live');
  await vi.waitFor(() => expect(document.querySelector('[data-testid=debate-stop]')).not.toBeNull());
  const calls = vi.spyOn(client, 'call');
  query<HTMLButtonElement>('[data-testid=debate-stop]').click();
  await vi.waitFor(() => expect(query('[data-testid=debate-salon]').dataset.status).toBe('stopped'));
  expect(calls).toHaveBeenCalledWith('debates.stop', { debateId: 'dbt_demo_live' });
  expect(text('[data-testid=debate-status-line]')).toBe('Stopped by the user.');
  expect(text('[data-testid=debate-closed]')).toBe('The debate is over: the salon takes no more messages.');
  expect(document.querySelector('[data-testid=debate-stop]')).toBeNull();
});
