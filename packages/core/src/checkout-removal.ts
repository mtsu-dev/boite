import { existsSync, lstatSync, mkdtempSync } from 'node:fs';
import { link, lstat, mkdir, readdir, readFile, readlink, realpath, rename, rmdir, symlink, unlink } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import type { Project, ThreadId, ThreadSummary } from '@boite/contracts';
import type { Core } from './core.ts';
import { inside, keyOf } from './checkouts.ts';
import { finishCheckoutRecovery, type CheckoutGit, type CheckoutGitResult } from './checkout-recovery.ts';
import { messageOf, refused } from './errors.ts';
import { occupiesCheckout } from './threads/occupancy.ts';

/** Resolve aliases, including a vanished folder through its nearest existing parent. */
export async function realKey(path: string): Promise<string> {
  let head = resolve(path);
  const tail: string[] = [];
  for (;;) {
    try { return keyOf(join(await realpath(head), ...tail)); }
    catch {
      const parent = dirname(head);
      if (parent === head) return keyOf(path);
      tail.unshift(basename(head));
      head = parent;
    }
  }
}

interface Occupant { thread: ThreadSummary; draft: boolean }

/** Resolve folders asynchronously, then re-read every occupant in the final synchronous check. */
async function occupancy(core: Core, path: string, retiringThreadId?: ThreadId): Promise<() => Occupant | null | 'moved'> {
  const key = await realKey(path);
  const threads = (): Occupant[] => [
    ...core.threads.list({ includeArchived: true }).map(thread => ({ thread, draft: false })),
    ...core.drafts.threads().map(thread => ({ thread, draft: true })),
  ];
  const keys = new Map<string, string>();
  await Promise.all([...new Set(threads().map(({ thread }) => thread.cwd))].map(async cwd => { keys.set(cwd, await realKey(cwd)); }));
  return () => {
    let holder: Occupant | null = null;
    for (const occupant of threads()) {
      const { thread, draft } = occupant;
      const at = keys.get(thread.cwd);
      if (at === undefined) return 'moved';
      // Only the cleanup's own idle row may relinquish its checkout without archive.
      // Processes, terminals or a resumed turn still hold it, just like any other occupant.
      const retiring = thread.id === retiringThreadId && (thread.status === 'idle' || thread.status === 'error');
      if (holder === null && inside(key, at) && occupiesCheckout(core, draft || retiring ? { ...thread, deleted: true } : thread)) holder = occupant;
    }
    return holder;
  };
}

function refuseOccupied(project: Project, path: string, occupant: Occupant | null): void {
  if (occupant === null) return;
  const holder = occupant.thread;
  const why = occupant.draft ? 'is a draft whose agent still runs there: send it, or discard it and let it stop'
    : holder.archived ? 'is still running there: wait for it to finish' : 'works there: archive it first';
  throw refused(`thread "${holder.title}" (${holder.id}) ${why} (${path})`, {
    projectId: project.id, path, threadId: holder.id, threadTitle: holder.title,
    field: 'path', expected: 'a worktree no live thread uses',
  });
}

export async function assertCheckoutVacant(core: Core, project: Project, path: string): Promise<void> {
  for (;;) {
    const holder = (await occupancy(core, path))();
    if (holder === 'moved') continue;
    refuseOccupied(project, path, holder);
    return;
  }
}

/** No await separates the final occupancy check and reservation, held through the actual deletion. */
export async function withVacantCheckout<T>(core: Core, project: Project, path: string, remove: () => Promise<T>, aliases: readonly string[] = [], retiringThreadId?: ThreadId): Promise<T> {
  const keys = await Promise.all([path, ...aliases].map(realKey));
  for (;;) {
    const holder = (await occupancy(core, path, retiringThreadId))();
    if (holder === 'moved') continue;
    refuseOccupied(project, path, holder);
    core.worktrees.reservations.assertFree(path, 'another checkout removal');
    const release = core.worktrees.reservations.reserve(path, keys);
    try { return await remove(); }
    finally { release(); }
  }
}

interface CheckoutMove { path: string; staged: string; admin: string; commit?: string }
const TEMPORARY_PREFIX = '.boite-removing-';
const MOVE_PREFIX = 'checkout-removal:';
const moveKey = async (path: string) => `${MOVE_PREFIX}${keyOf(join(await realKey(dirname(path)), basename(path)))}`;
const savedAt = (staged: string) => join(dirname(staged), 'saved');
const heldPointerAt = (staged: string) => join(dirname(staged), 'git-pointer');

/** An interrupted cleanup must be restored by its owner before the sweep can see it. */
export function stagedForRemoval(path: string): boolean {
  return basename(path) === 'checkout' && basename(dirname(path)).startsWith(TEMPORARY_PREFIX);
}

async function checkoutAdmin(path: string, dotGit = join(path, '.git')): Promise<string | null> {
  try {
    if (!(await lstat(dotGit)).isFile()) return null;
    const pointer = /^gitdir: (.+)$/.exec((await readFile(dotGit, 'utf8')).trimEnd())?.[1];
    return pointer ? realKey(resolve(path, pointer)) : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

const failure = (stderr: string): CheckoutGitResult => ({ code: 1, stdout: '', stderr });
const statusArgs = (path: string) => ['-C', path, '-c', 'core.fsmonitor=', 'status', '--porcelain=v1', '-z', '--untracked-files=normal', '--ignored=matching'];

/** Resolves directory aliases without following a tracked symlink itself. */
async function containedParent(root: string, file: string): Promise<void> {
  if (!inside(root, await realKey(dirname(file)))) throw refused(`path ${file} leaves ${root}`, { path: file });
}

/** Empty directories with rmdir. An unexpected node or a late file stops retirement. */
async function emptyDirectories(root: string): Promise<void> {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(root, entry.name);
    if ((await lstat(dir)).isDirectory()) await emptyDirectories(dir);
  }
  await rmdir(root);
}

/** Only these Git index entries can leave the staged checkout. No recursive file deletion. */
async function setAside(staged: string, saved: string, files: string[]): Promise<string | null> {
  const root = await realKey(staged);
  for (const name of files) {
    const from = resolve(staged, name);
    if (!inside(keyOf(staged), keyOf(from)) || from === staged) throw refused(`invalid tracked path ${name}`, { path: staged });
    await containedParent(root, from);
    const info = await lstat(from).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    });
    // An absent sparse entry needs no move. Gitlinks and replaced directories keep their checkout.
    if (!info) continue;
    if (!info.isFile() && !info.isSymbolicLink()) return `checkout entry ${from} is not a file or symlink`;
    const to = join(saved, name);
    await mkdir(dirname(to), { recursive: true });
    await rename(from, to);
  }
  return null;
}

/** A hard link publishes each saved file only if its old name is still free. */
async function restoreFile(from: string, to: string): Promise<void> {
  try { await link(from, to); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const [source, target] = await Promise.all([lstat(from, { bigint: true }), lstat(to, { bigint: true })]);
    // The last recovery may have stopped between publishing and dropping the old link.
    if (source.ino === 0n || source.ino !== target.ino || source.dev !== target.dev) throw error;
  }
  await unlink(from);
}

async function restoreSymlink(from: string, to: string): Promise<void> {
  const target = await readlink(from);
  try { await symlink(target, to); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    // A previous recovery can stop after publishing the link. Keep any different entry in place.
    if (await readlink(to).catch(() => null) !== target) throw error;
  }
  await unlink(from);
}

async function putBack(saved: string, staged: string): Promise<void> {
  const root = await realKey(staged);
  for (const entry of await readdir(saved, { withFileTypes: true, recursive: true })) {
    if (entry.isDirectory()) continue;
    const from = join(entry.parentPath, entry.name);
    const to = join(staged, relative(saved, from));
    await containedParent(root, to);
    await mkdir(dirname(to), { recursive: true });
    if (entry.isSymbolicLink()) await restoreSymlink(from, to);
    else await restoreFile(from, to);
  }
  await emptyDirectories(saved);
}

async function restoreCheckout(move: CheckoutMove, git: CheckoutGit): Promise<void> {
  const { path, staged, admin } = move;
  const saved = savedAt(staged);
  const pointer = heldPointerAt(staged);
  if (await checkoutAdmin(staged) !== admin && await checkoutAdmin(saved) !== admin && await checkoutAdmin(staged, pointer) !== admin) {
    throw refused(`cannot prove the checkout staged for ${path} still belongs to ${admin}`, { path, staged });
  }
  if (lstatSync(path, { throwIfNoEntry: false })) throw refused(`cannot restore ${path}: it already exists; the checkout stays at ${staged}`, { path, staged });
  if (!existsSync(staged)) await mkdir(staged);
  if (existsSync(saved)) await putBack(saved, staged);
  if (existsSync(pointer)) await restoreFile(pointer, join(staged, '.git'));
  const restored = await git(['worktree', 'move', staged, path]);
  if (restored.code !== 0) throw refused(`cannot restore ${path} from ${staged}: ${restored.stderr.trim() || `git exited ${restored.code}`}`, { path, staged });
}

/** The caller holds the repository's registration gate while resuming a recorded move. */
export async function restoreInterruptedCheckout(core: Core, project: Project, path: string, branch: string | null, git: CheckoutGit): Promise<void> {
  const key = await moveKey(path);
  const move = core.journal.getSetting(key) as CheckoutMove | undefined;
  if (!move) return;
  const listed = await git(['worktree', 'list', '--porcelain', '-z']);
  if (listed.code !== 0) throw refused(`cannot inspect the checkout staged for ${path}: ${listed.stderr}`, { path });
  const registered = listed.stdout.split('\0\0').map(record => record.split('\0'))
    .filter(entry => entry.includes(branch === null ? 'detached' : `branch refs/heads/${branch}`))
    .flatMap(entry => entry.find(field => field.startsWith('worktree '))?.slice(9) ?? []);
  const [keys, stagedKey, originalKey] = await Promise.all([Promise.all(registered.map(realKey)), realKey(move.staged), realKey(move.path)]);
  const atStaged = keys.includes(stagedKey);
  const atOriginal = keys.includes(originalKey);
  const halfMoved = atOriginal && !existsSync(move.path) && await checkoutAdmin(move.staged) === move.admin;
  if (atStaged || halfMoved) {
    await withVacantCheckout(core, project, move.staged, async () => {
      if (halfMoved) {
        const repair = await git(['worktree', 'repair', move.staged]);
        if (repair.code !== 0) throw refused(`cannot repair ${move.staged}: ${repair.stderr.trim()}`, { path, staged: move.staged });
      }
      await restoreCheckout(move, git);
    });
  } else if (existsSync(move.staged) || atOriginal && await checkoutAdmin(move.path) !== move.admin) {
    throw refused(`cannot verify the registered checkout at ${move.staged} for ${path}`, { path, staged: move.staged });
  }
  await finishRemoval(core, move, git);
  core.journal.deleteSetting(key);
}

async function finishRemoval(core: Core, move: CheckoutMove, git?: CheckoutGit): Promise<void> {
  const recoveryPath = savedAt(move.staged);
  // Old interrupted moves can still have the pointer in saved/.git.
  for (const pointer of [heldPointerAt(move.staged), join(recoveryPath, '.git')]) {
    if (!lstatSync(pointer, { throwIfNoEntry: false })) continue;
    if (await checkoutAdmin(move.staged, pointer) !== move.admin) {
      throw refused(`cannot verify the Git pointer kept at ${pointer}`, { path: move.path });
    }
    await unlink(pointer);
  }
  await finishCheckoutRecovery(core, { path: move.path, commit: move.commit ?? null, recoveryPath }, git);
}

/** Git removes the administrative directory last. If reused, it points to a new registered checkout. */
async function registrationGone(move: CheckoutMove): Promise<boolean> {
  if (!lstatSync(move.admin, { throwIfNoEntry: false })) return true;
  const current = (await readFile(join(move.admin, 'gitdir'), 'utf8')).trimEnd();
  if (!current) return false;
  const pointer = resolve(move.admin, current);
  const checkout = dirname(pointer);
  return basename(pointer) === '.git' && await realKey(checkout) !== await realKey(move.staged)
    && await checkoutAdmin(checkout) === move.admin;
}

/** Inventory publishes the files of completed removals, leaving unfinished Git moves to checkout reopening. */
export async function publishInterruptedCheckoutRecoveries(core: Core, registered: (repository: string, work: () => Promise<void>) => Promise<void>): Promise<void> {
  const rows = core.journal.db.query('SELECT key FROM settings WHERE key GLOB ?').all(`${MOVE_PREFIX}*`) as { key: string }[];
  for (const { key } of rows) {
    const move = core.journal.getSetting(key) as CheckoutMove | undefined;
    if (!move || core.worktrees.reservations.holder(move.staged) !== null) continue;
    const repository = dirname(dirname(move.admin));
    const temporary = dirname(move.staged);
    try {
      await registered(repository, async () => {
        // Re-read after taking the gate: an open or another inventory may have finished this move.
        const current = core.journal.getSetting(key) as CheckoutMove | undefined;
        if (current?.staged !== move.staged || !stagedForRemoval(move.staged)
          || keyOf(dirname(temporary)) !== keyOf(dirname(move.path)) || await moveKey(move.path) !== key
          || !lstatSync(temporary, { throwIfNoEntry: false })?.isDirectory() || lstatSync(move.staged, { throwIfNoEntry: false })
          || !lstatSync(savedAt(move.staged), { throwIfNoEntry: false })?.isDirectory() || !await registrationGone(move)) return;
        await finishRemoval(core, move);
        core.journal.deleteSetting(key);
      });
    } catch (error) {
      core.log('warn', `could not publish checkout recovery at ${savedAt(move.staged)}: ${messageOf(error)}`);
    }
  }
}

/** Reclaims a clean directory only by rmdir, then asks Git to remove its obsolete registration. */
export async function removeCleanCheckout(core: Core, path: string, git: CheckoutGit): Promise<CheckoutGitResult> {
  if (!existsSync(path)) return git(['worktree', 'remove', path]);
  const admin = await checkoutAdmin(path);
  if (!admin) return failure(`cannot verify the Git directory of ${path}`);
  const key = await moveKey(path);
  if (core.journal.getSetting(key)) return failure(`an interrupted removal of ${path} still needs recovery`);
  const head = await git(['-C', path, 'rev-parse', '--verify', 'HEAD^{commit}']);
  if (head.code !== 0) return head;
  const commit = head.stdout.trim();
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit)) return failure(`cannot verify the Git commit of ${path}`);
  const temporary = mkdtempSync(join(dirname(path), TEMPORARY_PREFIX));
  const staged = join(temporary, 'checkout');
  const saved = savedAt(staged);
  const move = { path, staged, admin, commit };
  const release = core.worktrees.reservations.reserve(staged, [await realKey(temporary)]);
  let removed = false;
  try {
    core.journal.setSetting(key, move);
    const moved = await git(['worktree', 'move', path, staged]);
    if (moved.code !== 0) return moved;
    const status = await git(statusArgs(staged));
    if (status.code !== 0) return status;
    if (status.stdout || status.stderr) return failure('the checkout has uncommitted files, including ignored files');
    const tracked = await git(['-C', staged, 'ls-files', '-z']);
    if (tracked.code !== 0) return tracked;
    const files = [...new Set(tracked.stdout.split('\0').filter(Boolean)), '.git'];
    const obstruction = await setAside(staged, saved, files);
    if (obstruction !== null) return failure(obstruction);
    if (await checkoutAdmin(saved) !== admin) return failure('the Git directory changed during cleanup');
    const savedStatus = await git(statusArgs(saved));
    if (savedStatus.code !== 0) return savedStatus;
    if (savedStatus.stdout || savedStatus.stderr) return failure('the tracked files changed during cleanup');
    await rename(join(saved, '.git'), heldPointerAt(staged));
    try { await emptyDirectories(staged); }
    catch (error) {
      if (['ENOTEMPTY', 'EEXIST'].includes((error as NodeJS.ErrnoException).code ?? '')) return failure('a file appeared during cleanup');
      throw error;
    }
    const result = await git(['worktree', 'remove', staged]);
    if (result.code !== 0) return result;
    removed = true;
    // A writer with a tracked file already open can still have changed it while Git ran.
    await finishRemoval(core, move, git);
    core.journal.deleteSetting(key);
    return result;
  } finally {
    try {
      if (!removed) {
        if (existsSync(staged) || existsSync(saved)) await restoreCheckout(move, git);
        await rmdir(temporary);
        core.journal.deleteSetting(key);
      }
    }
    finally { release(); }
  }
}
