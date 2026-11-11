import { afterEach, expect, test, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import { COUNCIL_EXPERIMENT, type Message } from '@boite/contracts';
import { setExperiment } from '../../lib/experiments';
import { FakeClient } from '../../lib/fake-client';
import { Store } from '../../lib/store.svelte';
import { workspace } from '../../lib/workspace.svelte';
import AssistantMessage from '../AssistantMessage.svelte';
import CouncilSalon from './CouncilSalon.svelte';

const mounted: ReturnType<typeof mount>[] = [];
const closers: (() => void)[] = [];
const previousActive = workspace.active;

afterEach(async () => {
  for (const component of mounted.splice(0)) await unmount(component);
  for (const close of closers.splice(0)) close();
  workspace.machines = []; workspace.active = previousActive;
  setExperiment(COUNCIL_EXPERIMENT, false);
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
const tableRows = () => all('[data-testid=council-table] tr').map(row => [...row.children].map(cell => cell.textContent?.trim()));

/**
 * The demo thread (`?fake=1&council=1`): a council closed after two rounds, one in
 * round 2 with GPT-6 Astra still reviewing, and a debate from before the council.
 * `on` is the Council experiment, in the app and on the core alike.
 */
async function demo(on = true) {
  setExperiment(COUNCIL_EXPERIMENT, on);
  const client = new FakeClient({ delayMs: 0, councilDemo: true });
  const store = new Store();
  store.attach(client);
  closers.push(() => { store.detach(); client.close(); });
  await store.connect();
  if (on) client.reportDesktopExperiments([COUNCIL_EXPERIMENT]);
  workspace.machines = [{ id: 'local', label: 'Local', store }]; workspace.active = store;
  await store.open('t-council');
  await vi.waitFor(() => expect(store.openThread?.messages.length).toBeGreaterThan(2));
  return { client, store };
}

/** The thread's message holding a council's card, drawn as the timeline draws it. */
function card(store: Store, messageId: string) {
  const message = store.openThread!.messages.find(entry => entry.id === messageId) as Message;
  mounted.push(mount(AssistantMessage, { target: document.body, props: { store, threadId: message.threadId, message, signedOut: null, showModel: false } }));
}

function salon(store: Store, councilId: string) {
  mounted.push(mount(CouncilSalon, { target: document.body, props: { store, councilId, threadId: 't-council' } }));
}

function type(value: string) {
  const field = query<HTMLTextAreaElement>('[data-testid=council-input]');
  field.focus();
  field.value = value;
  field.setSelectionRange(value.length, value.length);
  field.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

function press(key: string) {
  query('[data-testid=council-input]').dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  flushSync();
}

test('the card says where each council stands and opens the salon in the panel', async () => {
  const { store } = await demo();
  card(store, 'm-council-2');
  card(store, 'm-council-3');
  await vi.waitFor(() => expect(all('[data-testid=council-card-status]')).toHaveLength(2));

  const live = '[data-testid=council-card][data-council-id=cnl_demo_live]';
  const done = '[data-testid=council-card][data-council-id=cnl_demo_done]';
  expect(text(`${live} [data-testid=council-card-title]`)).toBe('Council · Review how the phone follows a council: invalidation events, then a pull.');
  expect(text(`${live} [data-testid=council-card-status]`)).toBe('Round 2');
  expect(query(`${live} [data-testid=council-card-status]`).classList.contains('live')).toBe(true);
  expect(text(live)).toContain('3 AIs and you');
  // Three members and the owner, two by two.
  expect(document.querySelectorAll(`${live} .faces > *`)).toHaveLength(4);
  expect(text(`${done} [data-testid=council-card-status]`)).toBe('Closed');

  expect(store.panel.isOpen).toBe(false);
  query<HTMLButtonElement>(`${live} [data-testid=council-card-open]`).click();
  flushSync();
  expect(store.panel.isOpen).toBe(true);
  expect(store.panel.active).toMatchObject({ kind: 'council', councilId: 'cnl_demo_live' });
  // The other card moves the same tab to its council.
  query<HTMLButtonElement>(`${done} [data-testid=council-card-open]`).click();
  flushSync();
  expect(store.panel.surfaces.filter(surface => surface.kind === 'council')).toHaveLength(1);
  expect(store.panel.active).toMatchObject({ kind: 'council', councilId: 'cnl_demo_done' });
});

test('with the experiment off, the thread draws no card, not even an old debate\'s, and the salon says how to turn it on', async () => {
  const { store } = await demo(false);
  card(store, 'm-council-3');
  card(store, 'm-council-4');
  salon(store, 'cnl_demo_live');
  await settle();
  expect(document.body.textContent).toContain('A second council is reviewing');
  expect(document.querySelector('[data-testid=council-card]')).toBeNull();
  expect(query('[data-testid=council-unavailable]').textContent).toContain('Settings, Experiments');
  expect(document.querySelector('[data-testid=council-composer]')).toBeNull();
});

test('the in-memory core answers a council as the real one: the exact route, the nearest effort, no table for an old debate', async () => {
  const { client } = await demo();
  // Reading the models is what fills the catalog.
  const threadId = (await client.call('threads.create', { projectId: 'p-boite', providerId: 'codex', accountId: 'a-codex', model: 'codex-demo', effort: 'high' })).id;
  await client.call('delegation.models', { threadId });
  const start = (models: string[]) => client.call('council.start', { threadId, request: 'Review the cache plan.', models });
  await expect(start(['codex/codex-dem', 'echo/echo-1'])).rejects.toThrow('codex does not offer it; the nearest is codex/codex-demo');
  const council = await start(['codex/codex-demo', 'echo/echo-1']);
  expect(council.members[0]?.effort).toBe('high');
  expect(council.warnings.some(warning => warning.endsWith('has no xhigh effort, so it runs at high.'))).toBe(true);
  await expect(client.call('council.table', { councilId: 'dbt_demo_old' })).rejects.toThrow('a debate from before the council has no scores, so no table');
});

test('the app with the experiment on, before the core has it, still draws no salon', async () => {
  setExperiment(COUNCIL_EXPERIMENT, true);
  const client = new FakeClient({ delayMs: 0, councilDemo: true });
  const store = new Store();
  store.attach(client);
  closers.push(() => { store.detach(); client.close(); });
  await store.connect();
  client.reportDesktopExperiments([]);
  salon(store, 'cnl_demo_live');
  await vi.waitFor(() => expect(document.querySelector('[data-testid=council-unavailable]')).not.toBeNull());
  // A read that times out says nothing about councils: the salon keeps what it said.
  const call = client.call.bind(client);
  let timedOut = false;
  vi.spyOn(client, 'call').mockImplementation(((method: string, params: unknown) => {
    if (method !== 'council.get' || timedOut) return call(method as never, params as never);
    timedOut = true;
    return Promise.reject(new Error('Request timed out'));
  }) as typeof client.call);
  client.reportDesktopExperiments([COUNCIL_EXPERIMENT]);
  await vi.waitFor(() => expect(timedOut).toBe(true));
  await settle();
  expect(document.querySelector('[data-testid=council-unavailable]')).not.toBeNull();
  // Turned on afterwards, the salon reads the council without being reopened.
  client.reportDesktopExperiments([COUNCIL_EXPERIMENT]);
  await vi.waitFor(() => expect(all('[data-testid=council-member]')).toHaveLength(3));
});

test('the salon shows who reviews, each answer with its score, round by round, then the table of scores', async () => {
  const { store } = await demo();
  salon(store, 'cnl_demo_live');
  await vi.waitFor(() => expect(all('[data-testid=council-member]')).toHaveLength(3));

  expect(text('[data-testid=council-round]')).toBe('Round 2');
  expect(all('[data-testid=council-member] .member-name').map(node => node.textContent)).toEqual(['Sonnet 5.5', 'GPT-6 Astra', 'Gemini 4 Pro']);
  expect(text('[data-testid=council-you]')).toContain('You');

  expect(all('[data-testid=council-divider]').map(node => node.textContent?.trim())).toEqual([
    'Round 1 · each reviews alone',
    'Round 2 · each reviews alone',
  ]);
  // The score sits in the head of each answer, the round's own.
  const scored = all('[data-testid=council-post]').filter(post => post.querySelector('[data-testid=council-post-score]'));
  expect(scored.map(post => [post.dataset.author, post.dataset.round, post.querySelector('[data-testid=council-post-score]')?.textContent?.trim()])).toEqual([
    ['p1', '1', '· 8/10'], ['p2', '1', '· 7/10'], ['p3', '1', '· 6/10'],
    ['p3', '2', '· 9/10'], ['p1', '2', '· 8/10'],
  ]);
  const thread = query('[data-testid=council-post][data-author=author]');
  expect(thread.textContent).toContain('The thread');
  expect(thread.querySelector('[data-testid=council-post-score]')).toBeNull();

  const owner = query('[data-testid=council-post][data-author=owner]');
  expect(owner.dataset.to).toBe('p3');
  expect(owner.querySelector('[data-testid=council-post-to]')?.textContent).toBe('To Gemini 4 Pro only');
  expect(owner.querySelector('.mention')?.textContent).toBe('@Gemini');
  expect(owner.querySelector('[data-testid=council-post-score]')).toBeNull();
  expect(text('[data-testid=council-status-line]')).toBe('GPT-6 Astra is writing…');

  // Only the rounds that closed: round 2 is still under way.
  expect(tableRows()).toEqual([['Delegate', 'Round 1'], ['Sonnet 5.5 (xhigh)', '8/10'], ['GPT-6 Astra (xhigh)', '7/10'], ['Gemini 4 Pro (xhigh)', '6/10']]);
  expect(text('[data-testid=council-table]')).toContain('Council review');
  expect(text('[data-testid=council-table]')).toContain('Rounds: 1');
  for (const gone of ['vote', 'tally', 'summary', 'anonymous', 'angle', 'rounds']) expect(document.querySelector(`[data-testid*=council-${gone}]`)).toBeNull();
});

test('a closed salon shows every round in the table and takes no more messages', async () => {
  const { store } = await demo();
  salon(store, 'cnl_demo_done');
  await vi.waitFor(() => expect(document.querySelector('[data-testid=council-table]')).not.toBeNull());
  expect(tableRows()).toEqual([
    ['Delegate', 'Round 1', 'Round 2'],
    ['Sonnet 5.5 (xhigh)', '7/10', '9/10'],
    ['GPT-6 Astra (xhigh)', '6/10', '9/10'],
    ['Gemini 4 Pro (xhigh)', 'no score', '8/10'],
  ]);
  expect(text('[data-testid=council-system]')).toContain('Gemini 4 Pro did not answer round 1');
  expect(text('[data-testid=council-status-line]')).toBe('Council closed. Its reviews went back to the thread.');
  expect(text('[data-testid=council-closed]')).toBe('The council is over: the salon takes no more messages.');
  for (const control of ['council-composer', 'council-close-round', 'council-stop']) expect(document.querySelector(`[data-testid=${control}]`)).toBeNull();
});

test('@ lists the members, Enter picks one, and the message goes to that member alone, for the next round', async () => {
  const { client, store } = await demo();
  salon(store, 'cnl_demo_live');
  await vi.waitFor(() => expect(document.querySelector('[data-testid=council-composer]')).not.toBeNull());

  type('@G');
  expect(all('[data-testid=mention-row]').map(row => row.textContent)).toEqual([
    expect.stringContaining('GPT-6 Astra'),
    expect.stringContaining('Gemini 4 Pro'),
  ]);
  type('@Ge');
  expect(all('[data-testid=mention-row]')).toHaveLength(1);
  press('Enter');
  const field = query<HTMLTextAreaElement>('[data-testid=council-input]');
  expect(field.value).toBe('@Gemini ');
  expect(all('[data-testid=mention-row]')).toHaveLength(0);

  type('@Gemini is an hour of sleep a real case?');
  expect(text('[data-testid=council-reads]')).toBe('Only Gemini 4 Pro reads it, next round.');
  type('Is an hour of sleep a real case?');
  expect(text('[data-testid=council-reads]')).toBe('Every AI reads it next round.');
  // Escape closes the list and leaves the text as typed.
  type('@So');
  expect(all('[data-testid=mention-row]')).toHaveLength(1);
  press('Escape');
  expect(document.querySelector('[data-testid=mention-menu]:not(.closing)')).toBeNull();
  expect(field.value).toBe('@So');

  type('@Gemini is an hour of sleep a real case?');
  const sent = vi.spyOn(client, 'call');
  query<HTMLButtonElement>('[data-testid=council-send]').click();
  await vi.waitFor(() => expect(field.value).toBe(''));
  expect(sent).toHaveBeenCalledWith('council.post', expect.objectContaining({ councilId: 'cnl_demo_live', text: '@Gemini is an hour of sleep a real case?', id: expect.any(String) }));
  await vi.waitFor(() => expect(all('[data-testid=council-post][data-author=owner]')).toHaveLength(2));
  const mine = all('[data-testid=council-post][data-author=owner]').at(-1)!;
  expect(mine.dataset.to).toBe('p3');
  expect(mine.dataset.round).toBe('3');
  // No round 3 has begun: the line over the message says who it waits for.
  expect(all('[data-testid=council-divider]').at(-1)?.textContent?.trim()).toBe('For the next round');
});

test('closing a round leaves the member who did not answer without a score, and the salon open until the council stops', async () => {
  const { client, store } = await demo();
  salon(store, 'cnl_demo_live');
  await vi.waitFor(() => expect(document.querySelector('[data-testid=council-close-round]')).not.toBeNull());
  const calls = vi.spyOn(client, 'call');

  query<HTMLButtonElement>('[data-testid=council-close-round]').click();
  await vi.waitFor(() => expect(query('[data-testid=council-salon]').dataset.status).toBe('waiting'));
  expect(calls).toHaveBeenCalledWith('council.closeRound', { councilId: 'cnl_demo_live' });
  expect(text('[data-testid=council-system]')).toBe('GPT-6 Astra did not answer round 2: closed early.');
  await vi.waitFor(() => expect(tableRows()[0]).toEqual(['Delegate', 'Round 1', 'Round 2']));
  expect(tableRows()[2]).toEqual(['GPT-6 Astra (xhigh)', '7/10', 'no score']);
  expect(text('[data-testid=council-status-line]')).toContain('Round 2 is done');
  expect(document.querySelector('[data-testid=council-close-round]')).toBeNull();
  expect(document.querySelector('[data-testid=council-composer]')).not.toBeNull();

  // Between two rounds nothing runs, so stopping closes the council rather than cutting it short.
  query<HTMLButtonElement>('[data-testid=council-stop]').click();
  await vi.waitFor(() => expect(query('[data-testid=council-salon]').dataset.status).toBe('done'));
  expect(document.querySelector('[data-testid=council-composer]')).toBeNull();
  expect(document.querySelector('[data-testid=council-stop]')).toBeNull();
});

test('Stop ends a round under way and closes the composer', async () => {
  const { client, store } = await demo();
  salon(store, 'cnl_demo_live');
  await vi.waitFor(() => expect(document.querySelector('[data-testid=council-stop]')).not.toBeNull());
  const calls = vi.spyOn(client, 'call');
  query<HTMLButtonElement>('[data-testid=council-stop]').click();
  await vi.waitFor(() => expect(query('[data-testid=council-salon]').dataset.status).toBe('stopped'));
  expect(calls).toHaveBeenCalledWith('council.stop', { councilId: 'cnl_demo_live' });
  expect(text('[data-testid=council-status-line]')).toBe('Stopped by the user.');
  expect(text('[data-testid=council-closed]')).toBe('The council is over: the salon takes no more messages.');
  expect(document.querySelector('[data-testid=council-stop]')).toBeNull();
});

test('a debate from before the council keeps its card and reads in the salon, with its summary, no score and no table', async () => {
  const { store } = await demo();
  card(store, 'm-council-4');
  await vi.waitFor(() => expect(document.querySelector('[data-testid=council-card-status]')).not.toBeNull());
  query<HTMLButtonElement>('[data-testid=council-card-open]').click();
  flushSync();
  expect(store.panel.active).toMatchObject({ kind: 'council', councilId: 'dbt_demo_old' });

  salon(store, 'dbt_demo_old');
  await vi.waitFor(() => expect(all('[data-testid=council-member]')).toHaveLength(3));
  expect(all('[data-testid=council-divider]').map(node => node.textContent?.trim())).toEqual(['Round 1', 'Round 2']);
  expect(query('[data-testid=council-post][data-author=summary]').textContent).toContain('Summary');
  expect(document.querySelector('[data-testid=council-post-score]')).toBeNull();
  expect(document.querySelector('[data-testid=council-table]')).toBeNull();
  expect(document.querySelector('[data-testid=council-composer]')).toBeNull();
  expect(document.querySelector('[data-testid=council-closed]')).not.toBeNull();
});
