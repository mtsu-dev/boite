/**
 * The one way to the Council's store and RPC methods in the core
 * (`council/store.ts`, `council/rpc.ts`); its commands load beside it in
 * `delegate-cli.ts`. `require` and not `import()`: the core builds its stores
 * in its constructor, which cannot wait.
 */
import type { Core } from './core.ts';
import type { CouncilStore } from './council/store.ts';

/** The council store. */
export function councilStore(core: Core): CouncilStore {
  return new (require('./council/store.ts') as typeof import('./council/store.ts')).CouncilStore(core);
}

/** The council methods. */
export function registerCouncilMethods(core: Core, probe: Parameters<typeof import('./council/rpc.ts').registerCouncil>[1]): void {
  (require('./council/rpc.ts') as typeof import('./council/rpc.ts')).registerCouncil(core, probe);
}
