import { deviceBound, type GitStatus, type ThreadId } from '@boite/contracts';
import type { Core } from './core.ts';
import { gitDiff } from './git/diff.ts';
import { gitFailed } from './git/errors.ts';
import { fromPrefix, parseNumstat, parseStatus, prefixOf } from './git/porcelain.ts';
import { git } from './git/read.ts';
import { assertDeviceFile, assertDeviceHistoryFile, assertDeviceReadable, threadCwd } from './workdir.ts';

export async function gitStatus(core: Core, threadId: ThreadId): Promise<GitStatus> {
  core.sharedAccess.denyTool(threadId);
  const cwd = threadCwd(core, threadId);
  // Both reads start together: neither needs the other's answer, and in series
  // they cost the sum of two full walks of the working tree. The status is
  // still judged first, so its refusal wins over anything the numbers say.
  const reading = git(core, threadId, cwd, ['status', '--porcelain=v1', '-z', '--branch']);
  // A repository with no commit has no HEAD to compare to: the paths are still
  // reported, without numbers, rather than failing the whole read.
  // The plumbing `diff-index`, not `diff`: the porcelain writes a refreshed
  // index back whatever GIT_OPTIONAL_LOCKS says. `-M` keeps its renames.
  const counting = git(core, threadId, cwd, ['diff-index', '-M', '--numstat', '-z', 'HEAD']);
  // Status and numstat name paths from the root; the thread names them from its folder.
  const locating = git(core, threadId, cwd, ['rev-parse', '--show-prefix']);
  // Left unread when the status refuses: their rejections must not go unhandled.
  counting.catch(() => {});
  locating.catch(() => {});
  const status = await reading;
  if (status.code !== 0) gitFailed(threadId, ['status'], status);
  const parsed = parseStatus(status.stdout);
  const numstat = await counting;
  const numbers = numstat.code === 0 ? parseNumstat(numstat.stdout) : new Map<string, { additions: number | null; deletions: number | null }>();
  const located = await locating;
  if (located.code !== 0) gitFailed(threadId, ['rev-parse', '--show-prefix'], located);
  const prefix = prefixOf(located.stdout);
  for (const change of parsed.changes) {
    const counted = numbers.get(change.path);
    change.path = fromPrefix(prefix, change.path);
    if (change.oldPath !== null) change.oldPath = fromPrefix(prefix, change.oldPath);
    if (counted === undefined) continue;
    change.additions = counted.additions;
    change.deletions = counted.deletions;
  }
  return parsed;
}

export function registerGitMethods(core: Core): void {
  // A paired device or a plugin reads only a thread that lives in its project or the core's worktrees.
  core.router.register('git.status', (params, ctx) => {
    if (deviceBound(ctx.connection.identity.principal)) assertDeviceReadable(core, params.threadId);
    return gitStatus(core, params.threadId);
  });
  core.router.register('git.diff', (params, ctx) => {
    if (deviceBound(ctx.connection.identity.principal)) {
      assertDeviceReadable(core, params.threadId);
      const cwd = threadCwd(core, params.threadId);
      assertDeviceFile(core, params.threadId, cwd, params.path);
      // The origin is read too, at HEAD: it answers to the same rules as the path.
      if (typeof params.oldPath === 'string') assertDeviceFile(core, params.threadId, cwd, params.oldPath);
      // And the origin git actually reads, which the status may give when the device names none.
      return gitDiff(core, params, (absolute) => assertDeviceHistoryFile(core, params.threadId, cwd, absolute));
    }
    return gitDiff(core, params);
  });
}
