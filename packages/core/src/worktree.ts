import { appendFileSync, closeSync, existsSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { BRANCH_NAME_MAX, type Project, type ThreadId, type WorktreeStorage } from '@boite/contracts';
import { CheckoutReservations } from './checkouts.ts';
import { removeCleanCheckout, restoreInterruptedCheckout, withVacantCheckout } from './checkout-removal.ts';
import type { Core } from './core.ts';
import { folderGone, messageOf, refused } from './errors.ts';
import { newId } from './ids.ts';
import { logGit } from './git/git-log.ts';
import { sharedGitConfig } from './contacts/compute-git.ts';
import { gitCommonDirOf } from './contacts/git-remote.ts';

// Linked checkouts and separate Core instances share one registration directory.
const registrations = new Map<string, Promise<void>>();

/** Every branch the core makes on its own starts with this. */
export const BRANCH_PREFIX = 'boite/';
/** The branch transaction records the reservation owner, including crash-only leftovers. */
const draftBranchOwner = (threadId: ThreadId) => `boite draft reservation ${threadId}`;
const SLUG_MAX = 40;
/** How many `-2`, `-3` suffixes are tried before a generated name is refused as taken. */
const SUFFIX_MAX = 20;
const REMOTE_BASE_TIMEOUT_MS = 2500;

/** A bounded folder name for projects and explicitly named branches. */
export function slugOf(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/, '');
  return slug.length > 0 ? slug : 'thread';
}

/** The folder Boite keeps inside a project, worktrees included. */
const PROJECT_FOLDER = '.boite';

/**
 * Creates a project's `.boite` folder with a `.gitignore` of `*`, so tools that
 * read .gitignore files but not .git/info/exclude skip it too. A `.gitignore`
 * already there is kept as it is. A `.boite` that is a link (a junction on
 * Windows) or resolves outside the project is the user's own arrangement: its
 * target, which may hold anything, gets no marker.
 */
function ensureProjectFolder(projectPath: string): void {
  const folder = join(projectPath, PROJECT_FOLDER);
  if (lstatSync(folder, { throwIfNoEntry: false })?.isSymbolicLink()) return;
  mkdirSync(folder, { recursive: true });
  // Checked again once the folder exists: another process may have linked it meanwhile.
  if (lstatSync(folder).isSymbolicLink()) return;
  const inside = relative(realpathSync(projectPath), realpathSync(folder));
  if (!inside || isAbsolute(inside) || inside === '..' || inside.startsWith(`..${sep}`)) return;
  try { writeFileSync(join(folder, '.gitignore'), '*\n', { flag: 'wx' }); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
}

/** Whether `path` is the project's `.boite` folder or lies in it. */
function inProjectFolder(projectPath: string, path: string): boolean {
  const local = relative(projectPath, path).split(sep).join('/');
  return local === PROJECT_FOLDER || local.startsWith(`${PROJECT_FOLDER}/`);
}

function sameCheckout(first: string, second: string): boolean {
  if (resolve(first) === resolve(second)) return true;
  const a = statSync(first, { bigint: true, throwIfNoEntry: false });
  const b = statSync(second, { bigint: true, throwIfNoEntry: false });
  return a !== undefined && b !== undefined && a.ino !== 0n && a.dev === b.dev && a.ino === b.ino;
}

/** The shared folder separates projects by their stable id, including namesakes. */
export function worktreeRoot(projectPath: string, storage?: WorktreeStorage, projectId?: string): string {
  if (storage?.mode === 'shared') {
    if (!projectId) throw refused('a shared worktree folder requires a project id');
    return join(storage.directory, `${slugOf(basename(projectPath))}-${projectId.replace(/[^a-z0-9_-]/gi, '-')}`);
  }
  return join(projectPath, PROJECT_FOLDER, 'worktrees');
}

/**
 * Runs `work` alone among the registration commands of one repository: every
 * `worktree add`, `list`, `remove` and `prune` of its linked checkouts and of
 * the sweep goes through here. Git exposes a partial registration (an empty
 * `commondir`) before an add completes, and a list or another add that reads
 * it then fails. `timeoutMs` bounds the wait and the work together; `work`
 * gets what is left of it.
 */
export async function withRegistration<T>(cwd: string, work: (remainingMs: number | undefined) => Promise<T>, options: { timeoutMs?: number; assertActive?: () => void; what?: () => string } = {}): Promise<T> {
  const { timeoutMs, assertActive } = options;
  const key = realpathSync(gitCommonDirOf(cwd) ?? cwd);
  const previous = registrations.get(key) ?? Promise.resolve();
  const release = Promise.withResolvers<void>();
  const tail = previous.then(() => release.promise);
  registrations.set(key, tail);
  const started = performance.now();
  const expired = () => refused(`${options.what?.() ?? 'a worktree registration'} did not finish within ${timeoutMs} ms`, { cwd });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (timeoutMs === undefined) await previous;
    else await Promise.race([previous, new Promise<never>((_, reject) => {timer = setTimeout(() => reject(expired()), timeoutMs);})]);
    clearTimeout(timer);
    const remaining = timeoutMs === undefined ? undefined : timeoutMs - (performance.now() - started);
    if (remaining !== undefined && remaining <= 0) throw expired();
    assertActive?.();
    return await work(remaining);
  } finally {
    clearTimeout(timer); release.resolve();
    // A timed-out waiter still sits behind its predecessor until that owner exits.
    void tail.then(() => {if (registrations.get(key) === tail) registrations.delete(key);});
  }
}

export interface PlacedWorktree {
  branch: string;
  path: string;
  base?: string;
  namingPending?: boolean;
}

interface WorktreePreparation {
  beforeMutation: (placed: PlacedWorktree) => (() => void) | void;
  assertActive: () => void;
  timeoutMs?: number;
  runCheckoutHook?: boolean;
}

/**
 * `git worktree add` for a thread that wants a branch of its own. The git
 * processes run under the thread's id, so the trace shows them like any
 * other. The worktree stays on disk when the thread is archived: the branch
 * may carry work nobody merged yet, and deleting it is a decision for a person.
 */
export class Worktrees {
  /** The checkouts a removal is deleting right now; see `CheckoutReservations`. */
  readonly reservations = new CheckoutReservations();

  readonly #core: Core;

  constructor(core: Core) {
    this.#core = core;}

  /** Whether a repository's config names `checkout.workers`, by project path, read once. */
  readonly #workersSet = new Map<string, Promise<boolean>>();

  /**
   * What `git worktree add` is given so a new checkout writes its files with
   * one worker per core: `checkout.workers=0`, unless the user's own config
   * sets a number, which then stands. A read that fails counts as unset.
   */
  async #checkoutWorkers(threadId: ThreadId, repository: string, timeoutMs?: number): Promise<string[]> {
    let set = this.#workersSet.get(repository);
    if (set === undefined) {
      set = this.git(threadId, repository, ['config', '--get', 'checkout.workers'], timeoutMs).then((read) => read.code === 0, () => false);
      this.#workersSet.set(repository, set);
    }
    return (await set) ? [] : ['-c', 'checkout.workers=0'];
  }

  pathFor(project: Project, branch: string): string {
    return join(worktreeRoot(project.path, this.#core.settings.get().worktreeStorage, project.id), slugOf(branch.replace(/^boite\//, '')));
  }

  /** Adopt only the exact branch/path recorded before preparation, or create it once. */
  async ensure(threadId: ThreadId, project: Project, branch: string, recordedPath?: string, preparation?: WorktreePreparation): Promise<PlacedWorktree> {
    return await this.#reattach(threadId, project, branch, recordedPath ?? this.pathFor(project, branch), preparation)
      ?? this.add(threadId, project, branch, recordedPath);
  }

  async #reattach(threadId: ThreadId, project: Project, branch: string, path: string, preparation?: WorktreePreparation): Promise<PlacedWorktree | null> {
    preparation?.assertActive();
    const listed = await withRegistration(project.path, async remaining => {
      const git = (args: string[]) => this.git(threadId, project.path, args, remaining);
      await restoreInterruptedCheckout(this.#core, project, path, branch, git);
      return git(['worktree', 'list', '--porcelain', '-z']);
    }, { timeoutMs: preparation?.timeoutMs, assertActive: preparation?.assertActive });
    preparation?.assertActive();
    if (listed.code !== 0) throw refused(`cannot inspect worktrees in ${project.path}: ${listed.stderr.trim()}`);
    for (const entry of listed.stdout.split('\0\0')) {
      const fields = entry.split('\0');
      const location = fields.find(field => field.startsWith('worktree '))?.slice(9);
      const name = fields.find(field => field.startsWith('branch '))?.slice(7);
      if (location && name === `refs/heads/${branch}` && existsSync(location) && existsSync(join(path, '.git'))) {
        // Git may report a long Windows path while the journal carries its 8.3 alias.
        const registered = statSync(location, { bigint: true });
        const expected = statSync(path, { bigint: true });
        if (registered.ino !== 0n && registered.dev === expected.dev && registered.ino === expected.ino) {
          this.markReused(project, path);
          return { path, branch };
        }
      }
      if (location && name === `refs/heads/${branch}` && existsSync(location)) throw refused(`branch ${branch} is already checked out at ${location}; expected ${path}`);
    }
    if (await this.#branchExists(threadId, project.path, branch)) {
      if (existsSync(path)) throw refused(`cannot recover ${branch}: ${path} already exists`);
      // No live checkout uses this branch. One --force permits an obsolete registration,
      // but does not bypass a locked worktree or overwrite an existing directory.
      await this.#exclude(threadId, project, path, preparation);
      const parallel = await this.#checkoutWorkers(threadId, project.path);
      preparation?.assertActive();
      const added = await this.#registeredGit(threadId, project.path, [...parallel, 'worktree', 'add', '--force', ...(preparation ? ['--no-checkout'] : []), path, branch], preparation?.timeoutMs, preparation?.assertActive);
      preparation?.assertActive();
      if (added.code !== 0) throw refused(`cannot recover ${branch} at ${path}: ${added.stderr.trim()}`);
      return { path, branch };
    }
    if (preparation) throw refused(`cannot resume ${branch}: the reserved branch is absent`, { branch, path });
    return null;
  }

  /**
   * A checkout removed under its thread while its branch stayed: checked out
   * again at `path`, as it was. False when the branch went too, never a new
   * branch in its place; refused like `ensure` when the branch is checked out
   * elsewhere or `path` exists.
   */
  async recover(threadId: ThreadId, project: Project, branch: string, path: string): Promise<boolean> {
    return (await this.#reattach(threadId, project, branch, path)) !== null;
  }

  /** Finish only a pending checkout whose ref was atomically reserved by this thread. */
  async resumePreparation(threadId: ThreadId, project: Project, branch: string, path: string, base: string, assertActive: () => void): Promise<void> {
    assertActive();
    const ref = await this.git(threadId, project.path, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
    assertActive();
    if (ref.code === 1) {
      // Stop may have preceded the reservation transaction. Resume its saved
      // base through the same CAS; never turn an I/O failure into an absent ref.
      await this.add(threadId, project, branch, path, { assertActive, beforeMutation: () => {} }, base);
      return;
    }
    if (ref.code !== 0) throw refused(`cannot inspect reserved branch ${branch}: ${ref.stderr.trim()}`, { branch, path });
    const owner = await this.git(threadId, project.path, ['reflog', 'show', '-1', '--format=%gs', `refs/heads/${branch}`]);
    assertActive();
    if (owner.code !== 0 || owner.stdout.trim() !== draftBranchOwner(threadId) || ref.stdout.trim() !== base) {
      throw refused(`cannot resume ${branch}: expected a branch reserved by ${threadId}`, { branch, path });
    }
    if (!existsSync(path)) await this.#reattach(threadId, project, branch, path, { assertActive, beforeMutation: () => {} });
    else this.markReused(project, path);
    assertActive();
    if (await this.#checkoutBranch(threadId, project.path, path) !== branch) {
      throw refused(`cannot resume ${branch}: ${path} is not its registered checkout`, { branch, path });
    }
    assertActive();
    await this.#finishPreparation(threadId, path, { assertActive, beforeMutation: () => {} });
  }

  /** Git only mutates a private index; Stop never strands a lock on the shared index. */
  async #finishPreparation(threadId: ThreadId, path: string, preparation: WorktreePreparation): Promise<void> {
    const assertActive = preparation.assertActive;
    assertActive();
    const index = await this.git(threadId, path, ['rev-parse', '--git-path', 'index'], preparation.timeoutMs);
    if (index.code !== 0) throw refused(`cannot locate the index of ${path}: ${index.stderr.trim()}`);
    assertActive();
    const file = resolve(path, index.stdout.trim());
    const lock = `${file}.lock`;
    if (existsSync(lock)) throw refused(`cannot prepare ${path}: its index lock already exists`, { path, lock });
    if (!existsSync(file)) {
      const temporary = mkdtempSync(join(dirname(file), 'boite-index-'));
      try {
        // Only this read-tree receives GIT_INDEX_FILE. Its exclusive directory
        // stays until the process exits and its pipes finish draining.
        const read = await this.git(threadId, path, ['-c', 'core.splitIndex=false', 'read-tree', 'HEAD'], preparation.timeoutMs, undefined, join(temporary, 'index'));
        assertActive();
        if (read.code !== 0) throw refused(`cannot restore the index of ${path}: ${read.stderr.trim()}`);
        // Git's ordinary lock excludes other writers. Publication is entirely
        // synchronous in the core: Stop kills children, never this transaction.
        const fd = openSync(lock, 'wx');
        const owned = fstatSync(fd, { bigint: true });
        const ownsLock = () => {
          const current = lstatSync(lock, { bigint: true, throwIfNoEntry: false });
          return current?.dev === owned.dev && current.ino === owned.ino;
        };
        try {
          if (!existsSync(file)) {
            if (!ownsLock()) throw refused(`cannot prepare ${path}: its index lock was replaced`, { path, lock });
            renameSync(join(temporary, 'index'), file);
          }
        } finally {
          closeSync(fd);
          if (ownsLock()) unlinkSync(lock);
        }
      } finally { rmSync(temporary, { recursive: true, force: true }); }
    }
    assertActive();
    const missing = await this.git(threadId, path, ['ls-files', '--deleted', '-z'], preparation.timeoutMs);
    if (missing.code !== 0) throw refused(`cannot inspect missing files in ${path}: ${missing.stderr.trim()}`);
    assertActive();
    if (missing.stdout) {
      // No --force: complete only absent indexed paths, preserving existing edits,
      // notes and staged changes. NUL-delimited stdin also handles long Windows lists.
      const parallel = await this.#checkoutWorkers(threadId, path, preparation.timeoutMs);
      assertActive();
      const checkout = await this.git(threadId, path, [...parallel, 'checkout-index', '-z', '--stdin'], preparation.timeoutMs, missing.stdout);
      if (checkout.code !== 0) throw refused(`cannot finish the checkout of ${path}: ${checkout.stderr.trim()}`);
      assertActive();
    }
  }

  /** `base` is a resolved commit. Independent worktrees start from the project's default branch. */
  async add(threadId: ThreadId, project: Project, wanted?: string, recordedPath?: string, preparation?: WorktreePreparation, base?: string): Promise<PlacedWorktree> {
    preparation?.assertActive();
    if (!existsSync(project.path)) throw folderGone(project.path, { field: 'projectId', projectId: project.id, project: project.name });
    if (!existsSync(join(project.path, '.git'))) {
      throw refused(`${project.path} is not a git repository: a worktree needs one`, {
        projectId: project.id,
        path: project.path,
      });
    }
    if (wanted !== undefined && (wanted.trim().length === 0 || /\s/.test(wanted))) {
      throw refused(`"${wanted}" is not a branch name: no spaces, not empty`, { branch: wanted });
    }

    if (wanted !== undefined && wanted.length > BRANCH_NAME_MAX) {
      throw refused(`branch must be at most ${BRANCH_NAME_MAX} characters; received ${wanted.length}`, {
        field: 'branch', expected: `at most ${BRANCH_NAME_MAX} characters`, maxLength: BRANCH_NAME_MAX, actualLength: wanted.length,
      });
    }

    const root = worktreeRoot(project.path, this.#core.settings.get().worktreeStorage, project.id);
    const slug = wanted === undefined ? `wt-${newId('').slice(0, 8)}` : slugOf(wanted.startsWith(BRANCH_PREFIX) ? wanted.slice(BRANCH_PREFIX.length) : wanted);
    const tries = wanted === undefined ? SUFFIX_MAX : 1;
    for (let n = 1; n <= tries; n += 1) {
      const suffix = n === 1 ? '' : `-${n}`;
      const branch = wanted ?? `${BRANCH_PREFIX}${slug}${suffix}`;
      const path = recordedPath ?? join(root, `${slug}${suffix}`);
      preparation?.assertActive();
      const branchExists = await this.#branchExists(threadId, project.path, branch, preparation?.timeoutMs);
      preparation?.assertActive();
      if (branchExists) {
        if (wanted !== undefined) throw refused(`branch ${branch} already exists in ${project.path}`, { branch, path: project.path });
        continue;
      }
      if (existsSync(path)) {
        if (wanted !== undefined) throw refused(`${path} already exists: pick another branch name`, { path, branch });
        continue;
      }
      base ??= await this.defaultBase(threadId, project.path);
      const parallel = await this.#checkoutWorkers(threadId, project.path, preparation?.timeoutMs);
      preparation?.assertActive();
      const placed = { branch, path, base, namingPending: wanted === undefined };
      const abandon = preparation?.beforeMutation(placed);
      await this.#exclude(threadId, project, path, preparation);
      // Exclusion lookup awaits git. A cancelled reservation must not start a late add.
      preparation?.assertActive();
      // A failed compare-and-swap grants no ownership of a competing ref.
      const created = await this.git(threadId, project.path,
        ['update-ref', '--create-reflog', '-m', draftBranchOwner(threadId), `refs/heads/${branch}`, base, ''], preparation?.timeoutMs);
      if (created.code !== 0) {
        // A stopped Git may have committed the ref before its exit was observed.
        preparation?.assertActive();
        abandon?.();
        throw refused(`cannot reserve branch ${branch}: ${created.stderr.trim()}`, { branch, path });
      }
      try {
        preparation?.assertActive();
        const staged = preparation !== undefined && !preparation.runCheckoutHook;
        const added = await this.#registeredGit(threadId, project.path,
          [...parallel, 'worktree', 'add', ...(staged ? ['--no-checkout'] : []), '--', path, branch], preparation?.timeoutMs, preparation?.assertActive);
        if (added.code !== 0) {
          throw refused(`git worktree add failed in ${project.path}: ${added.stderr.trim() || `exit ${added.code}`}`, {
            path: project.path, branch, worktree: path,
          });
        }
        if (staged) await this.#finishPreparation(threadId, path, preparation);
        return placed;
      } catch (error) {
        // A durable reservation, or the child's pending record, owns its own recovery.
        if (!preparation) await this.remove(threadId, project, placed).catch(cleanup => {
          this.#core.log('warn', `kept ${path} after worktree creation failed: ${messageOf(cleanup)}`, { threadId });
        });
        throw error;
      }
    }
    throw refused(`${SUFFIX_MAX} worktrees already carry the generated name ${slug}: try creating the thread again`, { slug, root });
  }

  /** Rename only the expected branch without an upstream or known remote ref. */
  async nameBranch(threadId: ThreadId, cwd: string, oldBranch: string, slug: string): Promise<string | null> {
    const head = await this.git(threadId, cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
    if (head.code !== 0 || head.stdout.trim() !== oldBranch) return null;
    const upstream = await this.git(threadId, cwd, ['for-each-ref', '--format=%(upstream)', `refs/heads/${oldBranch}`]);
    if (upstream.code !== 0 || upstream.stdout.trim()) return null;
    const published = await this.git(threadId, cwd, ['for-each-ref', '--format=%(refname)', `refs/remotes/*/${oldBranch}`]);
    if (published.code !== 0 || published.stdout.trim()) return null;
    for (let n = 1; n <= SUFFIX_MAX; n += 1) {
      const suffix = n === 1 ? '' : `-${n}`;
      const bounded = slug.slice(0, BRANCH_NAME_MAX - BRANCH_PREFIX.length - suffix.length).replace(/-+$/, '');
      const branch = `${BRANCH_PREFIX}${bounded}${suffix}`;
      if (await this.#branchExists(threadId, cwd, branch)) continue;
      const renamed = await this.#registeredGit(threadId, cwd, ['branch', '-m', oldBranch, branch]);
      if (renamed.code !== 0) throw refused(`cannot rename ${oldBranch} to ${branch}: ${renamed.stderr.trim()}`, { cwd, branch });
      return branch;
    }
    throw refused(`cannot name ${oldBranch}: ${SUFFIX_MAX} branches already carry the name ${slug}`, { cwd, slug });
  }

  /**
   * Undo an `add` whose thread was never written. Best effort on purpose: the
   * caller is already failing with the real reason, and a git that refuses to
   * clean up must not replace it. What it could not remove goes to the log with
   * the path, so the user can finish the job himself.
   */
  async remove(threadId: ThreadId, project: Project, placed: PlacedWorktree, timeoutMs?: number, retiringThreadId?: ThreadId): Promise<boolean> {
    const deadline = timeoutMs === undefined ? undefined : performance.now() + timeoutMs;
    const remaining = () => {
      if (deadline === undefined) return undefined;
      const left = deadline - performance.now();
      if (left <= 0) throw refused('git cleanup deadline elapsed', { path: placed.path });
      return left;
    };
    const ref = `refs/heads/${placed.branch}`;
    return withRegistration(project.path, async () => {
      const git = (args: string[], indexFile?: string) => this.git(threadId, project.path, args, remaining(), undefined, indexFile);
      await restoreInterruptedCheckout(this.#core, project, placed.path, placed.branch, git);
      const keep = (why: string) => {
        this.#core.log('warn', `kept ${placed.path} or its branch ${placed.branch}: ${why}`, { threadId });
        return false;
      };
      const owner = await git(['reflog', 'show', '-1', '--format=%H%x00%gs', ref]);
      if (owner.code !== 0 || !owner.stdout.trim()) {
        const branch = await git(['rev-parse', '--verify', '--quiet', ref]);
        if (branch.code === 1 && !existsSync(placed.path)) return true;
        return keep(`cannot verify the branch reservation: ${owner.stderr.trim() || 'no reflog entry'}`);
      }
      const [head, reason] = owner.stdout.trimEnd().split('\0');
      if (!head || reason !== draftBranchOwner(threadId) || (placed.base !== undefined && placed.base !== head)) {
        return keep('the branch has changed or belongs to another checkout');
      }
      const listed = await git(['worktree', 'list', '--porcelain', '-z']);
      if (listed.code !== 0) return keep(listed.stderr.trim());
      const holders = listed.stdout.split('\0\0').map(entry => entry.split('\0'))
        .filter(fields => fields.includes(`branch ${ref}`));
      if (holders.length > 0) {
        const fields = holders[0]!;
        const location = fields.find(field => field.startsWith('worktree '))?.slice(9);
        if (holders.length !== 1 || !location || !sameCheckout(location, placed.path) || !fields.includes(`HEAD ${head}`)) {
          return keep('the branch is registered at a different checkout or commit');
        }
        const removed = await withVacantCheckout(this.#core, project, placed.path, async () => {
          if (existsSync(location)) {
            const status = await this.#status(threadId, location, remaining(), project.path);
            if (status.stdout) return { code: 1, stderr: 'the checkout has uncommitted files, including ignored files' };
          }
          // Git's own in-progress creation lock is the only lock we can release.
          if (fields.includes('locked initializing')) {
            const unlocked = await git(['worktree', 'unlock', location]);
            if (unlocked.code !== 0) return unlocked;
          }
          return removeCleanCheckout(this.#core, location, git);
        }, [location], retiringThreadId);
        if (removed.code !== 0) return keep(removed.stderr.trim() || `git worktree remove exited ${removed.code}`);
      }
      const deleted = await git(['update-ref', '-d', ref, head]);
      return deleted.code === 0 || keep(deleted.stderr.trim() || `git update-ref exited ${deleted.code}`);
    }, { timeoutMs });
  }

  /** Git's registered checkout must own the reserved branch before its folder is removed. */
  async #checkoutBranch(threadId: ThreadId, cwd: string, path: string, timeoutMs?: number): Promise<string | null> {
    const listed = await this.#registeredGit(threadId, cwd, ['worktree', 'list', '--porcelain', '-z'], timeoutMs);
    if (listed.code !== 0) throw refused(`cannot inspect worktrees in ${cwd}: ${listed.stderr.trim()}`);
    const expected = existsSync(path) ? statSync(path, { bigint: true }) : null;
    for (const entry of listed.stdout.split('\0\0')) {
      const fields = entry.split('\0');
      const location = fields.find(field => field.startsWith('worktree '))?.slice(9);
      if (!location) continue;
      const registered = expected && existsSync(location) ? statSync(location, { bigint: true }) : null;
      if (resolve(location) === resolve(path) || (expected && registered && expected.ino !== 0n &&
        registered.dev === expected.dev && registered.ino === expected.ino)) {
        return fields.find(field => field.startsWith('branch refs/heads/'))?.slice('branch refs/heads/'.length) ?? null;
      }
    }
    return null;
  }

  /** The commit checked out in `cwd`, refused by name when it is not a git checkout or has no commit yet. */
  async head(threadId: ThreadId, cwd: string): Promise<string> {
    const result = await this.git(threadId, cwd, ['rev-parse', '--verify', 'HEAD^{commit}']);
    if (result.code !== 0) throw refused(`cannot read the commit checked out in ${cwd}: ${result.stderr.trim() || `exit ${result.code}`}`, { cwd });
    return result.stdout.trim();
  }

  /** Refresh the remote's advertised default; offline, use the corresponding local branch. */
  async defaultBase(threadId: ThreadId, cwd: string): Promise<string> {
    const remotes = (await this.git(threadId, cwd, ['remote'])).stdout.trim().split(/\s+/).filter(Boolean);
    let branch: string | undefined;
    let remotePrefix: string | undefined;
    if (remotes.length > 0) {
      const preferred = (await this.git(threadId, cwd, ['config', '--get', 'checkout.defaultRemote'])).stdout.trim();
      const remote = remotes.includes(preferred) ? preferred : remotes.includes('origin') ? 'origin' : remotes[0]!;
      const prefix = `refs/remotes/${remote}/`;
      remotePrefix = prefix;
      const known = (await this.git(threadId, cwd, ['symbolic-ref', '-q', `${prefix}HEAD`])).stdout.trim();
      if (known.startsWith(prefix)) branch = known.slice(prefix.length);
      // A timeout may stop its own Git and transport without stopping the moving thread.
      const scope = `worktree-base:${threadId}:${newId('')}`;
      const remoteGit = (args: string[]) => this.git(scope, cwd, args, REMOTE_BASE_TIMEOUT_MS, undefined, undefined, { GIT_TERMINAL_PROMPT: '0' });
      try {
        const advertised = await remoteGit(['ls-remote', '--symref', '--exit-code', '--', remote, 'HEAD']);
        if (advertised.code === 0) {
          const named = /^ref: refs\/heads\/(.+)\tHEAD$/m.exec(advertised.stdout)?.[1];
          if (named) branch = named;
          const head = /^([\da-f]{40}|[\da-f]{64})\tHEAD$/m.exec(advertised.stdout)?.[1];
          if (head) {
            const present = await this.git(threadId, cwd, ['cat-file', '-t', head]);
            if (present.code === 0 && present.stdout.trim() === 'commit') return head;
            const fetched = await remoteGit(['fetch', '--no-write-fetch-head', '--no-tags', '--no-recurse-submodules', '--', remote, head]);
            if (fetched.code === 0) return head;
          }
        }
      } catch (error) {
        this.#core.log('info', `could not refresh the default branch in ${cwd}: ${messageOf(error)}`, { threadId });
      }
    }
    const configured = (await this.git(threadId, cwd, ['config', '--get', 'init.defaultBranch'])).stdout.trim();
    const locals = await this.git(threadId, cwd, ['for-each-ref', '--format=%(refname:strip=2)%09%(objectname)', 'refs/heads']);
    const commits = new Map(locals.stdout.trim().split('\n').filter(Boolean).map(row => row.split('\t') as [string, string]));
    if (branch && remotePrefix) {
      const local = commits.get(branch);
      if (local) return local;
      const cached = await this.git(threadId, cwd, ['rev-parse', '--verify', '--quiet', `${remotePrefix}${branch}^{commit}`]);
      if (cached.code === 0) return cached.stdout.trim();
    }
    for (const name of [configured, 'main', 'master']) {
      const commit = commits.get(name);
      if (commit) return commit;
    }
    const localBranches = [...commits].filter(([name]) => !name.startsWith(BRANCH_PREFIX));
    if (localBranches.length === 1) return localBranches[0]![1];
    throw refused(`cannot identify a default branch in ${cwd}: configure a Git remote with a default branch or set init.defaultBranch to an existing local branch`, { cwd });
  }

  /** Commits on HEAD beyond `base`, and whether the checkout has uncommitted or untracked changes. */
  async changes(threadId: ThreadId, cwd: string, base: string): Promise<{ commits: number; dirty: boolean }> {
    const status = await this.#status(threadId, cwd);
    const count = await this.git(threadId, cwd, ['rev-list', '--count', `${base}..HEAD`]);
    if (count.code !== 0) throw refused(`cannot count the commits of ${cwd} beyond ${base}: ${count.stderr.trim() || `exit ${count.code}`}`, { cwd, base });
    return { commits: Number(count.stdout.trim()) || 0, dirty: status.stdout.trim().length > 0 };
  }

  async #status(threadId: ThreadId, cwd: string, timeoutMs?: number, from = cwd): Promise<{ stdout: string }> {
    // Git's unforced removal checks tracked changes and ordinary untracked files,
    // but considers ignored files disposable. Automatic cleanup keeps them too.
    const status = await this.git(threadId, from, [...(from === cwd ? [] : ['-C', cwd]), 'status', '--porcelain', '--untracked-files=normal', '--ignored=matching'], timeoutMs);
    if (status.code !== 0) throw refused(`cannot read the status of ${cwd}: ${status.stderr.trim() || `exit ${status.code}`}`, { cwd });
    return status;
  }

  async #branchExists(threadId: ThreadId, cwd: string, branch: string, timeoutMs?: number): Promise<boolean> {
    const result = await this.git(threadId, cwd, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], timeoutMs);
    // 1 is git's "no such ref"; anything else is a git that could not look, and a name it never checked is not free.
    if (result.code === 0 || result.code === 1) return result.code === 0;
    throw refused(`cannot tell whether branch ${branch} exists in ${cwd}: ${result.stderr.trim().split('\n')[0] || `exit ${result.code}`}`, { cwd, branch });
  }

  /**
   * A checkout made before the marker existed is marked when it is used again.
   * Only a checkout in the project's own `.boite` folder: a shared worktree
   * folder, possibly in the user's Boite data, is left alone. A failure is
   * logged, since the checkout itself still works.
   */
  markReused(project: Project, path: string): void {
    if (!inProjectFolder(project.path, path)) return;
    try { ensureProjectFolder(project.path); } catch (error) {
      this.#core.log('warn', `cannot create ${join(project.path, PROJECT_FOLDER, '.gitignore')}: ${messageOf(error)}`);
    }
  }

  /** Local exclusions keep nested checkouts out of status without editing .gitignore. */
  async #exclude(threadId: ThreadId, project: Project, path: string, preparation?: WorktreePreparation): Promise<void> {
    const local = relative(project.path, dirname(path));
    if (!local || isAbsolute(local) || local === '..' || local.startsWith(`..${sep}`)) return;
    const folder = local.split(sep).join('/');
    const boite = inProjectFolder(project.path, dirname(path));
    if (boite) {
      try { ensureProjectFolder(project.path); } catch (error) { throw refused(`cannot create ${join(project.path, PROJECT_FOLDER, '.gitignore')}: ${messageOf(error)}`); }
    }
    const pattern = boite ? `/${PROJECT_FOLDER}/` : `/${folder.replace(/[\\[\]*?!# ]/g, '\\$&')}/`;
    preparation?.assertActive();
    const result = await this.git(threadId, project.path, ['rev-parse', '--git-path', 'info/exclude'], preparation?.timeoutMs);
    preparation?.assertActive();
    if (result.code !== 0) throw refused(`cannot locate the git exclude file in ${project.path}: ${result.stderr.trim()}`);
    const file = resolve(project.path, result.stdout.trim());
    try {
      const previous = existsSync(file) ? readFileSync(file, 'utf8') : '';
      if (previous.split(/\r?\n/).includes(pattern)) return;
      mkdirSync(dirname(file), { recursive: true });
      appendFileSync(file, `${previous && !previous.endsWith('\n') ? '\n' : ''}${pattern}\n`);
    } catch (error) { throw refused(`cannot exclude worktrees in ${file}: ${messageOf(error)}`); }
  }

  #registeredGit(threadId: ThreadId, cwd: string, args: string[], timeoutMs?: number, assertActive?: () => void): Promise<{ code: number; stderr: string; stdout: string }> {
    return withRegistration(cwd, (remaining) => this.git(threadId, cwd, args, remaining), { timeoutMs, assertActive, what: () => `git ${args.join(' ')}` });
  }

  private async git(threadId: ThreadId, cwd: string, args: string[], timeoutMs?: number, input?: string, indexFile?: string, env?: NodeJS.ProcessEnv): Promise<{ code: number; stderr: string; stdout: string }> {
    if (this.#core.sharedCompute?.journal.worker(threadId)) args = [...await sharedGitConfig(this.#core, threadId, cwd), ...args];
    this.#core.sharedCompute?.assertGit(threadId);
    let spawned;
    const options = { cwd, env: indexFile === undefined ? env : { ...env, GIT_INDEX_FILE: indexFile } };
    try {
      const scope = this.#core.procs.protection.policy(threadId) ? this.#core.procs.protection.control(threadId) : threadId;
      if (input === undefined) spawned = this.#core.procs.spawn(scope, 'git', args, options);
      else {
        const piped = this.#core.procs.spawnPiped(scope, 'git', args, options);
        piped.proc.stdin.write(input);
        piped.proc.stdin.end();
        spawned = piped;
      }
    } catch (error) {
      throw refused(`git did not start (${messageOf(error)}): a worktree needs git on PATH`, { cwd, args });
    }
    const at = performance.now();
    const work = Promise.all([new Response(spawned.proc.stderr).text(), new Response(spawned.proc.stdout).text(), spawned.exited]);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let expired: ReturnType<typeof refused> | undefined;
    const late = timeoutMs === undefined ? null : new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        // Name the command, not "cleanup": draft creation runs under this bound too, and a CI
        // run (2026-10-18) lost 10 s to a git its log showed only as [Array ...].
        expired = refused(`git ${args.join(' ')} did not finish within ${timeoutMs} ms`, { cwd, args });
        // The registry owns POSIX groups and Windows jobs. Drain git's inherited
        // pipes before cleanup so its checkout/filter descendants stop writing.
        this.#core.procs.killTree(threadId);
        timer = setTimeout(() => reject(expired), 3000);
        void work.then(() => reject(expired), () => reject(expired));
      }, timeoutMs);
    });
    try {
      const [stderr, stdout, code] = await (late === null ? work : Promise.race([work, late]));
      if (expired) throw expired;
      try { logGit(this.#core, threadId, args, code, performance.now() - at, stderr); } catch { /* A diagnostic storage failure must not break worktrees. */ }
      return { code, stderr, stdout };
    } finally { clearTimeout(timer); }
  }
}
