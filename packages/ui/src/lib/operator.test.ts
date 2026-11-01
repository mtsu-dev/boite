import { expect, test, vi } from 'vitest';
import { botsHost, botsHostAway, ensureOperator, operatorHost } from './operator';
import type { Store } from './store.svelte';

/** A machine as `operatorHost` reads it: its owner, its link, its client and its place in the group. */
function machine(self: string, group: { settingsHome?: string; botsHome?: string } = {}, connected = true, call: (method: string) => unknown = () => ({})): Store {
  const cores = ['core-a', 'core-b', 'core-c'].map(coreId => ({ coreId, name: coreId.toUpperCase() }));
  return { owner: true, connection: connected ? 'ready' : 'closed', client: { call: vi.fn(async (method: string) => call(method)) }, group: { id: 'grp', self, cores, ...group } } as unknown as Store;
}

test('the Operator goes to the Bots machine and only there, else the Settings machine, else this window', () => {
  const roles = { settingsHome: 'core-b', botsHome: 'core-c' };
  const [a, b, c] = [machine('core-a', roles), machine('core-b', roles), machine('core-c', roles)];
  expect(operatorHost(a, [b, c])).toBe(c);
  expect(botsHost(a, [b, c])).toBe(c);
  expect(botsHostAway(a, [b, c])).toBeNull();
  // The Bots machine out of reach: it may hold the Operator out of sight, so no other machine gets one.
  const away = machine('core-c', roles, false);
  expect(operatorHost(a, [b, away])).toBeNull();
  expect(botsHost(a, [b, away])).toBeNull();
  expect(botsHostAway(a, [b, away])).toBe('CORE-C');
  // No Bots role: the Settings machine while connected, else this window's machine.
  const plain = { settingsHome: 'core-b' };
  const settings = machine('core-b', plain);
  expect(operatorHost(machine('core-a', plain), [machine('core-c', plain), settings])).toBe(settings);
  const here = machine('core-a', plain);
  expect(operatorHost(here, [machine('core-b', plain, false)])).toBe(here);
  expect(botsHostAway(here, [])).toBeNull();
});

test('turning Contacts on while the Bots machine is offline makes no Operator anywhere', async () => {
  const roles = { settingsHome: 'core-b', botsHome: 'core-c' };
  const none = (method: string) => method === 'contacts.get' ? { bot: null } : {};
  const [a, b] = [machine('core-a', roles, true, none), machine('core-b', roles, true, none)];
  await ensureOperator(a, [b, machine('core-c', roles, false, none)]);
  for (const store of [a, b]) expect(store.client!.call).not.toHaveBeenCalledWith('agents.builtin.ensure', expect.anything());
  // Back online: made there, and only there.
  const c = machine('core-c', roles, true, none);
  await ensureOperator(a, [b, c]);
  expect(c.client!.call).toHaveBeenCalledWith('agents.builtin.ensure', expect.objectContaining({ kind: 'contacts' }));
  for (const store of [a, b]) expect(store.client!.call).not.toHaveBeenCalledWith('agents.builtin.ensure', expect.anything());
});
