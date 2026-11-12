import type { Database } from 'bun:sqlite';

/** How every driver writes the part, its type then its trigger (`drivers/*`, `threads/background-compact.ts`). */
const COMPACTION = '{"type":"compaction","trigger":"';

/** Lazy per-message counts. Writes invalidate only that message, inside their transaction. */
export function createMessageStats(db: Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS message_compactions (
    message_id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, count INTEGER NOT NULL
  ) WITHOUT ROWID;
  CREATE INDEX IF NOT EXISTS message_compactions_by_thread ON message_compactions (thread_id);
  CREATE TRIGGER IF NOT EXISTS message_compactions_insert AFTER INSERT ON messages BEGIN
    DELETE FROM message_compactions WHERE message_id = NEW.id;
  END;
  CREATE TRIGGER IF NOT EXISTS message_compactions_update AFTER UPDATE OF parts, role, thread_id ON messages BEGIN
    DELETE FROM message_compactions WHERE message_id = OLD.id;
  END;
  CREATE TRIGGER IF NOT EXISTS message_compactions_delete AFTER DELETE ON messages BEGIN
    DELETE FROM message_compactions WHERE message_id = OLD.id;
  END;`);
}

/**
 * The compactions of a thread and the prompts the user sent, which the context
 * popup shows: a client holds only the pages it loaded. A compaction is a
 * `compaction` part of a message, so they are counted as occurrences of the
 * part's opening in the stored JSON, over the rows that hold one. A quote
 * inside a JSON string is escaped, so tool output that mentions the text
 * cannot match; only a tool input object nesting that exact opening could.
 * Parts carry no time of their own, so no date of the last one is given.
 * The first read counts old messages lazily; later reads inspect only changed
 * or new parts. Streaming writes invalidate a count without scanning their JSON.
 */
export function threadStats(db: Database, threadId: string): { compactions: number; prompts: number } {
  return db.transaction(() => {
    db.query(`INSERT INTO message_compactions (message_id, thread_id, count)
      SELECT m.id, m.thread_id, CASE WHEN instr(m.parts, ?2) > 0
        THEN (length(m.parts) - length(replace(m.parts, ?2, ''))) / length(?2) ELSE 0 END
      FROM messages m LEFT JOIN message_compactions c ON c.message_id = m.id
      WHERE m.thread_id = ?1 AND m.role <> 'user' AND c.message_id IS NULL`).run(threadId, COMPACTION);
    const compacted = db.query('SELECT COALESCE(SUM(count), 0) AS count FROM message_compactions WHERE thread_id = ?').get(threadId) as { count: number };
    const prompts = db.query("SELECT COUNT(*) AS count FROM messages WHERE thread_id = ? AND role = 'user'").get(threadId) as { count: number };
    return { compactions: compacted.count, prompts: prompts.count };
  })();
}
