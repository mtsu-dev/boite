/**
 * The synchronous entry to the Teams runtime. A Release omits the code
 * that creates, delivers and recovers team activity. The existing records
 * and the methods that read or remove them stay available.
 */
import { experimentStartRefusal, featureRuns } from '@boite/contracts';
import { Usage } from './cli-args.ts';
import type { Core } from './core.ts';
import { TeamRecordPeers } from './teams/record-peers.ts';
import { StoredTeams, teamParams } from './teams/records.ts';
import type { TeamStore } from './teams/store.ts';
import { CORE_VERSION } from './version.ts';

const START_METHODS = [
  'teams.create', 'teams.update', 'teams.members.add', 'teams.pause', 'teams.post',
  'teams.say', 'teams.dm', 'teams.propose', 'teams.invite',
] as const;

class HeldTeams extends StoredTeams {
  readonly peers: TeamRecordPeers & Pick<TeamStore['peers'], 'heard'>;
  readonly snapshots: Pick<TeamStore['snapshots'], 'mayReceive' | 'render' | 'envelope' | 'letterChanged'> = {
    mayReceive: () => false,
    render: () => ({ texts: new Map(), leftovers: [], channel: null }),
    envelope() {},
    letterChanged: letter => {
      if (!letter.team || (letter.status !== 'expired' && letter.status !== 'rejected')) return;
      const team = this.get(letter.team.teamId);
      const bot = this.core.workforce.agentOfThread(letter.to.threadId);
      const member = team && bot ? this.memberHere(team, bot.id) : undefined;
      if (!team || !member) return;
      const reports = this.settleDeliveries(team, member, letter);
      if (team.host !== this.self && reports.length > 0) {
        this.queuePeer(team.host, 'team.report', { teamId: team.id, reports });
      }
    },
  };

  constructor(core: Core) {
    super(core);
    this.peers = Object.assign(new TeamRecordPeers(core, this), { heard() {} });
  }

  recover(): void {}
  close(): void {}
  memberMoved(): void {}
  botRenamed(): void {}
}

export function teamStore(core: Core): TeamStore {
  if ((typeof __BOITE_HAS_TEAMS__ === 'undefined' || __BOITE_HAS_TEAMS__) && featureRuns('teams', core.version)) {
    return new (require('./teams/store.ts') as typeof import('./teams/store.ts')).TeamStore(core);
  }
  // The runtime-only members are reachable only from modules behind the flag.
  return new HeldTeams(core) as unknown as TeamStore;
}

export function registerTeamMethods(core: Core): void {
  const teams = core.teams;
  core.router.register('teams.list', params => ({ teams: teams.list(teamParams(params ?? {})) }));
  core.router.register('teams.read', params => teams.peers.read(teamParams(params)));
  core.router.register('teams.archive', params => teams.archive(teamParams(params)));
  core.router.register('teams.members.remove', params => teams.peers.removeMember(teamParams(params)));
  core.router.register('teams.leave', params => teams.leave(teamParams(params)));
  if ((typeof __BOITE_HAS_TEAMS__ === 'undefined' || __BOITE_HAS_TEAMS__) && featureRuns('teams', core.version)) {
    (require('./teams/rpc.ts') as typeof import('./teams/rpc.ts')).registerTeams(core);
  } else {
    for (const method of START_METHODS) core.router.register(method, () => { teams.allowStart(); throw new Error('Teams are not in this build'); });
  }
}

/** `boite team` (`team-cli.ts`), loaded when the command runs. */
export async function teamCli(): Promise<typeof import('./team-cli.ts')> {
  if (typeof __BOITE_HAS_TEAMS__ === 'undefined' || __BOITE_HAS_TEAMS__) return import('./team-cli.ts');
  throw new Usage(`boite team: ${experimentStartRefusal('teams', CORE_VERSION) ?? 'Teams are not in this build'}`);
}
