import { beforeEach, expect, test } from 'vitest';
import type { ThreadSummary } from '@boite/contracts';
import type { Store } from './store.svelte';
import { strings } from './strings';
import { ALL_PANELS, IN_USE, panelChoices, usedPanels } from './panel-choices';
import { offeredCards } from './surface-labels';
import { work } from './work-prefs.svelte';

// The terminal row follows the device's controls: the developer's set shows it.
beforeEach(() => { localStorage.clear(); work.load(); work.showPreset('developer'); });

const thread = (patch: Partial<ThreadSummary> = {}) => ({ id: 't1', title: 'Port', cwd: '/w', projectId: 'p1', parentThreadId: null, agentSessionId: null, archived: false, incognito: false, pinned: false, status: 'idle', ...patch } as ThreadSummary);
const stub = (patch: Record<string, unknown> = {}) => ({
  owner: true,
  panelOpen: true,
  panel: { active: { kind: 'files' } },
  keyLabel: () => 'Ctrl+J',
  terminalShown: () => false,
  boardAvailable: () => true,
  boardShown: false,
  delegation: null,
  coordination: null,
  threads: [],
  projects: [],
  workflowsOf: () => [],
  ...patch
}) as unknown as Store;
const ids = (items: { id: string; separator?: boolean }[]) => items.filter((item) => !item.separator).map((item) => item.id);
const sections = (items: { label: string; separator?: boolean }[]) => items.filter((item) => item.separator && item.label).map((item) => item.label);

test('the full list holds every panel once in named groups, the showing panel marked, the old names on hover', () => {
  const items = panelChoices(stub(), thread(), { available: () => true, full: true });
  const list = ids(items);
  for (const card of offeredCards()) expect(list.filter((id) => id === card.kind)).toHaveLength(1);
  expect(sections(items)).toEqual(['Work', 'Agents', 'Tools']);
  // The panel showing is in use: the way back to the short list leads.
  expect(list.slice(0, 2)).toEqual(['panels-in-use', 'changes']);
  expect(list.slice(-1)).toEqual(['customize']);
  expect(list).toContain('terminal-toggle');
  expect(list).toContain('board-toggle');
  expect(list).toContain('coordination');
  expect(new Set(list).size).toBe(list.length);
  expect(items.filter((item) => item.active).map((item) => item.id)).toEqual(['files']);
  const named = Object.fromEntries(items.map((item) => [item.id, item]));
  expect(named['trace']).toMatchObject({ label: 'Processes', title: 'Formerly Trace' });
  expect(named['messages']).toMatchObject({ label: 'Messages', title: 'Formerly Discussions' });
  expect(named['coordination']).toMatchObject({ label: 'Thread links', title: 'Formerly Communication between conversations' });
  expect(named['customize']).toMatchObject({ label: 'Customize', title: 'Formerly Choose the buttons' });
});

test('the short list holds the panels in use, then one row to all of them; the full one comes back to it', () => {
  const store = stub({ terminalShown: () => true });
  const used = usedPanels(store, thread(), ['files'], 3);
  const short = panelChoices(store, thread(), { available: () => true, used });
  expect(ids(short)).toEqual(['changes', 'files', 'terminal-toggle', ALL_PANELS]);
  expect(short.at(-1)).toMatchObject({ submenu: true });
  const full = panelChoices(store, thread(), { available: () => true, used, full: true });
  expect(full[0]).toMatchObject({ id: IN_USE, back: true });
  // Nothing in use: Changes and Files still lead, a click from the header, then the way to the rest.
  const fresh = panelChoices(stub({ panel: { active: null } }), thread(), { available: () => true, showing: undefined });
  expect(ids(fresh)).toEqual(['changes', 'files', ALL_PANELS]);
  // The way to the rest names what it holds, the best known first, so it is no door to guess at.
  const more = fresh.at(-1)!;
  expect(more.label).toMatch(/^Terminal, Browser and \d+ more$/);
  expect(more.title).toBe(strings.rightPanel.allPanels);
  expect(short.at(-1)!.label).not.toContain('Terminal');
  // A short list that would hold every row is the full list at once, with no way back to itself.
  const all = panelChoices(stub({ panel: { active: null } }), thread(), { available: () => true, showing: undefined, used: new Set(ids(panelChoices(stub(), thread(), { available: () => true, full: true }))) });
  expect(ids(all)).not.toContain(ALL_PANELS);
  expect(ids(all)).not.toContain(IN_USE);
  expect(sections(all)).toHaveLength(3);
});

test('a thread uses its subagents, its letters and its changes; none of them when it has none', () => {
  expect([...usedPanels(stub(), thread(), [], 0)]).toEqual([]);
  expect([...usedPanels(stub(), thread(), [], null)]).toEqual([]);
  const busy = stub({ delegation: { rootThreadId: 't1', agents: [{ thread: { id: 't2' } }] }, boardShown: true });
  expect([...usedPanels(busy, thread({ agentSessionId: 's1' }), ['file'], 2)].sort()).toEqual(['agents', 'board-toggle', 'changes', 'desk', 'files']);
});

test('a phone, a bot or a team thread lists what it can open, and an unreachable kind says why', () => {
  // A phone runs no terminal; a bot's thread has its desk first and no coordination.
  const bot = ids(panelChoices(stub(), thread({ agentSessionId: 's1' }), { phone: true, available: () => true, full: true }));
  expect(bot).toContain('desk');
  expect(bot).not.toContain('terminal-toggle');
  expect(bot).not.toContain('coordination');
  const team = ids(panelChoices(stub(), thread({ teamId: 'team-1' } as Partial<ThreadSummary>), { available: () => true, full: true }));
  expect(team).not.toContain('terminal-toggle');
  const shut = panelChoices(stub(), thread(), { available: (kind) => kind !== 'changes', full: true }).find((item) => item.id === 'changes');
  expect(shut).toMatchObject({ disabled: true });
  expect(shut?.hint).toBeTruthy();
});
