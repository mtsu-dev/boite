import { afterEach, expect, test, vi } from 'vitest';
import { flushSync } from 'svelte';
import { contactsViews } from './contacts-views.svelte';
import { contactsRail } from './contacts-rail.svelte';
import type { Store } from './store.svelte';

vi.mock('./contacts-entry', () => ({ contactsParts: null }));

const cores = ['core-a', 'core-c'].map(coreId => ({ coreId, name: coreId.toUpperCase() }));

/** A machine as the views and `operatorHost` read it, its link and its group reactive as the real store's are. */
function machine(self: string, connection: string, group: { botsHome?: string } | null, groupKnown: boolean) {
  const call = vi.fn(async (method: string) => method === 'contacts.get' ? { bot: null } : {});
  const store = $state({
    owner: true, page: 'chat', connection, client: { call }, groupKnown, error: '',
    group: group && { id: 'grp', self, cores, ...group }, showChat: () => {},
  });
  return { store, call, ensured: () => call.mock.calls.filter(([method]) => method === 'agents.builtin.ensure').length };
}

let stop: (() => void) | undefined;
afterEach(() => { stop?.(); stop = undefined; if (!contactsRail.folded) contactsRail.toggle(); });

/** The remembered column, unfolded on a desktop-wide window, with these machines in the workspace. */
function open(home: ReturnType<typeof machine>, others: ReturnType<typeof machine>[]) {
  if (contactsRail.folded) contactsRail.toggle();
  const all = [home, ...others].map(entry => ({ store: entry.store as unknown as Store }));
  stop = $effect.root(() => { contactsViews(() => home.store as unknown as Store, () => all, () => false); });
  flushSync();
}

test('a remembered Contacts column waits for the group before it makes the Operator on this machine', async () => {
  const home = machine('core-a', 'ready', null, false);
  open(home, []);
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(home.call).not.toHaveBeenCalled();
  // The group answers with a Bots machine elsewhere: this one makes none.
  home.store.group = { id: 'grp', self: 'core-a', cores, botsHome: 'core-c' };
  home.store.groupKnown = true;
  flushSync();
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(home.ensured()).toBe(0);
});

test('the Bots machine reconnecting while the Contacts column stays open gets the Operator', async () => {
  const roles = { botsHome: 'core-c' };
  const home = machine('core-a', 'ready', roles, true);
  const bots = machine('core-c', 'closed', roles, false);
  open(home, [bots]);
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(bots.ensured() + home.ensured()).toBe(0);
  bots.store.connection = 'ready';
  bots.store.groupKnown = true;
  flushSync();
  await vi.waitFor(() => expect(bots.ensured()).toBe(1));
  expect(home.ensured()).toBe(0);
});
