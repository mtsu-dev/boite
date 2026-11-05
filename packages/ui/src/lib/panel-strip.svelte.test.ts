import { expect, test } from 'vitest';
import { flushSync } from 'svelte';
import { PanelCounts } from './panel-strip.svelte';
import type { Store } from './store.svelte';

/** A machine whose open thread is `t-1` at the same turn, with its own count of changed files. */
function machine(files: number) {
  const calls = { status: 0 };
  const store = {
    openThread: { id: 't-1', branch: 'feat/import', turns: [{ finishedAt: 100 }] },
    gitStatus: async () => { calls.status += 1; return { changes: Array.from({ length: files }, (_, i) => ({ path: `f${i}`, status: 'modified' })) }; }
  } as unknown as Store;
  return { store, calls };
}

test('two machines whose open threads share an id and a turn each count their own changed files', async () => {
  const a = machine(2), b = machine(7);
  let counts: PanelCounts[] = [];
  const stop = $effect.root(() => { counts = [new PanelCounts(() => a.store), new PanelCounts(() => b.store)]; });
  for (let i = 0; i < 10; i++) { await Promise.resolve(); flushSync(); }
  expect(counts.map(count => count.of('changes')?.value ?? null)).toEqual([2, 7]);
  expect([a.calls.status, b.calls.status]).toEqual([1, 1]);
  stop();
});
