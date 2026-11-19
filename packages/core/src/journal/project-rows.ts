import type { Database } from 'bun:sqlite';
import type { Project } from '@boite/contracts';
import type { DetectedIcon } from '../project-icons.ts';
import { toProject, type ProjectIconRow, type ProjectRow } from './rows.ts';

export function getProject(db: Database, projectId: string): Project | null {
  const row = db.query('SELECT * FROM projects WHERE id = ? AND removed_at IS NULL').get(projectId) as ProjectRow | null;
  return row === null ? null : toProject(row);
}

export function listProjects(db: Database, removed: boolean): Project[] {
  const sql = removed ? 'SELECT * FROM projects WHERE removed_at IS NOT NULL ORDER BY removed_at DESC'
    : 'SELECT * FROM projects WHERE removed_at IS NULL ORDER BY rowid';
  return (db.query(sql).all() as ProjectRow[]).map(toProject);
}

/** Archived project threads, including work delegated by a bot, and how many are done. */
export function archivedThreadCounts(db: Database): Map<string, { archived: number; done: number }> {
  const rows = db
    .query(`SELECT project_id, COUNT(*) AS count, COUNT(done_at) AS done FROM threads WHERE archived = 1
      AND (parent_thread_id IS NULL OR EXISTS (SELECT 1 FROM threads parent WHERE parent.id = threads.parent_thread_id AND parent.agent_session_id IS NOT NULL))
      AND project_id IS NOT NULL AND id NOT IN (SELECT thread_id FROM thread_deletions) GROUP BY project_id`).all() as { project_id: string; count: number; done: number }[];
  return new Map(rows.map(row => [row.project_id, { archived: row.count, done: row.done }]));
}

export interface ProjectIconImage {
  mime: string;
  data: Uint8Array;
  version: string;
}

/** Icon metadata for visible projects, without the image bytes. */
export function projectIcons(db: Database): Map<string, ProjectIconRow> {
  const rows = db.query(`SELECT i.project_id, i.kind, i.tech, i.version FROM project_icons i
    JOIN projects p ON p.id = i.project_id WHERE p.removed_at IS NULL`).all() as (ProjectIconRow & { project_id: string })[];
  return new Map(rows.map(({ project_id, ...row }) => [project_id, row]));
}

export function projectIconImage(db: Database, projectId: string): ProjectIconImage | null {
  const row = db.query(`SELECT i.mime, i.data, i.version FROM project_icons i
    JOIN projects p ON p.id = i.project_id WHERE p.removed_at IS NULL AND i.project_id = ? AND i.kind = 'image'`)
    .get(projectId) as { mime: string | null; data: Uint8Array | null; version: string | null } | null;
  if (row === null || row.mime === null || row.data === null || row.version === null) return null;
  return { mime: row.mime, data: row.data, version: row.version };
}

export function putProjectIcon(db: Database, projectId: string, icon: DetectedIcon, checkedAt: number): void {
  db.query('INSERT OR REPLACE INTO project_icons (project_id, kind, tech, mime, data, version, source, checked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(
      projectId,
      icon.kind,
      icon.kind === 'tech' ? icon.id : null,
      icon.kind === 'image' ? icon.mime : null,
      icon.kind === 'image' ? icon.bytes : null,
      icon.kind === 'image' ? icon.version : null,
      icon.kind === 'image' ? icon.source : null,
      checkedAt,
    );
}
