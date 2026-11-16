import { untrack } from 'svelte';
import type { StoreContext } from './context';
import { idlePreloadAllowed } from './thread-preload';

/**
 * Reads the machine's first sidebar threads ahead (`IdlePreloads` in
 * `thread-preload.ts`): looks again whenever the connection, the list, the
 * open thread's status or a loading thread changes. Answers the stop.
 */
export function watchIdlePreloads(ctx: StoreContext): () => void {
  if (!idlePreloadAllowed()) return () => {};
  const { threads } = ctx;
  const stop = $effect.root(() => {
    $effect(() => {
      void ctx.store.connection; void threads.threads.length; void ctx.store.projects; void threads.openThread?.status; void threads.loadingThreadId;
      untrack(() => threads.preloads.idle.poke());
    });
  });
  return () => { stop(); threads.preloads.idle.stop(); };
}
