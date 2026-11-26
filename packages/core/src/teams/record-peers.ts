/**
 * Group calls that can still read an existing team or remove a member
 * while the Teams runtime is held off.
 */
import type { CoordinationPeer, RequestId, RpcParams, Team, TeamMember, TeamReading } from '@boite/contracts';
import type { Core } from '../core.ts';
import { PeerGone, PeerRefusal, type TeamOperation } from '../coordination-wire.ts';
import { invalidParams, messageOf, refused, unavailable, type RpcFailure } from '../errors.ts';
import type { StoredTeams } from './records.ts';

export type Fields = Record<string, unknown>;

export const OK = { ok: true };

export function fields(value: unknown, field: string): Fields {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw invalidParams(`${field}: expected an object`);
  return value as Fields;
}

/** A core that does not know the operation refuses it by name. */
export const tooOld = (error: unknown): boolean => error instanceof PeerRefusal && error.message.startsWith('operation: expected');

export function teamPeerFailure(peer: CoordinationPeer, error: unknown, away: string): RpcFailure {
  if (error instanceof PeerGone) return refused(`${peer.name} removed this machine from its group`, { reason: 'removed' });
  if (tooOld(error)) return refused(`Boite on ${peer.name} is too old for teams across machines; update it first`, { reason: 'peer-too-old' });
  if (error instanceof PeerRefusal) {
    const experimentOff = error.message.startsWith('experiment.teams ') || error.message.includes('Teams experiment');
    return refused(`${peer.name}: ${error.message}`, { reason: experimentOff ? 'experiment-off' : 'peer-refused' });
  }
  return unavailable(`${peer.name} did not answer (${messageOf(error)}); ${away}`, { reason: 'unreachable' });
}

export class TeamRecordPeers {
  readonly #core: Core;
  readonly #store: StoredTeams;

  constructor(core: Core, store: StoredTeams) {
    this.#core = core;
    this.#store = store;
  }

  get #self(): string { return this.#core.coordination.card().coreId; }

  /** A team held here, by what another machine named. */
  hosted(teamId: unknown): Team {
    const team = typeof teamId === 'string' ? this.#store.get(teamId) : null;
    if (team === null || team.host !== this.#self) throw refused(`teamId: this machine holds no team ${JSON.stringify(teamId)}`, { field: 'teamId' });
    return team;
  }

  /** The member a machine speaks for: the team says where the bot runs, and the group says who asks. What the payload claims decides nothing else. */
  speaker(team: Team, peer: CoordinationPeer, botId: unknown): TeamMember {
    const member = team.members.find(entry => entry.botId === botId && entry.coreId === peer.coreId);
    if (member === undefined) throw refused(`botId: ${JSON.stringify(botId)} is no member of ${team.name} on ${peer.name}`, { field: 'botId', reason: 'not-your-bot' });
    return member;
  }

  readFromPeer(peer: CoordinationPeer, raw: Fields): TeamReading {
    const team = this.hosted(raw.teamId);
    const member = this.speaker(team, peer, raw.botId);
    return this.#store.page(team, member.key, { before: raw.before as number | undefined, limit: raw.limit as number | undefined });
  }

  ownerTeam(peer: CoordinationPeer, teamId: unknown): Team {
    const team = this.hosted(teamId);
    if (!team.members.some(member => member.coreId === peer.coreId)) throw refused(`teamId: ${peer.name} has no mochi in ${team.name}`, { field: 'teamId', reason: 'not-your-bot' });
    return team;
  }

  removeFromPeer(peer: CoordinationPeer, raw: Fields): typeof OK {
    const team = this.ownerTeam(peer, raw.teamId);
    const member = team.members.find(entry => entry.botId === raw.botId);
    if (member === undefined) return OK;
    if (member.coreId !== peer.coreId) throw refused(`botId: ${member.name} runs on another machine`, { field: 'botId', reason: 'not-your-bot' });
    this.#store.removeMember({ teamId: team.id, botId: member.botId });
    return OK;
  }

  async answer(peer: CoordinationPeer, operation: TeamOperation, payload: unknown): Promise<unknown> {
    if (operation === 'team.read') return this.readFromPeer(peer, fields(payload, 'payload'));
    if (operation === 'team.owner') {
      const raw = fields(payload, 'payload');
      if (raw.action === 'remove') return this.removeFromPeer(peer, raw);
    }
    this.#store.allowStart();
  }

  async removeMember(params: RpcParams<'teams.members.remove'>): Promise<Team> {
    const team = typeof params.teamId === 'string' ? this.#store.get(params.teamId) : null;
    if (team === null || team.host === this.#self) return this.#store.removeMember(params);
    const card = this.heldElsewhere(team, params.card);
    const ask = this.#store.card(card, 'leave');
    if (ask.kind === 'leave' && ask.teamId !== team.id) throw refused(`card: it asks about another team, ${ask.teamName}`, { field: 'card' });
    const member = this.#store.member(team, params.botId, 'botId');
    await this.ask(team, 'team.owner', { action: 'remove', teamId: team.id, botId: member.botId });
    this.#store.settle(card, `applied: ${member.name} left ${team.name}`);
    return this.#store.get(team.id) ?? team;
  }

  /** Only a card of the owner's changes a team from another machine than the one holding it. */
  heldElsewhere(team: Team, card: RequestId | undefined): RequestId {
    if (card === undefined) throw refused(`teamId: ${team.name} is held by ${this.#store.machineName(team.host)}; change it there`, { field: 'teamId' });
    return card;
  }

  async read(params: RpcParams<'teams.read'>): Promise<TeamReading> {
    if (params.threadId === undefined) return this.#store.read(params);
    const { team, bot, key } = this.#store.mine(params.threadId, params.team);
    if (team.host === this.#self) return this.#store.page(team, key, params);
    // Only the holder has every post this bot may read: a mirror leaves out the private ones it wrote.
    const reading = await this.ask(team, 'team.read', { teamId: team.id, botId: bot.id, before: params.before, limit: params.limit }) as TeamReading;
    return { ...reading, team };
  }

  holder(team: Team): CoordinationPeer {
    const peer = this.#core.group.peers().find(entry => entry.coreId === team.host);
    if (peer === undefined) throw refused(`${team.name} is held by ${this.#store.machineName(team.host)}, which is no longer in this machine's group`, { field: 'team', reason: 'host-gone' });
    return peer;
  }

  async ask(team: Team, operation: TeamOperation, payload: unknown): Promise<unknown> {
    const peer = this.holder(team);
    try {
      return await this.#core.coordination.request(peer, operation, payload);
    } catch (error) {
      throw teamPeerFailure(peer, error, 'try again once it is back');
    }
  }
}
