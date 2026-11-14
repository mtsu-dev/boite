import { afterEach, expect, test, vi } from 'vitest';
import { RpcErrorCode, type AgentProfile } from '@boite/contracts';
import { agentMenuItems, pickAgentAction } from './agent-menu';
import { AgentsView } from './agents.svelte';
import { confirm } from './confirm.svelte';
import { contextMenu } from './context-menu.svelte';
import { FakeClient } from './fake-client';
import { RpcFailure } from './rpc-error';
import { Store, store as primary } from './store.svelte';
import { fill, strings } from './strings';
import { threadMenuItems, threadToolItems } from './thread-menu';
import { workspace } from './workspace.svelte';

const opened: { store: Store; client: FakeClient }[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  confirm.answer(false);
  contextMenu.close();
  for (const { store, client } of opened) { client.close(); store.detach(); }
  opened.length = 0;
  workspace.machines = [];
  workspace.active = primary;
  localStorage.clear();
});

const agent = (patch: Partial<AgentProfile> = {}) => ({
  id: 'mira', revision: 3, createdAt: 1, updatedAt: 2, name: 'Mira', domain: 'Research', instructions: 'Look things up.', avatar: '', status: 'active', projectIds: ['p1'],
  selection: { providerId: 'echo', accountId: 'echo', model: 'echo', effort: null, permissionMode: 'default' },
  ...patch
}) as AgentProfile;

/** A machine alone in no group, as the menu reads it: whether this window is its owner. */
const alone = (owner = true) => ({ owner, group: null }) as unknown as Store;

/** The bot's machine as the menu reaches it: its snapshot, its serialized saves and its client. */
function machine(profile: AgentProfile) {
  const sent: unknown[] = [];
  const call = vi.fn(async (..._args: unknown[]) => ({ path: '/brains/mira' }));
  const view = {
    snapshot: { profiles: [profile] },
    store: { client: { call } },
    // Like `AgentsView.save`, the params are read when the save's turn comes, after those queued before it.
    save: vi.fn(async (method: string, params: () => unknown) => { await new Promise(resolve => setTimeout(resolve, 0)); sent.push([method, await params()]); return {}; })
  } as unknown as AgentsView;
  const page = { reportError: vi.fn(), copy: vi.fn(async () => {}) } as unknown as Store & { reportError: ReturnType<typeof vi.fn>; copy: ReturnType<typeof vi.fn> };
  const actions = { open: vi.fn(), edit: vi.fn(), rename: vi.fn(), report: page };
  return { view, page, call, sent, actions };
}
const flush = () => new Promise(resolve => setTimeout(resolve, 10));

test('the desktop menu has the thread menu\'s groups, words and glyphs, cut to what a mochi has', () => {
  const items = agentMenuItems(alone(), agent(), { open: false });
  expect(items.map(item => item.id)).toEqual(['open', 'sep-open', 'rename', 'pin', 'edit', 'sep-archive', 'pause', 'archive', 'sep-tools', 'copy']);
  // Where a thread has the same action, the bot's row reads and looks the same.
  const owner = { owner: true, retitling: [], composerStates: {}, threads: [], moveBlocked: () => false } as unknown as Store;
  const row = { id: 't1', title: 'Port', cwd: '/w', projectId: null, parentThreadId: null, agentSessionId: null, archived: false, incognito: false, pinned: false, status: 'idle' } as never;
  // A thread's Copy path sits in its named group, or on the first level when it is the group's only row.
  const thread = [...threadMenuItems(owner, row, { open: false }), ...threadToolItems(owner, row, { open: false })];
  for (const id of ['open', 'pin', 'rename', 'copy']) {
    const mine = items.find(item => item.id === id)!, theirs = thread.find(item => item.id === id)!;
    expect([mine.label, mine.glyph]).toEqual([theirs.label, theirs.glyph]);
  }
  expect(items.find(item => item.id === 'archive')?.label).toBe(strings.agents.archive);
  expect(items.find(item => item.id === 'edit')?.label).toBe(strings.agents.edit);
  // The open conversation cannot be opened again; a paused bot resumes; a pinned one unpins.
  expect(agentMenuItems(alone(), agent(), { open: true })[0]).toMatchObject({ id: 'open', disabled: true });
  expect(agentMenuItems(alone(), agent({ status: 'paused', pinned: true }), { open: false }).map(item => item.label)).toEqual(expect.arrayContaining([strings.agents.resume, strings.sidebar.unpin]));
  // A built-in bot is never archived: Reset stands in its place, as in its own menu.
  expect(agentMenuItems(alone(), agent({ builtin: 'contacts' }), { open: false }).filter(item => item.danger).map(item => [item.id, item.label])).toEqual([['reset', strings.agents.builtin.reset]]);
});

test('a phone keeps rename, pin and edit, then pause and archive; a paired device keeps only what reads', () => {
  expect(agentMenuItems(alone(), agent(), { open: false, phone: true }).map(item => item.id)).toEqual(['rename', 'pin', 'edit', 'sep-archive', 'pause', 'archive']);
  // Saving a profile is the owner's: a paired desktop opens and copies, a paired phone has no menu.
  expect(agentMenuItems(alone(false), agent(), { open: false }).filter(item => !item.separator).map(item => item.id)).toEqual(['open', 'copy']);
  expect(agentMenuItems(alone(false), agent(), { open: false, phone: true })).toEqual([]);
});

test('pin, pause and resume save only their field, on the revision the mochi\'s machine holds when the save runs', async () => {
  const profile = agent();
  const { view, sent, actions } = machine(profile);
  pickAgentAction(view, profile, 'pin', actions);
  // Another client moved the bot meanwhile: the save reads that revision, not the menu's.
  view.snapshot!.profiles[0] = { ...profile, revision: 4, domain: 'Design' };
  await flush();
  expect(sent).toEqual([['agents.profile.save', { id: 'mira', expectedRevision: 4, value: expect.objectContaining({ name: 'Mira', domain: 'Design', pinned: true, status: 'active', projectIds: ['p1'] }) }]]);
  expect((sent[0] as [string, { value: object }])[1].value).not.toHaveProperty('revision');
  pickAgentAction(view, profile, 'pause', actions);
  pickAgentAction(view, agent({ status: 'paused' }), 'resume', actions);
  await flush();
  expect(sent.slice(1).map(entry => (entry as [string, { value: AgentProfile }])[1].value.status)).toEqual(['paused', 'active']);
});

test('archive asks for the mochi\'s exact name first, and a refused save says why on the page on screen', async () => {
  const profile = agent();
  const { view, page, sent, actions } = machine(profile);
  const ask = vi.spyOn(confirm, 'ask').mockResolvedValueOnce(false);
  pickAgentAction(view, profile, 'archive', actions);
  await flush();
  expect(ask).toHaveBeenCalledWith(expect.objectContaining({ requiredText: 'Mira', danger: true }));
  expect(sent).toEqual([]);
  ask.mockResolvedValueOnce(true);
  pickAgentAction(view, profile, 'archive', actions);
  await flush();
  expect((sent[0] as [string, { value: AgentProfile }])[1].value.status).toBe('archived');
  vi.mocked(view.save).mockRejectedValueOnce(new Error('profile revision changed'));
  pickAgentAction(view, profile, 'pin', actions);
  await flush();
  expect(page.reportError).toHaveBeenCalledWith(expect.objectContaining({ message: 'profile revision changed' }), 'minor');
});

test('copy reads the brain folder on the mochi\'s machine; open, edit and rename are the list\'s', async () => {
  const profile = agent();
  const { view, page, call, actions } = machine(profile);
  pickAgentAction(view, profile, 'copy', actions);
  await flush();
  expect(call).toHaveBeenCalledWith('agents.brain.get', { agentId: 'mira' });
  expect(page.copy).toHaveBeenCalledWith('/brains/mira');
  for (const id of ['open', 'edit', 'rename'] as const) {
    pickAgentAction(view, profile, id, actions);
    expect(actions[id]).toHaveBeenCalledOnce();
  }
});

async function connected(id: string, name: string): Promise<{ store: Store; client: FakeClient }> {
  const store = new Store();
  store.machineId = id;
  const client = new FakeClient({ delayMs: 0, coreId: `core-${id}`, coreName: name, publicUrl: `https://${id}.test` });
  store.attach(client);
  await store.connect();
  opened.push({ store, client });
  return { store, client };
}

test('Move to a machine opens the group\'s machines where the menu stood, the offline one greyed, then the move\'s own dialog', async () => {
  const first = await connected('first', 'First');
  const second = await connected('second', 'Second');
  expect(await first.store.createGroup('Home')).toBe(true);
  const { invite } = await first.client.call('group.invite', {});
  expect(await second.store.joinGroup(invite)).toBe(true);
  await vi.waitFor(() => expect(first.store.group?.cores).toHaveLength(2));
  // Alone in its group, the bot has nowhere to go: no move item.
  workspace.machines = [{ id: 'first', label: 'First', store: first.store }];
  const bot = await first.client.call('agents.builtin.ensure', { kind: 'contacts', name: 'Operator' });
  // Its first turn, the introduction, ends before it may move.
  await first.client.settled();
  expect(agentMenuItems(first.store, bot, { open: false }).some(item => item.id === 'move')).toBe(false);
  // A third member this window lists while it is not connected.
  const away = new Store();
  workspace.machines = [
    { id: 'first', label: 'First', store: first.store },
    { id: 'second', label: 'Second', store: second.store },
    { id: 'third', label: 'Third', store: away, groupId: first.store.group!.id }
  ];
  const items = agentMenuItems(first.store, bot, { open: false });
  expect(items.find(item => item.id === 'move')).toMatchObject({ label: strings.agents.move.menu });
  expect(items.map(item => item.id).slice(items.findIndex(item => item.id === 'sep-open'))).toEqual(['sep-open', 'rename', 'pin', 'edit', 'move', 'sep-archive', 'pause', 'reset', 'sep-tools', 'copy']);
  // While it waits to leave at the end of its turn, the menu cancels that move instead, as a thread's does.
  const waiting = agentMenuItems(first.store, bot, { open: false, leaving: true }).filter(item => item.id.startsWith('move'));
  expect(waiting.map(item => [item.id, item.label])).toEqual([['move-cancel', strings.threadMove.cancelMove]]);

  const view = AgentsView.of(first.store);
  await view.refresh();
  contextMenu.open(new MouseEvent('contextmenu', { clientX: 40, clientY: 50 }), items, () => {});
  // The page on screen is Second's, its rail listing First's bot.
  pickAgentAction(view, bot, 'move', { open: vi.fn(), edit: vi.fn(), rename: vi.fn(), report: second.store });
  const picker = contextMenu.current!;
  expect([picker.x, picker.y]).toEqual([40, 50]);
  expect(picker.items.map(item => [item.id, !!item.active, !!item.disabled, item.hint ?? null])).toEqual([
    ['first', true, true, null],
    ['second', false, false, null],
    ['third', false, true, strings.connection[away.connection]]
  ]);
  // A pick leads to the same dialog as the Machine row of its settings.
  const real = first.client.call.bind(first.client);
  vi.spyOn(first.client, 'call').mockImplementation(async (method, params) => {
    if (method === 'agents.move') throw new RpcFailure({ code: RpcErrorCode.Refused, message: 'agents.move: Operator has a turn in flight; wait for it to end', data: { field: 'agentId', reason: 'busy' } });
    return real(method, params);
  });
  picker.onpick('second');
  await vi.waitFor(() => expect(confirm.current?.title).toBe(fill(strings.agents.move.title, { name: 'Operator', machine: 'Second' })));
  // A refusal is told on the page on screen, not on the bot's machine.
  confirm.answer(true);
  await vi.waitFor(() => expect(second.store.error).toContain('has a turn in flight'));
  expect(first.store.error).toBeNull();
});


test('Cancel move drops the move the mochi waits to make, and says so when it is already on its way', async () => {
  const profile = agent();
  const { view, call, actions } = machine(profile);
  const page = actions.report as Store;
  (view.snapshot as { status: unknown[] }).status = [{ agentId: 'mira', state: 'working', leaving: { agentId: 'mira', machine: 'core-pc', requestId: 'r1', at: 1 } }];
  call.mockResolvedValueOnce({ cancelled: false } as never);
  pickAgentAction(view, profile, 'move-cancel', actions);
  await flush();
  expect(call).toHaveBeenCalledWith('agents.move.cancel', { agentId: 'mira' });
  expect(page.error).toBe(fill(strings.agents.move.cancelLate, { name: 'Mira' }));
});