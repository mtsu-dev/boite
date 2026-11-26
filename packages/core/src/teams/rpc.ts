/**
 * The team methods (`docs/internals/teams.md`). Who may call which is in `access.ts`. A
 * method that may have to reach another machine goes through `TeamPeers`.
 */
import { markFeature } from '@boite/contracts';
import type { Core } from '../core.ts';
import { teamParams } from './records.ts';

markFeature('boite-feature:teams');

export function registerTeams(core: Core): void {
  const teams = () => core.teams;
  const machines = () => core.teams.peers;
  core.router.register('teams.create', params => machines().create(teamParams(params)));
  core.router.register('teams.update', params => teams().update(teamParams(params)));
  core.router.register('teams.members.add', params => machines().addMember(teamParams(params)));
  core.router.register('teams.pause', params => teams().pause(teamParams(params)));
  core.router.register('teams.post', params => teams().ownerPost(teamParams(params)));
  core.router.register('teams.say', params => machines().say(teamParams(params)));
  core.router.register('teams.dm', params => machines().dm(teamParams(params)));
  core.router.register('teams.propose', params => machines().propose(teamParams(params)));
  core.router.register('teams.invite', params => machines().invite(teamParams(params)));
}
