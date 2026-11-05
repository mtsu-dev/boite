import type { Database } from 'bun:sqlite';

/**
 * When the current request started: the last started turn that opened one,
 * skipping the turns Boite opened to carry it on, as `continuesRequest` in the
 * contracts reads them. The user opens a request, and so does another agent's
 * message that found the thread at rest (`opensRequest`), whatever its
 * operation. A message that found it still at work carries the request on, like
 * a delegated agent's report, a finished background task, a watched pull
 * request, a restart's resume or an automatic compaction.
 * When only such turns ever started, the first of them stands in. Both orders
 * follow `queued_at`, then id, as `queueOrder` does, and walk
 * `turns_by_thread_queue`. Null when no turn of the thread started.
 */
export function requestSince(db: Database, threadId: string): number | null {
  const row = db
    .query(`SELECT started_at AS since FROM turns
      WHERE thread_id = ? AND started_at IS NOT NULL
        AND (execution IS NULL OR json_extract(execution, '$.opensRequest') IS 1 OR (
          COALESCE(json_extract(execution, '$.operation'), '') NOT IN ('background', 'delegation', 'coordination', 'resume', 'pull-request')
          AND json_extract(execution, '$.automatic') IS NOT 1))
      ORDER BY queued_at DESC, id DESC LIMIT 1`)
    .get(threadId) as { since: number } | null;
  if (row) return row.since;
  const first = db
    .query('SELECT started_at AS since FROM turns WHERE thread_id = ? AND started_at IS NOT NULL ORDER BY queued_at, id LIMIT 1')
    .get(threadId) as { since: number } | null;
  return first?.since ?? null;
}
