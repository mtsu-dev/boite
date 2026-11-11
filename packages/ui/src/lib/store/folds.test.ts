import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { FakeClient } from '../fake-client';
import { Store } from '../store.svelte';

const FOLDS = 'boite.foldedProjects.v1:';
const stores: Store[] = [];
/** A new Store is a new start of the app on this device: only its storage is left. */
async function ready(machine: string) {
  const store = new Store();
  store.machineId = machine;
  store.attach(new FakeClient({ delayMs: 0 }));
  await store.connect();
  stores.push(store);
  return store;
}
const foldKeys = () => Object.keys(localStorage).filter(key => key.startsWith(FOLDS));
beforeEach(() => localStorage.clear());
afterEach(() => { vi.restoreAllMocks(); for (const store of stores.splice(0)) { store.client?.close(); store.detach(); } localStorage.clear(); });

test('a fold is kept per core: the same project id on another machine stays open', async () => {
  const first = await ready('machine-a');
  first.toggleProject('p-boite');
  expect(foldKeys()).toHaveLength(1);
  expect((await ready('machine-a')).isCollapsed('p-boite')).toBe(true);
  expect((await ready('machine-b')).isCollapsed('p-boite')).toBe(false);

  // Unfolding the last one leaves no key behind, and the next start finds the project open.
  first.toggleProject('p-boite');
  expect(foldKeys()).toEqual([]);
  expect((await ready('machine-a')).isCollapsed('p-boite')).toBe(false);
});

test('storage that is full, refused or corrupt leaves the folds working for the session', async () => {
  const store = await ready('machine-a');
  store.toggleProject('p-notes');
  const key = foldKeys()[0]!;
  store.toggleProject('p-notes');
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new DOMException('denied', 'SecurityError'); });
  expect(() => store.toggleProject('p-boite')).not.toThrow();
  expect(store.isCollapsed('p-boite')).toBe(true);
  expect(() => store.toggleProject('p-boite')).not.toThrow();
  expect(store.isCollapsed('p-boite')).toBe(false);
  vi.restoreAllMocks();

  // A browser that refuses to read storage (private mode, blocked site data) still connects with every project open.
  const read = Storage.prototype.getItem;
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key: string) {
    if (key.startsWith(FOLDS)) throw new DOMException('denied', 'SecurityError');
    return read.call(this, key);
  });
  const refused = await ready('machine-a');
  expect(refused.connection).toBe('ready');
  expect(refused.collapsedProjects).toEqual([]);
  vi.restoreAllMocks();

  // Garbage under the key, or entries that are not ids, are dropped rather than trusted.
  localStorage.setItem(key, '{not json');
  expect((await ready('machine-a')).collapsedProjects).toEqual([]);
  localStorage.setItem(key, JSON.stringify(['p-boite', 7, null]));
  expect((await ready('machine-a')).collapsedProjects).toEqual(['p-boite']);
});
