import { expect, test } from 'vitest';
import { contactRows, type MachineContacts } from './contacts.svelte';

/** A machine and what its core answered to `contacts.get`. */
function holding(id: string, group: { id: string; self: string; botsHome?: string } | null, contacts: string[], asks: string[] = []): MachineContacts {
  return {
    machine: { id, label: id, store: { group } },
    view: { state: { contacts: contacts.map(coreId => ({ coreId, name: coreId.toUpperCase(), link: 'connected' })), requests: asks.map((coreId, n) => ({ id: `${id}-${n}`, coreId, direction: 'in', status: 'pending' })), mail: [] } }
  } as unknown as MachineContacts;
}

test('a contact two machines of one group hold is listed once, on the Bots machine when it holds it, with what waits on both', () => {
  const group = { id: 'grp' };
  const rows = contactRows([
    holding('pc', { ...group, self: 'core-pc', botsHome: 'core-srv' }, ['alice', 'bob'], ['alice']),
    holding('srv', { ...group, self: 'core-srv', botsHome: 'core-srv' }, ['alice'], ['alice']),
  ]);
  expect(rows.map(row => [row.contact.coreId, row.machine.id, row.waiting])).toEqual([['alice', 'srv', 2], ['bob', 'pc', 0]]);
  // Without a Bots machine the first listed copy stays; machines of no group, or of two groups, keep their own rows.
  const plain = contactRows([holding('pc', { ...group, self: 'core-pc' }, ['alice']), holding('srv', { ...group, self: 'core-srv' }, ['alice'])]);
  expect(plain.map(row => row.machine.id)).toEqual(['pc']);
  const apart = contactRows([holding('pc', null, ['alice']), holding('srv', null, ['alice']), holding('lab', { id: 'other', self: 'core-lab' }, ['alice'])]);
  expect(apart.map(row => row.machine.id)).toEqual(['pc', 'srv', 'lab']);
});
