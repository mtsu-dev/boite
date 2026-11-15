import { expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { GroupLinks } from './group-links.svelte';
import type { Machine, Workspace } from './workspace.svelte';

/** A store reduced to what the links read, its connection reactive as the real one is. */
function machine(id: string, connection: string): { entry: Machine; store: { connection: string } } {
  const store = $state({ connection, client: null, group: null, groupKnown: false, ungrouped: false, endpointUrl: id });
  return { entry: { id, label: id, store: store as unknown as Machine['store'] }, store };
}

it('a machine ready again after losing its link makes every other machine waiting out its backoff try now', async () => {
  vi.useFakeTimers();
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  const laptop = machine('http://laptop.tail:1', 'ready');
  const desktop = machine('http://desktop.tail:1', 'connecting');
  const resumeMachines = vi.fn();
  const stub = { settled: true, machines: [laptop.entry, desktop.entry], primary: laptop.entry.store, resumeMachines };
  const links = new GroupLinks(stub as unknown as Workspace, { reach: async () => null, secure: () => false, now: () => Date.now() });
  const stop = links.start();
  try {
    await vi.advanceTimersByTimeAsync(0);
    // A first hello at boot is no news of the network.
    desktop.store.connection = 'ready';
    flushSync();
    expect(resumeMachines).not.toHaveBeenCalled();
    // Both lose the link; the laptop comes back first.
    laptop.store.connection = 'connecting';
    desktop.store.connection = 'connecting';
    flushSync();
    expect(resumeMachines).not.toHaveBeenCalled();
    laptop.store.connection = 'ready';
    flushSync();
    expect(resumeMachines).toHaveBeenCalledTimes(1);
    // The desktop it woke comes back too: it wakes the rest again, which a ready machine ignores.
    desktop.store.connection = 'ready';
    flushSync();
    expect(resumeMachines).toHaveBeenCalledTimes(2);
  } finally {
    stop();
    hidden.mockRestore();
    vi.useRealTimers();
  }
});
