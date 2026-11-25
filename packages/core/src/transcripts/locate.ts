/*
 * Where the agents keep the sessions the archive reads, by session id.
 *
 * Claude Code: `<config dir>/projects/<folder>/<id>.jsonl`, with the folder
 * `<id>/` beside it for its subagents (`subagents/*.jsonl`) and the tool
 * outputs it moved out (`tool-results/*`). Codex:
 * `<home>/sessions/<year>/<month>/<day>/rollout-<time>-<id>.jsonl`, or
 * `.jsonl.zst` once Codex compressed it, and `<home>/archived_sessions/`; a
 * subagent's rollout names its parent in its first line and is read with it.
 *
 * What is listed here may be removed, so links are never followed, a listed
 * file must really be under its account's folder, and removal takes the listed
 * files one by one: a file this module does not read stays where it is.
 */

import type { Dirent } from 'node:fs';
import { lstat, readdir, realpath, rm, rmdir } from 'node:fs/promises';
import { basename, dirname, join, sep } from 'node:path';
import { lines, type TranscriptSource } from './session.ts';

export interface RawSession {
  id: string;
  source: TranscriptSource;
  /** The session's own file first, then its subagents', in name order. */
  files: string[];
  toolResults: string[];
  /** Folders of its own, removed once archived if nothing is left in them, deepest first. */
  dirs: string[];
  /** The account's folder every file must really be under, links resolved. */
  root: string;
  /** Each listed file as the scan found it: which file it is, its size, its last write and change. */
  stamps: Map<string, string>;
  /** The folder of `projects/` a Claude session is filed under: its working directory, flattened. */
  folder: string | null;
  bytes: number;
  /** Bytes of the files listed, and the last write to any of them. */
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

interface Sized { bytes: number; modifiedAt: number; stamp: string }

/** A real file's size and last write, with what tells it from another file put in its place. */
async function sized(path: string): Promise<Sized | null> {
  try {
    const stat = await lstat(path);
    return stat.isFile() ? { bytes: stat.size, modifiedAt: stat.mtimeMs, stamp: `${stat.dev}:${stat.ino} ${stat.size} ${stat.mtimeMs} ${stat.ctimeMs}` } : null;
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

/** The folder `name` of `root`, when it is a folder there and not a link to somewhere else. */
async function contained(root: string, name: string): Promise<string | null> {
  try {
    const path = join(root, name);
    return await realpath(path) === path ? path : null;
  } catch { return null; }
}

/** Two accounts may hold a session of the same id: each is a session of its own, under its account's folder. */
const keyOf = (root: string, id: string): string => `${root}\0${id}`;

function session(sessions: Map<string, RawSession>, id: string, source: TranscriptSource, own: boolean, folder: string | null, root: string): RawSession {
  let found = sessions.get(keyOf(root, id));
  if (found === undefined) {
    found = { id, source, files: [], toolResults: [], dirs: [], root, stamps: new Map(), folder, bytes: 0, modifiedAt: 0, own };
    sessions.set(keyOf(root, id), found);
  }
  return found;
}

async function add(raw: RawSession, path: string, list: 'files' | 'toolResults'): Promise<void> {
  const stat = await sized(path);
  if (stat === null) return;
  raw.bytes += stat.bytes;
  raw.modifiedAt = Math.max(raw.modifiedAt, stat.modifiedAt);
  raw.stamps.set(path, stat.stamp);
  raw[list].push(path);
}

async function scanClaude(root: string, own: boolean, sessions: Map<string, RawSession>): Promise<void> {
  const projects = await contained(root, 'projects');
  if (projects === null) return;
  for (const folder of await entries(projects)) {
    if (!folder.isDirectory() || folder.isSymbolicLink()) continue;
    const base = join(projects, folder.name);
    const listed = await entries(base);
    // The session's own file goes first whatever order the directory lists.
    for (const entry of listed) {
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
      const id = entry.name.slice(0, -'.jsonl'.length);
      if (!SESSION_ID.test(id)) continue;
      await add(session(sessions, id, 'claude', own, folder.name, root), join(base, entry.name), 'files');
    }
    for (const entry of listed) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !SESSION_ID.test(entry.name)) continue;
      const raw = session(sessions, entry.name, 'claude', own, folder.name, root);
      const home = join(base, entry.name);
      // Anything else in the folder is not read, so it is neither counted nor removed.
      for (const path of await walk(home)) {
        const part = path.slice(home.length + 1).split(/[\\/]/)[0];
        if (part === 'subagents' && path.endsWith('.jsonl')) await add(raw, path, 'files');
        else if (part === 'tool-results') await add(raw, path, 'toolResults');
      }
      const inner = new Set([...raw.files, ...raw.toolResults].filter(path => path.startsWith(home + sep)).map(path => dirname(path)));
      for (const path of inner) for (let at = path; at.length >= home.length; at = dirname(at)) inner.add(at);
      raw.dirs.push(...[...inner].sort((a, b) => b.length - a.length));
    }
  }
}

/** What of a rollout's first line is read to find its parent. */
const META_HEAD = 1 << 16;

/** The session a rollout says it was spawned by, in the `session_meta` it opens with. */
async function parentOf(path: string): Promise<string | null> {
  try {
    let first = '';
    if (path.endsWith('.zst')) { for await (const line of lines(path)) { first = line; break; } }
    else first = (await Bun.file(path).slice(0, META_HEAD).text()).split('\n', 1)[0] ?? '';
    const meta = JSON.parse(first) as { payload?: { source?: { subagent?: { thread_spawn?: { parent_thread_id?: unknown } } } } };
    const parent = meta.payload?.source?.subagent?.thread_spawn?.parent_thread_id;
    return typeof parent === 'string' && SESSION_ID.test(parent) ? parent : null;
  } catch { return null; }
}

async function scanCodex(root: string, own: boolean, sessions: Map<string, RawSession>): Promise<void> {
  const rollouts: { id: string; path: string }[] = [];
  for (const [name, depth] of [['sessions', 3], ['archived_sessions', 0]] as const) {
    const dir = await contained(root, name);
    if (dir === null) continue;
    for (const path of await walk(dir, depth)) {
      const match = ROLLOUT.exec(basename(path));
      if (match !== null) rollouts.push({ id: match[1]!, path });
    }
  }
  const parents = new Map<string, string>();
  for (const rollout of rollouts) {
    const parent = await parentOf(rollout.path);
    if (parent !== null && parent !== rollout.id) parents.set(rollout.id, parent);
  }
  const known = new Set(rollouts.map(rollout => rollout.id));
  /** The session a subagent's rollout is read with: its topmost parent that has a rollout here. */
  const top = (id: string): string => {
    const seen = new Set([id]);
    for (let at = parents.get(id); at !== undefined && known.has(at) && !seen.has(at); at = parents.get(at)) { seen.add(at); id = at; }
    return id;
  };
  // A session's own rollout first, then its subagents', in name order.
  const owner = (rollout: { id: string }): string => top(rollout.id);
  for (const rollout of [...rollouts].sort((a, b) => Number(owner(a) !== a.id) - Number(owner(b) !== b.id) || a.path.localeCompare(b.path))) {
    await add(session(sessions, owner(rollout), 'codex', own, null, root), rollout.path, 'files');
  }
}

/** The sessions of one account directory, by account folder and id. A directory that cannot be read holds none. */
export async function scanSessions(dir: string, source: TranscriptSource, own: boolean, into = new Map<string, RawSession>()): Promise<Map<string, RawSession>> {
  let root: string;
  try { root = await realpath(dir); } catch { return into; }
  if (source === 'claude') await scanClaude(root, own, into); else await scanCodex(root, own, into);
  for (const [key, raw] of into) if (raw.files.length === 0) into.delete(key);
  return into;
}

/** Whether a listed file is the one the scan found: the same file under its account's folder, same size, no later write or change. */
async function same(raw: RawSession, path: string): Promise<boolean> {
  const stat = await sized(path);
  if (stat === null || stat.stamp !== raw.stamps.get(path)) return false;
  try { return (await realpath(path)).startsWith(raw.root + sep); } catch { return false; }
}

/** Whether every file of a session is as a scan found it. */
export async function unchanged(raw: RawSession): Promise<boolean> {
  for (const path of [...raw.files, ...raw.toolResults]) if (!(await same(raw, path))) return false;
  return true;
}

/**
 * Removes the files a scan listed, one by one and each checked again as it
 * goes, then the session's own folders that are left empty. A file the scan
 * did not list, one written since or one put in its place stays, and keeps
 * its folder.
 */
export async function removeSession(raw: RawSession): Promise<void> {
  for (const path of [...raw.files, ...raw.toolResults]) if (await same(raw, path)) await rm(path, { force: true });
  for (const dir of raw.dirs) await rmdir(dir).catch(() => undefined);
}
