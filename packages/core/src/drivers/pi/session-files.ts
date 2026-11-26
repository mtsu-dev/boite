import { mkdir, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { NativeForkUnsupported } from '../native-fork.ts';
import { isRecord } from '../stdio.ts';
import type { ForkedSession, SessionContext, TurnResult } from '../types.ts';
import { sessionDirOf } from './mapping.ts';

type Checkpoint = NonNullable<TurnResult['checkpoint']>;

/** pi appends entries synchronously before agent_settled. Read only the last record. */
export async function checkpointOf(path: string, sessionId: string, dir: string): Promise<Checkpoint | undefined> {
  if (!path || dirname(resolve(path)) !== resolve(dir) || !basename(path).endsWith(`_${sessionId}.jsonl`)) return;
  const file = await open(path, 'r');
  try {
    const chunks: Buffer[] = [];
    const size = (await file.stat()).size;
    for (let end = size; end > 0;) {
      const start = Math.max(0, end - 4096);
      const chunk = Buffer.allocUnsafe(end - start);
      const { bytesRead } = await file.read(chunk, 0, chunk.length, start);
      if (bytesRead !== chunk.length) return;
      if (end === size && chunk.at(-1) !== 10) return;
      const line = end === size ? chunk.subarray(0, -1) : chunk;
      const previous = line.lastIndexOf(10);
      chunks.push(line.subarray(previous + 1));
      if (previous === -1 && start !== 0) { end = start; continue; }
      const entry: unknown = JSON.parse(Buffer.concat(chunks.reverse()).toString('utf8'));
      if (isRecord(entry) && entry['type'] !== 'session' && typeof entry['id'] === 'string') {
        return { sessionId, entry: entry['id'] };
      }
      return;
    }
  } finally { await file.close(); }
}

/** Write a new pi session containing the inclusive path to the checkpoint. */
export async function copySession(sourceDir: string, checkpoint: Checkpoint, targetDir: string, cwd: string): Promise<{ path: string; id: string }> {
  try {
    const names = (await readdir(sourceDir, { withFileTypes: true }))
      .filter(entry => entry.isFile() && entry.name.endsWith(`_${checkpoint.sessionId}.jsonl`));
    if (names.length !== 1) throw new NativeForkUnsupported('pi session file is missing or ambiguous');
    const source = join(sourceDir, names[0]!.name);
    const data = await readFile(source, 'utf8');
    // A concurrent append can leave the last record incomplete. A recorded checkpoint precedes it.
    const [first, ...lines] = data.slice(0, data.lastIndexOf('\n') + 1).trimEnd().split('\n');
    const header: unknown = JSON.parse(first ?? 'null');
    if (!isRecord(header) || header['type'] !== 'session' || header['id'] !== checkpoint.sessionId) {
      throw new NativeForkUnsupported('pi session header does not match the checkpoint');
    }
    const entries = new Map<string, { parentId: unknown; line: string }>();
    for (const line of lines) {
      // pi skips a malformed line when it resumes; only a broken ancestry stops the copy.
      let entry: unknown;
      try { entry = JSON.parse(line); } catch { continue; }
      if (isRecord(entry) && typeof entry['id'] === 'string') entries.set(entry['id'], { parentId: entry['parentId'], line });
    }
    const chain: string[] = [];
    const visited = new Set<string>();
    for (let leaf: unknown = checkpoint.entry; leaf !== null;) {
      if (typeof leaf !== 'string') throw new NativeForkUnsupported('pi checkpoint ancestor has no entry id');
      const entry = entries.get(leaf);
      if (!entry || visited.has(leaf)) throw new NativeForkUnsupported('pi checkpoint ancestry is missing or cyclic');
      visited.add(leaf);
      chain.push(entry.line);
      leaf = entry.parentId;
    }
    const id = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    const path = join(targetDir, `${timestamp.replace(/[:.]/g, '-')}_${id}.jsonl`);
    const staged = `${path}.tmp`;
    await mkdir(targetDir, { recursive: true, mode: 0o700 });
    try {
      await writeFile(staged, `${[JSON.stringify({ ...header, id, timestamp, cwd, parentSession: source }), ...chain.reverse()].join('\n')}\n`, { flag: 'wx', mode: 0o600 });
      await rename(staged, path);
    } catch (error) {
      await rm(staged, { force: true });
      throw error;
    }
    return { path, id };
  } catch (error) {
    if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new NativeForkUnsupported('pi checkpoint transcript is unavailable');
    }
    throw error;
  }
}

export async function forkSession(ctx: SessionContext, checkpoint: Checkpoint, sourceThreadId: string): Promise<ForkedSession> {
  const copy = await copySession(sessionDirOf(ctx, sourceThreadId), checkpoint, sessionDirOf(ctx), ctx.thread.cwd);
  return { sessionId: copy.id, release: async () => {}, discard: async () => { await rm(copy.path, { force: true }); } };
}
