/**
 * Stored teams, posts and removal operations used even when the Teams
 * runtime is cut from a Release. Delivery and recovery live in the runtime.
 */
import {
  experimentStartRefusal, teamPostVisible, TEAM_OWNER,
  type AgentLetter, type AgentProfile, type RequestId, type RpcParams, type Team, type TeamAsk, type TeamAudience,
  type TeamDelivery, type TeamMember, type TeamParty, type TeamPost, type TeamReading,
} from '@boite/contracts';
import type { Core } from '../core.ts';
import type { TeamOperation } from '../coordination-wire.ts';
import { invalidParams, notFound, refused } from '../errors.ts';
import { foldMachine } from '../threads/group-spawn.ts';

type TeamRow = { id: string; host: string; version: number; thread_id: string; last_seq: number; data: string; created_at: number; updated_at: number };
export type PostRow = {
  team_id: string; seq: number; id: string; fingerprint: string; author: string; text: string; audience: TeamAudience; to_keys: string;
  routed_by: TeamPost['routedBy']; why: string | null; in_reply_to: string | null; turn_id: string | null; notice: string | null; created_at: number;
};
export type Stored = Pick<Team, 'name' | 'brief' | 'members' | 'dispatcher' | 'paused' | 'archived' | 'createdBy'>;
export type TeamPeerReport = Pick<TeamDelivery, 'postId' | 'member' | 'reason'> & { state: 'delivered' | 'rejected' | 'expired' };

/** A moved bot takes its pending posts to the next machine. */
export const MOVED = 'moved to another machine';

/** What a row keeps of a team: the machine a member shows is said by the machine showing it. */
export const storedOf = (team: Stored): Stored => ({
  name: team.name, brief: team.brief, dispatcher: team.dispatcher, paused: team.paused, archived: team.archived, createdBy: team.createdBy,
  members: team.members.map(member => { const kept = { ...member }; delete kept.machine; return kept; }),
});

export function teamParams<T>(params: T | undefined | null): T {
  if (params === null || typeof params !== 'object') throw invalidParams('params: expected an object');
  return params;
}

export class StoredTeams {
  constructor(protected readonly core: Core) {}

  allowStart(): void {
    const message = experimentStartRefusal('teams', this.core.version);
    if (message !== null) throw refused(message, { reason: 'experiment-off' });
  }

  protected get db() { return this.core.journal.db; }
  protected get self(): string { return this.core.coordination.card().coreId; }

  // Teams.

  #team(row: TeamRow): Team {
    const stored = JSON.parse(row.data) as Stored;
    const members = stored.members.map(member => this.#shown(member));
    return { id: row.id, host: row.host, version: row.version, ...stored, members, threadId: row.thread_id, lastSeq: row.last_seq, createdAt: row.created_at, updatedAt: row.updated_at };
  }

  /** A member as this machine shows it: named as it is now, with its machine when it runs elsewhere. */
  #shown(member: TeamMember): TeamMember {
    const shown: TeamMember = { ...member, name: this.botName(member) };
    if (member.coreId === this.self) delete shown.machine;
    else shown.machine = this.machineName(member.coreId);
    return shown;
  }

  /** A team's row data, when another machine holds the team. */
  rowData(team: Stored): string { return JSON.stringify(storedOf(team)); }

  /** A machine of the group by name; one that left it by the start of its id. */
  machineName(coreId: string): string {
    return this.core.group.peers().find(peer => peer.coreId === coreId)?.name ?? coreId.slice(0, 8);
  }

  get(teamId: string): Team | null {
    const row = this.db.query('SELECT * FROM teams WHERE id = ?').get(teamId) as TeamRow | null;
    return row ? this.#team(row) : null;
  }

  /** A team this machine holds: the owner changes a team where it is held. */
  protected require(teamId: unknown): Team {
    const team = typeof teamId === 'string' ? this.get(teamId) : null;
    if (!team || team.host !== this.self) throw notFound(`teamId: no team ${JSON.stringify(teamId)}`, { field: 'teamId' });
    return team;
  }

  protected all(): Team[] { return (this.db.query('SELECT * FROM teams ORDER BY created_at').all() as TeamRow[]).map(row => this.#team(row)); }

  /** The teams this machine holds, the only ones its owner sees here: a mirror shows on the machine holding its team. */
  hosted(): Team[] { return this.all().filter(team => team.host === this.self); }

  /** A bot of this machine in a team. Its key stays the one it joined with; `coreId` says where it runs now. */
  memberHere(team: Pick<Team, 'members'>, botId: string): TeamMember | undefined {
    return team.members.find(member => member.botId === botId && member.coreId === this.self);
  }

  /** The team a bot names, by id or name, among the teams it belongs to; the owner (`null`) names any team held here. */
  #named(ref: unknown, botId: string | null): Team {
    const wanted = typeof ref === 'string' ? ref.trim() : '';
    if (!wanted) throw invalidParams('team: expected a team name or id');
    const mine = botId === null ? this.hosted() : this.all().filter(team => this.memberHere(team, botId) !== undefined);
    const byId = mine.find(team => team.id === wanted);
    // Two machines may each hold a team of that name, with the same bot in both.
    const named = mine.filter(team => !team.archived && team.name.toLowerCase() === wanted.toLowerCase());
    if (!byId && named.length > 1) throw refused(`team: ${named.length} of your teams are named ${JSON.stringify(wanted)}; name one by id: ${named.map(team => team.id).join(', ')}`, { field: 'team' });
    const found = byId ?? named[0];
    if (!found) throw refused(`team: no team ${JSON.stringify(wanted)}${botId === null ? '' : ' you are a member of'}; yours: ${mine.filter(team => !team.archived).map(team => team.name).join(', ') || 'none'}`, { field: 'team' });
    return found;
  }

  protected botName(member: Pick<TeamMember, 'coreId' | 'botId' | 'name'>): string {
    if (member.coreId !== this.self) return member.name;
    return this.core.workforce.records.find('profile', member.botId)?.name ?? member.name;
  }

  /** The bot whose own thread calls. */
  caller(threadId: unknown): AgentProfile {
    const bot = typeof threadId === 'string' ? this.core.workforce.agentOfThread(threadId) : null;
    if (!bot) throw refused('threadId: teams are for mochis; this thread is no mochi\'s conversation', { field: 'threadId' });
    return bot;
  }

  /** A team the calling bot belongs to, and its key there. */
  mine(threadId: unknown, ref: unknown): { team: Team; bot: AgentProfile; key: TeamParty } {
    const bot = this.caller(threadId);
    const team = this.#named(ref, bot.id);
    return { team, bot, key: this.memberHere(team, bot.id)!.key };
  }

  /** A member by key, by bot id or by a name no other member has; `<machine>/<bot>` tells a shared name apart. */
  member(team: Team, ref: unknown, field: string): TeamMember {
    const wanted = typeof ref === 'string' ? ref.trim() : '';
    const exact = team.members.find(entry => entry.key === wanted || entry.botId === wanted);
    if (exact) return exact;
    const same = (entry: TeamMember, name: string) => entry.botId === name || entry.name.toLowerCase() === name.toLowerCase();
    let named = team.members.filter(entry => same(entry, wanted));
    const slash = wanted.indexOf('/');
    if (named.length === 0 && slash > 0) named = team.members.filter(entry => this.#onMachine(entry, wanted.slice(0, slash)) && same(entry, wanted.slice(slash + 1).trim()));
    if (named.length === 1) return named[0]!;
    throw refused(named.length > 1 ? `${field}: ${named.length} members are named ${JSON.stringify(wanted)}; name one by id: ${named.map(entry => entry.botId).join(', ')}`
      : `${field}: ${JSON.stringify(wanted)} is no member of ${team.name}`, { field });
  }

  #onMachine(member: TeamMember, query: string): boolean {
    const wanted = query.trim();
    if (member.coreId === wanted || (/^[0-9a-f]{6,}$/.test(wanted) && member.coreId.startsWith(wanted))) return true;
    const here = this.core.group.view('owner')?.cores.find(entry => entry.coreId === this.self)?.name ?? this.core.info().hostname ?? '';
    return foldMachine(member.machine ?? here) === foldMachine(wanted);
  }

  /** A bot as a card and an answer name it: with its machine when it runs elsewhere. */
  protected label(bot: { coreId: string; name: string }): string {
    return bot.coreId === this.self ? bot.name : `${bot.name} (${this.machineName(bot.coreId)})`;
  }

  /** A member's own thread on this machine. */
  threadOf(member: TeamMember): string | null {
    if (member.coreId !== this.self) return null;
    try { return this.core.workforce.open(member.botId).threadId; } catch { return null; }
  }

  changed(team: Pick<Team, 'id' | 'version'>): void { this.core.bus.emit('teams.changed', { teamId: team.id, version: team.version }); }

  /** Saves a change of the team: its version moves on, so a member on another machine can tell it apart. */
  save(team: Team, change: Partial<Stored>): Team {
    const next: Team = { ...team, ...change, version: team.version + 1, updatedAt: Date.now() };
    const stored = storedOf(next);
    this.core.journal.append({ type: 'teams.saved', threadId: team.threadId, version: 1, payload: { teamId: team.id, version: next.version, ...stored } }, db => {
      const saved = db.query('UPDATE teams SET version = ?, data = ?, updated_at = ? WHERE id = ? AND version = ?').run(next.version, JSON.stringify(stored), next.updatedAt, team.id, team.version);
      if (saved.changes !== 1) throw refused(`${team.name} changed meanwhile; read it again`, { field: 'teamId' });
      this.trackMembers(team.id, team.members, next.members);
    });
    this.changed(next);
    this.teamSaved(team.id);
    return this.get(team.id)!;
  }

  list(params: RpcParams<'teams.list'> = {}): Team[] {
    const botId = params.threadId === undefined ? null : this.caller(params.threadId).id;
    return (botId === null ? this.hosted() : this.all().filter(team => this.memberHere(team, botId) !== undefined))
      .filter(team => params.archived === true || !team.archived);
  }

  archive(params: RpcParams<'teams.archive'>): Team {
    const team = this.require(params.teamId);
    if (typeof params.archived !== 'boolean') throw invalidParams('archived: expected a boolean');
    if (team.archived === params.archived) return team;
    if (!params.archived) {
      this.allowStart();
      return this.restoreTeam(team);
    }
    const archived = this.save(team, { archived: true });
    this.core.coordination.teamLetters.reject(team.id, null, `The team ${team.name} was archived`);
    return archived;
  }

  protected restoreTeam(team: Team): Team { return this.save(team, { archived: false }); }

  protected trackMembers(_teamId: string, _before: readonly TeamMember[], _after: readonly TeamMember[]): void {}
  protected teamSaved(_teamId: string): void {}

  removeMember(params: RpcParams<'teams.members.remove'>): Team {
    const team = this.require(params.teamId);
    const ask = params.card === undefined ? null : this.card(params.card, 'leave');
    if (ask !== null && ask.kind === 'leave' && ask.teamId !== team.id) throw refused(`card: it asks about another team, ${ask.teamName}`, { field: 'card' });
    const member = this.member(team, params.botId, 'botId');
    const saved = this.save(team, { members: team.members.filter(entry => entry.key !== member.key) });
    const threadId = this.threadOf(member);
    const reason = `${member.name} left the team ${team.name}`;
    if (threadId !== null) this.core.coordination.teamLetters.reject(team.id, threadId, reason);
    this.core.journal.append({ type: 'teams.member.removed', threadId: team.threadId, version: 1, payload: { teamId: team.id, member: member.key } }, db => {
      // A post interrupted before its letter has none to reject: its delivery ends with the membership too.
      db.query("UPDATE team_deliveries SET state = 'rejected', reason = ?, at = ? WHERE member = ? AND state = 'waiting' AND post_id IN (SELECT id FROM team_posts WHERE team_id = ?)")
        .run(reason, Date.now(), member.key, team.id);
      db.query('DELETE FROM team_cursors WHERE team_id = ? AND member = ?').run(team.id, member.key);
      db.query('DELETE FROM team_seen WHERE team_id = ? AND member = ?').run(team.id, member.key);
    });
    if (params.card !== undefined) this.settle(params.card, `applied: ${this.label(member)} left ${team.name}`);
    return saved;
  }

  toPost(row: PostRow): TeamPost {
    return {
      id: row.id, teamId: row.team_id, seq: row.seq, author: row.author, text: row.text, audience: row.audience, to: JSON.parse(row.to_keys) as TeamParty[],
      routedBy: row.routed_by, why: row.why, inReplyTo: row.in_reply_to, turnId: row.turn_id, fingerprint: row.fingerprint, createdAt: row.created_at,
      ...(row.notice === null ? {} : { notice: row.notice }),
    };
  }

  postAt(teamId: string, seq: number): TeamPost | null {
    const row = this.db.query('SELECT * FROM team_posts WHERE team_id = ? AND seq = ?').get(teamId, seq) as PostRow | null;
    return row ? this.toPost(row) : null;
  }

  queuePeer(coreId: string, operation: TeamOperation, payload: unknown): void {
    this.db.query('INSERT INTO team_outbox (core_id, operation, payload, at) VALUES (?, ?, ?, ?)').run(coreId, operation, JSON.stringify(payload), Date.now());
  }

  /** Persists a letter's final delivery state, including cancellations while Teams are held. */
  settleDeliveries(team: Team, member: TeamMember, letter: AgentLetter): TeamPeerReport[] {
    const { status } = letter;
    if (letter.error === MOVED || (status !== 'delivered' && status !== 'rejected' && status !== 'expired')) return [];
    const reports: TeamPeerReport[] = [];
    const reason = status === 'delivered' ? null : letter.error;
    for (const seq of letter.team?.triggers ?? []) {
      const post = this.postAt(team.id, seq);
      if (!post) continue;
      this.db.query('UPDATE team_deliveries SET state = ?, reason = ?, letter_id = ?, at = ? WHERE post_id = ? AND member = ?').run(status, reason, letter.id, Date.now(), post.id, member.key);
      reports.push({ postId: post.id, member: member.key, state: status, reason });
    }
    return reports;
  }

  /** Posts before `before`, the newest page, oldest first; a bot reads only what it may see. */
  read(params: RpcParams<'teams.read'>): TeamReading {
    if (params.threadId !== undefined) {
      const { team, key } = this.mine(params.threadId, params.team);
      return this.page(team, key, params);
    }
    return this.page(this.#named(params.team, null), TEAM_OWNER, params);
  }

  /** A page of what `reader` may see of a team held here. */
  page(team: Team, reader: TeamParty, params: Pick<RpcParams<'teams.read'>, 'before' | 'limit'>): TeamReading {
    const limit = params.limit === undefined ? 30 : params.limit;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw invalidParams('limit: expected 1 to 100');
    const before = params.before === undefined ? Number.MAX_SAFE_INTEGER : params.before;
    if (!Number.isSafeInteger(before) || before < 1) throw invalidParams('before: expected a post number');
    const posts: TeamPost[] = [];
    let more = false;
    const statement = this.db.prepare('SELECT * FROM team_posts WHERE team_id = ? AND seq < ? ORDER BY seq DESC');
    try {
      for (const row of statement.iterate(team.id, before) as Iterable<PostRow>) {
        const post = this.toPost(row);
        if (!teamPostVisible(post, reader)) continue;
        if (posts.length === limit) { more = true; break; }
        posts.push(post);
      }
    } finally { statement.finalize(); }
    posts.reverse();
    const deliveries = reader !== TEAM_OWNER || posts.length === 0 ? [] : (this.db.query('SELECT post_id, member, state, reason, at FROM team_deliveries WHERE post_id IN (SELECT value FROM json_each(?))')
      .all(JSON.stringify(posts.map(post => post.id))) as { post_id: string; member: string; state: TeamDelivery['state']; reason: string | null; at: number }[])
      .map(row => ({ postId: row.post_id, member: row.member, state: row.state, reason: row.reason, at: row.at }));
    return { team, posts, deliveries, more };
  }

  card(card: RequestId, kind: TeamAsk['kind']): TeamAsk {
    const ask = this.core.threads.listQuestions().find(request => request.id === card)?.team;
    if (ask === undefined || ask.kind !== kind) throw notFound(`card: ${String(card)} is no open team ${kind} card`, { field: 'card' });
    return ask;
  }

  settle(card: RequestId, text: string): void {
    this.core.threads.cards.settle(request => (request.id === card ? { optionIds: [], text } : null), 'the owner');
  }

  protected draw(threadId: string, text: string, team: TeamAsk): { questionId: RequestId } {
    const thread = this.core.threads.require(threadId);
    if (thread.archived) throw refused('cannot ask on an archived thread', { threadId });
    if (this.core.threads.listQuestions(threadId).some(request => request.team !== undefined && JSON.stringify(request.team) === JSON.stringify(team))) {
      throw refused('the same card is already open in this thread; the owner has not answered it yet', { field: 'card' });
    }
    return this.core.threads.cards.drawAsync(thread, { text, options: [{ id: 'refuse', label: 'Refuse' }], allowText: false, multiple: false, async: true, team });
  }

  leave(params: RpcParams<'teams.leave'>): { questionId: RequestId } {
    const { team, bot } = this.mine(params.threadId, params.team);
    return this.draw(params.threadId, `${bot.name} asks to leave the team ${JSON.stringify(team.name)}.`, { kind: 'leave', by: bot.id, teamId: team.id, teamName: team.name, botId: bot.id });
  }
}
