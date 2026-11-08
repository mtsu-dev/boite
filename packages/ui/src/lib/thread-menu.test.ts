import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { AgentsSnapshot, ThreadSummary } from '@boite/contracts';
import { setExperiment } from './experiments';
import { agentDirectory } from './agent-directory.svelte';
import { pickThreadAction, threadMenuItems, threadToolItems } from './thread-menu';
import type { Store } from './store.svelte';

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
  client: { call: vi.fn(async () => ({})) }
}) as unknown as Store & { client: { call: ReturnType<typeof vi.fn> } };

test('every thread menu offers Move only to a thread the core lets change project', () => {
  const store = stub();
  const ids = (t: ThreadSummary) => threadMenuItems(store, t, { open: false, showDone: true, prLoading: false }).map(item => item.id);
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

test('a phone menu keeps rename, pin, the view\'s tools, archive and delete, and leaves the desktop rows behind', () => {
  const store = stub();
  const ids = threadMenuItems(store, thread({ branch: 'boite/port' }), { phone: true, showDone: true, prLoading: false, tools: [{ id: 'find', label: 'Find' }] })
    .filter(item => !item.separator).map(item => item.id);
  expect(ids).toEqual(['rename', 'pin', 'find', 'done', 'archive', 'delete']);
});

test('the row, header and phone menus share one order and grouping for what they all have', () => {
  const store = stub();
  const shared = new Set(['rename', 'pin', 'done', 'archive', 'delete']);
  const order = (items: ReturnType<typeof threadMenuItems>) => items.filter(item => item.separator || shared.has(item.id))
    .map(item => item.separator ? '|' : item.id).join(' ').replace(/(\| )+/g, '| ').replace(/^\| |( \|)+$/g, '');
  const row = order(threadMenuItems(store, thread(), { open: false, showDone: true, prLoading: false }));
  const header = order(threadMenuItems(store, thread(), { showDone: true }));
  const grouped = order(threadMenuItems(store, thread(), { open: false, showDone: true, prLoading: false, grouped: true }));
  const phone = order(threadMenuItems(store, thread(), { phone: true, showDone: true }));
  expect(row).toBe('rename pin | done archive | delete');
  expect(header).toBe(row);
  expect(phone).toBe(row);
  expect(grouped).toBe(row);
});

test('a desktop row\'s menu puts the common actions first and every tool behind All tools, each with its own id', () => {
  const store = stub();
  agentDirectory(store).snapshot = { profiles: [{ id: 'mira', name: 'Mira', status: 'active', domain: '', avatar: '' }], entrusted: [] } as unknown as AgentsSnapshot;
  const options = { open: false, showDone: true, prLoading: false, grouped: true };
  const t = thread({ branch: 'boite/port' });
  const ids = (items: ReturnType<typeof threadMenuItems>) => items.filter(item => !item.separator).map(item => item.id);
  expect(ids(threadMenuItems(store, t, options))).toEqual(['open', 'rename', 'pin', 'done', 'archive', 'more', 'delete']);
  expect(threadMenuItems(store, t, options).find(item => item.id === 'more')?.submenu).toBe(true);
  const tools = threadToolItems(store, t, options);
  expect(ids(tools)).toEqual(['back', 'retitle', 'entrust', 'move', 'copy', 'pr']);
  expect(tools[0]?.back).toBe(true);
  // Nothing the flat menu offers is lost: the two lists together hold every row of it.
  const flat = ids(threadMenuItems(store, t, { open: false, showDone: true, prLoading: false }));
  expect(new Set([...ids(threadMenuItems(store, t, options)), ...ids(tools)])).toEqual(new Set([...flat, 'more', 'back']));
});

test('a phone row\'s menu groups the same way and keeps every action the flat phone menu had', () => {
  const store = stub();
  agentDirectory(store).snapshot = { profiles: [{ id: 'mira', name: 'Mira', status: 'active', domain: '', avatar: '' }], entrusted: [] } as unknown as AgentsSnapshot;
  const t = thread({ branch: 'boite/port' });
  const ids = (items: ReturnType<typeof threadMenuItems>) => items.filter(item => !item.separator).map(item => item.id);
  const main = threadMenuItems(store, t, { phone: true, grouped: true, showDone: true });
  const tools = threadToolItems(store, t, { phone: true });
  expect(ids(main)).toEqual(['rename', 'pin', 'done', 'archive', 'more', 'delete']);
  // The path and the pull request stay on the desktop.
  expect(ids(tools)).toEqual(['back', 'retitle', 'entrust', 'move']);
  const flat = ids(threadMenuItems(store, t, { phone: true, showDone: true }));
  for (const id of flat) expect([...ids(main), ...ids(tools)]).toContain(id);
});
