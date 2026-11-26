/**
 * Teams of bots (`docs/internals/teams.md`): a few bots and the owner in one group. The
 * team chat is a projectless thread that runs no agent; each post is one turn
 * there. A post addressed to a bot becomes a team letter in its inbox
 * (`TeamLetters.accept`, `coordination-team.ts`), rendered from what that bot has not seen
 * yet (`snapshots.ts`). The machine that creates a team holds it: its posts, their order and its
 * chat. A machine with a member on it keeps a mirror (`mirror.ts`), the team's
 * row and the posts it may have, so a letter runs there as it does here.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  routeTeamPost, teamMemberKey, teamPostVisible, TEAM_BRIEF_MAX, TEAM_MEMBERS_MAX, TEAM_NAME_MAX, TEAM_OWNER, TEAM_POST_MAX,
  markFeature, type AgentProfile, type Message, type RequestId, type RpcParams, type Team, type TeamAudience,
  type TeamMember, type TeamParty, type TeamPost, type TeamPostRef, type ThreadSummary, type Turn,
} from '@boite/contracts';
import type { Core } from '../core.ts';
import { invalidParams, messageOf, refused } from '../errors.ts';
import { newId } from '../ids.ts';
import { RESIDENT_LETTER_TTL_MS } from '../coordination-letter.ts';
import { withLoad } from '../threads/records.ts';
import { TEAM_WAKE_MAX_MS } from './mirror.ts';
import { TeamPeers } from './peers.ts';
import { TeamSnapshots } from './snapshots.ts';
import { MOVED, StoredTeams, type PostRow, type Stored } from './records.ts';

type PostInput = { id: unknown; author: TeamParty; text: unknown; audience: TeamAudience; to?: TeamParty[]; inReplyTo?: unknown; turnId?: string | null };

/** A bot a team can take, on any machine of the group. */
export interface TeamBot { coreId: string; botId: string; name: string }

export class TeamStore extends StoredTeams {
  readonly #off: () => void;
  /** The team's other machines: what goes between them, and every command that may have to. */
  readonly peers: TeamPeers;
  /** What a team letter reads and what its turn answers. */
  readonly snapshots: TeamSnapshots;

  constructor(core: Core) {
    super(core);
    this.peers = new TeamPeers(core, this);
    this.snapshots = new TeamSnapshots(core, this);
    this.#off = core.bus.onAny((name, payload) => {
      if (name !== 'turn.finished' || core.journal.isClosed()) return;
      const turn = payload as Turn;
      try { this.snapshots.finished(turn); } catch (error) { core.log('warn', `teams after turn ${turn.id}: ${messageOf(error)}`); }
      // An answer a failure left unpublished gets another try at each turn's end.
      this.snapshots.replayAnswers();
    });
  }

  close(): void {
    this.#off();
    this.peers.close();
  }

  /**
   * After a restart, what a stopped core left half done: snapshots of
   * letters nothing will settle any more are released, recipients whose
   * letter was never written get it, and finished answers are posted.
   */
  recover(): void {
    this.snapshots.releaseOrphans();
    this.followMoves();
    this.repair();
    this.snapshots.replayAnswers();
    this.peers.start();
  }

  /** How a party reads in a prompt. */
  partyName(team: Team, party: TeamParty): string {
    if (party === TEAM_OWNER) return 'owner';
    const member = team.members.find(entry => entry.key === party);
    if (member) return this.botName(member);
    const botId = party.slice(party.indexOf('/') + 1);
    return this.core.workforce.records.find('profile', botId)?.name ?? party;
  }

  #key(botId: string): TeamParty { return teamMemberKey(this.self, botId); }

  /** A bot of this machine, by id or name, as a team takes it; one on its way to another machine joins once it arrived. */
  localBot(ref: unknown, field = 'members'): TeamBot {
    const bot = this.#find(ref, field);
    if (this.core.workforce.moves.moving(bot.id)) throw refused(`${field}: ${bot.name} is moving to another machine; name it there once it arrived`, { field, reason: 'moving' });
    return { coreId: this.self, botId: bot.id, name: bot.name };
  }

  /** Whether exactly this names a bot of this machine: a name may hold the slash of `<machine>/<bot>`. */
  namesLocalBot(wanted: string): boolean {
    return this.#live().some(agent => agent.id === wanted || agent.name.toLowerCase() === wanted.toLowerCase());
  }

  #live(): AgentProfile[] { return this.core.workforce.records.list('profile').filter(agent => agent.status !== 'archived'); }

  #find(ref: unknown, field: string): AgentProfile {
    const wanted = typeof ref === 'string' ? ref.trim() : '';
    if (!wanted) throw invalidParams(`${field}: expected a mochi name or id`);
    const live = this.#live();
    const byId = live.find(agent => agent.id === wanted);
    if (byId) return byId;
    const named = live.filter(agent => agent.name.toLowerCase() === wanted.toLowerCase());
    if (named.length === 1) return named[0]!;
    if (named.length > 1) throw refused(`${field}: ${named.length} mochis are named ${JSON.stringify(wanted)}; name it by id: ${named.map(agent => agent.id).join(', ')}`, { field });
    const elsewhere = this.core.group.peers().length > 0 ? '; a mochi of another machine is written <machine>/<mochi>' : '';
    throw refused(`${field}: no mochi ${JSON.stringify(wanted)}; the mochis are ${live.map(agent => agent.name).join(', ') || 'none yet'}${elsewhere}`, { field });
  }

  #checkName(value: unknown, except?: string): string {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > TEAM_NAME_MAX) throw invalidParams(`name: expected 1 to ${TEAM_NAME_MAX} characters`);
    const name = value.trim().replace(/\s+/g, ' ');
    if (name.startsWith('@')) throw invalidParams('name: a team name does not start with @');
    if (this.hosted().some(team => !team.archived && team.id !== except && team.name.toLowerCase() === name.toLowerCase())) throw refused(`name: a team is already named ${JSON.stringify(name)}`, { field: 'name' });
    return name;
  }

  #checkBrief(value: unknown): string {
    if (value === undefined) return '';
    if (typeof value !== 'string' || value.length > TEAM_BRIEF_MAX) throw invalidParams(`brief: expected at most ${TEAM_BRIEF_MAX} characters`);
    return value.trim();
  }

  /** The bots a list names; `elsewhere` holds what `TeamPeers` found on other machines, by the words given. */
  #bots(refs: unknown, elsewhere?: ReadonlyMap<string, TeamBot>): TeamBot[] {
    if (!Array.isArray(refs) || refs.length === 0 || refs.length > TEAM_MEMBERS_MAX) throw invalidParams(`members: expected 1 to ${TEAM_MEMBERS_MAX} mochis`);
    const bots = refs.map(ref => (typeof ref === 'string' ? elsewhere?.get(ref) : undefined) ?? this.localBot(ref));
    return bots.filter((bot, index) => bots.findIndex(other => other.botId === bot.botId) === index);
  }

  #joining(bot: TeamBot, joinedSeq: number): TeamMember {
    return { key: teamMemberKey(bot.coreId, bot.botId), coreId: bot.coreId, botId: bot.botId, name: bot.name, joinedSeq };
  }

  create(params: RpcParams<'teams.create'>, elsewhere?: ReadonlyMap<string, TeamBot>): Team {
    const ask = params.card === undefined ? null : this.card(params.card, 'create');
    const name = this.#checkName(params.name);
    const brief = this.#checkBrief(params.brief);
    const bots = this.#bots(params.members, elsewhere);
    // The chat runs no agent, yet a thread carries a selection: the one of a bot of this machine in the team.
    const local = bots.find(bot => bot.coreId === this.self);
    const first = local ? this.core.workforce.records.find('profile', local.botId) : null;
    if (!first) throw refused('members: name a mochi of this machine; the team stays here and needs one of its own', { field: 'members' });
    const id = randomUUID();
    const now = Date.now();
    const cwd = join(this.core.dataDir, 'teams', id);
    mkdirSync(cwd, { recursive: true });
    const thread: ThreadSummary = {
      id: newId('thr_'), projectId: null, teamId: id, title: name, titleSource: 'user', ...first.selection, speed: null, cwd, branch: null,
      status: 'idle', unread: false, archived: false, pinned: false, sessionId: null, sessionGeneration: 0, selectionVersion: 0, load: null, context: null, createdAt: now, updatedAt: now,
    };
    const stored: Stored = {
      name, brief, members: bots.map(bot => this.#joining(bot, 0)),
      dispatcher: null, paused: false, archived: false, createdBy: ask === null ? TEAM_OWNER : this.#key(ask.by),
    };
    this.core.journal.append({ type: 'thread.created', threadId: thread.id, version: 1, payload: thread }, db => {
      this.core.journal.putThread(thread);
      db.query('INSERT INTO teams (id, host, version, thread_id, last_seq, data, created_at, updated_at) VALUES (?, ?, 1, ?, 0, ?, ?, ?)').run(id, this.self, thread.id, JSON.stringify(stored), now, now);
      this.peers.track(id, [], stored.members);
    });
    this.core.bus.emit('thread.created', withLoad(this.core, thread));
    const team = this.get(id)!;
    this.changed(team);
    this.peers.kick(id);
    if (params.card !== undefined) this.settle(params.card, `applied: the team ${JSON.stringify(name)} exists, with ${team.members.map(member => this.label(member)).join(', ')}`);
    return team;
  }

  update(params: RpcParams<'teams.update'>): Team {
    const team = this.require(params.teamId);
    const change: Partial<Stored> = {};
    if (params.name !== undefined) change.name = this.#checkName(params.name, team.id);
    if (params.brief !== undefined) change.brief = this.#checkBrief(params.brief);
    const saved = this.save(team, change);
    if (change.name !== undefined && change.name !== team.name) {
      const thread = this.core.threads.require(team.threadId);
      const renamed = { ...thread, title: change.name, updatedAt: Date.now() };
      this.core.journal.append({ type: 'thread.updated', threadId: thread.id, version: 1, payload: renamed }, () => this.core.journal.putThread(renamed));
      this.core.bus.emit('thread.updated', withLoad(this.core, renamed));
    }
    return saved;
  }

  protected override restoreTeam(asked: Team): Team {
    const team = this.#followGone(asked);
    const saved = this.save(team, { archived: false });
    this.kickMembers(saved);
    return saved;
  }

  protected override trackMembers(teamId: string, before: readonly TeamMember[], after: readonly TeamMember[]): void {
    this.peers.track(teamId, before, after);
  }

  protected override teamSaved(teamId: string): void {
    this.peers.kick(teamId);
  }

  pause(params: RpcParams<'teams.pause'>): Team {
    const team = this.require(params.teamId);
    if (typeof params.paused !== 'boolean') throw invalidParams('paused: expected a boolean');
    if (team.paused === params.paused) return team;
    const saved = this.save(team, { paused: params.paused });
    // Resumed: the letters it held go now, not at the next sweep.
    if (!params.paused) this.kickMembers(saved);
    return saved;
  }

  /**
   * Moves made while this machine held Teams off (a Release): a mochi that
   * left still sits here in its teams. Each team follows it now, the one held
   * here and the one held elsewhere (`team.moved`); a move already taken
   * changes nothing on the machine holding the team. A team that reaches this
   * machine after its mochi left again (`moveMember`, `TeamMirror.take`)
   * follows it on the same way, one machine at a time.
   */
  followMoves(teams: Team[] = this.all()): void {
    const gone = new Map<string, string>();
    for (const team of teams) {
      for (const member of team.members) {
        if (member.coreId !== this.self || gone.has(member.botId) || this.core.workforce.records.find('profile', member.botId) !== null) continue;
        const to = this.core.workforce.moves.movedTo(member.botId);
        if (to !== null && to !== this.self) gone.set(member.botId, to);
      }
    }
    for (const [botId, to] of gone) this.memberMoved(botId, to);
  }

  /**
   * Members that left this machine before a move took their teams along: one
   * follows its bot to where the move's receipt says; one nothing is known of
   * leaves, or the team could never be restored.
   */
  #followGone(asked: Team): Team {
    let team = asked;
    for (const member of asked.members) {
      if (member.coreId !== this.self || this.core.workforce.records.find('profile', member.botId) !== null) continue;
      const to = this.core.workforce.moves.movedTo(member.botId);
      if (to !== null) { team = this.moveMember(team, member, to); continue; }
      this.core.log('warn', `team ${team.id}: ${member.name} is gone from this machine and no move says where; it leaves the team`);
      team = this.save(team, { members: team.members.filter(entry => entry.key !== member.key) });
    }
    return team;
  }

  kickMembers(team: Team): void {
    for (const member of team.members) {
      const threadId = this.threadOf(member);
      if (threadId !== null) this.core.coordination.teamLetters.kick(threadId);
    }
  }

  addMember(params: RpcParams<'teams.members.add'>, guest?: TeamBot): Team {
    const team = this.require(params.teamId);
    const ask = params.card === undefined ? null : this.card(params.card, 'invite');
    if (ask !== null && ask.kind === 'invite' && ask.teamId !== team.id) throw refused(`card: it asks about another team, ${ask.teamName}`, { field: 'card' });
    const bot = guest ?? this.localBot(params.botId, 'botId');
    if (team.archived) throw refused(`${team.name} is archived`, { field: 'teamId' });
    if (team.members.some(member => member.botId === bot.botId)) throw refused(`${bot.name} is already a member of ${team.name}`, { field: 'botId' });
    if (team.members.length >= TEAM_MEMBERS_MAX) throw refused(`a team holds at most ${TEAM_MEMBERS_MAX} mochis`, { field: 'botId' });
    // A new member starts reading after the posts already there; `boite team read` shows the older ones.
    const saved = this.save(team, { members: [...team.members, this.#joining(bot, team.lastSeq)] });
    if (params.card !== undefined) this.settle(params.card, `applied: ${this.label(bot)} joined ${team.name}`);
    return saved;
  }

  /**
   * A member now runs on `to`: its key stays, so posts and fingerprints hold.
   * Posts still waiting for it wait for it there; the ones too old to wake it
   * end here, as they do for a machine long away.
   */
  moveMember(team: Team, member: TeamMember, to: string): Team {
    const now = Date.now();
    let joinedSeq = team.lastSeq;
    this.core.journal.append({ type: 'teams.member.moved', threadId: team.threadId, version: 1, payload: { teamId: team.id, member: member.key, to } }, db => {
      const ofTeam = 'post_id IN (SELECT id FROM team_posts WHERE team_id = ?)';
      db.query(`UPDATE team_deliveries SET state = 'expired', reason = ?, at = ? WHERE member = ? AND state IN ('waiting', 'unreachable') AND post_id IN (SELECT id FROM team_posts WHERE team_id = ? AND created_at < ?)`)
        .run(`${member.name} moved after this post had waited too long`, now, member.key, team.id, now - TEAM_WAKE_MAX_MS);
      const oldest = db.query(`SELECT MIN(p.seq) AS seq FROM team_deliveries d JOIN team_posts p ON p.id = d.post_id WHERE p.team_id = ? AND d.member = ? AND d.state IN ('waiting', 'unreachable')`).get(team.id, member.key) as { seq: number | null };
      if (oldest.seq !== null) joinedSeq = Math.max(member.joinedSeq, oldest.seq - 1);
      db.query(`UPDATE team_deliveries SET state = 'waiting', reason = NULL, at = ? WHERE member = ? AND state IN ('waiting', 'unreachable') AND ${ofTeam}`).run(now, member.key, team.id);
      db.query('DELETE FROM team_cursors WHERE team_id = ? AND member = ?').run(team.id, member.key);
      db.query('DELETE FROM team_seen WHERE team_id = ? AND member = ?').run(team.id, member.key);
    });
    const saved = this.save(team, { members: team.members.map(entry => (entry.key === member.key ? { ...entry, coreId: to, joinedSeq } : entry)) });
    if (to === this.self) { this.repair(); this.followMoves([saved]); }
    return saved;
  }

  /**
   * A bot of this machine is leaving for `to`, which already holds it
   * (`agents/move.ts`): its letters here end, what it read here goes, and the
   * machine holding each team, this one or another, follows it. Archived teams
   * too: restoring one must not find a member nobody can reach.
   */
  memberMoved(botId: string, to: string): void {
    for (const team of this.all()) {
      const member = this.memberHere(team, botId);
      if (!member) continue;
      try {
        const threadId = this.threadOf(member);
        if (threadId !== null) this.core.coordination.teamLetters.reject(team.id, threadId, MOVED);
        if (team.host === this.self) { this.moveMember(team, member, to); continue; }
        this.core.journal.append({ type: 'teams.member.moved', threadId: null, version: 1, payload: { teamId: team.id, member: member.key, to } }, db => {
          db.query('DELETE FROM team_cursors WHERE team_id = ? AND member = ?').run(team.id, member.key);
          db.query('DELETE FROM team_seen WHERE team_id = ? AND member = ?').run(team.id, member.key);
          this.peers.queue(team.host, 'team.moved', { teamId: team.id, botId, to });
        });
      } catch (error) { this.core.log('warn', `team ${team.id} after ${member.name} moved: ${messageOf(error)}`); }
    }
  }

  /** A bot of this machine got a new name: a team held here keeps it and tells its machines; the holder of any other hears it. */
  botRenamed(botId: string): void {
    for (const team of this.all()) {
      const member = this.memberHere(team, botId);
      if (!member) continue;
      try {
        if (team.host === this.self) this.save(team, {});
        else this.peers.queue(team.host, 'team.report', { teamId: team.id, reports: [], names: { [botId]: member.name } });
      } catch (error) { this.core.log('warn', `team ${team.id} after ${member.name} was renamed: ${messageOf(error)}`); }
    }
  }

  // Posts.

  #postById(id: string): TeamPost | null {
    const row = this.db.query('SELECT * FROM team_posts WHERE id = ?').get(id) as PostRow | null;
    return row ? this.toPost(row) : null;
  }

  /**
   * One post: kept once by its id, ordered, routed (`routeTeamPost`), shown in
   * the team chat as a turn of its own, then handed to each recipient bot as a
   * team letter. A retry with the same id and content returns the first post.
   */
  #post(team: Team, input: PostInput): TeamPost {
    if (team.host !== this.self) throw refused(`${team.name} is held by ${this.machineName(team.host)}, which orders its posts`, { field: 'team' });
    const id = typeof input.id === 'string' ? input.id.trim() : '';
    if (!id || id.length > 100) throw invalidParams('id: expected 1 to 100 characters');
    const text = typeof input.text === 'string' ? input.text.trim() : '';
    if (!text || text.length > TEAM_POST_MAX) throw invalidParams(`text: expected 1 to ${TEAM_POST_MAX} characters`);
    const inReplyTo = input.inReplyTo === undefined || input.inReplyTo === null ? null : String(input.inReplyTo);
    const to = input.audience === 'private' ? [...new Set(input.to ?? [])] : [...new Set(input.to ?? [])].sort();
    const fingerprint = createHash('sha256').update(JSON.stringify([input.author, input.audience, to, text, inReplyTo])).digest('hex');
    const known = this.#postById(id);
    if (known) {
      if (known.teamId !== team.id || known.fingerprint !== fingerprint) throw refused('id: already used for a different post', { field: 'id' });
      // A retry after an interruption hands over the letters the first try did not.
      this.repair(known.id);
      this.peers.kick(team.id);
      return known;
    }
    if (team.archived) throw refused(`${team.name} is archived`, { field: 'team' });
    let replied: TeamPost | null = null;
    if (inReplyTo !== null) {
      replied = this.#postById(inReplyTo);
      if (!replied || replied.teamId !== team.id || !teamPostVisible(replied, input.author)) throw refused('inReplyTo: no post of this team you may read', { field: 'inReplyTo' });
    }
    if (input.audience === 'private') {
      const recipient = to[0];
      if (to.length !== 1 || recipient === undefined) throw invalidParams('to: a private post has exactly one recipient');
      if (recipient === input.author) throw refused('to: a private post goes to someone else', { field: 'to' });
      if (recipient !== TEAM_OWNER && !team.members.some(member => member.key === recipient)) throw refused('to: the recipient is no member of the team', { field: 'to' });
    }
    const routing = routeTeamPost(team, { author: input.author, text, audience: input.audience, to, inReplyTo }, replied?.author ?? null);
    const now = Date.now();
    const thread = this.core.threads.require(team.threadId);
    const turn: Turn = {
      id: newId('trn_'), threadId: thread.id, status: 'done', queuedAt: now, startedAt: now, finishedAt: now, usage: null, error: null,
      execution: { providerId: thread.providerId, accountId: thread.accountId, model: thread.model, effort: thread.effort, speed: null, permissionMode: thread.permissionMode, sessionId: null, sessionGeneration: 0, selectionVersion: 0 },
    };
    let post: TeamPost | null = null;
    let message: Message | null = null;
    let chat: ThreadSummary | null = null;
    this.core.journal.append({ type: 'teams.posted', threadId: thread.id, version: 1, payload: { teamId: team.id, id, author: input.author } }, db => {
      const seq = (db.query('SELECT last_seq FROM teams WHERE id = ?').get(team.id) as { last_seq: number }).last_seq + 1;
      post = {
        id, teamId: team.id, seq, author: input.author, text, audience: input.audience, to: input.audience === 'private' ? to : routing.to, routedBy: routing.routedBy,
        why: null, inReplyTo, turnId: input.turnId ?? null, fingerprint, createdAt: now, ...(routing.notice ? { notice: routing.notice } : {}),
      };
      db.query(`INSERT INTO team_posts (team_id, seq, id, fingerprint, author, text, audience, to_keys, routed_by, why, in_reply_to, turn_id, notice, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`).run(team.id, seq, id, fingerprint, input.author, text, input.audience, JSON.stringify(post.to), post.routedBy, inReplyTo, post.turnId, routing.notice ?? null, now);
      db.query('UPDATE teams SET last_seq = ? WHERE id = ?').run(seq, team.id);
      for (const recipient of post.to) {
        if (recipient !== TEAM_OWNER) db.query('INSERT OR REPLACE INTO team_deliveries (post_id, member, state, reason, letter_id, at) VALUES (?, ?, ?, ?, NULL, ?)').run(id, recipient, 'waiting', null, now);
      }
      const ref: TeamPostRef = { id, teamId: team.id, seq, author: post.author, audience: post.audience, to: post.to, routedBy: post.routedBy, inReplyTo, ...(post.notice ? { notice: post.notice } : {}) };
      message = { id: newId('msg_'), threadId: thread.id, turnId: turn.id, role: input.author === TEAM_OWNER ? 'user' : 'assistant', parts: [{ type: 'text', text, teamPost: ref }], state: 'complete', createdAt: now };
      this.core.journal.putTurn(turn);
      this.core.journal.putMessage(message);
      // A bot's post is news in the team chat, as a finished turn is in a thread; the owner's own is not.
      chat = { ...thread, updatedAt: now, unread: input.author === TEAM_OWNER ? thread.unread : thread.unread || !this.core.subscribers.hasSubscribers(thread.id) };
      this.core.journal.putThread(chat);
    });
    this.core.bus.emit('message.started', message!);
    this.core.bus.emit('message.completed', { threadId: thread.id, messageId: message!.id, state: 'complete' });
    this.core.bus.emit('thread.updated', withLoad(this.core, chat!));
    const saved = post as unknown as TeamPost;
    // A private post to the owner reaches the owner's devices; group posts wait in the chat.
    if (saved.audience === 'private' && saved.to[0] === TEAM_OWNER) this.core.push.teamPost(thread.id, `${this.partyName(team, saved.author)}: ${text}`, `team-post-${saved.id}`);
    this.changed(team);
    this.#hand(team, saved);
    this.peers.kick(team.id);
    return saved;
  }

  /** A post of a member of another machine, `author` being what this machine found for the machine asking. */
  postAs(team: Team, input: PostInput): TeamPost { return this.#post(team, input); }

  /** Each recipient's letter. */
  #hand(team: Team, post: TeamPost): void {
    for (const recipient of post.to) {
      const member = team.members.find(entry => entry.key === recipient);
      const threadId = member ? this.threadOf(member) : null;
      if (threadId !== null) this.#accept(team, threadId, post.seq, post.author === TEAM_OWNER);
    }
  }

  /** The post stands: a letter that fails is logged and its delivery stays `waiting` until a retried id or the next start repairs it (`repair`). */
  #accept(team: Team, threadId: string, seq: number, owner: boolean): void {
    try { this.core.coordination.teamLetters.accept(team, threadId, seq, owner); } catch (error) { this.core.log('warn', `teams letter of #${seq} in ${team.id}: ${messageOf(error)}`); }
  }

  /**
   * A post committed before its letters: a recipient still `waiting` with no
   * letter of that team carrying the post gets one now. Letters live six
   * hours, so older posts are left as they are, and so is a post from before
   * the member's current membership.
   */
  repair(postId?: string): void {
    const rows = this.db.query(`SELECT p.team_id, p.seq, p.author, d.member FROM team_deliveries d JOIN team_posts p ON p.id = d.post_id
      WHERE d.state = 'waiting' AND d.at > ? AND (? IS NULL OR d.post_id = ?) ORDER BY p.team_id, p.seq`).all(Date.now() - RESIDENT_LETTER_TTL_MS, postId ?? null, postId ?? null) as { team_id: string; seq: number; author: string; member: string }[];
    for (const row of rows) {
      const team = this.get(row.team_id);
      const member = team?.archived === false ? team.members.find(entry => entry.key === row.member) : undefined;
      const threadId = member ? this.threadOf(member) : null;
      if (!team || !member || threadId === null || row.seq <= member.joinedSeq) continue;
      const carried = this.db.query(`SELECT 1 FROM coordination_letters l, json_each(l.data, '$.team.triggers') t WHERE l.thread_id = ? AND l.direction = 'in'
        AND l.status IN ('received', 'uncertain') AND json_extract(l.data, '$.team.teamId') = ? AND t.value = ? LIMIT 1`).get(threadId, team.id, row.seq);
      if (!carried) this.#accept(team, threadId, row.seq, row.author === TEAM_OWNER);
    }
  }

  /** The owner's post. `to` lists bot ids: the composer's recipients, or the one reader of a private post. */
  ownerPost(params: RpcParams<'teams.post'>): TeamPost {
    const team = this.require(params.teamId);
    const audience = params.audience ?? 'team';
    if (audience !== 'team' && audience !== 'private') throw invalidParams('audience: expected team or private');
    const to = (params.to ?? []).map(ref => this.member(team, ref, 'to').key);
    return this.#post(team, { id: params.id, author: TEAM_OWNER, text: params.text, audience, to, inReplyTo: params.inReplyTo });
  }

  /** `boite team say`: a group post from the bot's own thread. */
  say(params: RpcParams<'teams.say'>): TeamPost {
    const { team, key } = this.mine(params.threadId, params.team);
    return this.#post(team, { id: params.id ?? randomUUID(), author: key, text: params.text, audience: 'team', inReplyTo: params.inReplyTo, turnId: this.core.journal.runningTurn(params.threadId)?.id ?? null });
  }

  /** `boite team dm`: a private post to one member or the owner. */
  dm(params: RpcParams<'teams.dm'>): TeamPost {
    const { team, key } = this.mine(params.threadId, params.team);
    return this.#post(team, { id: params.id ?? randomUUID(), author: key, text: params.text, audience: 'private', to: [this.recipient(team, params.to)], turnId: this.core.journal.runningTurn(params.threadId)?.id ?? null });
  }

  /** Who a `dm` writes to. */
  recipient(team: Team, to: unknown): TeamParty {
    const wanted = typeof to === 'string' ? to.trim() : '';
    if (!wanted) throw invalidParams('to: expected a member or owner');
    return wanted.toLowerCase() === TEAM_OWNER ? TEAM_OWNER : this.member(team, wanted, 'to').key;
  }

  /** How a card names a bot, read again when the owner applies it: its id here, `<coreId>/<botId>` on another machine. */
  #cardRef(bot: TeamBot): string { return bot.coreId === this.self ? bot.botId : `${bot.coreId}/${bot.botId}`; }

  propose(params: RpcParams<'teams.propose'>, elsewhere?: ReadonlyMap<string, TeamBot>): { questionId: RequestId } {
    const bot = this.caller(params.threadId);
    const name = this.#checkName(params.name);
    const brief = this.#checkBrief(params.brief);
    const others = this.#bots(params.members, elsewhere).filter(other => other.botId !== bot.id);
    if (others.length === 0) throw invalidParams('members: name at least one other mochi');
    const members: TeamBot[] = [{ coreId: this.self, botId: bot.id, name: bot.name }, ...others];
    const text = `${bot.name} proposes the team ${JSON.stringify(name)}: ${members.map(member => this.label(member)).join(', ')}.${brief ? ` ${brief}` : ''}`;
    return this.draw(params.threadId, text, { kind: 'create', by: bot.id, name, brief, members: members.map(member => this.#cardRef(member)) });
  }

  invite(params: RpcParams<'teams.invite'>, found?: TeamBot): { questionId: RequestId } {
    const { team, bot } = this.mine(params.threadId, params.team);
    const guest = found ?? this.localBot(params.bot, 'bot');
    if (team.members.some(member => member.botId === guest.botId)) throw refused(`${guest.name} is already a member of ${team.name}`, { field: 'bot' });
    return this.draw(params.threadId, `${bot.name} asks to add ${this.label(guest)} to the team ${JSON.stringify(team.name)}.`, { kind: 'invite', by: bot.id, teamId: team.id, teamName: team.name, botId: this.#cardRef(guest) });
  }
}

markFeature('boite-feature:teams');
