import type { Database } from 'bun:sqlite';
import type { ThreadSummary } from '@boite/contracts';
import { toThread, type ThreadRow } from './rows.ts';
import { writeThreadUsage } from './usage-slots.ts';

export const REMOVED_PROJECTS = 'SELECT id FROM projects WHERE removed_at IS NOT NULL';
export const VISIBLE_THREAD_ROWS = `FROM threads WHERE id NOT IN (SELECT thread_id FROM thread_deletions)
  AND (project_id IS NULL OR project_id NOT IN (${REMOVED_PROJECTS}))`;

/** Whole thread rows a client can see, with the time of their last prompt. Callers add `AND ...` filters. */
export const VISIBLE_THREADS = `SELECT *,
  EXISTS (SELECT 1 FROM threads parent WHERE parent.id = threads.parent_thread_id AND parent.agent_session_id IS NOT NULL) AS parent_is_bot,
  (SELECT MAX(created_at) FROM messages WHERE thread_id = threads.id AND role = 'user') AS last_user_message_at
  ${VISIBLE_THREAD_ROWS}`;

/**
 * Visible threads matching `filter`, in creation order. Every read of whole
 * threads goes through here, so the deleted-thread filter and the last-prompt
 * column stay the same whatever the filter.
 */
export function threadsWhere(db: Database, filter: string, ...params: string[]): ThreadSummary[] {
  return (db.query(`${VISIBLE_THREADS} ${filter} ORDER BY rowid`).all(...params) as ThreadRow[]).map(toThread);
}

/** Only ids are needed to freeze the order of a sidebar read. The first page paints the newest rows. */
export function recentThreadIds(db: Database): string[] {
  return (db.query(`SELECT id ${VISIBLE_THREAD_ROWS} AND archived = 0 ORDER BY updated_at DESC, id`).all() as { id: string }[]).map(row => row.id);
}

/** Current native sessions remain reserved while deleted threads are recoverable, children included. */
export function sessionThreads(db: Database): { id: string; sessionId: string }[] {
  return db.query('SELECT id, session_id AS sessionId FROM threads WHERE session_id IS NOT NULL').all() as { id: string; sessionId: string }[];
}

/**
 * Restores a deleted family atomically, retaining IDs, message cursors and
 * prior archive flags. Each restored row passes `admit` before the commit,
 * like any other thread write, so a refusal leaves the family deleted.
 */
export function restoreDeletedRows(db: Database, rootId: string, admit: (thread: ThreadSummary) => void): string[] {
  return db.transaction(() => {
    const rows = db.query('SELECT thread_id, archived FROM thread_deletions WHERE root_id = ?').all(rootId) as { thread_id: string; archived: number }[];
    // A thread that was live before its deletion loses the archive time the deletion gave it.
    for (const row of rows) db.query('UPDATE threads SET archived = ?1, archived_at = CASE WHEN ?1 = 0 THEN NULL ELSE archived_at END WHERE id = ?2').run(row.archived, row.thread_id);
    db.query('DELETE FROM thread_deletions WHERE root_id = ?').run(rootId);
    const ids = rows.map(row => row.thread_id);
    for (const thread of threadsWhere(db, 'AND id IN (SELECT value FROM json_each(?))', JSON.stringify(ids))) admit(thread);
    return ids;
  })();
}

/** The one write of a whole thread row. `Journal.putThread` admits it first. */
export function writeThread(db: Database, thread: ThreadSummary): void {
  // The usage page's slots follow a thread's project, provider and model, in one transaction (`usage-slots.ts`).
  db.transaction(() => {
    writeThreadUsage(db, { id: thread.id, project_id: thread.projectId, provider_id: thread.providerId, model: thread.model });
    writeThreadRow(db, thread);
  })();
}

function writeThreadRow(db: Database, thread: ThreadSummary): void {
  db.query(
    `INSERT OR REPLACE INTO threads
     (id, project_id, title, title_source, provider_id, account_id, model, effort, cwd, branch, permission_mode, status, unread, archived, pinned, session_id, context, created_at, updated_at, session_generation, selection_version, speed, parent_thread_id, prompt_cache, agent_session_id, session_resume_at, title_state, branch_naming_pending, fork_origin, done_at, incognito, archived_at, context_mode, team_id, debate_id, interruption_read_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    thread.id,
    thread.projectId,
    thread.title,
    thread.titleSource,
    thread.providerId,
    thread.accountId,
    thread.model,
    thread.effort,
    thread.cwd,
    thread.branch,
    thread.permissionMode,
    thread.status,
    thread.unread ? 1 : 0,
    thread.archived ? 1 : 0,
    thread.pinned ? 1 : 0,
    thread.sessionId,
    thread.context === null ? null : JSON.stringify(thread.context),
    thread.createdAt,
    thread.updatedAt,
    thread.sessionGeneration ?? 0,
    thread.selectionVersion ?? 0,
    thread.speed ?? null,
    thread.parentThreadId ?? null,
    thread.promptCache ? JSON.stringify(thread.promptCache) : null,
    thread.agentSessionId ?? null,
    thread.sessionResumeAt ?? null,
    thread.titleState ? JSON.stringify(thread.titleState) : null,
    thread.branchNamingPending === true ? 1 : 0,
    thread.forkOrigin ? JSON.stringify(thread.forkOrigin) : null,
    thread.doneAt ?? null,
    thread.incognito ? 1 : 0,
    thread.archived ? (thread.archivedAt ?? null) : null, thread.contextMode ? JSON.stringify(thread.contextMode) : null,
    thread.teamId ?? null,
    thread.councilId ?? null,
    thread.interruptionReadAt ?? null,
  );
}
