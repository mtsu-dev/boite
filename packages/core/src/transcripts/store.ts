/*
 * The archive of compacted conversations, under `<data dir>/transcripts`:
 *
 *   index.db                               what the archive holds, for audits
 *   sessions/<thread>/<session>.jsonl.zst  one file a provider session
 *   blobs/<aa>/<sha256>.<ext>              images and other binaries, once each
 *
 * The index is a plain SQLite file an audit may query on its own: `threads`,
 * `sessions`, `turns` (usage, kept even after a conversation is erased),
 * `failures`, `blobs` and `blob_refs`. Session files and blobs are written by
 * `session.ts` before a row names them, so a row never points at nothing.
 */

import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { ArchivedFailure, ArchivedTranscript } from '@boite/contracts';
import { blobPath, type ArchiveResult } from './session.ts';
import { sha256 } from './records.ts';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  project_path TEXT,
  provider TEXT,
  model TEXT,
  created_at INTEGER,
  updated_at INTEGER,
  deleted_at INTEGER,
  compacted_at INTEGER NOT NULL,
  erased_at INTEGER,
  images_erased_at INTEGER
);
CREATE TABLE IF NOT EXISTS sessions (
  thread_id TEXT NOT NULL,
  id TEXT NOT NULL,
  source TEXT NOT NULL,
  file TEXT NOT NULL,
  raw_bytes INTEGER NOT NULL,
  bytes INTEGER NOT NULL,
  records INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  first_at INTEGER,
  last_at INTEGER,
  compacted_at INTEGER NOT NULL,
  PRIMARY KEY (thread_id, id)
);
CREATE TABLE IF NOT EXISTS turns (
  thread_id TEXT NOT NULL,
  id TEXT NOT NULL,
  status TEXT NOT NULL,
  queued_at INTEGER,
  started_at INTEGER,
  finished_at INTEGER,
  usage TEXT,
  error TEXT,
  PRIMARY KEY (thread_id, id)
);
CREATE TABLE IF NOT EXISTS failures (
  thread_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  line INTEGER NOT NULL,
  at INTEGER,
  kind TEXT NOT NULL,
  tool TEXT,
  text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS failures_by_thread ON failures (thread_id, session_id);
CREATE INDEX IF NOT EXISTS failures_by_time ON failures (at);
CREATE TABLE IF NOT EXISTS blobs (
  sha256 TEXT PRIMARY KEY,
  ext TEXT NOT NULL,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  stored INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS blob_refs (
  sha256 TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  PRIMARY KEY (sha256, thread_id)
);
CREATE INDEX IF NOT EXISTS blob_refs_by_thread ON blob_refs (thread_id);
CREATE TABLE IF NOT EXISTS leftovers (
  root TEXT NOT NULL,
  session_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  PRIMARY KEY (root, session_id)
);
`;

/** A name safe as a path segment; anything else is filed under its hash. */
const SEGMENT = /^[A-Za-z0-9._-]{1,120}$/;
const segment = (name: string): string => SEGMENT.test(name) && !name.startsWith('.') ? name : sha256(name).slice(0, 32);

export interface ArchivedThread {
  id: string;
  title: string;
  projectPath: string | null;
  provider: string | null;
  model: string | null;
  createdAt: number | null;
  updatedAt: number | null;
  deletedAt: number | null;
}

export interface ArchivedTurn {
  id: string;
  status: string;
  queuedAt: number | null;
  startedAt: number | null;
  finishedAt: number | null;
  usage: unknown;
  error: string | null;
}

interface ThreadRow {
  id: string; title: string; project_path: string | null; provider: string | null; model: string | null;
  created_at: number | null; updated_at: number | null; deleted_at: number | null; compacted_at: number;
  sessions: number; records: number; bytes: number; failures: number;
}

export class TranscriptStore {
  readonly dir: string;
  #db: Database | null = null;
  #reader: Database | null = null;

  constructor(dataDir: string) {
    this.dir = join(dataDir, 'transcripts');
  }

  get blobsDir(): string { return join(this.dir, 'blobs'); }
  get indexPath(): string { return join(this.dir, 'index.db'); }

  /** Whether anything was ever archived: a read never creates the archive. */
  exists(): boolean { return this.#db !== null || existsSync(this.indexPath); }

  /** The index to write to, made at the first write. A rollback journal, not a WAL: a reader leaves no file beside it. */
  get db(): Database {
    if (this.#db !== null) return this.#db;
    mkdirSync(this.dir, { recursive: true });
    const db = new Database(this.indexPath, { create: true });
    db.exec(SCHEMA);
    this.#reader?.close();
    this.#reader = null;
    this.#db = db;
    return db;
  }

  /** The index to read from: opened read-only until something is written, so a preview changes nothing on disk. Call after `exists()`. */
  get read(): Database {
    return this.#db ?? (this.#reader ??= new Database(this.indexPath, { readonly: true }));
  }

  close(): void {
    this.#db?.close();
    this.#reader?.close();
    this.#db = null;
    this.#reader = null;
  }

  /** Where a session's archive goes; a session archived again takes the next free name. */
  sessionPath(threadId: string, sessionId: string): { id: string; file: string; path: string } {
    const taken = this.exists() ? new Set((this.read.query('SELECT id FROM sessions WHERE thread_id = ?').all(threadId) as { id: string }[]).map(row => row.id)) : new Set<string>();
    let id = sessionId;
    for (let round = 2; taken.has(id); round += 1) id = `${sessionId}.${round}`;
    const file = join('sessions', segment(threadId), `${segment(id)}.jsonl.zst`);
    return { id, file, path: join(this.dir, file) };
  }

  /**
   * Puts a verified copy in the place of the archive a thread already holds of the same records, and answers
   * whether it held one: the same file is not kept twice, and the one kept is the one just read back.
   */
  replaceSession(threadId: string, digest: string, copy: string, bytes: number): boolean {
    if (!this.exists()) return false;
    const row = this.read.query('SELECT id, file FROM sessions WHERE thread_id = ? AND sha256 = ? ORDER BY id LIMIT 1').get(threadId, digest) as { id: string; file: string } | null;
    if (row === null) return false;
    renameSync(copy, join(this.dir, row.file));
    this.db.query('UPDATE sessions SET bytes = ? WHERE thread_id = ? AND id = ?').run(bytes, threadId, row.id);
    return true;
  }

  /**
   * Blobs several conversations hold that leave the disk when `erased` drop every hold and `faded` their holds
   * on images: the images among them, and the bytes of the others.
   */
  sharedBlobs(erased: readonly string[], faded: readonly string[]): { images: { count: number; bytes: number }; others: number } {
    const out = { images: { count: 0, bytes: 0 }, others: 0 };
    if (!this.exists() || erased.length + faded.length === 0) return out;
    const rows = this.read.query(`SELECT b.stored, b.mime LIKE 'image/%' AS image FROM blobs b
      WHERE (SELECT COUNT(*) FROM blob_refs r WHERE r.sha256 = b.sha256) > 1
        AND NOT EXISTS (SELECT 1 FROM blob_refs r WHERE r.sha256 = b.sha256
          AND r.thread_id NOT IN (SELECT value FROM json_each(?1))
          AND NOT (b.mime LIKE 'image/%' AND r.thread_id IN (SELECT value FROM json_each(?2))))`).all(JSON.stringify(erased), JSON.stringify(faded)) as { stored: number; image: number }[];
    for (const row of rows) {
      if (row.image === 1) { out.images.count += 1; out.images.bytes += row.stored; } else out.others += row.stored;
    }
    return out;
  }

  thread(threadId: string): { updatedAt: number | null; deletedAt: number | null; erasedAt: number | null; compactedAt: number } | null {
    if (!this.exists()) return null;
    const row = this.read.query('SELECT updated_at, deleted_at, erased_at, compacted_at FROM threads WHERE id = ?').get(threadId) as { updated_at: number | null; deleted_at: number | null; erased_at: number | null; compacted_at: number } | null;
    return row === null ? null : { updatedAt: row.updated_at, deletedAt: row.deleted_at, erasedAt: row.erased_at, compactedAt: row.compacted_at };
  }

  /**
   * Notes whose a provider session is, right before its conversation leaves the journal: should its files
   * outlive that (written to at that moment), a later pass still knows them for that conversation's.
   */
  leave(threadId: string, sessions: readonly { root: string; id: string }[]): void {
    const insert = this.db.query('INSERT OR REPLACE INTO leftovers (root, session_id, thread_id) VALUES (?, ?, ?)');
    this.db.transaction(() => { for (const session of sessions) insert.run(session.root, session.id, threadId); })();
  }

  /** The files of that session are gone, or a conversation names it again: nothing is left over. */
  settle(root: string, sessionId: string): void {
    if (this.exists()) this.db.query('DELETE FROM leftovers WHERE root = ? AND session_id = ?').run(root, sessionId);
  }

  /** The conversation a session was left over from, as the archive knows it. */
  leftover(root: string, sessionId: string): (ArchivedThread & { erased: boolean }) | null {
    if (!this.exists()) return null;
    const row = this.read.query(`SELECT t.id, t.title, t.project_path, t.provider, t.model, t.created_at, t.updated_at, t.deleted_at, t.erased_at FROM leftovers l JOIN threads t ON t.id = l.thread_id
      WHERE l.root = ? AND l.session_id = ?`).get(root, sessionId) as { id: string; title: string; project_path: string | null; provider: string | null; model: string | null; created_at: number | null; updated_at: number | null; deleted_at: number | null; erased_at: number | null } | null;
    return row === null ? null : { id: row.id, title: row.title, projectPath: row.project_path, provider: row.provider, model: row.model, createdAt: row.created_at, updatedAt: row.updated_at, deletedAt: row.deleted_at, erased: row.erased_at !== null };
  }

  putThread(thread: ArchivedThread, now: number): void {
    this.db.query(`INSERT INTO threads (id, title, project_path, provider, model, created_at, updated_at, deleted_at, compacted_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
      ON CONFLICT(id) DO UPDATE SET title = ?2, project_path = ?3, provider = ?4, model = ?5, created_at = ?6, updated_at = ?7, deleted_at = ?8, compacted_at = ?9, erased_at = NULL`)
      .run(thread.id, thread.title, thread.projectPath, thread.provider, thread.model, thread.createdAt, thread.updatedAt, thread.deletedAt, now);
  }

  putTurns(threadId: string, turns: readonly ArchivedTurn[]): void {
    const insert = this.db.query('INSERT OR REPLACE INTO turns (thread_id, id, status, queued_at, started_at, finished_at, usage, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    this.db.transaction(() => {
      for (const turn of turns) insert.run(threadId, turn.id, turn.status, turn.queuedAt, turn.startedAt, turn.finishedAt, turn.usage === null || turn.usage === undefined ? null : JSON.stringify(turn.usage), turn.error);
    })();
  }

  putSession(threadId: string, session: { id: string; file: string; source: string; rawBytes: number }, result: ArchiveResult, now: number): void {
    const db = this.db;
    db.transaction(() => {
      db.query('INSERT OR REPLACE INTO sessions (thread_id, id, source, file, raw_bytes, bytes, records, sha256, first_at, last_at, compacted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(threadId, session.id, session.source, session.file, session.rawBytes, result.bytes, result.records, result.sha256, result.firstAt, result.lastAt, now);
      const failure = db.query('INSERT INTO failures (thread_id, session_id, line, at, kind, tool, text) VALUES (?, ?, ?, ?, ?, ?, ?)');
      for (const item of result.failures) failure.run(threadId, session.id, item.line, item.at, item.kind, item.tool, item.text);
      this.holdBlobs(threadId, result.blobs);
    })();
  }

  /** Records the blobs a job stored and the thread's hold on them; also for an archive the thread already had, written again with its images. */
  holdBlobs(threadId: string, blobs: ArchiveResult['blobs']): void {
    const blob = this.db.query('INSERT OR IGNORE INTO blobs (sha256, ext, mime, bytes, stored) VALUES (?, ?, ?, ?, ?)');
    const ref = this.db.query('INSERT OR IGNORE INTO blob_refs (sha256, thread_id) VALUES (?, ?)');
    for (const item of blobs) {
      // A blob the job did not store (images already due to go) is referenced by the records only.
      if (item.stored === 0) continue;
      blob.run(item.sha256, item.ext, item.mime, item.bytes, item.stored);
      ref.run(item.sha256, threadId);
    }
  }

  /**
   * Drops a thread's hold on its images and removes those nothing else refers
   * to; with `all`, on every blob, as an erased conversation does. A PDF or
   * another binary is no image. Answers what left the disk.
   */
  eraseImages(threadId: string, now: number, all = false): { count: number; bytes: number } {
    if (!this.exists()) return { count: 0, bytes: 0 };
    const db = this.db;
    const kinds = all ? '%' : 'image/%';
    const gone = db.transaction(() => {
      const orphans = db.query(`SELECT b.sha256, b.ext, b.stored FROM blobs b JOIN blob_refs r ON r.sha256 = b.sha256 WHERE r.thread_id = ?1 AND b.mime LIKE ?2
        AND NOT EXISTS (SELECT 1 FROM blob_refs other WHERE other.sha256 = b.sha256 AND other.thread_id != ?1)`).all(threadId, kinds) as { sha256: string; ext: string; stored: number }[];
      db.query('DELETE FROM blob_refs WHERE thread_id = ?1 AND sha256 IN (SELECT sha256 FROM blobs WHERE mime LIKE ?2)').run(threadId, kinds);
      const remove = db.query('DELETE FROM blobs WHERE sha256 = ?');
      for (const blob of orphans) remove.run(blob.sha256);
      db.query('UPDATE threads SET images_erased_at = ? WHERE id = ?').run(now, threadId);
      return orphans;
    })();
    for (const blob of gone) rmSync(blobPath(this.blobsDir, blob.sha256, blob.ext), { force: true });
    return { count: gone.length, bytes: gone.reduce((sum, blob) => sum + blob.stored, 0) };
  }

  /** Removes a conversation's records and images. Its row and its turns stay: usage outlives it. */
  eraseThread(threadId: string, now: number): number {
    if (!this.exists()) return 0;
    const db = this.db;
    const images = this.eraseImages(threadId, now, true);
    const sessions = db.query('SELECT file, bytes FROM sessions WHERE thread_id = ?').all(threadId) as { file: string; bytes: number }[];
    db.transaction(() => {
      db.query('DELETE FROM sessions WHERE thread_id = ?').run(threadId);
      db.query('DELETE FROM failures WHERE thread_id = ?').run(threadId);
      db.query('UPDATE threads SET erased_at = ? WHERE id = ?').run(now, threadId);
    })();
    for (const session of sessions) rmSync(join(this.dir, session.file), { force: true });
    rmSync(join(this.dir, 'sessions', segment(threadId)), { recursive: true, force: true });
    return images.bytes + sessions.reduce((sum, session) => sum + session.bytes, 0);
  }

  /**
   * Bytes a conversation holds in the archive: its records, the images it
   * alone refers to, and its other blobs. `imageRefs` counts every image it
   * refers to, shared ones included.
   */
  threadBytes(threadId: string): { records: number; images: number; imageCount: number; imageRefs: number; others: number } {
    if (!this.exists()) return { records: 0, images: 0, imageCount: 0, imageRefs: 0, others: 0 };
    const records = (this.read.query('SELECT COALESCE(SUM(bytes), 0) AS bytes FROM sessions WHERE thread_id = ?').get(threadId) as { bytes: number }).bytes;
    const own = this.read.query(`SELECT COALESCE(SUM(b.stored), 0) AS bytes, COUNT(*) AS count FROM blobs b JOIN blob_refs r ON r.sha256 = b.sha256 WHERE r.thread_id = ?1 AND b.mime LIKE ?2
      AND NOT EXISTS (SELECT 1 FROM blob_refs other WHERE other.sha256 = b.sha256 AND other.thread_id != ?1)`);
    const images = own.get(threadId, 'image/%') as { bytes: number; count: number };
    const all = own.get(threadId, '%') as { bytes: number; count: number };
    const imageRefs = (this.read.query("SELECT COUNT(*) AS count FROM blob_refs r JOIN blobs b ON b.sha256 = r.sha256 WHERE r.thread_id = ? AND b.mime LIKE 'image/%'").get(threadId) as { count: number }).count;
    return { records, images: images.bytes, imageCount: images.count, imageRefs, others: all.bytes - images.bytes };
  }

  /** Deleted conversations still in the archive, with what the policy reads of them. */
  deleted(): { id: string; deletedAt: number; imagesErasedAt: number | null }[] {
    if (!this.exists()) return [];
    return (this.read.query('SELECT id, deleted_at, images_erased_at FROM threads WHERE deleted_at IS NOT NULL AND erased_at IS NULL').all() as { id: string; deleted_at: number; images_erased_at: number | null }[])
      .map(row => ({ id: row.id, deletedAt: row.deleted_at, imagesErasedAt: row.images_erased_at }));
  }

  totalBytes(): number {
    if (!this.exists()) return 0;
    const row = this.read.query('SELECT (SELECT COALESCE(SUM(bytes), 0) FROM sessions) + (SELECT COALESCE(SUM(stored), 0) FROM blobs) AS bytes').get() as { bytes: number };
    return row.bytes;
  }

  list(query: string | undefined, limit: number): ArchivedTranscript[] {
    if (!this.exists()) return [];
    const like = `%${(query ?? '').replace(/[\\%_]/g, char => `\\${char}`)}%`;
    const rows = this.read.query(`SELECT t.*, COUNT(s.id) AS sessions, COALESCE(SUM(s.records), 0) AS records, COALESCE(SUM(s.bytes), 0) AS bytes,
        (SELECT COUNT(*) FROM failures f WHERE f.thread_id = t.id) AS failures
      FROM threads t JOIN sessions s ON s.thread_id = t.id
      WHERE t.erased_at IS NULL AND (t.title LIKE ?1 ESCAPE '\\' OR COALESCE(t.project_path, '') LIKE ?1 ESCAPE '\\' OR t.id = ?2)
      GROUP BY t.id ORDER BY COALESCE(t.updated_at, t.compacted_at) DESC LIMIT ?3`).all(like, query ?? '', limit) as ThreadRow[];
    return rows.map(row => ({
      threadId: row.id, title: row.title, projectPath: row.project_path, provider: row.provider, model: row.model,
      createdAt: row.created_at, updatedAt: row.updated_at, deletedAt: row.deleted_at, compactedAt: row.compacted_at,
      sessions: row.sessions, records: row.records, bytes: row.bytes, failures: row.failures,
    }));
  }

  failures(params: { threadId?: string | undefined; query?: string | undefined }, limit: number): ArchivedFailure[] {
    if (!this.exists()) return [];
    const like = `%${(params.query ?? '').replace(/[\\%_]/g, char => `\\${char}`)}%`;
    const rows = this.read.query(`SELECT thread_id, session_id, line, at, kind, tool, text FROM failures
      WHERE (?1 IS NULL OR thread_id = ?1) AND (text LIKE ?2 ESCAPE '\\' OR COALESCE(tool, '') LIKE ?2 ESCAPE '\\' OR kind LIKE ?2 ESCAPE '\\')
      ORDER BY at DESC LIMIT ?3`).all(params.threadId ?? null, like, limit) as { thread_id: string; session_id: string; line: number; at: number | null; kind: string; tool: string | null; text: string }[];
    return rows.map(row => ({ threadId: row.thread_id, sessionId: row.session_id, line: row.line, at: row.at, kind: row.kind, tool: row.tool, text: row.text }));
  }

  /** A conversation's archived sessions, oldest first, with where each file is. */
  sessions(threadId: string): { id: string; path: string }[] {
    if (!this.exists()) return [];
    return (this.read.query('SELECT id, file FROM sessions WHERE thread_id = ? ORDER BY COALESCE(first_at, compacted_at), id').all(threadId) as { id: string; file: string }[])
      .map(row => ({ id: row.id, path: join(this.dir, row.file) }));
  }
}
