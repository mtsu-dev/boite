import { beforeEach, expect, test } from 'vitest';
import type { ThreadSummary } from '@boite/contracts';
import type { Store } from './store.svelte';
import { panelChoices } from './panel-choices';
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
  ...patch
}) as unknown as Store;
const ids = (items: { id: string; separator?: boolean }[]) => items.filter((item) => !item.separator).map((item) => item.id);

test('the selector lists every panel once, then the drawers and the coordination, the showing panel marked', () => {
  const items = panelChoices(stub(), thread(), { available: () => true });
  const list = ids(items);
  for (const card of offeredCards()) expect(list.filter((id) => id === card.kind)).toHaveLength(1);
  expect(list.slice(0, 2)).toEqual(['changes', 'agent-browser']);
  expect(list.slice(-4)).toEqual(['terminal-toggle', 'board-toggle', 'coordination', 'customize']);
  expect(new Set(list).size).toBe(list.length);
  expect(items.filter((item) => item.active).map((item) => item.id)).toEqual(['files']);
});

test('a phone, a bot or a team thread lists what it can open, and an unreachable kind says why', () => {
  // A phone runs no terminal; a bot's thread has its desk first and no coordination.
  const bot = ids(panelChoices(stub(), thread({ agentSessionId: 's1' }), { phone: true, available: () => true }));
  expect(bot[0]).toBe('desk');
  expect(bot).not.toContain('terminal-toggle');
  expect(bot).not.toContain('coordination');
  const team = ids(panelChoices(stub(), thread({ teamId: 'team-1' } as Partial<ThreadSummary>), { available: () => true }));
  expect(team).not.toContain('terminal-toggle');
  const shut = panelChoices(stub(), thread(), { available: (kind) => kind !== 'changes' }).find((item) => item.id === 'changes');
  expect(shut).toMatchObject({ disabled: true });
  expect(shut?.hint).toBeTruthy();
});
