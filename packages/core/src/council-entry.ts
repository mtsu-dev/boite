/**
 * The one way to the Council's store and RPC methods in the core
 * (`council/store.ts`, `council/rpc.ts`); its commands load beside it in
 * `delegate-cli.ts`. The flag is written in full because a bundler folds
 * nothing less direct (`packages/contracts/src/experiments.ts`): in a build
 * below the Council's tag it is `false`, the `require` calls below are
 * dropped and the bundle holds neither module. From source and in tests it
 * is not defined. `require` and not `import()`: the core builds its stores in
 * its constructor, which cannot wait.
 *
 * A build without the Council gets a stand-in that answers what the rest of
 * the core asks of the store: it is off, owns no thread and runs nothing, and
 * every method is refused with the tag and the build. The tables stay in the
 * journal (`council/journal.ts`), so what a Nightly left is kept and ignored
 * (docs/internals/experiments.md#out-of-the-build).
 */
import { experimentRefusal } from '@boite/contracts';
import type { Core } from './core.ts';
import type { CouncilStore } from './council/store.ts';
import { refused } from './errors.ts';

const METHODS = ['council.start', 'council.again', 'council.list', 'council.get', 'council.table', 'council.post', 'council.closeRound', 'council.stop'] as const;

/** What the core calls on the store from outside `council/`, for a build without it. */
function standIn(): CouncilStore {
  const store: Pick<CouncilStore, 'enabled' | 'owns' | 'memberOf' | 'running' | 'overFor' | 'stopParent' | 'resumeAfterRestart' | 'beginClose' | 'close'> = {
    enabled: () => false,
    owns: () => false,
    memberOf: () => false,
    running: () => false,
    overFor: () => false,
    stopParent: () => 0,
    resumeAfterRestart() {},
    beginClose() {},
    close() {},
  };
  return store as CouncilStore;
}

/** The council store of this build. */
export function councilStore(core: Core): CouncilStore {
  if (typeof __BOITE_HAS_DEBATES__ === 'undefined' || __BOITE_HAS_DEBATES__) return new (require('./council/store.ts') as typeof import('./council/store.ts')).CouncilStore(core);
  return standIn();
}

/** The council methods of this build: the real ones, or a refusal under each name. */
export function registerCouncilMethods(core: Core, probe: Parameters<typeof import('./council/rpc.ts').registerCouncil>[1]): void {
  if (typeof __BOITE_HAS_DEBATES__ === 'undefined' || __BOITE_HAS_DEBATES__) return (require('./council/rpc.ts') as typeof import('./council/rpc.ts')).registerCouncil(core, probe);
  for (const method of METHODS) core.router.register(method, () => { throw refused(experimentRefusal('debates', core.version) ?? 'the Council is not in this build', { reason: 'experiment-off' }); });
}
