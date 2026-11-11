import type { Database } from 'bun:sqlite';

/**
 * The council (`docs/internals/council.md`). The tables keep the name of the debates they
 * were made for: a debate stored then stays readable next to a council, and a
 * rename would have an older core refuse this journal for nothing.
 *
 * - `debates`: the council as JSON (`Council` and what the core keeps beside it), its version, its parent and its salon.
 * - `debate_posts`: every post of the salon in order; `id` is the writer's for the owner's, so a retry posts once. `vote` only a stored debate has.
 * - `debate_children`: the delegated threads a council runs, so a thread maps back to its council in one read. `role` is `participant`, or `summary` in a stored debate.
 */
export function createCouncil(db: Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS debates (
    id TEXT PRIMARY KEY,
    parent_thread_id TEXT NOT NULL,
    salon_thread_id TEXT NOT NULL,
    request_id TEXT,
    fingerprint TEXT NOT NULL,
    status TEXT NOT NULL,
    version INTEGER NOT NULL,
    data TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS debates_parent ON debates(parent_thread_id)');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS debates_request ON debates(parent_thread_id, request_id) WHERE request_id IS NOT NULL');
  db.exec(`CREATE TABLE IF NOT EXISTS debate_posts (
    debate_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    id TEXT NOT NULL UNIQUE,
    round INTEGER NOT NULL,
    author TEXT NOT NULL,
    text TEXT NOT NULL,
    to_id TEXT,
    in_reply_to TEXT,
    vote TEXT,
    turn_id TEXT,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (debate_id, seq)
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS debate_children (
    thread_id TEXT PRIMARY KEY,
    debate_id TEXT NOT NULL,
    role TEXT NOT NULL
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS debate_children_debate ON debate_children(debate_id)');
}
