import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMessageSearch, searchThreadMessages } from '../packages/core/src/journal/message-search.ts';

const filler = 'Reviewing the scheduler queue, session transport, snapshot replay, and worker lifecycle across connected machines before shipping the next nightly build. '.repeat(5);

function runShape(threadCount: number, messageCount: number): void {
  const dir = mkdtempSync(join(tmpdir(), 'boite-message-search-bench-'));
  const file = join(dir, 'journal.db');
  const db = new Database(file);
  try {
    db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
    db.exec(`
      CREATE TABLE projects (id TEXT PRIMARY KEY, removed_at INTEGER);
      CREATE TABLE threads (id TEXT PRIMARY KEY, project_id TEXT, archived INTEGER DEFAULT 0, incognito INTEGER DEFAULT 0);
      CREATE TABLE thread_deletions (thread_id TEXT PRIMARY KEY);
      CREATE TABLE messages (id TEXT PRIMARY KEY, thread_id TEXT, role TEXT, parts TEXT, created_at INTEGER);
      CREATE TABLE streaming_parts (message_id TEXT, part_index INTEGER, json TEXT, PRIMARY KEY (message_id, part_index));
    `);
    const insertThread = db.query('INSERT INTO threads (id, project_id, archived, incognito) VALUES (?, NULL, 0, 0)');
    const insertMessage = db.query('INSERT INTO messages (id, thread_id, role, parts, created_at) VALUES (?, ?, ?, ?, ?)');
    db.transaction(() => {
      for (let t = 0; t < threadCount; t++) insertThread.run(`t-${t}`);
      for (let i = 0; i < messageCount; i++) {
        const body = (i % 5 === 0
          ? `Checking the deploy pipeline after the error on branch release-${i} to test the build before deploying. `
          : `Routine status update for step ${i} with deploy metrics and error checks across the branch workers. `) + filler;
        insertMessage.run(`m-${i}`, `t-${i % threadCount}`, i % 2 === 0 ? 'user' : 'assistant', JSON.stringify([{ type: 'text', text: body }]), 1_700_000_000_000 + i);
      }
    })();
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    const beforeMb = statSync(file).size / 1e6;
    const migrateStart = performance.now();
    db.transaction(() => createMessageSearch(db))();
    const migrateSec = (performance.now() - migrateStart) / 1000;
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    const afterMb = statSync(file).size / 1e6;
    console.log(`threads=${threadCount} messages=${messageCount} before=${beforeMb.toFixed(1)}MB after=${afterMb.toFixed(1)}MB migrate=${migrateSec.toFixed(2)}s`);
    for (const query of ['deploy', 'the error', 'test the build', 'ploy', 'xyzzynotfound']) {
      const start = performance.now();
      const hits = searchThreadMessages(db, query, { limit: 20 });
      console.log(`  ${query.padEnd(16)} hits=${String(hits.length).padStart(2)} ${(performance.now() - start).toFixed(1)} ms`);
    }
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

runShape(20, 120_000);
runShape(500, 120_000);
