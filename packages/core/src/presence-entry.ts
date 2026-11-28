/**
 * The one way to the rich presence's code in the core (`presence/`), cut from
 * a build below its tag: the flag is written in full so Bun folds the branch
 * and the `require` with it (docs/internals/experiments.md#out-of-the-build).
 * Without it the method stays unknown, as in a core from before it.
 */
import type { Core } from './core.ts';

export function registerPresenceMethods(core: Core): void {
  if (typeof __BOITE_HAS_DISCORD_PRESENCE__ === 'undefined' || __BOITE_HAS_DISCORD_PRESENCE__) {
    // The socket that set the presence clears it as it closes, the core's shutdown included.
    (require('./presence/rpc.ts') as typeof import('./presence/rpc.ts')).registerPresence(core);
  }
}
