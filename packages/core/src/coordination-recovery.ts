import { threadActive, type ThreadStatus } from '@boite/contracts';
import type { Journal } from './journal.ts';

/** A restart keeps idle contacts reachable and holds interrupted work for a new wake. */
export function pauseInterruptedCoordination(journal: Journal, pause: (threadId: string) => void): void {
  const db = journal.db;
  const candidates = db.query(`SELECT settings.key, settings.value, threads.rowid FROM settings JOIN threads ON settings.key = 'coordination:' || threads.id
    WHERE threads.id NOT IN (SELECT thread_id FROM thread_deletions) AND (typeof(settings.value) <> 'text' OR NOT json_valid(settings.value))
    ORDER BY threads.rowid`).all() as { key: string; value: string; rowid: number }[];
  // Find the real parser error now; report it after the preceding recovery writes.
  const invalidConfig = candidates.find(({ value }) => { try { JSON.parse(value); return false; } catch { return true; } });
  const interrupted = db.query(`SELECT id, status, rowid FROM threads WHERE id NOT IN (SELECT thread_id FROM thread_deletions)
    AND (? IS NULL OR rowid <= ?) AND (status IN ('queued', 'running', 'waiting') OR rowid = ?
      OR id IN (SELECT thread_id FROM coordination_letters WHERE status IN ('queued', 'received', 'uncertain')))
    ORDER BY rowid`).all(invalidConfig?.rowid ?? null, invalidConfig?.rowid ?? null, invalidConfig?.rowid ?? null) as { id: string; status: ThreadStatus; rowid: number }[];
  for (const thread of interrupted) {
    if (thread.rowid === invalidConfig?.rowid) journal.getSetting(invalidConfig.key);
    const pending = db.query("SELECT 1 FROM coordination_letters WHERE thread_id = ? AND (status IN ('queued', 'received') OR (status = 'uncertain' AND json_extract(data, '$.error') = 'Queued for provider delivery')) LIMIT 1").get(thread.id);
    if (pending || threadActive(thread.status)) pause(thread.id);
  }
}
