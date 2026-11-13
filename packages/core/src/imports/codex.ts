/*
 * Codex's sessions: one rollout per session under the account's Codex home,
 * `<home>/sessions/<year>/<month>/<day>/rollout-<time>-<session id>.jsonl`,
 * every working directory in the same tree. The first line says which
 * directory a session ran in, so a listing reads that line of each file and
 * goes on to the first prompt only for the folder it was asked about. The
 * names a session was given live in `<home>/session_index.jsonl`, one
 * `{ id, thread_name }` per line, the last line of an id winning.
 *
 * The session id is all `thread/resume` needs (`drivers/codex/session.ts`):
 * the app-server finds the rollout in the same home by that id.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { join } from 'node:path';
import type { TranscriptTurn } from './claude.ts';
import { RolloutReader, isReject, metaOf, parseRecord } from './codex-rollout.ts';
import type { RolloutMeta, RolloutReject } from './codex-rollout.ts';

/** Where a Codex home keeps its rollouts. */
export function codexSessionsDir(home: string): string {
  return join(home, 'sessions');
}

/** `sessions/<year>/<month>/<day>/<file>`: nothing deeper is looked at. */
const WALK_DEPTH = 3;

/** Every rollout file under a sessions directory. A directory that cannot be read holds none. */
export function rolloutFiles(dir: string, depth = 0): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (depth < WALK_DEPTH) out.push(...rolloutFiles(path, depth + 1));
    } else if (entry.name.startsWith('rollout-') && entry.name.endsWith('.jsonl')) {
      out.push(path);
    }
  }
  return out;
}

/** A `session_meta` line is tens of kilobytes (23 KB at most over 1001 real rollouts); a longer first line is no rollout. */
export const META_LINE_MAX = 1 << 20;
/** A later line past this is dropped without being held: a record that size is a blob, not a prompt or an answer. */
export const LINE_MAX = 8 << 20;

/**
 * Feeds `take` the file's lines in order until it returns false, holding at
 * most `max(index)` bytes of the line at that index (0 for the first). A
 * longer line is given as null the moment it passes the bound, and the rest
 * of it is skipped unread into memory.
 */
export async function readBoundedLines(
  file: string,
  max: (index: number) => number,
  take: (line: string | null, index: number) => boolean | void,
): Promise<void> {
  const chunks = Bun.file(file).stream().getReader();
  let parts: Uint8Array[] = [];
  let held = 0;
  let over = false;
  let index = 0;
  try {
    for (;;) {
      const { done, value } = await chunks.read();
      if (done) break;
      let start = 0;
      for (;;) {
        const at = value.indexOf(10, start);
        const end = at < 0 ? value.length : at;
        if (!over && end > start) {
          if (held + end - start > max(index)) {
            over = true;
            parts = [];
            if (take(null, index) === false) return;
          } else {
            parts.push(value.subarray(start, end));
            held += end - start;
          }
        }
        if (at < 0) break;
        if (!over && take(Buffer.concat(parts).toString('utf8'), index) === false) return;
        parts = [];
        held = 0;
        over = false;
        index += 1;
        start = at + 1;
      }
    }
    if (!over && held > 0) take(Buffer.concat(parts).toString('utf8'), index);
  } finally {
    await chunks.cancel().catch(() => undefined);
  }
}

const lineMax = (index: number): number => (index === 0 ? META_LINE_MAX : LINE_MAX);
const OVERSIZED: RolloutReject = { field: 'line 1', expected: `a session_meta record of at most ${META_LINE_MAX} bytes` };

/** What a list of sessions shows of one rollout. */
export interface RolloutHead {
  prompt: string;
  promptAt: number;
}

/**
 * The first line of a rollout and, when `wants` takes its working directory,
 * the first prompt: the read stops there. `head` is undefined when the prompt
 * was not looked for, null when the file has none.
 */
export async function listRollout(
  file: string,
  wants: (cwd: string) => boolean,
): Promise<{ meta: RolloutMeta; head: RolloutHead | null | undefined } | RolloutReject> {
  let meta: RolloutMeta | RolloutReject | null = null;
  let wanted = false;
  const reader = new RolloutReader();
  await readBoundedLines(file, lineMax, (line, index) => {
    if (index === 0) {
      meta = line === null ? OVERSIZED : metaOf(line);
      wanted = !isReject(meta) && !meta.subagent && wants(meta.cwd);
      return wanted;
    }
    if (line !== null) reader.line(line);
    return !reader.hasPrompt;
  });
  if (meta === null) return { field: 'line 1', expected: 'a session_meta record' };
  if (isReject(meta)) return meta;
  if (!wanted) return { meta, head: undefined };
  const first = reader.finish().turns[0];
  return { meta, head: first === undefined ? null : { prompt: first.prompt, promptAt: first.promptAt } };
}

/** A rollout read whole: its session and one turn per prompt. */
export async function readRollout(
  file: string,
): Promise<{ meta: RolloutMeta; turns: TranscriptTurn[]; model: string | null; dropped: number[] } | RolloutReject> {
  let meta: RolloutMeta | RolloutReject | null = null;
  const reader = new RolloutReader();
  /** The numbers of the lines past `LINE_MAX`, which were not read. */
  const dropped: number[] = [];
  await readBoundedLines(file, lineMax, (line, index) => {
    if (index === 0) {
      meta = line === null ? OVERSIZED : metaOf(line);
      return !isReject(meta);
    }
    if (line === null) dropped.push(index + 1);
    else reader.line(line);
    return true;
  });
  if (meta === null) return { field: 'line 1', expected: 'a session_meta record' };
  if (isReject(meta)) return meta;
  return { meta, ...reader.finish(), dropped };
}

/** One listed session of a Codex home. */
export interface CodexListing {
  file: string;
  sessionId: string;
  cwd: string;
  prompt: string;
  promptAt: number;
  /** The name `session_index.jsonl` gives the session, when it has one. */
  name: string | null;
  size: number;
  mtimeMs: number;
}

interface Kept {
  size: number;
  mtimeMs: number;
  /** Null for a file whose first line could not be used: it was logged once. */
  meta: RolloutMeta | null;
  head: RolloutHead | null | undefined;
}

/** What each Codex home's files said, kept while a file's size and last write stay the same. */
export class CodexSessions {
  private readonly kept = new Map<string, Map<string, Kept>>();
  private readonly names = new Map<string, { size: number; mtimeMs: number; byId: Map<string, string> }>();

  constructor(private readonly log: (level: 'warn', message: string) => void) {}

  /** The names the home's index gives its sessions, read again only when the index changed. */
  sessionNames(home: string): Map<string, string> {
    const file = join(home, 'session_index.jsonl');
    let stat: { size: number; mtimeMs: number };
    try {
      stat = statSync(file);
    } catch {
      this.names.delete(home);
      return new Map();
    }
    const before = this.names.get(home);
    if (before !== undefined && before.size === stat.size && before.mtimeMs === stat.mtimeMs) return before.byId;
    const byId = new Map<string, string>();
    try {
      // A few dozen bytes per named session: small enough to read whole.
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        const record = parseRecord(line);
        const id = record?.['id'];
        const name = record?.['thread_name'];
        if (typeof id === 'string' && typeof name === 'string' && name.trim().length > 0) byId.set(id, name.trim());
      }
    } catch {
      return new Map();
    }
    this.names.set(home, { size: stat.size, mtimeMs: stat.mtimeMs, byId });
    return byId;
  }

  /**
   * The home's sessions whose working directory `wants` takes and that carry a
   * prompt. A rollout whose first line cannot be used is left out, with one
   * line on the log naming the file and the field.
   */
  async list(home: string, wants: (cwd: string) => boolean): Promise<CodexListing[]> {
    const dir = codexSessionsDir(home);
    if (!existsSync(dir)) {
      this.kept.delete(dir);
      return [];
    }
    const before = this.kept.get(dir);
    const now = new Map<string, Kept>();
    const names = this.sessionNames(home);
    const out: CodexListing[] = [];
    for (const file of rolloutFiles(dir)) {
      let stat: { size: number; mtimeMs: number };
      try {
        stat = statSync(file);
      } catch {
        continue;
      }
      let entry = before?.get(file);
      const same = entry !== undefined && entry.size === stat.size && entry.mtimeMs === stat.mtimeMs;
      const wanted = entry?.meta != null && !entry.meta.subagent && wants(entry.meta.cwd);
      if (!same || (wanted && entry!.head === undefined)) {
        let read: Awaited<ReturnType<typeof listRollout>>;
        try {
          read = await listRollout(file, wants);
        } catch (error) {
          this.log('warn', `import: ${file} could not be read (${error instanceof Error ? error.message : String(error)}); skipped`);
          continue;
        }
        if (isReject(read)) {
          this.log('warn', `import: ${file} is not a rollout Boite reads: ${read.field}, expected ${read.expected}; skipped`);
          entry = { size: stat.size, mtimeMs: stat.mtimeMs, meta: null, head: undefined };
        } else {
          entry = { size: stat.size, mtimeMs: stat.mtimeMs, meta: read.meta, head: read.head };
        }
      }
      now.set(file, entry!);
      const { meta, head } = entry!;
      if (meta === null || meta.subagent || head == null || !wants(meta.cwd)) continue;
      out.push({
        file,
        sessionId: meta.id,
        cwd: meta.cwd,
        prompt: head.prompt,
        promptAt: head.promptAt,
        name: names.get(meta.id) ?? null,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      });
    }
    this.kept.set(dir, now);
    return out;
  }

  /** The rollout files a session id names: the file name ends with it. */
  find(home: string, sessionId: string): string[] {
    return rolloutFiles(codexSessionsDir(home)).filter((file) => file.endsWith(`-${sessionId}.jsonl`));
  }
}
