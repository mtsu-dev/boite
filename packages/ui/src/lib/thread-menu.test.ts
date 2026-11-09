import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { AgentsSnapshot, ThreadSummary } from '@boite/contracts';
import { setExperiment } from './experiments';
import { agentDirectory } from './agent-directory.svelte';
import { pickThreadAction, threadMenuItems, threadToolItems } from './thread-menu';
import type { Store } from './store.svelte';
import type { MenuItem } from './menu';

beforeEach(() => { setExperiment('resident-agents', true); });
afterEach(() => { setExperiment('resident-agents', false); });

const thread = (patch: Partial<ThreadSummary> = {}) => ({ id: 't1', title: 'Port', cwd: '/w', projectId: 'p1', parentThreadId: null, agentSessionId: null, archived: false, incognito: false, pinned: false, status: 'idle', ...patch } as ThreadSummary);
const stub = () => ({
  owner: true,
  connection: 'ready',
  retitling: [],
  composerStates: {},
  threads: [thread()],
  moveBlocked: () => false,
  openThread: null,
  panelOpen: false,
  panel: { active: null },
  keyLabel: () => '',
  terminalShown: () => false,
  boardAvailable: () => false,
  client: { call: vi.fn(async () => ({})) }
}) as unknown as Store & { client: { call: ReturnType<typeof vi.fn> } };

test('every thread menu offers Move only to a thread the core lets change project', () => {
  const store = stub();
  const ids = (t: ThreadSummary) => threadToolItems(store, t, { open: false, showDone: true, prLoading: false }).map(item => item.id);
  expect(ids(thread())).toContain('move');
  // Outside any project, a persistent agent's session, a sub-thread, archived or incognito: the core refuses each.
  for (const other of [thread({ projectId: null }), thread({ agentSessionId: 's1' }), thread({ parentThreadId: 't0' }), thread({ archived: true }), thread({ incognito: true })])
    expect(ids(other)).not.toContain('move');
});

test('a pick from any thread menu, the phone list included, reaches the entrust rows', () => {
  const store = stub();
  agentDirectory(store).snapshot = { profiles: [{ id: 'mira', name: 'Mira', status: 'active', domain: '', avatar: '' }], entrusted: [{ threadId: 't1', agentId: 'mira', objective: 'Ship', at: 1 }] } as unknown as AgentsSnapshot;
  // Hand-off sits in the named group, with what is done to a thread less often.
  expect(threadToolItems(store, thread()).map(item => item.id)).toContain('entrust-back');
  const rename = vi.fn();
  expect(pickThreadAction(store, thread(), 'entrust-back', { rename })).toBe(true);
  expect(store.client.call).toHaveBeenCalledWith('agents.entrust', { threadId: 't1', agentId: null });
  expect(pickThreadAction(store, thread(), 'rename', { rename })).toBe(true);
  expect(rename).toHaveBeenCalledOnce();
  // A row the view added itself stays the view's.
  expect(pickThreadAction(store, thread(), 'coordination', { rename })).toBe(false);
});

test('a phone menu has the short first level, find first, and the same named group without path or pull request', () => {
  const store = stub();
  const t = thread({ branch: 'boite/port' });
  const options = { phone: true, showDone: true, prLoading: false, tools: [{ id: 'find', label: 'Find' }] };
  const ids = (items: MenuItem[]) => items.filter(item => !item.separator).map(item => item.id);
  const main = threadMenuItems(store, t, options);
  expect(ids(main)).toEqual(['find', 'rename', 'pin', 'done', 'archive', 'more', 'delete']);
  // The group carries its own rows: the phone's sheet opens it in place, no caller state.
  const group = main.find(item => item.id === 'more')?.items ?? [];
  expect(ids(group)).toEqual(['back', 'retitle', 'move']);
  expect(ids(threadToolItems(store, t, options))).toEqual(ids(group));
});

test('the row, header and phone menus share one order and grouping for what they all have', () => {
  const store = stub();
  const shared = new Set(['rename', 'pin', 'done', 'archive', 'more', 'delete']);
  const order = (items: MenuItem[]) => items.filter(item => item.separator || shared.has(item.id))
    .map(item => item.separator ? '|' : item.id).join(' ').replace(/(\| )+/g, '| ').replace(/^\| |( \|)+$/g, '');
  const row = order(threadMenuItems(store, thread(), { open: false, showDone: true, prLoading: false }));
  const header = order(threadMenuItems(store, thread(), { showDone: true }));
  const phone = order(threadMenuItems(store, thread(), { phone: true, showDone: true }));
  expect(row).toBe('rename pin | done archive | more | delete');
  expect(header).toBe(row);
  expect(phone).toBe(row);
});

test('a desktop menu keeps seven rows at most on its first level and names its one group, find first, no panel', () => {
  const store = stub();
  agentDirectory(store).snapshot = { profiles: [{ id: 'mira', name: 'Mira', status: 'active', domain: '', avatar: '' }], entrusted: [] } as unknown as AgentsSnapshot;
  const options = { open: false, showDone: true, prLoading: false, tools: [{ id: 'find', label: 'Find' }] };
  const t = thread({ branch: 'boite/port' });
  const ids = (items: MenuItem[]) => items.filter(item => !item.separator).map(item => item.id);
  const main = threadMenuItems(store, t, options);
  // A row's menu adds Open: the header's has find in its place, so both stay at seven.
  expect(ids(main)).toEqual(['open', 'find', 'rename', 'pin', 'done', 'archive', 'more', 'delete']);
  expect(ids(threadMenuItems(store, t, { ...options, open: undefined }))).toHaveLength(7);
  expect(ids(threadMenuItems(store, t, { ...options, tools: [] }))).toHaveLength(7);
  // The door says what a user does there, in words to act on: move it, give it to a bot.
  expect(main.find(item => item.id === 'more')).toMatchObject({ submenu: true, label: 'Move to a project or a bot' });
  expect(main.some(item => item.label === 'More')).toBe(false);
  const tools = threadToolItems(store, t, options);
  // The way back names the level it stands on, as the model picker's levels do.
  expect(tools[0]).toMatchObject({ back: true, label: 'Move to a project or a bot' });
  // What is done less often, in the door's order: the hand-off, a new title, then where the thread lives. The panels have their own selector.
  expect(ids(tools)).toEqual(['back', 'entrust', 'retitle', 'move', 'copy', 'pr']);
  // What the header says of the thread leads each part: its bot the bot rows, its branch the folder rows.
  expect(ids(threadToolItems(store, t, { ...options, lead: [{ id: 'thread-entrusted-chip', label: 'Open Mira' }], place: [{ id: 'thread-branch', label: 'boite/port' }] })))
    .toEqual(['back', 'thread-entrusted-chip', 'entrust', 'retitle', 'thread-branch', 'move', 'copy', 'pr']);
  // No bot to give it to: the name drops the word, never promising a row that is not there.
  agentDirectory(store).snapshot = { profiles: [], entrusted: [] } as unknown as AgentsSnapshot;
  expect(threadToolItems(store, t, options)[0]).toMatchObject({ back: true, label: 'Move or retitle' });
  // A sub-thread cannot move: the name drops the move too, and keeps what is there.
  expect(threadToolItems(store, thread({ branch: 'boite/port', parentThreadId: 't0' }), options)[0]).toMatchObject({ back: true, label: 'Retitle or copy the path' });
});

test('a group of one is a row on the first level, not a submenu', () => {
  const store = stub();
  // A sub-thread on a phone cannot move and has no path row: a new title is the group's only row.
  const t = thread({ parentThreadId: 't0' });
  const ids = (items: MenuItem[]) => items.filter(item => !item.separator).map(item => item.id);
  expect(ids(threadMenuItems(store, t, { showDone: true, phone: true }))).toEqual(['rename', 'pin', 'done', 'archive', 'retitle']);
  expect(threadToolItems(store, t, { phone: true })).toEqual([]);
});

test('no thread menu opens a panel or a drawer: the panel selector is their one door', async () => {
  const store = stub();
  const open = vi.fn();
  Object.assign(store, { openThread: thread(), panel: { open }, boardAvailable: () => true });
  const all = [...threadMenuItems(store, thread(), { phone: true }), ...threadToolItems(store, thread(), { phone: true }), ...threadToolItems(store, thread(), {})];
  expect(all.filter(item => item.id.startsWith('kind:') || item.id === 'terminal-toggle' || item.id === 'board-toggle')).toEqual([]);
  expect(pickThreadAction(store, thread(), 'kind:changes', { rename: vi.fn() })).toBe(false);
  await Promise.resolve();
  expect(open).not.toHaveBeenCalled();
});

test('a Mark done that cannot run says why on its row', () => {
  const store = stub();
  const done = (t: ThreadSummary) => threadMenuItems(store, t, { showDone: true }).find(item => item.id === 'done')!;
  expect(done(thread())).toMatchObject({ disabled: false });
  expect(done(thread()).hint).toBeUndefined();
  expect(done(thread({ status: 'running' }))).toMatchObject({ disabled: true, hint: 'Still working', title: 'Still working' });
  (store as { connection: string }).connection = 'connecting';
  expect(done(thread())).toMatchObject({ disabled: true, hint: 'Not connected' });
});
