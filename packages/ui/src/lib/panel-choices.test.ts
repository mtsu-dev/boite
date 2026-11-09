import { beforeEach, expect, test } from 'vitest';
import type { ThreadSummary } from '@boite/contracts';
import type { Store } from './store.svelte';
import { strings } from './strings';
import { notePanelUse, panelChoices, usedPanels } from './panel-choices';
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

test('one list holds every panel once in named groups, the showing panel checked, the old names on hover', () => {
  const items = panelChoices(stub(), thread(), { available: () => true });
  const list = ids(items);
  for (const card of offeredCards()) expect(list.filter((id) => id === card.kind)).toHaveLength(1);
  // Nothing picked yet: no Recent group, the three families, Changes first.
  expect(sections(items)).toEqual(['Work', 'Agents', 'Tools']);
  expect(list[0]).toBe('changes');
  expect(list.slice(-1)).toEqual(['customize']);
  expect(list).toContain('terminal-toggle');
  expect(list).toContain('board-toggle');
  expect(list).toContain('coordination');
  // No door to the rest: the old "N more" and its way back are gone.
  expect(list).not.toContain('all-panels');
  expect(list).not.toContain('panels-in-use');
  expect(items.some((item) => item.submenu || item.back)).toBe(false);
  expect(new Set(list).size).toBe(list.length);
  expect(items.filter((item) => item.active).map((item) => item.id)).toEqual(['files']);
  const named = Object.fromEntries(items.map((item) => [item.id, item]));
  expect(named['trace']).toMatchObject({ label: 'Processes', title: 'Formerly Trace' });
  expect(named['messages']).toMatchObject({ label: 'Messages', title: 'Formerly Discussions' });
  expect(named['coordination']).toMatchObject({ label: 'Linked threads', title: 'Formerly Thread links' });
  // The two lists of work to do say whose work each holds, by name and by line: the project's or the thread's.
  expect(named['board-toggle']).toMatchObject({ label: 'Project board', hint: "The whole project's todos, in columns" });
  expect(named['tasks']).toMatchObject({ label: 'Goal and todos', hint: "This thread's goal, loop, todos and watches", title: 'Formerly Task manager' });
  // Every row says in one plain line what it holds.
  for (const item of items.filter((one) => !one.separator)) expect(item.hint, item.id).toBeTruthy();
  expect(named['trace']?.hint).toBe(strings.rightPanel.roles.trace);
  expect(named['changes']?.hint).toBe(strings.rightPanel.roles.changes);
  expect(named['agent-browser']?.hint).toBe(strings.rightPanel.roles.browser);
  expect(named['terminal-toggle']?.hint).toBe(strings.rightPanel.roles.terminal);
  expect(named['customize']).toMatchObject({ label: 'Customize', title: 'Formerly Choose the buttons' });
});

test('a phone, a bot or a team thread lists what it can open, and an unreachable kind says why', () => {
  // A phone runs no terminal; a bot's thread has its desk first and no coordination.
  const bot = ids(panelChoices(stub(), thread({ agentSessionId: 's1' }), { phone: true, available: () => true }));
  expect(bot).toContain('desk');
  expect(bot).not.toContain('terminal-toggle');
  expect(bot).not.toContain('coordination');
  const team = ids(panelChoices(stub(), thread({ teamId: 'team-1' } as Partial<ThreadSummary>), { available: () => true }));
  expect(team).not.toContain('terminal-toggle');
  const shut = panelChoices(stub(), thread(), { available: (kind) => kind !== 'changes' }).find((item) => item.id === 'changes');
  expect(shut).toMatchObject({ disabled: true });
  expect(shut?.hint).toBeTruthy();
});

test('the panels this thread used lead, newest first, and leave their usual group; another thread has its own', () => {
  const store = stub({ panel: { active: null } });
  const other = stub({ panel: { active: null } });
  notePanelUse(store, 't1', 'trace');
  notePanelUse(store, 't1', 'board-toggle');
  notePanelUse(store, 't1', 'file');
  const list = (used: string[]) => panelChoices(store, thread(), { available: () => true, showing: undefined, used });
  // A file tab counts as Files; each row stays once, so the families lose what the used group took.
  const items = list(usedPanels(store, 't1'));
  expect(sections(items)).toEqual(['Used in this thread', 'Work', 'Agents', 'Tools']);
  expect(ids(items).slice(0, 4)).toEqual(['files', 'board-toggle', 'trace', 'changes']);
  expect(new Set(ids(items)).size).toBe(ids(items).length);
  notePanelUse(store, 't1', 'trace');
  // Only what was noted: the showing panel adds nothing once the thread has used some.
  expect(usedPanels(store, 't1', 'changes')).toEqual(['trace', 'files', 'board-toggle']);
  // A kind this thread cannot show is no row (a bot's desk on a plain thread).
  notePanelUse(store, 't1', 'desk');
  expect(ids(list(usedPanels(store, 't1'))).slice(0, 4)).toEqual(['trace', 'files', 'board-toggle', 'changes']);
  // At most four, newest first; the older ones go back to their own group.
  for (const id of ['messages', 'agents', 'terminal-toggle']) notePanelUse(store, 't1', id);
  const capped = list(usedPanels(store, 't1'));
  expect(ids(capped).slice(0, 5)).toEqual(['terminal-toggle', 'agents', 'messages', 'trace', 'changes']);
  expect(ids(capped).filter((id) => id === 'files')).toEqual(['files']);
  // Nothing noted: the showing panel alone, a page counting as the Browser; every other open tab stays in its group.
  expect(usedPanels(store, 't2', 'browser')).toEqual(['agent-browser']);
  // Another thread, or the same id on another machine, starts with its own.
  expect(usedPanels(store, 't2')).toEqual([]);
  expect(usedPanels(other, 't1')).toEqual([]);
  expect(sections(panelChoices(store, thread(), { available: () => true, showing: undefined }))).toEqual(['Work', 'Agents', 'Tools']);
});
