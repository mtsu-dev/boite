import type { Database } from 'bun:sqlite';
import type { DetectedIcon } from '../project-icons.ts';
import type { ProjectIconRow } from './rows.ts';

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
