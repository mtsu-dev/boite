/*
 * Which native sessions the journal names. Read by the journal itself before
 * it erases incognito conversations, and by the transcript purge, so this
 * module imports nothing of the core.
 */

import type { Database } from 'bun:sqlite';

export interface NativeSession {
  accountId: string;
  sessionId: string;
}

function fieldOf(text: string | null, field: 'accountId' | 'sessionId'): string | null {
  if (text === null) return null;
  try {
    const value = (JSON.parse(text) as Record<string, unknown>)[field];
    return typeof value === 'string' && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

/** The sessions a thread keeps for a switch back to their accounts (`threads/account-sessions.ts`, setting `account-sessions:`). */
function savedSessions(db: Database, threadId: string): NativeSession[] {
  const row = db.query('SELECT value FROM settings WHERE key = ?').get(`account-sessions:${threadId}`) as { value: string } | null;
  if (row === null) return [];
  try {
    const saved = (JSON.parse(row.value) as { saved?: Record<string, { sessionId?: unknown }> }).saved ?? {};
    return Object.entries(saved).flatMap(([accountId, session]) => typeof session?.sessionId === 'string' && session.sessionId.length > 0 ? [{ accountId, sessionId: session.sessionId }] : []);
  } catch {
    return [];
  }
}

/**
 * Every session the threads ran on, with the account it ran under: the
 * current one, the ones kept for a switch back, and each turn's frozen
 * execution and checkpoint, which keep the sessions an account change or a
 * fresh retry left behind.
 */
export function threadSessions(db: Database, threadIds: readonly string[]): NativeSession[] {
  const out = new Map<string, NativeSession>();
  const add = (accountId: string, sessionId: string | null) => {
    if (sessionId !== null) out.set(`${accountId}\0${sessionId}`, { accountId, sessionId });
  };
  const threadQuery = db.query('SELECT account_id, session_id FROM threads WHERE id = ?');
  const turnQuery = db.query('SELECT execution, checkpoint FROM turns WHERE thread_id = ?');
  for (const id of threadIds) {
    const thread = threadQuery.get(id) as { account_id: string; session_id: string | null } | null;
    if (thread === null) continue;
    add(thread.account_id, thread.session_id);
    for (const saved of savedSessions(db, id)) add(saved.accountId, saved.sessionId);
    for (const turn of turnQuery.all(id) as { execution: string | null; checkpoint: string | null }[]) {
      const accountId = fieldOf(turn.execution, 'accountId') ?? thread.account_id;
      add(accountId, fieldOf(turn.execution, 'sessionId'));
      add(accountId, fieldOf(turn.checkpoint, 'sessionId'));
    }
  }
  return [...out.values()];
}

/**
 * Whether any thread still in the journal names the session: a fork can
 * resume its source's. Asked right before each removal, so a thread that
 * took the session up while the purge was waiting on the disk keeps it. The
 * LIKE only narrows the scan; the JSON field decides.
 */
export function sessionReferenced(db: Database, sessionId: string): boolean {
  return db.query(`SELECT 1 FROM threads WHERE session_id = ?1
    UNION ALL SELECT 1 FROM settings WHERE key LIKE 'account-sessions:%' AND value LIKE '%' || ?1 || '%' AND json_valid(value)
      AND EXISTS (SELECT 1 FROM json_each(settings.value, '$.saved') AS saved WHERE json_extract(saved.value, '$.sessionId') = ?1)
    UNION ALL SELECT 1 FROM turns WHERE
      (execution LIKE '%' || ?1 || '%' AND json_valid(execution) AND json_extract(execution, '$.sessionId') = ?1)
      OR (checkpoint LIKE '%' || ?1 || '%' AND json_valid(checkpoint) AND json_extract(checkpoint, '$.sessionId') = ?1)
    LIMIT 1`).get(sessionId) !== null;
}
