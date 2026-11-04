import type { Database } from 'bun:sqlite';

/**
 * Debates between AIs (`docs/debates.md`).
 *
 * - `debates`: the debate as JSON (`Debate` without its ids and times), its version, its parent and its salon.
 * - `debate_posts`: every post of the salon in order; `id` is the writer's for the owner's, so a retry posts once.
 * - `debate_children`: the delegated threads a debate runs, `participant` or `summary`, so a thread maps back to its debate in one read.
 */
export function createDebates(db: Database): void {
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
