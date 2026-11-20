import { createHash } from 'node:crypto';
import { constants, existsSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, renameSync, unlinkSync, type BigIntStats } from 'node:fs';
import { open, readdir, readlink, rename, rm, rmdir, unlink, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import type { WorktreeRecovery } from '@boite/contracts';
import type { Core } from './core.ts';
import { keyOf } from './checkouts.ts';
import { excludeRecoveryWriters, restoreRecoveryName } from './platform/recovery-file.ts';

export interface CheckoutGitResult { code: number; stdout: string; stderr: string }
export type CheckoutGit = (args: string[], indexFile?: string) => Promise<CheckoutGitResult>;

const INVENTORY = 'checkout-recoveries';
const CAPTURE_PREFIX = '.boite-compacting-';

export function listCheckoutRecoveries(core: Core): WorktreeRecovery[] {
  const entries = (core.journal.getSetting(INVENTORY) as WorktreeRecovery[] | undefined) ?? [];
  const present = entries.filter(({ recoveryPath }) => {
    try { lstatSync(recoveryPath); return true; }
    catch (error) {
      // A path that cannot be inspected may still hold a recovery.
      const code = (error as NodeJS.ErrnoException).code;
      return code !== 'ENOENT' && code !== 'ENOTDIR';
    }
  });
  if (present.length !== entries.length) core.journal.setSetting(INVENTORY, present);
  return present;
}

function indexRecovery(core: Core, recovery: WorktreeRecovery): void {
  const entries = listCheckoutRecoveries(core);
  if (!entries.some(entry => entry.recoveryPath === recovery.recoveryPath)) {
    core.journal.setSetting(INVENTORY, [...entries, recovery]);
    core.log('warn', `kept files from ${recovery.path} for recovery at ${recovery.recoveryPath}; remove this copy manually after checking it`, {
      source: 'worktrees', event: 'worktree.recovery-saved', data: { ...recovery },
    });
  }
}

interface Blob { mode: string; oid: string }

async function committedBlobs(git: CheckoutGit, commit: string): Promise<Map<string, Blob>> {
  const blobs = new Map<string, Blob>();
  const tree = await git(['--no-replace-objects', 'ls-tree', '-r', '-z', '--full-tree', commit]).catch(() => null);
  if (tree === null || tree.code !== 0 || tree.stderr) return blobs;
  for (const row of tree.stdout.split('\0')) {
    const match = /^(100644|100755|120000) blob ([a-f0-9]{40}|[a-f0-9]{64})\t([\s\S]+)$/.exec(row);
    // The process wrapper decodes Git output as UTF-8. An undecodable name
    // could be confused with a different path when passed back to Git.
    if (match && !match[3]!.includes('\ufffd')) blobs.set(match[3]!, { mode: match[1]!, oid: match[2]! });
  }
  return blobs;
}

function blobHash(blob: Blob, size: number | bigint) {
  return createHash(blob.oid.length === 40 ? 'sha1' : 'sha256').update(`blob ${size}\0`);
}

function sameIdentity(before: BigIntStats, after: BigIntStats): boolean {
  return before.ino !== 0n && before.ino === after.ino && before.dev === after.dev;
}

function stillSame(path: string, before: BigIntStats): boolean {
  const after = lstatSync(path, { bigint: true, throwIfNoEntry: false });
  return after !== undefined && sameIdentity(before, after)
    && before.mode === after.mode && before.size === after.size && before.ctimeNs === after.ctimeNs && before.mtimeNs === after.mtimeNs;
}

type GitComparison = (file: FileHandle, name: string) => Promise<boolean>;

async function discardIdentical(path: string, blob: Blob, name: string, comparison: GitComparison | null): Promise<boolean> {
  const parent = dirname(path);
  const entry = lstatSync(path, { bigint: true });
  if (entry.isSymbolicLink() && blob.mode === '120000') {
    const target = await readlink(path, { encoding: 'buffer' });
    // A symlink's contents are immutable. Replacement at the public name
    // cannot change this captured entry.
    if (blobHash(blob, target.length).update(target).digest('hex') !== blob.oid || !canUnlink(path, parent, entry)) return false;
    unlinkSync(path);
    return true;
  }
  if (comparison === null || !entry.isFile() || blob.mode === '120000') return false;
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const guard = excludeRecoveryWriters(path, file.fd);
    if (guard === null) return false;
    try {
      const before = await file.stat({ bigint: true });
      if (!before.isFile() || !canUnlink(path, parent, before) || !guard.held()) return false;
      if (process.platform !== 'win32' && ((before.mode & 0o100n) !== 0n) !== (blob.mode === '100755')) return false;
      if (!await comparison(file, name) || !canUnlink(path, parent, before) || !guard.held()) return false;
      unlinkSync(path);
      return true;
    } finally { guard.release(); }
  } finally { await file.close(); }
}

function canUnlink(path: string, parent: string, entry: BigIntStats): boolean {
  return keyOf(realpathSync.native(dirname(path))) === keyOf(parent) && stillSame(path, entry);
}

function isPhysicalPath(path: string): boolean {
  try { return keyOf(realpathSync.native(path)) === keyOf(path); }
  catch { return false; }
}

async function compactEntry(root: string, path: string, blob: Blob, name: string, comparison: GitComparison | null): Promise<void> {
  if (!isPhysicalPath(dirname(path))) return;
  const capture = mkdtempSync(join(root, CAPTURE_PREFIX));
  const captured = join(capture, name);
  try {
    if (dirname(captured) !== capture) mkdirSync(dirname(captured), { recursive: true });
    if (!isPhysicalPath(dirname(path)) || !isPhysicalPath(dirname(captured))) return;
    const parent = lstatSync(dirname(path), { bigint: true });
    renameSync(path, captured);
    const sameParent = () => isPhysicalPath(dirname(path)) && sameIdentity(parent, lstatSync(dirname(path), { bigint: true }));
    if (!sameParent()) return;
    const discarded = await discardIdentical(captured, blob, name, comparison).catch(() => false);
    if (discarded || !sameParent() || !isPhysicalPath(dirname(captured))) return;
    restoreRecoveryName(captured, path);
  } finally {
    for (let dir = dirname(captured); isPhysicalPath(dir); dir = dirname(dir)) {
      if (!await rmdir(dir).then(() => true, () => false) || dir === capture) break;
    }
  }
}

async function compact(root: string, dir: string, blobs: Map<string, Blob>, comparison: GitComparison | null): Promise<void> {
  if (!isPhysicalPath(dir)) return;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(CAPTURE_PREFIX)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await compact(root, path, blobs, comparison);
    else {
      const name = relative(root, path).split(sep).join('/');
      const blob = blobs.get(name);
      if (blob !== undefined && (comparison !== null || blob.mode === '120000')) {
        await compactEntry(root, path, blob, name, comparison).catch(() => undefined);
      }
    }
  }
  if (isPhysicalPath(dir)) await rmdir(dir).catch(() => undefined);
}

async function sameFileBytes(file: FileHandle, restored: string): Promise<boolean> {
  const expected = await open(restored, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const info = await expected.stat({ bigint: true });
    if (!info.isFile() || info.size !== (await file.stat({ bigint: true })).size) return false;
    const actualBytes = Buffer.allocUnsafe(64 * 1024);
    const expectedBytes = Buffer.allocUnsafe(actualBytes.length);
    for (;;) {
      const actual = await file.read(actualBytes, 0, actualBytes.length, null);
      const want = await expected.read(expectedBytes, 0, expectedBytes.length, null);
      if (actual.bytesRead !== want.bytesRead) return false;
      if (actual.bytesRead === 0) return true;
      if (!actualBytes.subarray(0, actual.bytesRead).equals(expectedBytes.subarray(0, want.bytesRead))) return false;
    }
  } finally { await expected.close(); }
}

/** Materialize Git's checkout bytes with the retired commit's attributes in an empty worktree. */
async function gitComparison(git: CheckoutGit, commit: string, temporary: string): Promise<GitComparison | null> {
  // The removed worktree's private configuration is no longer available.
  const worktreeConfig = await git(['config', '--type=bool', '--get', 'extensions.worktreeConfig']);
  if (worktreeConfig.stderr || !(worktreeConfig.code === 1 || worktreeConfig.code === 0 && worktreeConfig.stdout.trim() === 'false')) return null;
  const admin = await git(['rev-parse', '--absolute-git-dir']);
  const dir = admin.stdout.trim();
  if (admin.code !== 0 || admin.stderr || !isAbsolute(dir)) return null;
  const index = join(temporary, 'index');
  const checkout = join(temporary, 'checkout');
  mkdirSync(checkout);
  const options = ['--no-replace-objects', '--literal-pathspecs', `--git-dir=${dir}`,
    '-C', checkout, `--work-tree=${checkout}`,
    '-c', 'core.fsmonitor=false', '-c', 'core.sparseCheckout=false', '-c', 'core.splitIndex=false'];
  const loaded = await git([...options, 'read-tree', commit], index);
  if (loaded.code !== 0 || loaded.stderr) return null;
  return async (file, name) => {
    const result = await git([...options, 'checkout-index', '--temp', '-z', '--', name], index);
    if (result.code !== 0 || result.stderr) return false;
    const tab = result.stdout.indexOf('\t');
    if (tab === -1) return false;
    const filename = result.stdout.slice(0, tab);
    if (!/^\.merge_file_[a-zA-Z0-9]+$/.test(filename) || result.stdout.slice(tab + 1) !== `${name}\0`) return false;
    const restored = join(checkout, filename);
    try { return await sameFileBytes(file, restored); }
    finally { await unlink(restored).catch(() => undefined); }
  };
}

async function compactRecovery(saved: string, git: CheckoutGit, commit: string | null): Promise<void> {
  if (commit === null) return;
  const root = join(realpathSync.native(dirname(saved)), 'saved');
  const blobs = await committedBlobs(git, commit);
  if (blobs.size === 0) return;
  const temporary = mkdtempSync(join(tmpdir(), 'boite-recovery-git-'));
  try {
    const comparison = await gitComparison(git, commit, temporary).catch(() => null);
    await compact(root, root, blobs, comparison);
  } finally {
    await rm(temporary, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Publish only after Git has dropped its registration and the pointer is gone. */
export async function finishCheckoutRecovery(core: Core, recovery: WorktreeRecovery, git?: CheckoutGit): Promise<void> {
  const saved = recovery.recoveryPath;
  const temporary = dirname(saved);
  const manifest = join(temporary, 'recovery.json');
  const writing = `${manifest}.tmp`;
  if (existsSync(saved) && !existsSync(manifest)) {
    if (git !== undefined) await compactRecovery(saved, git, recovery.commit).catch(() => undefined);
    if (existsSync(saved)) {
      if (existsSync(writing)) await unlink(writing);
      const file = await open(writing, 'wx');
      try {
        await file.writeFile(`${JSON.stringify({ version: 1, ...recovery }, null, 2)}\n`);
        await file.sync();
      } finally { await file.close(); }
      await rename(writing, manifest);
    }
  }
  if (existsSync(saved)) indexRecovery(core, recovery);
  else if (git !== undefined) {
    for (const file of [manifest, writing]) if (existsSync(file)) await unlink(file);
    if (existsSync(temporary)) await rmdir(temporary);
  }
}
