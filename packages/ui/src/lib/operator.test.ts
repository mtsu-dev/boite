import { expect, test } from 'vitest';
import { botsHost, operatorHost } from './operator';
import type { Store } from './store.svelte';

/** A machine as `operatorHost` reads it: its owner, its link, its client and its place in the group. */
function machine(self: string, group: { settingsHome?: string; botsHome?: string } = {}, connected = true): Store {
  return { owner: true, connection: connected ? 'ready' : 'closed', client: {}, group: { id: 'grp', self, ...group } } as unknown as Store;
}

test('the Operator goes to the Bots machine, else the Settings machine, else this window, each only while connected', () => {
  const roles = { settingsHome: 'core-b', botsHome: 'core-c' };
  const [a, b, c] = [machine('core-a', roles), machine('core-b', roles), machine('core-c', roles)];
  expect(operatorHost(a, [b, c])).toBe(c);
  expect(botsHost(a, [b, c])).toBe(c);
  // The Bots machine out of reach: the Settings one, as before the role existed.
  const away = machine('core-c', roles, false);
  expect(operatorHost(a, [b, away])).toBe(b);
  expect(botsHost(a, [b, away])).toBeNull();
  // Neither role reachable: this window's machine.
  expect(operatorHost(a, [machine('core-b', roles, false), away])).toBe(a);
  // No Bots role: the Settings machine.
  const plain = { settingsHome: 'core-b' };
  expect(operatorHost(machine('core-a', plain), [machine('core-c', plain), b])).toBe(b);
});
