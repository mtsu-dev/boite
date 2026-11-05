/**
 * A team between its machines, in this core's tables (`docs/teams.md`): what
 * the machine holding it sends a member's machine and hears back, and the
 * mirror kept there. `peers.ts` carries them.
 */
import type { Team, TeamMember, TeamParty, TeamPost } from '@boite/contracts';
import type { Core } from '../core.ts';
import type { TeamPeerPost, TeamPeerReport } from './peers.ts';
import type { PostRow, TeamStore } from './store.ts';

/** How long a post waits to wake a bot on a machine that is away; older, it stays readable and wakes nobody. */
export const TEAM_WAKE_MAX_MS = 7 * 24 * 3_600_000;

export class TeamMirror {
  readonly #core: Core;
  readonly #store: TeamStore;

  constructor(core: Core, store: TeamStore) {
    this.#core = core;
    this.#store = store;
  }

  get #db() { return this.#core.journal.db; }
  get #self(): string { return this.#core.coordination.card().coreId; }

  /**
   * The next posts a machine may have of a team held here, oldest first, within
   * `bytes`: group posts and private posts to one of its members, never the
   * others. `upTo` covers what it was not sent. `wake` names who still waits for
   * a post there; a post that waited too long stays readable and wakes nobody.
   */
  batchFor(team: Team, coreId: string, after: number, bytes: number): { posts: TeamPeerPost[]; upTo: number } {
    const members = team.members.filter(member => member.coreId === coreId);
    const posts: TeamPeerPost[] = [];
    if (members.length === 0) return { posts, upTo: team.lastSeq };
    let size = Buffer.byteLength(JSON.stringify(team));
    let cursor = after;
    for (;;) {
      const rows = this.#db.query('SELECT * FROM team_posts WHERE team_id = ? AND seq > ? ORDER BY seq LIMIT 100').all(team.id, cursor) as PostRow[];
      if (rows.length === 0) return { posts, upTo: team.lastSeq };
      for (const row of rows) {
        const post = this.#store.toPost(row);
        if (post.audience === 'team' || members.some(member => post.to.includes(member.key))) {
          const length = Buffer.byteLength(JSON.stringify(post));
          if (posts.length > 0 && size + length > bytes) return { posts, upTo: cursor };
          posts.push({ post, wake: this.#wakes(post, members) });
          size += length;
        }
        cursor = post.seq;
      }
    }
  }

  #wakes(post: TeamPost, members: TeamMember[]): TeamParty[] {
    const wake = members.filter(member => post.to.includes(member.key) && post.seq > member.joinedSeq).map(member => member.key).filter(key => {
      const delivery = this.#db.query('SELECT state FROM team_deliveries WHERE post_id = ? AND member = ?').get(post.id, key) as { state: string } | null;
      return delivery?.state === 'waiting' || delivery?.state === 'unreachable';
    });
    if (wake.length === 0 || Date.now() - post.createdAt < TEAM_WAKE_MAX_MS) return wake;
    const now = Date.now();
    this.#core.journal.append({ type: 'teams.post.expired', threadId: null, version: 1, payload: { postId: post.id, members: wake } }, db => {
      for (const key of wake) db.query("UPDATE team_deliveries SET state = 'expired', reason = 'its machine was away too long', at = ? WHERE post_id = ? AND member = ?").run(now, post.id, key);
    });
    return [];
  }

  /** A machine that did not take what it has coming: what waits for its bots says why, until it does (`reached`). */
  unreachable(coreId: string, reason: string): void {
    const now = Date.now();
    for (const team of this.#store.hosted()) {
      let marked = 0;
      for (const member of team.members.filter(entry => entry.coreId === coreId)) {
        marked += this.#db.query("UPDATE team_deliveries SET state = 'unreachable', reason = ?, at = ? WHERE member = ? AND state = 'waiting' AND post_id IN (SELECT id FROM team_posts WHERE team_id = ?)")
          .run(reason, now, member.key, team.id).changes;
      }
      if (marked > 0) this.#store.changed(team);
    }
  }

  /** A machine took a batch: its posts are on their way to a letter there, whose fate it reports. */
  reached(team: Team, coreId: string, upTo: number): void {
    const now = Date.now();
    let changed = 0;
    for (const member of team.members.filter(entry => entry.coreId === coreId)) {
      changed += this.#db.query("UPDATE team_deliveries SET state = 'waiting', reason = NULL, at = ? WHERE member = ? AND state = 'unreachable' AND post_id IN (SELECT id FROM team_posts WHERE team_id = ? AND seq <= ?)")
        .run(now, member.key, team.id, upTo).changes;
    }
    if (changed > 0) this.#store.changed(team);
  }

  /** What a member's machine says of its letters and of its bots' names; it speaks for its own bots only. */
  reported(team: Team, coreId: string, reports: TeamPeerReport[], names: Record<string, string>): void {
    const own = team.members.filter(member => member.coreId === coreId);
    const kept = reports.filter(report => own.some(member => member.key === report.member));
    if (kept.length > 0) {
      const now = Date.now();
      this.#core.journal.append({ type: 'teams.reported', threadId: team.threadId, version: 1, payload: { teamId: team.id, reports: kept.length } }, db => {
        for (const report of kept) {
          db.query('UPDATE team_deliveries SET state = ?, reason = ?, at = ? WHERE post_id = ? AND member = ? AND post_id IN (SELECT id FROM team_posts WHERE team_id = ?)').run(report.state, report.reason, now, report.postId, report.member, team.id);
        }
      });
      this.#store.changed(team);
    }
    const renamed = own.filter(member => typeof names[member.botId] === 'string' && names[member.botId] !== member.name);
    if (renamed.length > 0) this.#store.save(team, { members: team.members.map(entry => (renamed.includes(entry) ? { ...entry, name: names[entry.botId]! } : entry)) });
  }

  /**
   * A batch from the machine holding a team: its state, the posts this machine
   * may have, and who they wake. `repair` hands each post over as it does after
   * an interruption here: it looks at the letters already written, so a batch
   * sent twice wakes nobody twice. Once no bot of this machine is left in the
   * team, nothing of it stays here.
   */
  take(incoming: Team, posts: TeamPeerPost[], upTo: number): void {
    const before = this.#store.get(incoming.id);
    const current = before !== null && before.version > incoming.version ? before : incoming;
    const stays = current.members.filter(member => member.coreId === this.#self);
    if (before === null && stays.length === 0) return;
    const lost = (before?.members ?? []).filter(member => member.coreId === this.#self && !stays.some(entry => entry.key === member.key));
    const now = Date.now();
    const leftReason = (member: TeamMember) => `${member.name} left the team ${current.name}`;
    this.#core.journal.append({ type: 'teams.mirrored', threadId: null, version: 1, payload: { teamId: incoming.id, version: incoming.version, upTo, posts: posts.length } }, db => {
      db.query(`INSERT INTO teams (id, host, version, thread_id, last_seq, data, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET version = excluded.version, data = excluded.data, updated_at = excluded.updated_at WHERE excluded.version >= teams.version`)
        .run(incoming.id, incoming.host, incoming.version, incoming.threadId, this.#store.rowData(incoming), incoming.createdAt, incoming.updatedAt);
      db.query('UPDATE teams SET last_seq = MAX(last_seq, ?) WHERE id = ?').run(upTo, incoming.id);
      for (const { post, wake } of posts) {
        db.query(`INSERT OR IGNORE INTO team_posts (team_id, seq, id, fingerprint, author, text, audience, to_keys, routed_by, why, in_reply_to, turn_id, notice, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(post.teamId, post.seq, post.id, post.fingerprint, post.author, post.text, post.audience, JSON.stringify(post.to), post.routedBy, post.why, post.inReplyTo, post.turnId, post.notice ?? null, post.createdAt);
        for (const key of wake) {
          if (!stays.some(member => member.key === key)) continue;
          // Sent again and still waiting, it gets another six hours; any other state stands.
          db.query(`INSERT INTO team_deliveries (post_id, member, state, reason, letter_id, at) VALUES (?, ?, 'waiting', NULL, NULL, ?)
            ON CONFLICT (post_id, member) DO UPDATE SET at = excluded.at WHERE state = 'waiting'`).run(post.id, key, now);
        }
      }
      for (const member of lost) {
        db.query("UPDATE team_deliveries SET state = 'rejected', reason = ?, at = ? WHERE member = ? AND state = 'waiting' AND post_id IN (SELECT id FROM team_posts WHERE team_id = ?)").run(leftReason(member), now, member.key, incoming.id);
        db.query('DELETE FROM team_cursors WHERE team_id = ? AND member = ?').run(incoming.id, member.key);
        db.query('DELETE FROM team_seen WHERE team_id = ? AND member = ?').run(incoming.id, member.key);
      }
    });
    const letters = this.#core.coordination.teamLetters;
    for (const member of lost) {
      const threadId = this.#store.threadOf(member);
      if (threadId !== null) letters.reject(incoming.id, threadId, leftReason(member));
    }
    if (before !== null && !before.archived && current.archived) letters.reject(incoming.id, null, `The team ${current.name} was archived`);
    if (before !== null && ((before.archived && !current.archived) || (before.paused && !current.paused))) {
      this.#store.repair();
      this.#store.kickMembers(current);
    }
    for (const { post, wake } of posts) if (wake.length > 0) this.#store.repair(post.id);
    if (stays.length === 0) this.#forget(incoming.id);
  }

  #forget(teamId: string): void {
    this.#core.journal.append({ type: 'teams.forgotten', threadId: null, version: 1, payload: { teamId } }, db => {
      db.query('DELETE FROM team_deliveries WHERE post_id IN (SELECT id FROM team_posts WHERE team_id = ?)').run(teamId);
      db.query('DELETE FROM team_posts WHERE team_id = ?').run(teamId);
      db.query('DELETE FROM team_cursors WHERE team_id = ?').run(teamId);
      db.query('DELETE FROM team_seen WHERE team_id = ?').run(teamId);
      db.query('DELETE FROM teams WHERE id = ?').run(teamId);
    });
  }
}
