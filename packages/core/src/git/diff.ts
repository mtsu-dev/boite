import { resolve } from 'node:path';
import type { GitChangeStatus, GitDiff, RpcParams } from '@boite/contracts';
import { DIFF_MAX_BYTES } from '@boite/contracts';
import type { Core } from '../core.ts';
import { refused } from '../errors.ts';
import { hasNul, resolveInside, threadCwd, writeLandsInside } from '../workdir.ts';
import { gitFailed } from './errors.ts';
import { parseStatus } from './porcelain.ts';
import { git, readRefSide, readTreeSide, SIDE_CEILING_BYTES } from './read.ts';

function checkRef(ref: string): string {
  if (typeof ref !== 'string' || ref.length === 0) throw refused('git.diff ref must be a revision', { ref: String(ref) });
  if (ref.startsWith('-') || /[\s\0:]/.test(ref)) throw refused(`git.diff refuses the ref ${ref}`, { ref });
  return ref;
}

function cut(data: Uint8Array): { text: string; truncated: boolean } {
  const truncated = data.length > DIFF_MAX_BYTES;
  return { text: new TextDecoder().decode(truncated ? data.subarray(0, DIFF_MAX_BYTES) : data), truncated };
}

/**
 * `historical`, when given, sees the file the old side is read from before any
 * of its content is: a rename's origin from the status, not only the paths the
 * caller named.
 */
export async function gitDiff(core: Core, params: RpcParams<'git.diff'>, historical?: (absolute: string) => void): Promise<GitDiff> {
  // A path filter cannot protect historical blobs or Git's configurable external helpers.
  core.sharedAccess.denyTool(params.threadId);
  const threadId = params.threadId;
  const cwd = threadCwd(core, threadId);
  const found = resolveInside(cwd, params.path, 'git.diff path');
  const ref = checkRef(params.ref === undefined || params.ref === '' ? 'HEAD' : params.ref);
  const change = await changeOf(core, params, cwd, found.relative);
  // Status paths are root-relative; an unchanged path is relative to cwd.
  const atRef = change?.oldPath ?? change?.path ?? `./${found.relative}`;
  // The name goes to git as one NUL-ended record: a NUL inside it would end it early.
  if (atRef.includes('\0')) throw refused(`git.diff refuses a path with a NUL in it: ${JSON.stringify(atRef)}`, { path: params.path });
  // `<ref>:./x` is relative to cwd and `<ref>:x` to the repository's root, as git reads them.
  if (historical) historical(atRef.startsWith('./') ? resolve(cwd, atRef) : resolve(await topLevel(core, threadId, cwd), atRef));
  const oldSide = await readRefSide(core, threadId, cwd, ref, atRef);
  // Missing files remain valid inputs, but links and ancestors must stay inside cwd.
  if (!writeLandsInside(cwd, found.absolute)) {
    throw refused(`git.diff path leaves the thread's working directory: ${params.path}`, { path: params.path });
  }
  const newSide = await readTreeSide(found.absolute, params.path);
  if (oldSide.tooBig || newSide.tooBig) {
    throw refused(
      `git.diff will not read ${params.path}: it is over ${SIDE_CEILING_BYTES / (1024 * 1024)} MB on one side`,
      { path: params.path, ref, ceilingBytes: SIDE_CEILING_BYTES },
    );
  }
  const old = oldSide.data;
  const current = newSide.data;
  if (old === null && current === null) {
    throw refused(`git.diff has no file to read at ${params.path}, in the working tree or at ${ref}`, { path: params.path, ref });
  }

  return renderDiff(found.relative, change, old, current);
}

async function topLevel(core: Core, threadId: RpcParams<'git.diff'>['threadId'], cwd: string): Promise<string> {
  const found = await git(core, threadId, cwd, ['rev-parse', '--show-toplevel']);
  if (found.code !== 0) gitFailed(threadId, ['rev-parse', '--show-toplevel'], found);
  return found.stdout.trim();
}

/**
 * What `git.status` says of the path. The client that read the status passes
 * the rename origin it saw, null included, and no second walk of the whole
 * tree runs; without it, the core asks git.
 */
async function changeOf(core: Core, params: RpcParams<'git.diff'>, cwd: string, relative: string): Promise<{ path: string; oldPath: string | null; status?: GitChangeStatus } | null> {
  const given = params.oldPath;
  if (given === null) return null;
  if (given !== undefined) {
    const origin = resolveInside(cwd, given, 'git.diff oldPath');
    return { path: relative, oldPath: origin.relative, status: 'renamed' };
  }
  // Read the whole status so a rename retains its origin.
  const status = await git(core, params.threadId, cwd, ['status', '--porcelain=v1', '-z']);
  if (status.code !== 0) gitFailed(params.threadId, ['status'], status);
  return parseStatus(status.stdout).changes.find((entry) => entry.path === relative) ?? null;
}

function renderDiff(path: string, change: { oldPath: string | null; status?: GitChangeStatus } | null, old: Uint8Array | null, current: Uint8Array | null): GitDiff {
  const binary = (old !== null && hasNul(old)) || (current !== null && hasNul(current));
  const oldSide = old === null || binary ? null : cut(old);
  const newSide = current === null || binary ? null : cut(current);
  return {
    path,
    oldPath: change?.oldPath ?? null,
    status: change?.status ?? (old === null ? 'added' : current === null ? 'deleted' : 'modified'),
    oldText: oldSide?.text ?? null,
    newText: newSide?.text ?? null,
    binary,
    truncated: (oldSide?.truncated ?? false) || (newSide?.truncated ?? false),
  };
}
