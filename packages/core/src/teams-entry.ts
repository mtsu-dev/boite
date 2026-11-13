/**
 * The one way to the Teams' code in the core: the store with its peers,
 * snapshots and mirror (`teams/store.ts`) and the RPC methods
 * (`teams/rpc.ts`). The flag is written in full because a bundler folds
 * nothing less direct (`packages/contracts/src/experiments.ts`): in a build
 * below the Teams' tag it is `false`, the `require` calls below are dropped
 * and the bundle holds neither module. From source and in tests it is not
 * defined. `require` and not `import()`: the core builds its stores in its
 * constructor, which cannot wait.
 *
 * A build without the Teams gets a stand-in that answers what the rest of
 * the core asks of the store: no team, no letter received, every method
 * refused with the tag and the build. The tables stay in the journal
 * (`teams/journal.ts`), so what a Nightly left is kept and ignored
 * (docs/internals/experiments.md#out-of-the-build).
 */
import { experimentRefusal } from '@boite/contracts';
import type { Core } from './core.ts';
import { Usage } from './cli-args.ts';
import { refused } from './errors.ts';
import type { TeamStore } from './teams/store.ts';
import { CORE_VERSION } from './version.ts';

const METHODS = ['teams.list', 'teams.create', 'teams.update', 'teams.archive', 'teams.members.add', 'teams.members.remove', 'teams.pause', 'teams.post', 'teams.read', 'teams.say', 'teams.dm', 'teams.propose', 'teams.invite', 'teams.leave'] as const;

function absent(core: Core): Error {
  return refused(experimentRefusal('teams', core.version) ?? 'Teams are not in this build', { reason: 'experiment-off' });
}

/** What the core calls on the store from outside `teams/`, for a build without it. */
function standIn(core: Core): TeamStore {
  const store: Pick<TeamStore, 'recover' | 'close' | 'machineName' | 'memberMoved' | 'botRenamed'> & { peers: Pick<TeamStore['peers'], 'heard' | 'answer'>; snapshots: Pick<TeamStore['snapshots'], 'mayReceive' | 'render' | 'envelope' | 'letterChanged'> } = {
    recover() {},
    close() {},
    machineName: () => '',
    memberMoved() {},
    botRenamed() {},
    peers: { heard() {}, answer: async () => { throw absent(core); } },
    snapshots: { mayReceive: () => false, render: () => ({ texts: new Map(), leftovers: [], channel: null }), envelope() {}, letterChanged() {} },
  };
  return store as TeamStore;
}

/** The team store of this build. */
export function teamStore(core: Core): TeamStore {
  if (typeof __BOITE_HAS_TEAMS__ === 'undefined' || __BOITE_HAS_TEAMS__) return new (require('./teams/store.ts') as typeof import('./teams/store.ts')).TeamStore(core);
  return standIn(core);
}

/** The team methods of this build: the real ones, or a refusal under each name. */
export function registerTeamMethods(core: Core): void {
  if (typeof __BOITE_HAS_TEAMS__ === 'undefined' || __BOITE_HAS_TEAMS__) return (require('./teams/rpc.ts') as typeof import('./teams/rpc.ts')).registerTeams(core);
  for (const method of METHODS) core.router.register(method, () => { throw absent(core); });
}

/** `boite team` (`team-cli.ts`): the command, or in a build without the Teams a usage error that names the tag and the build. */
export async function teamCli(): Promise<typeof import('./team-cli.ts')> {
  if (typeof __BOITE_HAS_TEAMS__ === 'undefined' || __BOITE_HAS_TEAMS__) return import('./team-cli.ts');
  throw new Usage(`boite team: ${experimentRefusal('teams', CORE_VERSION) ?? 'Teams are not in this build'}`);
}
