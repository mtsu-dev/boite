/*
 * Where the agents keep the sessions the archive reads, by session id.
 *
 * Claude Code: `<config dir>/projects/<folder>/<id>.jsonl`, with the folder
 * `<id>/` beside it for its subagents (`subagents/*.jsonl`) and the tool
 * outputs it moved out (`tool-results/*`). Codex:
 * `<home>/sessions/<year>/<month>/<day>/rollout-<time>-<id>.jsonl`, or
 * `.jsonl.zst` once Codex compressed it, and `<home>/archived_sessions/`.
 * Links are never followed: what is listed here may be removed.
 */

import type { Dirent } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { TranscriptSource } from './session.ts';

export interface RawSession {
  id: string;
  source: TranscriptSource;
  /** The session's own file first, then its subagents', in name order. */
  files: string[];
  toolResults: string[];
  /** The files and folders that go once the session is archived. */
  paths: string[];
  /** The folder of `projects/` a Claude session is filed under: its working directory, flattened. */
  folder: string | null;
  bytes: number;
  /** The last write to any of its files. */
  modifiedAt: number;
  /** In a directory Boite made for the account: sessions nobody else reads. */
  own: boolean;
}

/** What an agent names a session with; anything else could leave its folder. */
const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/;
const ROLLOUT = /^rollout-.*?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl(\.zst)?$/;

async function entries(dir: string): Promise<Dirent[]> {
  try { return await readdir(dir, { withFileTypes: true }); } catch { return []; }
}

async function sized(path: string): Promise<{ bytes: number; modifiedAt: number } | null> {
  try {
    const stat = await lstat(path);
    return stat.isFile() ? { bytes: stat.size, modifiedAt: stat.mtimeMs } : null;
  } catch { return null; }
}

/** Every real file under `dir`, links left out. */
async function walk(dir: string, depth = 4): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await entries(dir)) {
    if (entry.isSymbolicLink()) continue;
    const path = join(dir, entry.name);
    if (entry.isFile()) out.push(path);
    else if (entry.isDirectory() && depth > 0) out.push(...await walk(path, depth - 1));
  }
  return out.sort();
}

function session(sessions: Map<string, RawSession>, id: string, source: TranscriptSource, own: boolean, folder: string | null): RawSession {
  let found = sessions.get(id);
  if (found === undefined) {
    found = { id, source, files: [], toolResults: [], paths: [], folder, bytes: 0, modifiedAt: 0, own };
    sessions.set(id, found);
  }
  return found;
}

async function add(raw: RawSession, path: string, list: 'files' | 'toolResults' | null): Promise<void> {
  const stat = await sized(path);
  if (stat === null) return;
  raw.bytes += stat.bytes;
  raw.modifiedAt = Math.max(raw.modifiedAt, stat.modifiedAt);
  if (list !== null) raw[list].push(path);
}

async function scanClaude(dir: string, own: boolean, sessions: Map<string, RawSession>): Promise<void> {
  for (const folder of await entries(join(dir, 'projects'))) {
    if (!folder.isDirectory() || folder.isSymbolicLink()) continue;
    const base = join(dir, 'projects', folder.name);
    const listed = await entries(base);
    // The session's own file goes first whatever order the directory lists.
    for (const entry of listed) {
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
      const id = entry.name.slice(0, -'.jsonl'.length);
      if (!SESSION_ID.test(id)) continue;
      const raw = session(sessions, id, 'claude', own, folder.name);
      await add(raw, join(base, entry.name), 'files');
      raw.paths.push(join(base, entry.name));
    }
    for (const entry of listed) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !SESSION_ID.test(entry.name)) continue;
      const raw = session(sessions, entry.name, 'claude', own, folder.name);
      for (const path of await walk(join(base, entry.name))) {
        const part = path.slice(join(base, entry.name).length + 1).split(/[\\/]/)[0];
        await add(raw, path, part === 'subagents' && path.endsWith('.jsonl') ? 'files' : part === 'tool-results' ? 'toolResults' : null);
      }
      raw.paths.push(join(base, entry.name));
    }
  }
}

async function scanCodex(dir: string, own: boolean, sessions: Map<string, RawSession>): Promise<void> {
  for (const path of [...await walk(join(dir, 'sessions'), 3), ...await walk(join(dir, 'archived_sessions'), 0)]) {
    const match = ROLLOUT.exec(basename(path));
    if (match === null) continue;
    const raw = session(sessions, match[1]!, 'codex', own, null);
    await add(raw, path, 'files');
    raw.paths.push(path);
  }
}

/** The sessions of one account directory. A directory that cannot be read holds none. */
export async function scanSessions(dir: string, source: TranscriptSource, own: boolean, into = new Map<string, RawSession>()): Promise<Map<string, RawSession>> {
  if (source === 'claude') await scanClaude(dir, own, into); else await scanCodex(dir, own, into);
  for (const [id, raw] of into) if (raw.files.length === 0) into.delete(id);
  return into;
}

/** Whether a session's files are as a scan found them: same size, no later write. */
export async function unchanged(raw: RawSession): Promise<boolean> {
  let bytes = 0;
  let modifiedAt = 0;
  for (const path of [...raw.files, ...raw.toolResults]) {
    const stat = await sized(path);
    if (stat === null) return false;
    bytes += stat.bytes;
    modifiedAt = Math.max(modifiedAt, stat.modifiedAt);
  }
  return modifiedAt <= raw.modifiedAt && bytes <= raw.bytes;
}
