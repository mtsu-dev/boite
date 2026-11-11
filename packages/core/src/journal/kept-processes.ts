/*
 * Schema 49: `kept_processes`, one row per agent process the keeper holds for
 * this core (`keeper/kept-agents.ts`). `offset` is how much of its stdout the
 * journal has committed the events of: it is written in the transaction that
 * commits them, and only then is the keeper told it may let go of those
 * bytes. `state` is left for the driver's translator snapshot at that byte,
 * which a core that attaches again will read; null until a driver writes one.
 */

import type { Database } from 'bun:sqlite';

export interface KeptProcessRow {
  procId: string;
  keeperPid: number;
  pid: number;
  threadId: string;
  turnId: string | null;
  kind: string;
  driver: string | null;
  offset: number;
  state: string | null;
  startedAt: number;
  updatedAt: number;
}

export function createKeptProcesses(db: Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS kept_processes (
    proc_id TEXT PRIMARY KEY,
    keeper_pid INTEGER NOT NULL,
    pid INTEGER NOT NULL,
    thread_id TEXT NOT NULL,
    turn_id TEXT,
    kind TEXT NOT NULL,
    driver TEXT,
    offset INTEGER NOT NULL DEFAULT 0,
    state TEXT,
    started_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
}

const COLUMNS = `proc_id AS procId, keeper_pid AS keeperPid, pid, thread_id AS threadId, turn_id AS turnId, kind, driver,
  offset, state, started_at AS startedAt, updated_at AS updatedAt`;

export function insertKeptProcess(db: Database, row: Omit<KeptProcessRow, 'offset' | 'state' | 'updatedAt'>): void {
  db.query(`INSERT OR REPLACE INTO kept_processes (proc_id, keeper_pid, pid, thread_id, turn_id, kind, driver, offset, state, started_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)`)
    .run(row.procId, row.keeperPid, row.pid, row.threadId, row.turnId, row.kind, row.driver, row.startedAt, row.startedAt);
}

export function setKeptOffset(db: Database, procId: string, offset: number, at: number): void {
  db.query('UPDATE kept_processes SET offset = ?, updated_at = ? WHERE proc_id = ?').run(offset, at, procId);
}

export function deleteKeptProcess(db: Database, procId: string): void {
  db.query('DELETE FROM kept_processes WHERE proc_id = ?').run(procId);
}

/** At startup: what an earlier core kept is ended (`terminals.ts` releases it), so its rows go. */
export function clearKeptProcesses(db: Database): void {
  db.query('DELETE FROM kept_processes').run();
}

export function keptProcesses(db: Database): KeptProcessRow[] {
  return db.query(`SELECT ${COLUMNS} FROM kept_processes ORDER BY started_at`).all() as KeptProcessRow[];
}
