import { createHash } from 'node:crypto';
import { constants, existsSync, lstatSync, realpathSync, unlinkSync, type BigIntStats } from 'node:fs';
import { open, readdir, readlink, rename, rmdir, unlink } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import type { WorktreeRecovery } from '@boite/contracts';
import type { Core } from './core.ts';
import { keyOf } from './checkouts.ts';
import { excludeRecoveryWriters } from './platform/recovery-file.ts';

export interface CheckoutGitResult { code: number; stdout: string; stderr: string }
export type CheckoutGit = (args: string[]) => Promise<CheckoutGitResult>;

const INVENTORY = 'checkout-recoveries';

export function listCheckoutRecoveries(core: Core): WorktreeRecovery[] {
  return (core.journal.getSetting(INVENTORY) as WorktreeRecovery[] | undefined) ?? [];
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

async function committedBlobs(git: CheckoutGit, commit: string | null): Promise<Map<string, Blob>> {
  const blobs = new Map<string, Blob>();
  if (commit === null) return blobs;
  const tree = await git(['--no-replace-objects', 'ls-tree', '-r', '-z', '--full-tree', commit]).catch(() => null);
  if (tree === null || tree.code !== 0 || tree.stderr) return blobs;
  for (const row of tree.stdout.split('\0')) {
    const match = /^(100644|100755|120000) blob ([a-f0-9]{40}|[a-f0-9]{64})\t([\s\S]+)$/.exec(row);
    if (match) blobs.set(match[3]!, { mode: match[1]!, oid: match[2]! });
  }
  return blobs;
}

function blobHash(blob: Blob, size: number | bigint) {
  return createHash(blob.oid.length === 40 ? 'sha1' : 'sha256').update(`blob ${size}\0`);
}

function stillSame(path: string, before: BigIntStats): boolean {
  const after = lstatSync(path, { bigint: true, throwIfNoEntry: false });
  return after !== undefined && before.ino !== 0n && before.ino === after.ino && before.dev === after.dev
    && before.mode === after.mode && before.size === after.size && before.ctimeNs === after.ctimeNs && before.mtimeNs === after.mtimeNs;
}

async function discardIdentical(path: string, parent: string, blob: Blob, buffer: Uint8Array): Promise<void> {
  const entry = lstatSync(path, { bigint: true });
  if (entry.isSymbolicLink() && blob.mode === '120000') {
    const target = await readlink(path, { encoding: 'buffer' });
    if (blobHash(blob, target.length).update(target).digest('hex') === blob.oid && canUnlink(path, parent, entry)) unlinkSync(path);
    return;
  }
  if (!entry.isFile() || blob.mode === '120000') return;
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const guard = excludeRecoveryWriters(path, file.fd);
    if (guard === null) return;
    try {
      const before = await file.stat({ bigint: true });
      if (!before.isFile() || !stillSame(path, before)) return;
      if (process.platform !== 'win32' && ((before.mode & 0o100n) !== 0n) !== (blob.mode === '100755')) return;
      const hash = blobHash(blob, before.size);
      let remaining = before.size;
      while (remaining > 0n) {
        if (!guard.held()) return;
        const length = remaining < BigInt(buffer.length) ? Number(remaining) : buffer.length;
        const { bytesRead } = await file.read(buffer, 0, length, null);
        if (bytesRead === 0) return;
        hash.update(buffer.subarray(0, bytesRead));
        remaining -= BigInt(bytesRead);
      }
      if (hash.digest('hex') === blob.oid && canUnlink(path, parent, before) && guard.held()) unlinkSync(path);
    } finally { guard.release(); }
  } finally { await file.close(); }
}

function canUnlink(path: string, parent: string, entry: BigIntStats): boolean {
  return keyOf(realpathSync.native(dirname(path))) === keyOf(parent) && stillSame(path, entry);
}

async function compact(root: string, dir: string, physicalDir: string, blobs: Map<string, Blob>, buffer: Uint8Array): Promise<void> {
  if (keyOf(realpathSync.native(dir)) !== keyOf(physicalDir)) return;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await compact(root, path, join(physicalDir, entry.name), blobs, buffer);
    else {
      const blob = blobs.get(relative(root, path).split(sep).join('/'));
      if (blob !== undefined) {
        // A read or unlink failure leaves the file in the recovery.
        await discardIdentical(path, physicalDir, blob, buffer).catch(() => undefined);
      }
    }
  }
  if (keyOf(realpathSync.native(dir)) !== keyOf(physicalDir)) return;
  await rmdir(dir).catch(error => {
    if (error.code !== 'ENOTEMPTY' && error.code !== 'EEXIST') throw error;
  });
}

/** Publish only after Git has dropped its registration and the pointer is gone. */
export async function finishCheckoutRecovery(core: Core, recovery: WorktreeRecovery, git: CheckoutGit): Promise<void> {
  const saved = recovery.recoveryPath;
  const temporary = dirname(saved);
  const manifest = join(temporary, 'recovery.json');
  const writing = `${manifest}.tmp`;
  if (existsSync(saved) && !existsSync(manifest)) {
    await compact(saved, saved, join(realpathSync.native(temporary), 'saved'), await committedBlobs(git, recovery.commit), new Uint8Array(128 * 1024));
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
  else {
    for (const file of [manifest, writing]) if (existsSync(file)) await unlink(file);
    if (existsSync(temporary)) await rmdir(temporary);
  }
}
