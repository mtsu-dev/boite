import { createHash, randomUUID } from 'node:crypto';
import { constants, lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync, type BigIntStats } from 'node:fs';
import { chmod, copyFile, link, lstat, mkdir, open, readdir, readFile, readlink, realpath, rename, rm, rmdir, symlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import type { Core } from '../core.ts';
import { DISK_VIEW, type FileView } from '../file-view.ts';
import type { SharedFilePermit } from '../contacts/access-policy.ts';
import { refused, RpcFailure } from '../errors.ts';
import { git } from '../git/read.ts';
import { BLOB_BYTE_LIMIT, decodeBlob, encodeBlob, errno, NO_LINK, readBlob, readBlobSync, sharedBlob } from './checkpoint-store.ts';

export { sharedBlob };

const FILE_LIMIT = 20_000;
const BYTE_LIMIT = 128 * 1024 * 1024;
const FILE_BYTE_LIMIT = BLOB_BYTE_LIMIT;
const METADATA_BATCH = 16;
const SKIP = new Set(['.git', '.boite', '.agents', 'node_modules']);

/**
 * `unbacked`: a file over the per-file limit, known by its metadata only. It
 * blocks a rewind only when the removed turns changed it.
 */
export interface FileEntry { hash: string; mode: number; link?: string; unbacked?: true }
export type FileSnapshot = Record<string, FileEntry>;
/** `objects`: the folder that already holds this entry's blob, when known. */
interface CachedFile { entry: FileEntry; metadata: string; size: number; objects?: string }
export type SnapshotCache = Map<string, CachedFile>;

function metadataOf(info: BigIntStats): string {
  return [info.dev, info.ino, info.size, info.mode, info.mtimeNs, info.ctimeNs].join(':');
}

export function contains(root: string, path: string): boolean {
  const child = relative(resolve(root), resolve(path));
  return child === '' || (!isAbsolute(child) && child !== '..' && !child.startsWith(`..${sep}`));
}

/**
 * Whether turns in these two folders can change the same snapshot file. A
 * folder inside another shares its files when the outer snapshot would list
 * one of them: git decides what it lists (a repository or worktree of its own
 * shows as one directory entry, files the outer index tracks still count), and
 * a plain walk lists all but the skipped folders.
 */
export async function overlap(core: Core, threadId: string, a: string, b: string): Promise<boolean> {
  if (contains(a, b)) return listsAny(core, threadId, resolve(a), resolve(b));
  if (contains(b, a)) return listsAny(core, threadId, resolve(b), resolve(a));
  return false;
}

async function listsAny(core: Core, threadId: string, root: string, path: string): Promise<boolean> {
  const inner = relative(root, path);
  if (!inner) return true;
  const scope = core.procs.protection.policy(threadId) ? core.procs.protection.control(threadId) : threadId;
  const listed = await git(core, scope, root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', inner.split(sep).join('/')], 5000);
  // Same fallback as `snapshot`: without git, every folder but the skipped ones is walked.
  if (listed.code !== 0) return !inner.split(sep).some(part => SKIP.has(part));
  return listed.stdout.split('\0').some(name => name && !name.endsWith('/'));
}

export function same(a: FileEntry | undefined, b: FileEntry | undefined): boolean {
  return a?.hash === b?.hash && a?.mode === b?.mode && a?.link === b?.link && a?.unbacked === b?.unbacked;
}

/**
 * Resolve parents without following a symlink out of the checkpoint's workspace.
 * `verified` holds parents already checked during one snapshot; restores pass
 * none, so each write checks its parents just before it happens.
 */
async function checkedPath(root: string, name: string, verified?: Set<string>): Promise<string> {
  if (!name || isAbsolute(name) || name.split(/[\\/]/).includes('..') || !contains(root, join(root, name))) {
    throw refused(`file checkpoint path ${name}: expected a relative path inside ${root}`, { field: 'path', path: name });
  }
  let parent = dirname(join(root, name));
  while (parent !== root) {
    if (verified?.has(parent)) break;
    try {
      if ((await lstat(parent)).isSymbolicLink()) throw refused(`file checkpoint path ${name}: parent ${parent} is a symlink`, { field: 'path', path: name });
      verified?.add(parent);
    } catch (error) { if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error; }
    parent = dirname(parent);
  }
  return join(root, name);
}

/** One file at a time, bounded before allocation. Never follows a file symlink. */
async function readEntry(path: string, cached?: CachedFile, permit?: SharedFilePermit): Promise<(CachedFile & { bytes?: Buffer }) | null> {
  return readEntryAt(path, await fileMetadata(path), cached, permit);
}

async function fileMetadata(path: string): Promise<BigIntStats | null> {
  try { return await lstat(path, { bigint: true }); } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return null;
    throw error;
  }
}

async function readEntryAt(path: string, info: BigIntStats | null, cached?: CachedFile, permit?: SharedFilePermit): Promise<(CachedFile & { bytes?: Buffer }) | null> {
  if (!info || info.isDirectory()) return null;
  const metadata = metadataOf(info);
  if (cached?.metadata === metadata) return cached;
  if (info.isSymbolicLink()) {
    const link = await readlink(path);
    if (metadataOf(await lstat(path, { bigint: true })) !== metadata) throw new Error(`${path}: link changed while saving the checkpoint`);
    return { entry: { hash: createHash('sha256').update(link).digest('hex'), mode: Number(info.mode) & 0o777, link }, metadata, size: Buffer.byteLength(link) };
  }
  if (!info.isFile()) throw new Error(`${path}: expected a regular file or symlink`);
  if (info.size > BigInt(FILE_BYTE_LIMIT)) {
    // Nothing is read or stored: the hash stands for this exact metadata, so any write shows as a change.
    return { entry: { hash: createHash('sha256').update(`unbacked:${metadata}`).digest('hex'), mode: Number(info.mode) & 0o777, unbacked: true }, metadata, size: 0 };
  }
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    permit?.opened?.(await realpath(path), await handle.stat({ bigint: true }));
    const bytes = Buffer.alloc(Number(info.size) + 1);
    let size = 0;
    while (size < bytes.length) {
      const read = await handle.read(bytes, size, bytes.length - size, null);
      if (read.bytesRead === 0) break;
      size += read.bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    if (size !== Number(info.size) || metadataOf(after) !== metadata) throw new Error(`${path}: file changed while saving the checkpoint`);
    const content = bytes.subarray(0, size);
    permit?.inspect(content);
    return { entry: { hash: createHash('sha256').update(content).digest('hex'), mode: Number(info.mode) & 0o777 }, bytes: content, metadata, size };
  } finally { await handle.close(); }
}

/** Validate parents in order, then recheck metadata in small parallel batches. */
async function* scanPaths(root: string, names: string[], protectedScope: boolean, signal?: AbortSignal) {
  const verified = new Set<string>();
  const batchSize = protectedScope ? 1 : METADATA_BATCH;
  for (let offset = 0; offset < names.length; offset += batchSize) {
    signal?.throwIfAborted();
    const batch = [];
    for (const name of names.slice(offset, offset + batchSize)) {
      batch.push({ name, path: await checkedPath(root, name, verified) });
    }
    // The shared-file policy must authorize each path before it is statted.
    const infos = protectedScope ? undefined : await Promise.all(batch.map(({ path }) => fileMetadata(path)));
    for (const [index, entry] of batch.entries()) yield { ...entry, info: infos?.[index] };
  }
}

/** Without git there are no reliable ignore rules; walk only bounded, ordinary project files. */
async function plainFiles(root: string, signal?: AbortSignal): Promise<string[]> {
  const files: string[] = [];
  const pending = [''];
  let entries = 0;
  while (pending.length) {
    signal?.throwIfAborted();
    const parent = pending.pop()!;
    for (const entry of await readdir(join(root, parent), { withFileTypes: true })) {
      if (SKIP.has(entry.name) || entry.name === 'AGENTS.md' || entry.name.startsWith('.env')) continue;
      if (++entries > FILE_LIMIT) throw new Error('workspace exceeds the 20000 file checkpoint limit');
      const name = parent ? `${parent}/${entry.name}` : entry.name;
      if (entry.isDirectory()) pending.push(name);
      else if (entry.isFile() || entry.isSymbolicLink()) files.push(name);
    }
  }
  return files;
}

/**
 * `shared` is the store every thread's blobs come from. A thread's `objects`
 * folder then holds hard links to it, so each folder stays enough for a
 * rewind on its own. Without `shared`, blobs are written into `objects`.
 */
export async function snapshot(core: Core, threadId: string, root: string, objects: string, previous?: SnapshotCache, shared?: string, signal?: AbortSignal): Promise<FileSnapshot> {
  signal?.throwIfAborted();
  if (contains(root, core.dataDir)) throw new Error('workspace contains the core data directory');
  // Fixed host bookkeeping belongs to provider control, never the model's tool sandbox.
  const scope = core.procs.protection.policy(threadId) ? core.procs.protection.control(threadId) : threadId;
  const listed = await git(core, scope, root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], 5000);
  signal?.throwIfAborted();
  const names = listed.code === 0 ? [...new Set(listed.stdout.split('\0').filter(Boolean))] : await plainFiles(root, signal);
  if (names.length > FILE_LIMIT) throw new Error('workspace exceeds the 20000 file checkpoint limit');
  await mkdir(objects, { recursive: true, mode: 0o700 });
  const result: FileSnapshot = Object.create(null) as FileSnapshot;
  const next: SnapshotCache = new Map();
  const folders = new Set<string>();
  let bytes = 0;
  const protectedScope = core.sharedAccess.bound(threadId) !== null;
  for await (const { name, path, info } of scanPaths(root, names, protectedScope, signal)) {
    signal?.throwIfAborted();
    const cached = previous?.get(name);
    // Without a shared store, a hash cached for another folder has no blob here.
    let saved;
    try {
      const permit = protectedScope ? core.sharedAccess.file(threadId, relative(core.threads.require(threadId).cwd, path).split(sep).join('/'), 'read', false, true) : undefined;
      // A local cache may contain a credential under an ordinary name. Shared snapshots inspect the actual bytes.
      saved = await readEntryAt(path, info === undefined ? await fileMetadata(path) : info, !protectedScope && (shared || cached?.objects === objects) ? cached : undefined, permit);
    } catch (error) {
      if (error instanceof RpcFailure && error.message.startsWith('shared file policy:')) continue;
      throw error;
    }
    if (!saved) continue;
    if (shared && !saved.bytes && needsBlob(saved.entry) && saved.objects !== objects && !await linkBlob(shared, objects, saved.entry.hash)) {
      // The shared blob is gone: read the file again.
      saved = await readEntry(path);
      if (!saved) continue;
    }
    bytes += saved.size;
    if (bytes > BYTE_LIMIT) throw new Error('workspace exceeds the 128 MiB checkpoint limit');
    result[name] = saved.entry;
    if (saved.bytes) {
      const stored = await encodeBlob(saved.bytes);
      if (shared) await storeBlob(shared, objects, saved.entry.hash, saved.bytes, stored, folders);
      else await writeCheckpointBlob(join(objects, saved.entry.hash), saved.entry.hash, stored);
    }
    next.set(name, { entry: saved.entry, metadata: saved.metadata, size: saved.size, objects });
  }
  signal?.throwIfAborted();
  if (previous) { previous.clear(); for (const [name, entry] of next) previous.set(name, entry); }
  return result;
}

function needsBlob(entry: FileEntry): boolean { return entry.link === undefined && !entry.unbacked; }

/**
 * Put the shared blob at `objects/<hash>`. Returns false when the shared blob
 * is missing. A file the folder already holds stays when it is that same
 * blob, or when the shared one is gone; an older private copy is replaced by
 * the link. A file system without hard links gets a private copy, as before
 * the shared store existed.
 */
async function linkBlob(shared: string, objects: string, hash: string): Promise<boolean> {
  const source = sharedBlob(shared, hash);
  const dest = join(objects, hash);
  try { await link(source, dest); return true; } catch (error) {
    const code = errno(error);
    const want = await lstat(source, { bigint: true }).catch(() => null);
    if (!want) return code === 'EEXIST';
    if (code === 'EEXIST') {
      const have = await lstat(dest, { bigint: true });
      if (have.ino === want.ino && have.dev === want.dev) return true;
    } else if (!NO_LINK.has(code)) throw error;
    await replaceBlob(source, dest, code === 'EEXIST');
    return true;
  }
}

/** Swap `dest` for a link to `source`, or a copy of it, in one rename. */
async function replaceBlob(source: string, dest: string, tryLink: boolean): Promise<void> {
  const temporary = `${dest}.tmp-${randomUUID()}`;
  try {
    const linked = tryLink && await link(source, temporary).then(() => true, (error: unknown) => {
      if (!NO_LINK.has(errno(error))) throw error;
      return false;
    });
    if (!linked) await copyFile(source, temporary);
    await rename(temporary, dest);
  } catch (error) { await rm(temporary, { force: true }); throw error; }
}

/**
 * Keep a blob in `objects` and in the shared store. `stored` is what goes on
 * disk for `bytes`, a zstd frame when that pays. Known content is linked
 * without reading it whole when the shared blob is a frame of the expected
 * size: its name is the hash and a rewind hashes it again. A raw shared blob,
 * from before compression or incompressible, is compared byte for byte.
 * New content is written into `objects` first and gets its shared name once
 * complete, so the store never names a partial file. A shared blob left
 * short or zeroed by a crash before its data reached the disk is replaced,
 * along with the thread's own name when it is the same file.
 */
async function storeBlob(shared: string, objects: string, hash: string, bytes: Buffer, stored: Buffer, folders: Set<string>): Promise<void> {
  const source = sharedBlob(shared, hash);
  const info = await lstat(source).catch(() => null);
  if (info?.isFile() && await sameBlob(source, info.size, bytes, stored) && await linkBlob(shared, objects, hash)) return;
  const dest = join(objects, hash);
  await writeCheckpointBlob(dest, hash, stored);
  const folder = dirname(source);
  if (!folders.has(folder)) { await mkdir(folder, { recursive: true, mode: 0o700 }); folders.add(folder); }
  if (info) await rm(source, { force: true });
  try { await link(dest, source); }
  catch (error) { if (errno(error) !== 'EEXIST' && !NO_LINK.has(errno(error))) throw error; }
}

/** Whether the shared blob at `path` holds `bytes`, reading four bytes of a frame or the whole of a raw blob. */
async function sameBlob(path: string, size: number, bytes: Buffer, stored: Buffer): Promise<boolean> {
  if (stored !== bytes && size === stored.length) {
    const handle = await open(path, constants.O_RDONLY).catch(() => null);
    if (!handle) return false;
    try {
      const head = Buffer.alloc(4);
      return (await handle.read(head, 0, 4, 0)).bytesRead === 4 && head.equals(stored.subarray(0, 4));
    } finally { await handle.close(); }
  }
  if (size !== bytes.length) return false;
  const existing = await readFile(path).catch(() => null);
  return existing !== null && existing.equals(bytes);
}

/**
 * Remove shared blobs no thread folder links to any more. A blob changed in
 * the last `graceMs` stays: a snapshot may be about to link it. Unfinished
 * writes older than that are removed too. Returns the count removed.
 */
export async function collectSharedBlobs(shared: string, graceMs: number): Promise<number> {
  let folders;
  try { folders = await readdir(shared, { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0; throw error; }
  const before = Date.now() - graceMs;
  let removed = 0;
  for (const folder of folders) {
    if (!folder.isDirectory()) continue;
    for (const name of await readdir(join(shared, folder.name)).catch(() => [])) {
      const path = join(shared, folder.name, name);
      const info = await lstat(path).catch(() => null);
      if (!info?.isFile() || info.nlink !== 1 || Math.max(info.ctimeMs, info.mtimeMs) > before) continue;
      await rm(path, { force: true });
      removed += 1;
    }
  }
  return removed;
}

/**
 * One content-addressed blob, `bytes` in its stored form. A crash can leave
 * a short file at the hash name: `wx` then fails with EEXIST and a later
 * rewind would trust the partial bytes until the restore hash check refuses
 * the whole rewind. A file whose content hashes to the name stays, raw or
 * framed. A mismatch is replaced. Any other write error removes the partial
 * file this attempt created.
 */
async function writeCheckpointBlob(dest: string, hash: string, bytes: Buffer): Promise<void> {
  try {
    await writeFile(dest, bytes, { flag: 'wx', mode: 0o600 });
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      await rm(dest, { force: true });
      throw error;
    }
  }
  const existing = await readFile(dest).catch(() => null);
  if (existing !== null && await decodeBlob(existing, hash)) return;
  await rm(dest, { force: true });
  await writeFile(dest, bytes, { flag: 'wx', mode: 0o600 });
}

export async function workspaceRoot(cwd: string): Promise<string> { return realpath(cwd); }

export interface FileChange { name: string; before?: FileEntry; after?: FileEntry }

async function writeEntry(root: string, objects: string, name: string, entry: FileEntry | undefined): Promise<void> {
  const path = await checkedPath(root, name);
  if (!entry) {
    await rm(path, { force: true });
    // Newly created directory trees can become files again. Only empty
    // parents are removed; unrelated content always stops the cleanup.
    let parent = dirname(path);
    while (parent !== root) {
      try { await rmdir(parent); }
      catch (error) { if (['ENOTEMPTY', 'EEXIST', 'ENOENT', 'EACCES', 'EPERM', 'EROFS'].includes((error as NodeJS.ErrnoException).code ?? '')) break; throw error; }
      parent = dirname(parent);
    }
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.boite-restore-${randomUUID()}`);
  try {
    if (entry.link !== undefined) await symlink(entry.link, temporary);
    else {
      const content = await readBlob(join(objects, entry.hash), entry.hash);
      if (!content) throw new Error(`file checkpoint blob for ${name} is missing or corrupt`);
      await writeFile(temporary, content, { mode: entry.mode });
      await chmod(temporary, entry.mode);
    }
    // A removed directory can be replaced by a file once its affected children
    // are gone. Refuse nonempty directories instead of deleting outside files.
    try { if ((await lstat(path)).isDirectory()) await rmdir(path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
}

/** Whether this system's file names may ignore case, so two spellings may name one entry. */
const FOLDED = process.platform === 'win32' || process.platform === 'darwin';
const LINKED = { state: 'linked' } as const;
const MISSING = { state: 'missing' } as const;
type Spot = typeof LINKED | typeof MISSING | { state: 'file' | 'dir'; at: string; restored: boolean };

function within(dir: string, path: string): boolean {
  const rest = relative(dir, path);
  return rest === '' || (rest !== '..' && !rest.startsWith(`..${sep}`) && !isAbsolute(rest));
}

function real(path: string): string {
  try { return realpathSync.native(path); } catch { return resolve(path); }
}

const flip = (name: string) => name === name.toLowerCase() ? name.toUpperCase() : name.toLowerCase();

/**
 * Whether the names in `dir` ignore case: an entry there and its other case are one file. False where two entries
 * differ only by case, null when no entry has a letter to try.
 */
function caseless(dir: string): boolean | null {
  if (!FOLDED) return false;
  let names: string[];
  try { names = readdirSync(dir); } catch { return null; }
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name.toLowerCase())) return false;
    seen.add(name.toLowerCase());
  }
  const probe = names.find(name => flip(name) !== name);
  if (probe === undefined) return null;
  try {
    const [own, other] = [lstatSync(join(dir, probe), { bigint: true }), lstatSync(join(dir, flip(probe)), { bigint: true })];
    return own.ino === other.ino && own.dev === other.dev;
  } catch { return false; }
}

/** Whether a file the restore writes with `mode` is readable to this process, which then owns it. */
const ownReadable = (mode: number) => process.platform === 'win32' || process.getuid?.() === 0 || (mode & 0o400) !== 0;

const split = (path: string) => path.split(process.platform === 'win32' ? /[\\/]/ : sep).filter(Boolean);

/**
 * The files under `root` as `restoreFiles(root, objects, changes)` will leave them, read without writing anything:
 * each change's `before`, a parent its deleted files leave empty gone, every other path as the disk holds it. A path
 * spelled under `cwd`, the thread's spelling of `root` that `realpath` expands, reads under `root`. Where the root's
 * names ignore case, any case of a name reads the entry the restore writes; a restored file this process would own
 * without its read bit reads as unreadable.
 *
 * The view follows no link inside the workspace. A path whose way there crosses a symbolic link or a junction, on
 * disk or restored, or names an entry the restore writes under two spellings (or under another case, where the case
 * rule is unknown), is `linked` and reads as missing; so is
 * one spelled outside `cwd` and `root` whose way enters the workspace. Any other path outside reads from the disk,
 * which the restore leaves alone.
 */
export function restoredView(root: string, objects: string, changes: readonly FileChange[], cwd = root): FileView {
  const base = real(root);
  const folds = caseless(base);
  const fold = (path: string) => folds === true ? path.toLowerCase() : path;
  const lower = (path: string) => FOLDED ? path.toLowerCase() : path;
  const planned = new Map(changes.map(change => [fold(join(base, change.name)), change.before]));
  /** Each spelling the restore writes, and every folder above one, by its name without case. */
  const spellings = new Map<string, Set<string>>();
  for (const change of changes) {
    for (let at = join(base, change.name); at !== base && within(base, at); at = dirname(at)) {
      const seen = spellings.get(lower(at)) ?? new Set<string>();
      seen.add(at);
      spellings.set(lower(at), seen);
    }
  }
  const below = (dir: string) => { const own = fold(dir); return own.endsWith(sep) ? own : own + sep; };
  /** Whether the restore puts any entry below `dir`, which then stands as a directory. */
  const created = (dir: string) => [...planned].some(([path, entry]) => entry !== undefined && path.startsWith(below(dir)));
  const touched = (dir: string) => [...planned.keys()].some(path => path.startsWith(below(dir)));
  const names = (dir: string) => { try { return readdirSync(dir); } catch { return []; } };
  /** Whether an entry stands at `path` itself, a link not followed, every directory above it standing. */
  const present = (path: string): boolean => {
    if (planned.has(fold(path))) return planned.get(fold(path)) !== undefined || created(path);
    let directory: boolean;
    try { directory = lstatSync(path).isDirectory(); } catch { return created(path); }
    if (!directory) return true;
    // `writeEntry` removes only the parents a deleted file leaves empty: a directory empty before stays.
    return created(path) || names(path).some(name => present(join(path, name))) || !touched(path);
  };
  const inWorkspace = (path: string) => within(lower(base), lower(path));
  /**
   * A path spelled outside the workspace: `linked` when its way, each link followed as the disk holds it, enters the
   * workspace, where the restore may change a link it crosses; else null, as the disk holds it.
   */
  const outside = (full: string): Spot | null => {
    let at = parse(full).root;
    const queue = split(full.slice(at.length));
    let hops = 0;
    while (queue.length) {
      const part = queue.shift()!;
      if (part === '.') continue;
      if (part === '..') { at = dirname(at); continue; }
      const next = join(at, part);
      if (inWorkspace(next)) return LINKED;
      let info;
      try { info = lstatSync(next); } catch { break; }
      if (!info.isSymbolicLink()) { at = next; continue; }
      if (++hops > 40) return LINKED;
      let target: string;
      // A Windows target may carry the `\\?\` or `\??\` prefix, `UNC\` for a share.
      try { target = readlinkSync(next).replace(/^(\\\\\?\\|\\\?\?\\)UNC\\/i, '\\\\').replace(/^\\\\\?\\|^\\\?\?\\/, ''); } catch { return LINKED; }
      if (isAbsolute(target)) {
        at = parse(target).root;
        if (!at) return LINKED;
        queue.unshift(...split(target.slice(at.length)));
      } else queue.unshift(...split(target));
    }
    try { return inWorkspace(at) || inWorkspace(realpathSync.native(at)) ? LINKED : null; } catch { return null; }
  };
  const locate = (path: string): Spot | null => {
    const full = resolve(path);
    const spelled = resolve(cwd);
    let at: string;
    if (within(spelled, full)) {
      // A spelling inside the workspace is a link the restore may change.
      if (relative(base, spelled) !== '' && within(base, spelled)) return LINKED;
      at = join(base, relative(spelled, full));
    } else if (within(base, full)) at = full;
    else if (within(resolve(root), full)) at = join(base, relative(resolve(root), full));
    else return outside(full);
    const parts = split(relative(base, at));
    let here = base;
    let restored = false;
    for (const [index, part] of parts.entries()) {
      const next = join(here, part);
      const last = index === parts.length - 1;
      // Two spellings of one entry, or, where the case rule is unknown, another case of one the restore writes.
      const written = spellings.get(lower(next));
      if (written && (written.size > 1 && folds !== false || folds === null && !written.has(next))) return LINKED;
      if (planned.has(fold(next))) {
        const entry = planned.get(fold(next));
        if (entry === undefined) {
          if (!created(next)) return MISSING;
          here = next; restored = true; continue;
        }
        if (entry.link !== undefined) return LINKED;
        return last ? { state: 'file', at: next, restored } : MISSING;
      }
      if (restored) {
        if (!created(next)) return MISSING;
        here = next; continue;
      }
      let info;
      try { info = lstatSync(next); } catch {
        if (!created(next)) return MISSING;
        here = next; restored = true; continue;
      }
      if (info.isSymbolicLink()) return LINKED;
      if (!info.isDirectory()) return last ? { state: 'file', at: next, restored } : MISSING;
      here = next;
    }
    // The restore never removes the root, even when it empties it.
    return here === base || restored || present(here) ? { state: 'dir', at: here, restored } : MISSING;
  };
  return {
    read: path => {
      const spot = locate(path);
      if (spot === null) return DISK_VIEW.read(path);
      if (spot.state !== 'file') return null;
      const entry = planned.get(fold(spot.at));
      if (entry) return ownReadable(entry.mode) ? readBlobSync(join(objects, entry.hash), entry.hash)?.toString('utf8') ?? null : null;
      try { return readFileSync(spot.at, 'utf8'); } catch { return null; }
    },
    exists: path => {
      const spot = locate(path);
      return spot === null ? DISK_VIEW.exists(path) : spot.state === 'file' || spot.state === 'dir';
    },
    listsAny: path => {
      const spot = locate(path);
      if (spot === null) return DISK_VIEW.listsAny(path);
      if (spot.state !== 'dir') return false;
      return created(spot.at) || (!spot.restored && names(spot.at).some(name => present(join(spot.at, name))));
    },
    linked: path => locate(path)?.state === 'linked',
  };
}

/** The disk as `restoredView` reads it with nothing to restore, so a send and an edit read `cwd`'s folder alike. */
export function diskView(cwd: string): FileView {
  let root: string;
  try { root = realpathSync.native(cwd); } catch { return DISK_VIEW; }
  return restoredView(root, '', [], cwd);
}

/** Check all conflicts before writing; put the original files back if a write fails. */
export async function restoreFiles(root: string, objects: string, changes: FileChange[]): Promise<void> {
  for (const change of changes) {
    if (change.before?.unbacked || change.after?.unbacked) {
      throw refused(`cannot rewind: ${change.name} had a version over the 16 MiB checkpoint limit, which has no backup`, { field: 'path', path: change.name, reason: 'file-unbacked' });
    }
    const current = await readEntry(await checkedPath(root, change.name));
    if (!same(current?.entry, change.after)) {
      throw refused(`cannot rewind: ${change.name} changed outside the removed turns`, { field: 'path', path: change.name, reason: 'file-conflict', expected: 'the file state at the end of the removed turns' });
    }
    // A missing backup must be discovered before any file is touched.
    if (change.before && change.before.link === undefined && !await readBlob(join(objects, change.before.hash), change.before.hash)) {
      throw new Error(`file checkpoint blob for ${change.name} is missing or corrupt`);
    }
  }
  const written: FileChange[] = [];
  try {
    const ordered = [...changes].sort((a, b) => Number(!!a.before) - Number(!!b.before) || a.name.split('/').length - b.name.split('/').length);
    for (const change of ordered) {
      // Recheck after asynchronous validation, immediately before its write.
      const current = await readEntry(await checkedPath(root, change.name));
      if (!same(current?.entry, change.after)) throw refused(`cannot rewind: ${change.name} changed while restoring files`, { field: 'path', path: change.name, reason: 'file-conflict' });
      await writeEntry(root, objects, change.name, change.before);
      written.push(change);
    }
  } catch (error) {
    for (const change of written.reverse()) await writeEntry(root, objects, change.name, change.after);
    throw error;
  }
}
