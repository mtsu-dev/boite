import type { Database } from 'bun:sqlite';

/** How every driver writes the part, its type then its trigger (`drivers/*`, `threads/background-compact.ts`). */
const COMPACTION = '{"type":"compaction","trigger":"';

/**
 * The compactions of a thread and the prompts the user sent, which the context
 * popup shows: a client holds only the pages it loaded. A compaction is a
 * `compaction` part of a message, so they are counted as occurrences of the
 * part's opening in the stored JSON, over the rows that hold one. A quote
 * inside a JSON string is escaped, so tool output that mentions the text
 * cannot match; only a tool input object nesting that exact opening could.
 * Parts carry no time of their own, so no date of the last one is given. On a 42 MB thread of 2,751 messages this took about 130 ms where
 * `json_each` over the same rows took 1.1 s (2026-10-31).
 */
export function threadStats(db: Database, threadId: string): { compactions: number; prompts: number } {
  const compacted = db
    .query(`SELECT COALESCE(SUM((length(parts) - length(replace(parts, ?2, ''))) / length(?2)), 0) AS count
      FROM messages WHERE thread_id = ?1 AND role <> 'user' AND instr(parts, ?2) > 0`)
    .get(threadId, COMPACTION) as { count: number };
  const prompts = db.query("SELECT COUNT(*) AS count FROM messages WHERE thread_id = ? AND role = 'user'").get(threadId) as { count: number };
  return { compactions: compacted.count, prompts: prompts.count };
}
