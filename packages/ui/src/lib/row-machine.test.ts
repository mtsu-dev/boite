import { expect, test } from 'vitest';
import { namesMachine } from './row-machine';
import type { Machine } from './workspace.svelte';
import type { Store } from './store.svelte';

const machine = (id: string, label: string, store: Partial<Store> = {}): Machine => ({ id, label, store: { endpointUrl: id, ...store } as Store });

// A row names a machine only when the work runs elsewhere. A remote someone
// called "This PC" is still elsewhere: hiding it by that name made it read as local.
test('a remote keeps its name in a row whatever it is called; this PC never shows one', () => {
  expect(namesMachine(machine('local', 'This PC', { endpointUrl: undefined }), false)).toBe(false);
  expect(namesMachine(machine('http://127.0.0.1:41000', 'This PC'), false)).toBe(false);
  expect(namesMachine(machine('https://desk.example', 'Desk', { localCore: true } as Partial<Store>), false)).toBe(false);
  expect(namesMachine(machine('http://builder.test', 'Builder'), false)).toBe(true);
  expect(namesMachine(machine('http://builder.test', 'This PC'), false)).toBe(true);
  expect(namesMachine(machine('http://builder.test', 'Ce PC'), false)).toBe(true);
  // A machine that stopped answering says so by its name, this one included.
  expect(namesMachine(machine('local', 'This PC', { endpointUrl: undefined }), true)).toBe(true);
});
