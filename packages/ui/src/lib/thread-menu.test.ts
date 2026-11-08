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
  expect(threadMenuItems(store, thread()).map(item => item.id)).toContain('entrust-back');
  const rename = vi.fn();
  expect(pickThreadAction(store, thread(), 'entrust-back', { rename })).toBe(true);
  expect(store.client.call).toHaveBeenCalledWith('agents.entrust', { threadId: 't1', agentId: null });
  expect(pickThreadAction(store, thread(), 'rename', { rename })).toBe(true);
  expect(rename).toHaveBeenCalledOnce();
  // A row the view added itself stays the view's.
  expect(pickThreadAction(store, thread(), 'coordination', { rename })).toBe(false);
});

test('a phone menu holds every row on its first level, find first, and no group called More', () => {
  const store = stub();
  const t = thread({ branch: 'boite/port' });
  const options = { phone: true, showDone: true, prLoading: false, tools: [{ id: 'find', label: 'Find' }] };
  const ids = (items: MenuItem[]) => items.filter(item => !item.separator).map(item => item.id);
  // The path and the pull request stay on the desktop; a phone has no second level.
  expect(ids(threadMenuItems(store, t, options))).toEqual(['find', 'rename', 'retitle', 'pin', 'done', 'archive', 'move', 'delete']);
  expect(threadToolItems(store, t, options)).toEqual([]);
});

test('the row, header and phone menus share one order and grouping for what they all have', () => {
  const store = stub();
  const shared = new Set(['rename', 'retitle', 'pin', 'done', 'archive', 'delete']);
  const order = (items: MenuItem[]) => items.filter(item => item.separator || shared.has(item.id))
    .map(item => item.separator ? '|' : item.id).join(' ').replace(/(\| )+/g, '| ').replace(/^\| |( \|)+$/g, '');
  const row = order(threadMenuItems(store, thread(), { open: false, showDone: true, prLoading: false }));
  const header = order(threadMenuItems(store, thread(), { showDone: true }));
  const phone = order(threadMenuItems(store, thread(), { phone: true, showDone: true }));
  expect(row).toBe('rename retitle pin | done archive | delete');
  expect(header).toBe(row);
  expect(phone).toBe(row);
});

test('a desktop menu names its one group for what it holds, find first, no More and no panel', () => {
  const store = stub();
  agentDirectory(store).snapshot = { profiles: [{ id: 'mira', name: 'Mira', status: 'active', domain: '', avatar: '' }], entrusted: [] } as unknown as AgentsSnapshot;
  const options = { open: false, showDone: true, prLoading: false, tools: [{ id: 'find', label: 'Find' }] };
  const t = thread({ branch: 'boite/port' });
  const ids = (items: MenuItem[]) => items.filter(item => !item.separator).map(item => item.id);
  const main = threadMenuItems(store, t, options);
  // Hand off is something done to the thread: it stays beside rename and pin.
  expect(ids(main)).toEqual(['open', 'find', 'rename', 'retitle', 'pin', 'entrust', 'done', 'archive', 'more', 'delete']);
  expect(main.find(item => item.id === 'more')).toMatchObject({ submenu: true, label: 'Project and branch' });
  expect(main.some(item => item.label === 'More')).toBe(false);
  const tools = threadToolItems(store, t, options);
  expect(tools[0]?.back).toBe(true);
  // Where the thread lives; the panels have their own selector.
  expect(ids(tools)).toEqual(['back', 'move', 'copy', 'pr']);
});

test('a group of one is a row on the first level, not a submenu', () => {
  const store = stub();
  // A sub-thread cannot move: the path is the group's only row.
  const t = thread({ parentThreadId: 't0' });
  const ids = (items: MenuItem[]) => items.filter(item => !item.separator).map(item => item.id);
  expect(ids(threadMenuItems(store, t, { showDone: true }))).toEqual(['rename', 'retitle', 'pin', 'done', 'archive', 'copy']);
  expect(threadToolItems(store, t, {})).toEqual([]);
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
