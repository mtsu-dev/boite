import { beforeEach, expect, test } from 'vitest';
import type { ThreadSummary } from '@boite/contracts';
import type { Store } from './store.svelte';
import { strings } from './strings';
import { notePanelUse, panelChoices } from './panel-choices';
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
  // The two lists of work to do say whose work each holds.
  expect(named['board-toggle']).toMatchObject({ label: 'Project board', hint: strings.rightPanel.roles.board });
  expect(named['tasks']).toMatchObject({ label: 'Task manager', hint: strings.rightPanel.roles.tasks });
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

test('the panels picked last lead as a short Recent group, newest first, and leave their usual group', () => {
  const store = stub({ panel: { active: null } });
  notePanelUse('trace');
  notePanelUse('board-toggle');
  notePanelUse('file');
  const items = panelChoices(store, thread(), { available: () => true, showing: undefined });
  // A file tab counts as Files; each row stays once, so the families lose what Recent took.
  expect(sections(items)).toEqual(['Recent', 'Work', 'Agents', 'Tools']);
  expect(ids(items).slice(0, 4)).toEqual(['files', 'board-toggle', 'trace', 'changes']);
  expect(new Set(ids(items)).size).toBe(ids(items).length);
  notePanelUse('trace');
  expect(ids(panelChoices(store, thread(), { available: () => true, showing: undefined })).slice(0, 3)).toEqual(['trace', 'files', 'board-toggle']);
  // A recent kind this thread cannot show is no Recent row (a bot's desk on a plain thread); the oldest drops out of three.
  notePanelUse('desk');
  expect(ids(panelChoices(store, thread(), { available: () => true, showing: undefined })).slice(0, 3)).toEqual(['trace', 'files', 'changes']);
});
