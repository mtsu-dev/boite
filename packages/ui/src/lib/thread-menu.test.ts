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

test('a phone menu keeps the thread\'s actions on its first level and every tool behind Tools', () => {
  const store = stub();
  const t = thread({ branch: 'boite/port' });
  const options = { phone: true, showDone: true, prLoading: false, tools: [{ id: 'find', label: 'Find' }] };
  const ids = (items: MenuItem[]) => items.filter(item => !item.separator).map(item => item.id);
  expect(ids(threadMenuItems(store, t, options))).toEqual(['rename', 'pin', 'done', 'archive', 'more', 'delete']);
  // The path and the pull request stay on the desktop; the view's find moves into Tools.
  expect(ids(threadToolItems(store, t, options))).toEqual(['back', 'find', 'retitle', 'move']);
});

test('the row, header and phone menus share one order and grouping for what they all have', () => {
  const store = stub();
  const shared = new Set(['rename', 'pin', 'done', 'archive', 'more', 'delete']);
  const order = (items: MenuItem[]) => items.filter(item => item.separator || shared.has(item.id))
    .map(item => item.separator ? '|' : item.id).join(' ').replace(/(\| )+/g, '| ').replace(/^\| |( \|)+$/g, '');
  const row = order(threadMenuItems(store, thread(), { open: false, showDone: true, prLoading: false }));
  const header = order(threadMenuItems(store, thread(), { showDone: true }));
  const grouped = order(threadMenuItems(store, thread(), { open: false, showDone: true, prLoading: false, grouped: true }));
  const phone = order(threadMenuItems(store, thread(), { phone: true, showDone: true }));
  expect(row).toBe('rename pin | done archive | more | delete');
  expect(header).toBe(row);
  expect(phone).toBe(row);
  expect(grouped).toBe(row);
});

test('a desktop menu keeps the thread\'s actions apart and opens one Tools list with the panels, the view\'s tools and the rest', () => {
  const store = stub();
  agentDirectory(store).snapshot = { profiles: [{ id: 'mira', name: 'Mira', status: 'active', domain: '', avatar: '' }], entrusted: [] } as unknown as AgentsSnapshot;
  const options = { open: false, showDone: true, prLoading: false, tools: [{ id: 'find', label: 'Find' }] };
  const t = thread({ branch: 'boite/port' });
  const ids = (items: MenuItem[]) => items.filter(item => !item.separator).map(item => item.id);
  const main = threadMenuItems(store, t, options);
  // Hand off is something done to the thread: it stays beside rename and pin.
  expect(ids(main)).toEqual(['open', 'rename', 'pin', 'entrust', 'done', 'archive', 'more', 'delete']);
  expect(main.find(item => item.id === 'more')).toMatchObject({ submenu: true, label: 'Tools' });
  const tools = threadToolItems(store, t, options);
  expect(tools[0]?.back).toBe(true);
  const list = ids(tools);
  // The panels first, one row each, then the drawers, the view's own tools, then the thread's place and name.
  expect(list.slice(0, 3)).toEqual(['back', 'kind:changes', 'kind:agent-browser']);
  expect(list).toEqual(expect.arrayContaining(['kind:agents', 'kind:files', 'kind:tasks']));
  expect(list.slice(-5)).toEqual(['find', 'retitle', 'move', 'copy', 'pr']);
  expect(new Set(list).size).toBe(list.length);
});

test('a panel picked from a row\'s Tools opens beside that thread', async () => {
  const store = stub();
  const open = vi.fn();
  Object.assign(store, { openThread: thread(), panel: { open } });
  expect(pickThreadAction(store, thread(), 'kind:changes', { rename: vi.fn() })).toBe(true);
  await Promise.resolve();
  expect(open).toHaveBeenCalledWith('changes');
});
