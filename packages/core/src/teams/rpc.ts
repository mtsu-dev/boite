/**
 * The team methods (`docs/internals/teams.md`). Who may call which is in `access.ts`; the
 * machine holding a team refuses them while its `teams` experiment is off. A
 * method that may have to reach another machine goes through `TeamPeers`.
 */
import type { Core } from '../core.ts';
import { invalidParams } from '../errors.ts';

export function registerTeams(core: Core): void {
  const teams = () => core.teams;
  const machines = () => core.teams.peers;
  const object = <T>(params: T | undefined | null): T => {
    if (params === null || typeof params !== 'object') throw invalidParams('params: expected an object');
    return params;
  };
  core.router.register('teams.list', params => ({ teams: teams().list(object(params ?? {})) }));
  core.router.register('teams.create', params => machines().create(object(params)));
  core.router.register('teams.update', params => teams().update(object(params)));
  core.router.register('teams.archive', params => teams().archive(object(params)));
  core.router.register('teams.members.add', params => machines().addMember(object(params)));
  core.router.register('teams.members.remove', params => machines().removeMember(object(params)));
  core.router.register('teams.pause', params => teams().pause(object(params)));
  core.router.register('teams.post', params => teams().ownerPost(object(params)));
  core.router.register('teams.read', params => machines().read(object(params)));
  core.router.register('teams.say', params => machines().say(object(params)));
  core.router.register('teams.dm', params => machines().dm(object(params)));
  core.router.register('teams.propose', params => machines().propose(object(params)));
  core.router.register('teams.invite', params => machines().invite(object(params)));
  core.router.register('teams.leave', params => teams().leave(object(params)));
}

/** Marks this module in a bundle (scripts/ci/feature-cut.ts). */
export const FEATURE_MARKER = 'boite-feature:teams';
