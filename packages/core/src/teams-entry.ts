/**
 * The one way to the Teams' code in the core: the store with its peers,
 * snapshots and mirror (`teams/store.ts`), the RPC methods (`teams/rpc.ts`)
 * and `boite team` (`team-cli.ts`). `require` and not `import()` for the
 * store and the methods: the core builds its stores in its constructor,
 * which cannot wait.
 */
import type { Core } from './core.ts';
import type { TeamStore } from './teams/store.ts';

/** The team store. */
export function teamStore(core: Core): TeamStore {
  return new (require('./teams/store.ts') as typeof import('./teams/store.ts')).TeamStore(core);
}

/** The team methods. */
export function registerTeamMethods(core: Core): void {
  (require('./teams/rpc.ts') as typeof import('./teams/rpc.ts')).registerTeams(core);
}

/** `boite team` (`team-cli.ts`), loaded when the command runs. */
export function teamCli(): Promise<typeof import('./team-cli.ts')> {
  return import('./team-cli.ts');
}
