import { afterEach, expect, test, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { RpcErrorCode } from '@boite/contracts';
import { AgentsView } from '../../lib/agents.svelte';
import { confirm } from '../../lib/confirm.svelte';
import { FakeClient } from '../../lib/fake-client';
import { droppedFailure, RpcFailure } from '../../lib/rpc-error';
import { Store, store as primary } from '../../lib/store.svelte';
import { fill, strings } from '../../lib/strings';
import { workspace } from '../../lib/workspace.svelte';
import AgentMachine from './AgentMachine.svelte';

let component: ReturnType<typeof mount> | undefined;
const opened: { store: Store; client: FakeClient }[] = [];
const one = <T extends HTMLElement>(testid: string) => document.querySelector<T>(`[data-testid="${testid}"]`);
const settle = async () => { for (let index = 0; index < 30; index += 1) { await Promise.resolve(); flushSync(); } };

afterEach(async () => {
  confirm.answer(false);
  if (component) await unmount(component);
  component = undefined;
  for (const { store, client } of opened) { client.close(); store.detach(); }
  opened.length = 0;
  workspace.machines = [];
  workspace.active = primary;
  localStorage.clear();
  document.body.innerHTML = '';
});

async function machine(id: string, name: string): Promise<{ store: Store; client: FakeClient }> {
  const store = new Store();
  store.machineId = id;
  const client = new FakeClient({ delayMs: 0, coreId: `core-${id}`, coreName: name, publicUrl: `https://${id}.test` });
  store.attach(client);
  await store.connect();
  opened.push({ store, client });
  return { store, client };
}

/** Two machines of one group, both reached from this window, and a bot on the first. */
async function setup() {
  const first = await machine('first', 'First');
  const second = await machine('second', 'Second');
  expect(await first.store.createGroup('Home')).toBe(true);
  const { invite } = await first.client.call('group.invite', {});
  expect(await second.store.joinGroup(invite)).toBe(true);
  await vi.waitFor(() => expect(first.store.group?.cores).toHaveLength(2));
  workspace.machines = [{ id: 'first', label: 'First', store: first.store }, { id: 'second', label: 'Second', store: second.store }];
  workspace.active = first.store;
  const bot = await first.client.call('agents.builtin.ensure', { kind: 'contacts', name: 'Operator' });
  // Its first turn, the introduction, ends before it may move.
  await first.client.settled();
  const view = AgentsView.of(first.store);
  await view.refresh();
  component = mount(AgentMachine, { target: document.body, props: { view, agent: bot } });
  await settle();
  return { first, second, bot, view };
}

function pick(value: string) {
  one<HTMLButtonElement>('agent-move-pick')!.click();
  flushSync();
  document.querySelector<HTMLButtonElement>(`[data-testid="agent-move-pick-menu"] [data-value="${value}"]`)!.click();
}

test('the Machine row moves a bot after the app asks, a refusal is told, and the Bots page follows it to its new machine', async () => {
  const { first, second, bot } = await setup();
  expect(one('agent-move-pick')!.textContent).toContain('First');
  one<HTMLButtonElement>('agent-move-pick')!.click();
  flushSync();
  const items = [...document.querySelectorAll<HTMLButtonElement>('[data-testid="agent-move-pick-menu"] [data-value]')];
  expect(items.map(item => [item.dataset.value, item.disabled])).toEqual([['first', true], ['second', false]]);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

  // The app's dialog says what moves and what stays; Cancel sends nothing.
  const real = first.client.call.bind(first.client);
  const call = vi.spyOn(first.client, 'call');
  pick('second');
  await vi.waitFor(() => expect(confirm.current).not.toBeNull());
  expect(confirm.current!.title).toBe(fill(strings.agents.move.title, { name: 'Operator', machine: 'Second' }));
  expect(confirm.current!.body).toBe(fill(strings.agents.move.body, { name: 'Operator', machine: 'Second', source: 'First' }));
  confirm.answer(false);
  await settle();
  expect(call.mock.calls.some(([method]) => method === 'agents.move')).toBe(false);

  // A turn in flight on a machine that cannot hold a move for its end: the core refuses, the toast says it in one clear line, the bot stays.
  first.store.core = { ...first.store.core!, features: { ...first.store.core!.features, botMoveQueue: false } };
  call.mockImplementation(async (method, params) => {
    if (method === 'agents.move') throw new RpcFailure({ code: RpcErrorCode.Refused, message: 'agents.move: Operator has a turn running or queued; stop it or let it end before moving the bot', data: { field: 'agentId', reason: 'turn-in-flight' } });
    return real(method, params);
  });
  pick('second');
  await vi.waitFor(() => expect(confirm.current).not.toBeNull());
  confirm.answer(true);
  await vi.waitFor(() => expect(first.store.error).toBe(fill(strings.agents.move.turnInFlight, { name: 'Operator' })));
  expect(workspace.active).toBe(first.store);
  expect(call.mock.calls.some(([method]) => method === 'agents.move.queue')).toBe(false);

  // Where its machine can hold the move, a turn that started since the dialog opened makes it wait for the turn's end.
  first.store.error = null;
  first.store.core = { ...first.store.core!, features: { ...first.store.core!.features, botMoveQueue: true } };
  call.mockImplementation(async (method, params) => {
    if (method === 'agents.move') throw new RpcFailure({ code: RpcErrorCode.Refused, message: 'agents.move: Operator has a turn running or queued', data: { field: 'agentId', reason: 'turn-in-flight' } });
    if (method === 'agents.move.queue') return { ...(params as { agentId: string; machine: string; requestId: string }), at: 1 } as never;
    return real(method, params);
  });
  pick('second');
  await vi.waitFor(() => expect(confirm.current).not.toBeNull());
  expect(confirm.current!.confirmLabel).toBe(strings.agents.move.confirm);
  confirm.answer(true);
  await vi.waitFor(() => expect(call).toHaveBeenCalledWith('agents.move.queue', { agentId: bot.id, machine: 'core-second', requestId: expect.any(String) }));
  await settle();
  expect(first.store.error).toBeNull();
  call.mockImplementation(real);

  // Confirmed: `agents.move` on the bot's machine with the picked one, then the page opens it there.
  first.store.error = null;
  pick('second');
  await vi.waitFor(() => expect(confirm.current).not.toBeNull());
  confirm.answer(true);
  await vi.waitFor(() => expect(workspace.active).toBe(second.store));
  expect(call).toHaveBeenCalledWith('agents.move', { agentId: bot.id, machine: 'core-second', requestId: expect.any(String) });
  expect((await second.client.call('agents.snapshot', {})).profiles.map(profile => profile.id)).toEqual([bot.id]);
  expect((await first.client.call('agents.snapshot', {})).profiles.some(profile => profile.id === bot.id)).toBe(false);
  await vi.waitFor(() => expect(second.store.page).toBe('agents'));
  expect(second.store.openThread?.agentSessionId).toBeTruthy();
  expect(first.store.error).toBeNull();
});

test('a member whose Boite cannot take a bot is shut in the menu and says to update it', async () => {
  const { second } = await setup();
  second.store.core = { ...second.store.core!, features: { ...second.store.core!.features, botMove: false } };
  flushSync();
  one<HTMLButtonElement>('agent-move-pick')!.click();
  flushSync();
  const item = document.querySelector<HTMLButtonElement>('[data-testid="agent-move-pick-menu"] [data-value="second"]')!;
  expect(item.disabled).toBe(true);
  expect(item.title).toBe(fill(strings.agents.move.older, { machine: 'Second' }));
  expect(item.textContent).toContain(strings.agents.move.olderShort);
});

test('a move that did not finish keeps its requestId through a reload, and a new one starts after it moved or was refused for good', async () => {
  const { first, second, bot, view } = await setup();
  const real = first.client.call.bind(first.client);
  const ids: string[] = [];
  const answers: (Error | null)[] = [
    // The target refused it, having read it: that move is over.
    new RpcFailure({ code: RpcErrorCode.Refused, message: 'agents.move: Second has no signed-in account to run Operator; sign in there first', data: { field: 'machine' } }),
    // The target made the bot and its answer was lost: the next try must be the same move.
    new RpcFailure({ code: RpcErrorCode.Refused, message: 'agents.move: Second did not answer (timeout); the bot stays here, and the same requestId tries again without moving it twice', data: { field: 'machine', reason: 'unreachable' } }),
    droppedFailure('the connection dropped'),
    null,
  ];
  vi.spyOn(first.client, 'call').mockImplementation(async (method, params) => {
    if (method === 'agents.move') {
      ids.push((params as { requestId: string }).requestId);
      const answer = answers.shift();
      if (answer) throw answer;
    }
    return real(method, params);
  });
  const attempt = async (count: number) => {
    pick('second');
    await vi.waitFor(() => expect(confirm.current).not.toBeNull());
    confirm.answer(true);
    await vi.waitFor(() => expect(ids).toHaveLength(count));
    await settle();
  };
  await attempt(1);
  await attempt(2);
  expect(ids[1]).not.toBe(ids[0]);
  // A reload: the page is drawn again from scratch, and the unfinished move keeps its id.
  await unmount(component!);
  component = mount(AgentMachine, { target: document.body, props: { view, agent: bot } });
  await settle();
  await attempt(3);
  expect(ids[2]).toBe(ids[1]);
  await attempt(4);
  expect(ids[3]).toBe(ids[1]);
  await vi.waitFor(() => expect(workspace.active).toBe(second.store));
  // It moved: nothing is kept for it any more.
  expect(localStorage.getItem('boite.agentMoves')).toBeNull();
});

test('a bot at work moves once its turn ends: the dialog names the projects the target lacks, the row says where it goes, and a cancelled move keeps its id', async () => {
  const { first, second, bot, view } = await setup();
  await unmount(component!);
  // A project Second also lists under its name, one only First has, and one it had from Second that Second no longer has.
  const twin = first.store.projects.find(project => project.kind !== 'drafts')!;
  expect(second.store.projects.some(project => project.name === twin.name)).toBe(true);
  const only = await first.client.call('projects.add', { path: '/home/owner/site', name: 'site' });
  await vi.waitFor(() => expect(first.store.projects.some(project => project.id === only.id)).toBe(true));
  const agent = { ...bot, projectIds: [twin.id, only.id, 'core-second/p-gone'] };
  component = mount(AgentMachine, { target: document.body, props: { view, agent } });
  const threadId = (await first.client.call('agents.snapshot', {})).status.find(status => status.agentId === bot.id)!.threadId!;
  first.client.holdAfterRestart(threadId, 'Still at it');
  await view.refresh();
  await settle();

  const call = vi.spyOn(first.client, 'call');
  pick('second');
  await vi.waitFor(() => expect(confirm.current).not.toBeNull());
  const labels = strings.agents.move;
  const names = { name: 'Operator', machine: 'Second', source: 'First' };
  expect(confirm.current!.confirmLabel).toBe(labels.confirmLater);
  expect(confirm.current!.body).toBe([
    fill(labels.later, names),
    fill(labels.body, names),
    fill(labels.projectsAbsent, { ...names, projects: 'site' }),
    fill(labels.projectsTwin, { ...names, projects: twin.name }),
    fill(labels.projectsReachOff, { ...names, setting: strings.machines.groupBots, page: strings.settings.tabs.machines }),
    fill(labels.projectsLost, { ...names, projects: 'p-gone' }),
  ].join('\n\n'));
  confirm.answer(true);
  // Its machine holds the move: the row says where the bot goes, and the picker waits.
  await vi.waitFor(() => expect(one('agent-move-leaving')?.textContent).toBe(fill(labels.leaving, { machine: 'Second' })));
  expect(call.mock.calls.filter(([method]) => method === 'agents.move')).toEqual([]);
  const queued = call.mock.calls.find(([method]) => method === 'agents.move.queue')![1] as { requestId: string };
  expect(queued).toEqual({ agentId: bot.id, machine: 'core-second', requestId: expect.any(String) });
  expect(one<HTMLButtonElement>('agent-move-pick')!.disabled).toBe(true);
  // The machine owns the id from here on: none stays in this window.
  expect(localStorage.getItem('boite.agentMoves')).toBeNull();

  // Cancelled: the bot stays, and a move there by hand goes with that id, in case it was sent already.
  one<HTMLButtonElement>('agent-move-cancel')!.click();
  await vi.waitFor(() => expect(one('agent-move-leaving')).toBeNull());
  expect(call).toHaveBeenCalledWith('agents.move.cancel', { agentId: bot.id });
  expect(Object.values(JSON.parse(localStorage.getItem('boite.agentMoves')!))).toEqual([queued.requestId]);

  // Asked again, it leaves as soon as the turn ends, and the page follows it.
  pick('second');
  await vi.waitFor(() => expect(confirm.current).not.toBeNull());
  confirm.answer(true);
  await vi.waitFor(() => expect(one('agent-move-leaving')).not.toBeNull());
  expect((call.mock.calls.filter(([method]) => method === 'agents.move.queue').at(-1)![1] as { requestId: string }).requestId).toBe(queued.requestId);
  await first.client.call('turns.stop', { threadId });
  await vi.waitFor(async () => expect((await second.client.call('agents.snapshot', {})).profiles.map(profile => profile.id)).toEqual([bot.id]));
  expect(first.store.error).toBeNull();
});