import { expect, test } from 'vitest';
import { flushSync } from 'svelte';
import type { AgentsSnapshot } from '@boite/contracts';
import { agentDirectory } from './agent-directory.svelte';
import type { Store } from './store.svelte';

test("a directory first made inside a derived still wakes it when its snapshot lands: the rail's bots on a cold load", () => {
  const store = { client: null, threads: [] } as unknown as Store;
  let seen: (AgentsSnapshot | null)[] = [];
  const stop = $effect.root(() => {
    const snapshot = $derived(agentDirectory(store).snapshot);
    $effect(() => { seen = [...seen, snapshot]; });
  });
  flushSync();
  expect(seen).toEqual([null]);
  const loaded = { profiles: [], statuses: [] } as unknown as AgentsSnapshot;
  agentDirectory(store).snapshot = loaded;
  flushSync();
  expect(seen).toEqual([null, loaded]);
  stop();
});
