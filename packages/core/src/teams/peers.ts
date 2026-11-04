/**
 * What goes between the machines of a team (`docs/teams.md`). The machine that
 * creates a team holds it and sends each member's machine the team's state and
 * the posts that machine may have (`team.sync`), from a per-machine mark that
 * moves only once a batch was taken. A member's machine posts, reads, reports
 * and asks for the owner through the holder; what need not wait goes through a
 * durable outbox. Every operation bears being asked twice: a post keeps its id,
 * a batch its seqs. A machine speaks for its own bots only: the holder finds a
 * post's author in the team by the group identity of the machine asking, never
 * in what it says.
 */
import { randomUUID } from 'node:crypto';
import {
  TEAM_BRIEF_MAX, TEAM_MEMBERS_MAX, TEAM_NAME_MAX, TEAM_POST_MAX,
  type CoordinationPeer, type RequestId, type RpcParams, type Team, type TeamAudience, type TeamMember, type TeamMemberKey, type TeamPost, type TeamReading,
} from '@boite/contracts';
import type { Core } from '../core.ts';
import { MAX_BODY, PeerGone, PeerRefusal, type TeamOperation } from '../coordination-wire.ts';
import { invalidParams, messageOf, refused, unavailable, type RpcFailure } from '../errors.ts';
import { foldMachine, memberNamed } from '../threads/group-spawn.ts';
import { TeamMirror } from './mirror.ts';
import type { TeamBot, TeamStore } from './store.ts';

const RETRY_MS = [5_000, 15_000, 60_000, 300_000];
const LAST_RETRY_MS = RETRY_MS[RETRY_MS.length - 1]!;
const BATCH_BYTES = Math.floor(MAX_BODY * 3 / 8);
const OUTBOX_DAYS = 30;

/** A post on its way to a member's machine, and the members there it still wakes. */
export interface TeamPeerPost { post: TeamPost; wake: TeamMemberKey[] }
/** What became of a post's letter on a member's machine. */
export interface TeamPeerReport { postId: string; member: TeamMemberKey; state: 'delivered' | 'rejected' | 'expired'; reason: string | null }

type MachineRow = { team_id: string; core_id: string; sent_seq: number; sent_version: number };
type OutboxRow = { id: number; core_id: string; operation: TeamOperation; payload: string; at: number };
type Fields = Record<string, unknown>;

const OK = { ok: true };

function fields(value: unknown, field: string): Fields {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw invalidParams(`${field}: expected an object`);
  return value as Fields;
}

function text(value: unknown, field: string, max: number, min = 1): string {
  if (typeof value !== 'string' || value.length < min || value.length > max) throw invalidParams(`${field}: expected ${min} to ${max} characters`);
  return value;
}

function textOrNull(value: unknown, field: string, max: number): string | null {
  return value === null || value === undefined ? null : text(value, field, max);
}

function count(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw invalidParams(`${field}: expected a whole number`);
  return value;
}

function flag(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw invalidParams(`${field}: expected a boolean`);
  return value;
}

function keys(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length > TEAM_MEMBERS_MAX + 1) throw invalidParams(`${field}: expected at most ${TEAM_MEMBERS_MAX + 1} members`);
  return value.map((entry, index) => text(entry, `${field}[${index}]`, 300));
}

function audienceOf(value: unknown, field: string): TeamAudience {
  if (value !== 'team' && value !== 'private') throw invalidParams(`${field}: expected team or private`);
  return value;
}

/** A team as a batch carries it: every field checked, nothing kept that the store does not know. */
function teamOf(value: unknown): Team {
  const raw = fields(value, 'team');
  if (!Array.isArray(raw.members) || raw.members.length > TEAM_MEMBERS_MAX) throw invalidParams(`team.members: expected at most ${TEAM_MEMBERS_MAX} bots`);
  const version = count(raw.version, 'team.version');
  if (version < 1) throw invalidParams('team.version: expected 1 or more');
  return {
    id: text(raw.id, 'team.id', 100), host: text(raw.host, 'team.host', 200), version,
    name: text(raw.name, 'team.name', TEAM_NAME_MAX), brief: text(raw.brief, 'team.brief', TEAM_BRIEF_MAX, 0),
    members: raw.members.map((entry, index) => {
      const field = `team.members[${index}]`;
      const member = fields(entry, field);
      return {
        key: text(member.key, `${field}.key`, 300), coreId: text(member.coreId, `${field}.coreId`, 200), botId: text(member.botId, `${field}.botId`, 100),
        name: text(member.name, `${field}.name`, 200), joinedSeq: count(member.joinedSeq, `${field}.joinedSeq`),
      };
    }),
    dispatcher: textOrNull(raw.dispatcher, 'team.dispatcher', 200), paused: flag(raw.paused, 'team.paused'), archived: flag(raw.archived, 'team.archived'),
    createdBy: text(raw.createdBy, 'team.createdBy', 300), threadId: text(raw.threadId, 'team.threadId', 100), lastSeq: count(raw.lastSeq, 'team.lastSeq'),
    createdAt: count(raw.createdAt, 'team.createdAt'), updatedAt: count(raw.updatedAt, 'team.updatedAt'),
  };
}

function postsOf(value: unknown, teamId: string): TeamPeerPost[] {
  if (!Array.isArray(value)) throw invalidParams('posts: expected an array');
  return value.map((entry, index) => {
    const field = `posts[${index}]`;
    const raw = fields(entry, field);
    const post = fields(raw.post, `${field}.post`);
    if (post.teamId !== teamId) throw invalidParams(`${field}.post.teamId: expected ${teamId}`);
    const notice = textOrNull(post.notice, `${field}.post.notice`, TEAM_POST_MAX);
    return {
      post: {
        id: text(post.id, `${field}.post.id`, 100), teamId, seq: count(post.seq, `${field}.post.seq`), author: text(post.author, `${field}.post.author`, 300),
        text: text(post.text, `${field}.post.text`, TEAM_POST_MAX), audience: audienceOf(post.audience, `${field}.post.audience`), to: keys(post.to, `${field}.post.to`),
        routedBy: text(post.routedBy, `${field}.post.routedBy`, 100) as TeamPost['routedBy'], why: textOrNull(post.why, `${field}.post.why`, TEAM_POST_MAX),
        inReplyTo: textOrNull(post.inReplyTo, `${field}.post.inReplyTo`, 100), turnId: textOrNull(post.turnId, `${field}.post.turnId`, 100),
        fingerprint: text(post.fingerprint, `${field}.post.fingerprint`, 100), createdAt: count(post.createdAt, `${field}.post.createdAt`), ...(notice === null ? {} : { notice }),
      },
      wake: keys(raw.wake, `${field}.wake`),
    };
  });
}

function reportsOf(value: unknown): TeamPeerReport[] {
  if (!Array.isArray(value)) throw invalidParams('reports: expected an array');
  return value.map((entry, index) => {
    const field = `reports[${index}]`;
    const raw = fields(entry, field);
    if (raw.state !== 'delivered' && raw.state !== 'rejected' && raw.state !== 'expired') throw invalidParams(`${field}.state: expected delivered, rejected or expired`);
    return { postId: text(raw.postId, `${field}.postId`, 100), member: text(raw.member, `${field}.member`, 300), state: raw.state, reason: textOrNull(raw.reason, `${field}.reason`, TEAM_POST_MAX) };
  });
}

/** A core that does not know the operation refuses it by name: it knows once it is updated. */
const tooOld = (error: unknown): boolean => error instanceof PeerRefusal && error.message.startsWith('operation: expected');

export class TeamPeers {
  readonly #core: Core;
  readonly #store: TeamStore;
  readonly #mirror: TeamMirror;
  readonly #timers = new Map<string, ReturnType<typeof setTimeout>>();
  readonly #attempts = new Map<string, number>();
  readonly #sending = new Set<string>();
  readonly #again = new Set<string>();
  #closed = false;

  constructor(core: Core, store: TeamStore) {
    this.#core = core;
    this.#store = store;
    this.#mirror = new TeamMirror(core, store);
  }

  get #db() { return this.#core.journal.db; }
  get #self(): string { return this.#core.coordination.card().coreId; }
  get #stopped(): boolean { return this.#closed || this.#core.journal.isClosed(); }

  // Sending.

  /**
   * A member that came to a machine, in the transaction that says so: that
   * machine is owed what the member may read from now on. A member that stays
   * where it was moves no mark, or it would send the same posts again.
   */
  track(teamId: string, before: readonly TeamMember[], after: readonly TeamMember[]): void {
    for (const member of after) {
      if (member.coreId === this.#self || before.some(entry => entry.key === member.key && entry.coreId === member.coreId)) continue;
      this.#db.query(`INSERT INTO team_machines (team_id, core_id, sent_seq, sent_version) VALUES (?, ?, ?, 0)
        ON CONFLICT (team_id, core_id) DO UPDATE SET sent_seq = MIN(sent_seq, excluded.sent_seq)`).run(teamId, member.coreId, member.joinedSeq);
    }
  }

  /** A team changed or took a post: its machines hear it now. */
  kick(teamId: string): void {
    const rows = this.#db.query('SELECT core_id FROM team_machines WHERE team_id = ?').all(teamId) as { core_id: string }[];
    for (const row of rows) this.#schedule(row.core_id, 0);
  }

  /** Something another machine must hear, whenever it is back. It may run inside the transaction that decided it. */
  queue(coreId: string, operation: TeamOperation, payload: unknown): void {
    this.#db.query('INSERT INTO team_outbox (core_id, operation, payload, at) VALUES (?, ?, ?, ?)').run(coreId, operation, JSON.stringify(payload), Date.now());
    this.#schedule(coreId, 0);
  }

  /** After a restart: whatever was still owed goes out. */
  start(): void {
    this.#db.query('DELETE FROM team_outbox WHERE at < ?').run(Date.now() - OUTBOX_DAYS * 86_400_000);
    const rows = this.#db.query(`SELECT core_id FROM team_outbox UNION
      SELECT m.core_id FROM team_machines m LEFT JOIN teams t ON t.id = m.team_id WHERE t.id IS NULL OR m.sent_seq < t.last_seq OR m.sent_version <> t.version`).all() as { core_id: string }[];
    for (const row of rows) this.#schedule(row.core_id, 0);
  }

  /** A machine this one failed to reach spoke: it is back, so what it is owed need not wait for the next retry. */
  heard(coreId: string): void {
    if (!this.#attempts.has(coreId)) return;
    const timer = this.#timers.get(coreId);
    if (timer !== undefined) clearTimeout(timer);
    this.#timers.delete(coreId);
    this.#schedule(coreId, 0);
  }

  close(): void {
    this.#closed = true;
    for (const timer of this.#timers.values()) clearTimeout(timer);
    this.#timers.clear();
  }

  #schedule(coreId: string, delay: number): void {
    if (this.#closed || this.#timers.has(coreId)) return;
    const timer = setTimeout(() => {
      this.#timers.delete(coreId);
      this.#flush(coreId).catch((error: unknown) => {
        if (!this.#stopped) this.#core.log('warn', `teams toward ${coreId}: ${messageOf(error)}`);
      });
    }, delay);
    timer.unref?.();
    this.#timers.set(coreId, timer);
  }

  async #flush(coreId: string): Promise<void> {
    if (this.#stopped) return;
    if (this.#sending.has(coreId)) { this.#again.add(coreId); return; }
    const peer = this.#core.group.peers().find(entry => entry.coreId === coreId);
    if (peer === undefined) {
      // Out of the group for now: what it is owed waits, and goes if it speaks again.
      this.#attempts.set(coreId, this.#attempts.get(coreId) ?? 0);
      return;
    }
    this.#sending.add(coreId);
    try {
      await this.#sendOutbox(peer);
      await this.#sendTeams(peer);
      this.#attempts.delete(coreId);
    } catch (error) {
      if (this.#stopped) return;
      if (error instanceof PeerGone) {
        this.#db.query('DELETE FROM team_outbox WHERE core_id = ?').run(coreId);
        this.#attempts.delete(coreId);
        this.#mirror.unreachable(coreId, `${peer.name} removed this machine from its group`);
        return;
      }
      if (error instanceof PeerRefusal) {
        // It answers and says no: trying sooner would only ask the same again. Hearing from it changes nothing, so no attempt is kept.
        this.#core.log('warn', `teams toward ${peer.name}: ${error.message}`);
        this.#mirror.unreachable(coreId, `${peer.name} refused: ${error.message}`);
        this.#schedule(coreId, LAST_RETRY_MS);
        return;
      }
      this.#mirror.unreachable(coreId, `${peer.name} is unreachable`);
      const attempt = this.#attempts.get(coreId) ?? 0;
      this.#attempts.set(coreId, attempt + 1);
      this.#schedule(coreId, RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)]!);
    } finally {
      this.#sending.delete(coreId);
      if (this.#again.delete(coreId)) this.#schedule(coreId, 0);
    }
  }

  /** Oldest first, one at a time, each kept until taken. A refusal is final for that row; a core too old for it may yet be updated. */
  async #sendOutbox(peer: CoordinationPeer): Promise<void> {
    for (;;) {
      const row = this.#db.query('SELECT * FROM team_outbox WHERE core_id = ? ORDER BY id LIMIT 1').get(peer.coreId) as OutboxRow | null;
      if (row === null) return;
      try {
        await this.#core.coordination.request(peer, row.operation, JSON.parse(row.payload));
      } catch (error) {
        if (!(error instanceof PeerRefusal) || tooOld(error)) throw error;
        this.#core.log('warn', `teams: ${peer.name} refused ${row.operation}: ${error.message}`);
      }
      if (this.#stopped) return;
      this.#db.query('DELETE FROM team_outbox WHERE id = ?').run(row.id);
    }
  }

  async #sendTeams(peer: CoordinationPeer): Promise<void> {
    for (;;) {
      const row = this.#db.query(`SELECT m.* FROM team_machines m LEFT JOIN teams t ON t.id = m.team_id
        WHERE m.core_id = ? AND (t.id IS NULL OR m.sent_seq < t.last_seq OR m.sent_version <> t.version) LIMIT 1`).get(peer.coreId) as MachineRow | null;
      if (row === null) return;
      await this.#sendBatch(peer, row);
      if (this.#stopped) return;
    }
  }

  async #sendBatch(peer: CoordinationPeer, row: MachineRow): Promise<void> {
    const team = this.#store.get(row.team_id);
    const forget = () => this.#db.query('DELETE FROM team_machines WHERE team_id = ? AND core_id = ?').run(row.team_id, row.core_id);
    if (team === null) { forget(); return; }
    const { posts, upTo } = this.#mirror.batchFor(team, peer.coreId, row.sent_seq, BATCH_BYTES);
    // Nothing that machine may see changed: a private post between others does not even show as a request.
    if (posts.length > 0 || row.sent_version !== team.version) {
      await this.#core.coordination.request(peer, 'team.sync', { team, posts, upTo });
      if (this.#stopped) return;
    }
    // A member arriving meanwhile moved the mark down: it stays there.
    this.#db.query('UPDATE team_machines SET sent_seq = CASE WHEN sent_seq = ? THEN ? ELSE sent_seq END, sent_version = ? WHERE team_id = ? AND core_id = ?')
      .run(row.sent_seq, upTo, team.version, row.team_id, row.core_id);
    this.#mirror.reached(team, peer.coreId, upTo);
    const now = this.#store.get(team.id);
    // Once it heard that no member of the team runs there, it forgot the team: nothing more goes.
    if (now === null || (team.version === now.version && !now.members.some(member => member.coreId === peer.coreId))) forget();
  }

  // Answering another machine.

  async answer(peer: CoordinationPeer, operation: TeamOperation, payload: unknown): Promise<unknown> {
    const raw = fields(payload, 'payload');
    switch (operation) {
      case 'team.bot': {
        // A machine with the experiment off lets no bot of its own enter a team.
        this.#store.gate();
        const bot = this.#store.localBot(raw.ref, 'bot');
        return { botId: bot.botId, name: bot.name };
      }
      case 'team.sync': return this.#took(peer, raw);
      case 'team.post': return this.#posted(peer, raw);
      case 'team.read': {
        const team = this.#hosted(raw.teamId);
        const member = this.#speaker(team, peer, raw.botId);
        this.#store.gate();
        return this.#store.page(team, member.key, { before: raw.before as number | undefined, limit: raw.limit as number | undefined });
      }
      case 'team.report': return this.#reported(peer, raw);
      case 'team.moved': return this.#moved(peer, raw);
      case 'team.owner': return this.#forOwner(peer, raw);
      default: throw invalidParams(`operation: expected a team operation, not ${String(operation)}`);
    }
  }

  /** A team held here, by what another machine named. */
  #hosted(teamId: unknown): Team {
    const team = typeof teamId === 'string' ? this.#store.get(teamId) : null;
    if (team === null || team.host !== this.#self) throw refused(`teamId: this machine holds no team ${JSON.stringify(teamId)}`, { field: 'teamId' });
    return team;
  }

  /** The member a machine speaks for: the team says where the bot runs, and the group says who asks. What the payload claims decides nothing else. */
  #speaker(team: Team, peer: CoordinationPeer, botId: unknown): TeamMember {
    const member = team.members.find(entry => entry.botId === botId && entry.coreId === peer.coreId);
    if (member === undefined) throw refused(`botId: ${JSON.stringify(botId)} is no member of ${team.name} on ${peer.name}`, { field: 'botId', reason: 'not-your-bot' });
    return member;
  }

  /** A batch from the machine holding a team. Nobody else speaks for it. Not gated: the holder's switch decides. */
  #took(peer: CoordinationPeer, raw: Fields): unknown {
    const team = teamOf(raw.team);
    const posts = postsOf(raw.posts, team.id);
    const upTo = count(raw.upTo, 'upTo');
    if (team.host !== peer.coreId) throw refused(`team.host: ${peer.name} does not hold the team ${team.name}`, { field: 'team', reason: 'not-the-holder' });
    const known = this.#store.get(team.id);
    if (known !== null && known.host !== peer.coreId) throw refused(`team.id: ${peer.name} does not hold the team ${known.name}`, { field: 'team', reason: 'not-the-holder' });
    this.#mirror.take(team, posts, upTo);
    return OK;
  }

  #posted(peer: CoordinationPeer, raw: Fields): TeamPost {
    const team = this.#hosted(raw.teamId);
    const member = this.#speaker(team, peer, raw.botId);
    // A final answer goes as a local bot's does: the switch stops commands, not a turn already under way.
    if (raw.answer !== true) this.#store.gate();
    const audience = audienceOf(raw.audience, 'audience');
    const to = audience === 'private' ? [this.#store.recipient(team, Array.isArray(raw.to) ? raw.to[0] : undefined)] : undefined;
    return this.#store.postAs(team, { id: raw.id, author: member.key, text: raw.text, audience, to, inReplyTo: raw.inReplyTo, turnId: textOrNull(raw.turnId, 'turnId', 100) });
  }

  #reported(peer: CoordinationPeer, raw: Fields): unknown {
    const team = typeof raw.teamId === 'string' ? this.#store.get(raw.teamId) : null;
    if (team === null || team.host !== this.#self) return OK;
    const named = raw.names === undefined ? {} : fields(raw.names, 'names');
    const names = Object.fromEntries(Object.entries(named).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0 && entry[1].length <= 200));
    this.#mirror.reported(team, peer.coreId, reportsOf(raw.reports), names);
    return OK;
  }

  /** A bot left the machine asking. It alone says so, and only for its own bot. */
  #moved(peer: CoordinationPeer, raw: Fields): unknown {
    const team = typeof raw.teamId === 'string' ? this.#store.get(raw.teamId) : null;
    if (team === null || team.host !== this.#self) return OK;
    const member = team.members.find(entry => entry.botId === raw.botId);
    if (member === undefined || member.coreId === raw.to) return OK;
    if (member.coreId !== peer.coreId) throw refused(`botId: ${member.name} runs on another machine, which alone says where it went`, { field: 'botId', reason: 'not-your-bot' });
    const to = text(raw.to, 'to', 200);
    if (to !== this.#self && !this.#core.group.peers().some(entry => entry.coreId === to)) throw invalidParams('to: expected a machine of the group');
    this.#store.moveMember(team, member, to);
    return OK;
  }

  /** The owner answered a card on a member's machine: the change happens here. Only a machine with a bot in the team asks, and it takes out only its own. */
  async #forOwner(peer: CoordinationPeer, raw: Fields): Promise<unknown> {
    const team = this.#hosted(raw.teamId);
    if (!team.members.some(member => member.coreId === peer.coreId)) throw refused(`teamId: ${peer.name} has no bot in ${team.name}`, { field: 'teamId', reason: 'not-your-bot' });
    this.#store.gate();
    if (raw.action === 'add') {
      const bot = await this.bot(raw.bot, 'bot');
      if (!team.members.some(member => member.botId === bot.botId)) this.#store.addMember({ teamId: team.id, botId: bot.botId }, bot);
      return { ok: true, name: bot.name };
    }
    if (raw.action === 'remove') {
      const member = team.members.find(entry => entry.botId === raw.botId);
      if (member === undefined) return OK;
      if (member.coreId !== peer.coreId) throw refused(`botId: ${member.name} runs on another machine`, { field: 'botId', reason: 'not-your-bot' });
      this.#store.removeMember({ teamId: team.id, botId: member.botId });
      return OK;
    }
    throw invalidParams('action: expected add or remove');
  }

  // Commands, here or wherever the team is held.

  /** A bot on any machine of the group: its name or id here, `<machine>/<bot>` elsewhere. A name may hold the slash itself. */
  async bot(ref: unknown, field: string): Promise<TeamBot> {
    const wanted = typeof ref === 'string' ? ref.trim() : '';
    if (!wanted.includes('/') || this.#store.namesLocalBot(wanted)) return this.#store.localBot(wanted, field);
    const slash = wanted.indexOf('/');
    const machine = wanted.slice(0, slash).trim();
    const name = wanted.slice(slash + 1).trim();
    if (!machine || !name) throw invalidParams(`${field}: expected <machine>/<bot>`);
    const group = this.#core.group.view('owner');
    if (group === null) throw refused(`${field}: this machine is in no group, so ${JSON.stringify(wanted)} names no bot`, { field });
    const peers = this.#core.group.peers();
    const named = foldMachine(machine);
    const here = group.cores.find(entry => entry.coreId === group.self)?.name;
    const prefix = /^[0-9a-f]{6,}$/.test(machine) && this.#self.startsWith(machine);
    if (machine === this.#self || prefix || (here !== undefined && foldMachine(here) === named && !peers.some(peer => foldMachine(peer.name) === named))) return this.#store.localBot(name, field);
    const peer = memberNamed(this.#core, machine, field);
    try {
      const answer = fields(await this.#core.coordination.request(peer, 'team.bot', { ref: name }), 'answer');
      return { coreId: peer.coreId, botId: text(answer.botId, 'answer.botId', 100), name: text(answer.name, 'answer.name', 200) };
    } catch (error) {
      throw this.#failure(peer, error, 'its bots can join once it answers');
    }
  }

  #distant(ref: unknown): ref is string {
    return typeof ref === 'string' && ref.includes('/') && !this.#store.namesLocalBot(ref.trim());
  }

  /** The bots of other machines a list names, by the words given; a bad list is the store's to refuse. */
  async #resolved(refs: unknown): Promise<Map<string, TeamBot>> {
    const found = new Map<string, TeamBot>();
    if (!Array.isArray(refs) || refs.length > TEAM_MEMBERS_MAX) return found;
    const distant = refs.filter((ref): ref is string => this.#distant(ref));
    const bots = await Promise.all(distant.map(ref => this.bot(ref, 'members')));
    distant.forEach((ref, index) => found.set(ref, bots[index]!));
    return found;
  }

  async create(params: RpcParams<'teams.create'>): Promise<Team> {
    this.#store.gate();
    return this.#store.create(params, await this.#resolved(params.members));
  }

  async propose(params: RpcParams<'teams.propose'>): Promise<{ questionId: RequestId }> {
    this.#store.gate();
    this.#store.caller(params.threadId);
    return this.#store.propose(params, await this.#resolved(params.members));
  }

  async invite(params: RpcParams<'teams.invite'>): Promise<{ questionId: RequestId }> {
    this.#store.mine(params.threadId, params.team);
    return this.#store.invite(params, this.#distant(params.bot) ? await this.bot(params.bot, 'bot') : undefined);
  }

  async addMember(params: RpcParams<'teams.members.add'>): Promise<Team> {
    const team = typeof params.teamId === 'string' ? this.#store.get(params.teamId) : null;
    if (team === null || team.host === this.#self) {
      this.#store.gate();
      return this.#store.addMember(params, this.#distant(params.botId) ? await this.bot(params.botId, 'botId') : undefined);
    }
    const card = this.#heldElsewhere(team, params.card);
    const ask = this.#store.card(card, 'invite');
    if (ask.kind === 'invite' && ask.teamId !== team.id) throw refused(`card: it asks about another team, ${ask.teamName}`, { field: 'card' });
    const ref = this.#distant(params.botId) ? params.botId : `${this.#self}/${params.botId}`;
    const done = await this.#ask(team, 'team.owner', { action: 'add', teamId: team.id, bot: ref }) as { name?: unknown };
    this.#store.settle(card, `applied: ${typeof done?.name === 'string' ? done.name : 'the bot'} joined ${team.name}`);
    return this.#store.get(team.id) ?? team;
  }

  async removeMember(params: RpcParams<'teams.members.remove'>): Promise<Team> {
    const team = typeof params.teamId === 'string' ? this.#store.get(params.teamId) : null;
    if (team === null || team.host === this.#self) return this.#store.removeMember(params);
    const card = this.#heldElsewhere(team, params.card);
    const ask = this.#store.card(card, 'leave');
    if (ask.kind === 'leave' && ask.teamId !== team.id) throw refused(`card: it asks about another team, ${ask.teamName}`, { field: 'card' });
    const member = this.#store.member(team, params.botId, 'botId');
    await this.#ask(team, 'team.owner', { action: 'remove', teamId: team.id, botId: member.botId });
    this.#store.settle(card, `applied: ${member.name} left ${team.name}`);
    return this.#store.get(team.id) ?? team;
  }

  /** Only a card of the owner's changes a team from another machine than the one holding it. */
  #heldElsewhere(team: Team, card: RequestId | undefined): RequestId {
    if (card === undefined) throw refused(`teamId: ${team.name} is held by ${this.#store.machineName(team.host)}; change it there`, { field: 'teamId' });
    return card;
  }

  async say(params: RpcParams<'teams.say'>): Promise<TeamPost> {
    const { team, bot } = this.#store.mine(params.threadId, params.team);
    if (team.host === this.#self) return this.#store.say(params);
    const post = this.#checked(params);
    return this.#remotePost(team, bot.id, params.threadId, { ...post, audience: 'team', inReplyTo: params.inReplyTo ?? null });
  }

  async dm(params: RpcParams<'teams.dm'>): Promise<TeamPost> {
    const { team, bot } = this.#store.mine(params.threadId, params.team);
    if (team.host === this.#self) return this.#store.dm(params);
    const post = this.#checked(params);
    return this.#remotePost(team, bot.id, params.threadId, { ...post, audience: 'private', to: [this.#store.recipient(team, params.to)], inReplyTo: null });
  }

  /** What the store checks of a post, here too: a command never fails on the machine holding the team for what this one can tell. */
  #checked(params: { id?: unknown; text: unknown }): { id: string; text: string } {
    const id = typeof params.id === 'string' ? params.id.trim() : params.id === undefined ? randomUUID() : '';
    if (!id || id.length > 100) throw invalidParams('id: expected 1 to 100 characters');
    const body = typeof params.text === 'string' ? params.text.trim() : '';
    if (!body || body.length > TEAM_POST_MAX) throw invalidParams(`text: expected 1 to ${TEAM_POST_MAX} characters`);
    return { id, text: body };
  }

  async read(params: RpcParams<'teams.read'>): Promise<TeamReading> {
    if (params.threadId === undefined) return this.#store.read(params);
    const { team, bot, key } = this.#store.mine(params.threadId, params.team);
    if (team.host === this.#self) return this.#store.page(team, key, params);
    // Only the holder has every post this bot may read: a mirror leaves out the private ones it wrote.
    const reading = await this.#ask(team, 'team.read', { teamId: team.id, botId: bot.id, before: params.before, limit: params.limit }) as TeamReading;
    return { ...reading, team };
  }

  #holder(team: Team): CoordinationPeer {
    const peer = this.#core.group.peers().find(entry => entry.coreId === team.host);
    if (peer === undefined) throw refused(`${team.name} is held by ${this.#store.machineName(team.host)}, which is no longer in this machine's group`, { field: 'team', reason: 'host-gone' });
    return peer;
  }

  async #ask(team: Team, operation: TeamOperation, payload: unknown): Promise<unknown> {
    const peer = this.#holder(team);
    try {
      return await this.#core.coordination.request(peer, operation, payload);
    } catch (error) {
      throw this.#failure(peer, error, 'try again once it is back');
    }
  }

  async #remotePost(team: Team, botId: string, threadId: string, post: { id: string; text: string; audience: TeamAudience; to?: string[]; inReplyTo: unknown }): Promise<TeamPost> {
    const peer = this.#holder(team);
    try {
      return await this.#core.coordination.request(peer, 'team.post', { ...post, teamId: team.id, botId, turnId: this.#core.journal.runningTurn(threadId)?.id ?? null }) as TeamPost;
    } catch (error) {
      if (error instanceof PeerRefusal || error instanceof PeerGone) throw this.#failure(peer, error, '');
      throw unavailable(
        `${peer.name} holds the team ${team.name} and did not answer (${messageOf(error)}); nothing is lost: send the same command again with --request-id ${post.id}; it posts once even if this try got through`,
        { reason: 'host-unreachable', requestId: post.id },
      );
    }
  }

  #failure(peer: CoordinationPeer, error: unknown, away: string): RpcFailure {
    if (error instanceof PeerGone) return refused(`${peer.name} removed this machine from its group`, { reason: 'removed' });
    if (tooOld(error)) return refused(`Boite on ${peer.name} is too old for teams across machines; update it first`, { reason: 'peer-too-old' });
    if (error instanceof PeerRefusal) return refused(`${peer.name}: ${error.message}`, error.message.includes('Teams experiment') ? { reason: 'experiment-off' } : { reason: 'peer-refused' });
    return unavailable(`${peer.name} did not answer (${messageOf(error)}); ${away}`, { reason: 'unreachable' });
  }
}
