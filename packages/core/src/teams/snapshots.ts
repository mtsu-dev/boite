/**
 * What a team letter reads and what its turn answers (`docs/teams.md`). Every
 * delivery path of `Coordination` asks these, inside its own transaction: the
 * snapshot of posts a letter freezes, released when it never arrives, and the
 * final answer posted where the letter's envelope says.
 */
import { createHash } from 'node:crypto';
import { teamPostVisible, TEAM_OWNER, TEAM_POST_MAX, type AgentLetter, type Team, type TeamAudience, type TeamMember, type TeamParty, type TeamPost, type Turn } from '@boite/contracts';
import type { Core } from '../core.ts';
import { messageOf } from '../errors.ts';
import { finalText, quietText } from '../agents/runtime.ts';
import type { TeamPeerReport } from './peers.ts';
import { planTeamLetter, teamPostLine, teamPrompt, type TeamChannel } from './prompt.ts';
import type { PostRow, TeamStore } from './store.ts';

/** The letter states that keep a snapshot in flight; any other ends it. */
const IN_FLIGHT = new Set(['Queued for provider delivery', 'Awaiting provider acknowledgement']);
const inFlight = (error: string | null): boolean => error !== null && (IN_FLIGHT.has(error) || error.startsWith('Awaiting provider turn '));
const ACTIVE = new Set(['queued', 'running']);
/** What ends a bot's letters on the machine it left: its posts wait for it on the next one, so they settle nothing. */
export const MOVED = 'moved to another machine';

/** A final answer's post id: the same turn always gives the same id, so a retried publication posts once. */
export function answerPostId(turnId: string): string {
  const hash = createHash('sha256').update(`team-answer:${turnId}`).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

/** What a batch's team letters read, and what changes with them. */
export interface TeamRendering {
  /** By letter id. */
  texts: Map<string, string>;
  /** Triggers that did not fit, by letter: each set goes to a new waiting letter. */
  leftovers: { letter: AgentLetter; seqs: number[]; owner: boolean }[];
  /** The one channel every team letter of the batch shares, when asked for one. */
  channel: TeamChannel | null;
}

export class TeamSnapshots {
  readonly #core: Core;
  readonly #store: TeamStore;

  constructor(core: Core, store: TeamStore) {
    this.#core = core;
    this.#store = store;
  }

  get #db() { return this.#core.journal.db; }
  get #self(): string { return this.#core.coordination.card().coreId; }

  /** A team letter may reach its bot now: the team stands here, runs, and keeps the bot; a bot's letter also waits while bots are held. */
  mayReceive(letter: AgentLetter): boolean {
    const ref = letter.team;
    if (ref === undefined) return false;
    const team = this.#store.get(ref.teamId);
    if (!team || team.paused || team.archived) return false;
    const bot = this.#core.workforce.agentOfThread(letter.to.threadId);
    if (!bot || !this.#store.memberHere(team, bot.id)) return false;
    return ref.owner || !this.#core.agentRuntime.holds(letter.to.threadId);
  }

  #low(team: Team, member: TeamMember): number {
    const row = this.#db.query('SELECT low FROM team_cursors WHERE team_id = ? AND member = ?').get(team.id, member.key) as { low: number } | null;
    return Math.max(row?.low ?? 0, member.joinedSeq);
  }

  /**
   * Moves the member's cursor up across seen posts and posts it may not
   * read, so a private post between two others never pins it.
   */
  #fold(team: Team, member: TeamMember): void {
    let low = this.#low(team, member);
    const start = low;
    const seen = new Set((this.#db.query("SELECT seq FROM team_seen WHERE team_id = ? AND member = ? AND state = 'seen'").all(team.id, member.key) as { seq: number }[]).map(row => row.seq));
    const last = (this.#db.query('SELECT last_seq FROM teams WHERE id = ?').get(team.id) as { last_seq: number }).last_seq;
    while (low < last) {
      const next = low + 1;
      if (!seen.has(next)) {
        const post = this.#store.postAt(team.id, next);
        if (post !== null && teamPostVisible(post, member.key) && post.author !== member.key) break;
      }
      low = next;
    }
    if (low === start) return;
    this.#db.query('INSERT INTO team_cursors (team_id, member, low) VALUES (?, ?, ?) ON CONFLICT (team_id, member) DO UPDATE SET low = excluded.low').run(team.id, member.key, low);
    this.#db.query('DELETE FROM team_seen WHERE team_id = ? AND member = ? AND seq <= ?').run(team.id, member.key, low);
  }

  /**
   * Freezes the snapshot of each team letter of a batch: its triggers, whole,
   * oldest first, then what the bot may read above its cursor that is neither
   * seen nor held by another snapshot in flight. `seen` (hook, waiter) marks
   * them read now; `flight` (steer, wake) until the letter is settled.
   * `reply` asks for the one channel a wake's final answer goes to.
   */
  render(threadId: string, letters: AgentLetter[], mode: 'seen' | 'flight', reply: boolean): TeamRendering {
    const rendering: TeamRendering = { texts: new Map(), leftovers: [], channel: null };
    const bot = this.#core.workforce.agentOfThread(threadId);
    if (letters.length === 0 || !bot) return rendering;
    const planned = letters.map(letter => {
      const team = this.#store.get(letter.team!.teamId)!;
      const member = this.#store.memberHere(team, bot.id)!;
      const you = member.key;
      const low = this.#low(team, member);
      const triggers = letter.team!.triggers.map(seq => this.#store.postAt(team.id, seq)).filter((post): post is TeamPost => post !== null);
      const newest = Math.max(0, ...triggers.map(post => post.seq));
      const trigger = new Set(triggers.map(post => post.seq));
      const held = new Set((this.#db.query('SELECT seq FROM team_seen WHERE team_id = ? AND member = ?').all(team.id, you) as { seq: number }[]).map(row => row.seq));
      const context = (this.#db.query('SELECT * FROM team_posts WHERE team_id = ? AND seq > ? AND seq <= ? ORDER BY seq').all(team.id, low, newest) as PostRow[])
        .map(row => this.#store.toPost(row)).filter(post => !trigger.has(post.seq) && !held.has(post.seq) && post.author !== you && teamPostVisible(post, you));
      const name = (party: TeamParty) => this.#store.partyName(team, party);
      const plan = planTeamLetter(triggers, context, (post, isTrigger) => teamPostLine(post, you, name, isTrigger));
      return { letter, team, member, plan, name };
    });
    if (reply) rendering.channel = this.#channel(planned.map(entry => ({ teamId: entry.team.id, triggers: entry.plan.triggers })));
    for (const { letter, team, member, plan, name } of planned) {
      const owner = (posts: TeamPost[]) => posts.some(post => post.author === TEAM_OWNER);
      if (plan.leftover.length > 0) {
        rendering.leftovers.push({ letter, seqs: plan.leftover.map(post => post.seq), owner: owner(plan.leftover) });
        letter.team = { ...letter.team!, triggers: plan.triggers.map(post => post.seq), owner: owner(plan.triggers) };
      }
      const you = member.key;
      rendering.texts.set(letter.id, teamPrompt({ team: team.name, you, plan, channel: rendering.channel, name }));
      const seqs = [...plan.triggers, ...plan.context, ...plan.omitted].map(post => post.seq);
      const low = this.#low(team, member);
      for (const seq of seqs.filter(seq => seq > low)) {
        if (mode === 'seen') this.#db.query("INSERT INTO team_seen (team_id, member, seq, state, letter_id) VALUES (?, ?, ?, 'seen', NULL) ON CONFLICT (team_id, member, seq) DO UPDATE SET state = 'seen', letter_id = NULL").run(team.id, you, seq);
        // A post another snapshot holds stays its: whichever settles first decides, so it can come twice, never zero times.
        else this.#db.query("INSERT INTO team_seen (team_id, member, seq, state, letter_id) VALUES (?, ?, ?, 'flight', ?) ON CONFLICT (team_id, member, seq) DO NOTHING").run(team.id, you, seq, letter.id);
      }
      if (mode === 'seen') this.#fold(team, member);
    }
    return rendering;
  }

  /** The one channel of a wake: one team, and the group or one private author. */
  #channel(entries: { teamId: string; triggers: TeamPost[] }[]): TeamChannel | null {
    const teams = new Set(entries.map(entry => entry.teamId));
    const posts = entries.flatMap(entry => entry.triggers).sort((a, b) => a.seq - b.seq);
    const newest = posts.at(-1);
    if (teams.size !== 1 || newest === undefined) return null;
    const teamId = newest.teamId;
    if (posts.every(post => post.audience === 'team')) return { teamId, audience: 'team', recipient: null, inReplyTo: newest.id };
    const authors = new Set(posts.map(post => post.author));
    if (posts.every(post => post.audience === 'private') && authors.size === 1) return { teamId, audience: 'private', recipient: newest.author, inReplyTo: newest.id };
    return null;
  }

  /** The reply envelope of an accepted wake, never changed after: where its final answer goes. */
  envelope(turnId: string, threadId: string, channel: TeamChannel): void {
    this.#db.query('INSERT OR IGNORE INTO team_replies (turn_id, thread_id, team_id, audience, recipient, in_reply_to, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(turnId, threadId, channel.teamId, channel.audience, channel.recipient, channel.inReplyTo, Date.now());
  }

  /**
   * A team letter changed state, in the same transaction: delivered marks its
   * snapshot seen; back in the inbox, refused, expired or failed releases it,
   * so the next delivery renders those posts again.
   */
  letterChanged(letter: AgentLetter): void {
    const ref = letter.team;
    if (ref === undefined) return;
    if (letter.status === 'uncertain' && inFlight(letter.error)) return;
    const team = this.#store.get(ref.teamId);
    const bot = this.#core.workforce.agentOfThread(letter.to.threadId);
    const member = team && bot ? this.#store.memberHere(team, bot.id) : undefined;
    if (letter.status === 'delivered') this.#db.query("UPDATE team_seen SET state = 'seen', letter_id = NULL WHERE letter_id = ? AND state = 'flight'").run(letter.id);
    else this.#db.query("DELETE FROM team_seen WHERE letter_id = ? AND state = 'flight'").run(letter.id);
    if (team && member && letter.status === 'delivered') this.#fold(team, member);
    // A bot on its way to another machine: its posts wait for it there.
    if (letter.error === MOVED) return;
    const state = letter.status === 'delivered' ? 'delivered' : letter.status === 'rejected' ? 'rejected' : letter.status === 'expired' ? 'expired' : null;
    if (!team || !member || state === null) return;
    const reports: TeamPeerReport[] = [];
    const reason = state === 'delivered' ? null : letter.error;
    for (const seq of ref.triggers) {
      const post = this.#store.postAt(team.id, seq);
      if (!post) continue;
      this.#db.query('UPDATE team_deliveries SET state = ?, reason = ?, letter_id = ?, at = ? WHERE post_id = ? AND member = ?').run(state, reason, letter.id, Date.now(), post.id, member.key);
      reports.push({ postId: post.id, member: member.key, state, reason });
    }
    if (team.host !== this.#self && reports.length > 0) this.#store.peers.queue(team.host, 'team.report', { teamId: team.id, reports });
  }

  /** A team wake that settled without reaching its provider's answer: its snapshot is released, its letter stays as it is. */
  #release(turn: Turn): void {
    const letters = this.#db.query("SELECT id FROM coordination_letters WHERE thread_id = ? AND direction = 'in' AND status = 'uncertain' AND json_extract(data, '$.error') = ? AND json_extract(data, '$.team') IS NOT NULL")
      .all(turn.threadId, `Awaiting provider turn ${turn.id}`) as { id: string }[];
    if (letters.length === 0) return;
    this.#core.journal.append({ type: 'teams.released', threadId: turn.threadId, version: 1, payload: { turnId: turn.id, letters: letters.map(row => row.id) } }, db => {
      for (const { id } of letters) db.query("DELETE FROM team_seen WHERE letter_id = ? AND state = 'flight'").run(id);
    });
  }

  /**
   * Snapshots in flight whose letter nothing will settle: gone, settled, a
   * steer that no provider acknowledged before a restart, or a wake whose
   * turn ended. The letter stays as it is; its posts render again.
   */
  releaseOrphans(): void {
    const rows = this.#db.query(`SELECT DISTINCT s.letter_id AS id, l.status, json_extract(l.data, '$.error') AS error FROM team_seen s
      LEFT JOIN coordination_letters l ON l.id = s.letter_id WHERE s.state = 'flight'`).all() as { id: string; status: string | null; error: string | null }[];
    const orphans = rows.filter(row => {
      if (row.status !== 'uncertain' || row.error === null) return true;
      if (row.error === 'Queued for provider delivery') return false;
      const turnId = row.error.startsWith('Awaiting provider turn ') ? row.error.slice('Awaiting provider turn '.length) : null;
      return turnId === null || !ACTIVE.has(this.#core.journal.getTurn(turnId)?.status ?? '');
    }).map(row => row.id);
    if (orphans.length === 0) return;
    this.#core.journal.append({ type: 'teams.released', threadId: null, version: 1, payload: { letters: orphans } }, db => {
      for (const id of orphans) db.query("DELETE FROM team_seen WHERE letter_id = ? AND state = 'flight'").run(id);
    });
  }

  /** Envelopes whose turn ended and whose answer was not posted yet: done ones post it, the others have none. */
  replayAnswers(): void {
    if (this.#core.journal.isClosed()) return;
    const pending = this.#db.query('SELECT r.turn_id, r.thread_id, t.status FROM team_replies r LEFT JOIN turns t ON t.id = r.turn_id WHERE r.published = 0').all() as { turn_id: string; thread_id: string; status: string | null }[];
    for (const row of pending) {
      if (row.status !== null && ACTIVE.has(row.status)) continue;
      try {
        if (row.status === 'done') this.publishAnswer({ id: row.turn_id, threadId: row.thread_id });
        else this.#db.query('UPDATE team_replies SET published = 1 WHERE turn_id = ?').run(row.turn_id);
      } catch (error) { this.#core.log('warn', `teams answer of ${row.turn_id}: ${messageOf(error)}`); }
    }
  }

  finished(turn: Turn): void {
    if (turn.execution?.operation !== 'coordination') return;
    if (turn.status !== 'done') { this.#release(turn); return; }
    this.publishAnswer(turn);
  }

  /**
   * A team wake's final answer, posted on its envelope's channel with an id
   * the turn gives, so a retry posts once. `[quiet]` posts nothing; a turn
   * without an envelope never posts to a team.
   */
  publishAnswer(turn: Pick<Turn, 'id' | 'threadId'>): TeamPost | null {
    const envelope = this.#db.query('SELECT * FROM team_replies WHERE turn_id = ?').get(turn.id) as { thread_id: string; team_id: string; audience: TeamAudience; recipient: string | null; in_reply_to: string | null } | null;
    if (envelope === null) return null;
    const post = this.#answer(turn, envelope);
    // Posted, or nothing to post: a later start does not try again.
    this.#db.query('UPDATE team_replies SET published = 1 WHERE turn_id = ?').run(turn.id);
    return post;
  }

  #answer(turn: Pick<Turn, 'id' | 'threadId'>, envelope: { thread_id: string; team_id: string; audience: TeamAudience; recipient: string | null; in_reply_to: string | null }): TeamPost | null {
    const team = this.#store.get(envelope.team_id);
    const bot = this.#core.workforce.agentOfThread(envelope.thread_id);
    const member = team && bot ? this.#store.memberHere(team, bot.id) : undefined;
    if (!team || team.archived || !bot || !member) return null;
    if (envelope.recipient !== null && envelope.recipient !== TEAM_OWNER && !team.members.some(entry => entry.key === envelope.recipient)) return null;
    const text = finalText(this.#core, turn);
    if (!text || quietText(text)) return null;
    const answer = {
      id: answerPostId(turn.id), text: text.slice(0, TEAM_POST_MAX), audience: envelope.audience,
      ...(envelope.recipient === null ? {} : { to: [envelope.recipient] }), inReplyTo: envelope.in_reply_to, turnId: turn.id,
    };
    if (team.host === this.#self) return this.#store.postAs(team, { ...answer, author: member.key });
    // It waits for the machine holding the team, which orders it among the others and keeps it once, by its id.
    this.#store.peers.queue(team.host, 'team.post', { ...answer, teamId: team.id, botId: bot.id, answer: true });
    return null;
  }
}
