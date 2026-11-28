import type { Database } from 'bun:sqlite';
import { DEFAULT_DELEGATION_CONFIG, type AgentLetter } from '@boite/contracts';

/** A turn's delivery marker must match before the inbox page limit applies. */
export function delegationLetters(db: Database, threadId: string, status: AgentLetter['status'], { limit = 100, error }: { limit?: number; error?: string } = {}): AgentLetter[] {
  const rows = db.query(`SELECT data FROM delegation_messages WHERE recipient_id = ?1 AND status = ?2
    AND (?3 IS NULL OR json_extract(data, '$.error') = ?3) ORDER BY created_at, rowid LIMIT ?4`)
    .all(threadId, status, error ?? null, limit) as { data: string }[];
  return rows.map(row => JSON.parse(row.data) as AgentLetter);
}

/** Ordinary letters must still expire while paused; results wait without being materialized. */
export function pendingMail(db: Database): { root_id: string; recipient_id: string; data: string | null }[] {
  return db.query(`SELECT m.root_id, m.recipient_id, CASE WHEN m.request_id GLOB 'result:*' THEN NULL ELSE m.data END AS data
    FROM delegation_messages m LEFT JOIN settings s ON s.key = 'delegation:' || m.root_id
    WHERE m.status = 'received' AND (m.request_id NOT GLOB 'result:*' OR (
      CASE WHEN s.key IS NULL THEN ?1 ELSE json_extract(s.value, '$.enabled') END = 1
      AND COALESCE(json_extract(s.value, '$.paused'), ?2) = 0))`)
    .all(DEFAULT_DELEGATION_CONFIG.enabled ? 1 : 0, DEFAULT_DELEGATION_CONFIG.paused ? 1 : 0) as { root_id: string; recipient_id: string; data: string | null }[];
}
