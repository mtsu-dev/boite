/*
 * The thread's working directory, as a client may read it: one directory at a
 * time, one file, and the editor's save. Every path a caller names is resolved
 * inside that directory and refused outside it, real paths included, so a
 * symlink or a junction pointing out of the tree is not a way through.
 *
 * What is not text, or too big to be one, leaves through a ticket on the HTTP
 * server rather than a JSON frame: a video has to seek, and a picture carried
 * as base64 in a WebSocket message is paid for twice.
 */

import { constants, existsSync, lstatSync, realpathSync, statSync } from 'node:fs';
import type { BigIntStats, Stats } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { open, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { DEVICE_HOME_CREDENTIAL_STORES, FILES_LIST_MAX, FILE_MAX_BYTES, FILE_ROUTE, FILE_TICKET_TTL_MS, deviceBound } from '@boite/contracts';
import type { FileContent, FileEntry, ThreadId, Timestamp } from '@boite/contracts';
import type { Core } from './core.ts';
import { locateFile } from './files.ts';
import { refused, RpcFailure } from './errors.ts';
import type { RpcContext } from './router.ts';
import { newToken } from './ids.ts';
import { currentOs, homePath } from './paths.ts';
import { worktreeRoot } from './worktree.ts';
import type { SharedFilePermit } from './contacts/access-policy.ts';

/** How much of a file decides whether it is text: one NUL in there and it is not. */
const TEXT_PROBE_BYTES = 8000;

export interface InsidePath {
  absolute: string;
  /** Relative to the working directory, forward slashes, empty for the directory itself. */
  relative: string;
}

/** The working directory of a thread that exists, which is what every path here is resolved against. */
export function threadCwd(core: Core, threadId: ThreadId): string {
  return core.threads.require(threadId).cwd;
}

/**
 * A paired device reads a thread's tree only where the core keeps its work: the
 * thread's project, or the worktree folder the core makes for that project.
 * `threads.create` already holds a device's cwd there, but an imported or
 * owner-made thread may sit anywhere, and a link may have moved since: the
 * real path is checked again on every read, before any git or file access.
 */
export function assertDeviceReadable(core: Core, threadId: ThreadId): void {
  const thread = core.threads.require(threadId);
  const where = realOf(thread.cwd);
  if (!deviceRoots(core, threadId).some((root) => contains(root, where))) {
    throw refused(`a paired device reads only inside the thread's project or its worktrees, not ${thread.cwd}`, { threadId });
  }
  const login = homeLoginFolder(core, realOf(homePath()), where);
  if (login !== null) throw loginRefusal(login, thread.cwd, threadId);
}

function deviceRoots(core: Core, threadId: ThreadId): string[] {
  const thread = core.threads.require(threadId);
  const project = thread.projectId === null ? null : core.projects.require(thread.projectId);
  // The in-project worktree folder is inside the project; a shared one is not.
  const roots = project === null ? [] : [project.path, worktreeRoot(project.path, core.settings.get().worktreeStorage, project.id)];
  return roots.map(realOf);
}

/** Folders that hold keys or tokens wherever they sit in a tree. */
const DEVICE_SECRET_DIRS = new Set(['.git', '.ssh', '.gnupg', '.aws', '.azure', '.kube', '.docker']);
/** Files that hold credentials; templates such as `.env.example` stay readable. */
const DEVICE_SECRET_FILE =
  /^(\.env(\.(?!example$|sample$|template$)[^.]+)*|\.envrc|\.dev\.vars|\.netrc|_netrc|\.npmrc|\.pypirc|\.pgpass|\.htpasswd|\.git-credentials|\.credentials\.json|credentials(\.json)?|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|.+\.(tfvars|tfstate|tfstate\.backup)|.+\.(pem|key|p12|pfx|jks|keystore|kdbx))$/i;

/**
 * Where the owner's logins live: the home folder's hidden entries (every agent
 * CLI, gh, rclone, keyrings, shell history) and the per-user stores of Windows
 * and macOS. Denied as a whole rather than by a list of known names, since a
 * new CLI brings a new folder. The temporary folder, which Windows keeps
 * under AppData, holds no login, nor do the cloud drives macOS keeps under
 * Library. The answer names the entry, for the refusal.
 */
function homeCredentialEntry(home: string, real: string): string | null {
  if (!contains(home, real) || contains(realOf(tmpdir()), real)) return null;
  const [first = '', second = ''] = relative(home, real).split(sep);
  if (/^library$/i.test(first) && /^(cloudstorage|mobile documents)$/i.test(second)) return null;
  return first.startsWith('.') || /^(appdata|library)$/i.test(first) ? first : null;
}

function isCredentialPath(core: Core, home: string, path: string, real: string, forProjectRoot = false): boolean {
  const { roots, exact } = core.providers.credentialPaths(core.accounts.list(), forProjectRoot);
  for (const name of DEVICE_HOME_CREDENTIAL_STORES) roots.add(join(home, name));
  for (const root of roots) {
    if (contains(root, path) || contains(realOf(root), real)) return true;
  }
  for (const entry of exact) {
    if (relative(entry, path) === '' || relative(realOf(entry), real) === '') return true;
  }
  return false;
}

/**
 * The home folder's known login folders, as segments: each agent CLI's, the key
 * and token stores, and the ones other CLIs keep under the XDG folders. `AppData`
 * and `Library` hold every Windows and macOS app's logins and count whole.
 */
const HOME_LOGIN_FOLDERS = [
  ...DEVICE_HOME_CREDENTIAL_STORES, '.ssh', '.gnupg', '.aws', '.azure', '.kube', '.docker',
  '.cargo', '.config/gcloud', 'AppData', 'Library',
].map(folder => folder.toLowerCase().split('/'));

/**
 * The login folder of the home folder that holds `real`, checked whatever the
 * root: a project the owner registered at `~/.codex`, or a device adding
 * `~/.config/gh`, reaches the same logins as the home folder would. Known
 * folders only, so a project or worktree folder kept in another hidden folder
 * (`~/.worktrees`, `~/.config/nvim`) stays readable. Boite's data folder is
 * left to its own check, and the temporary folder and macOS' cloud drives hold
 * no login.
 */
function homeLoginFolder(core: Core, home: string, real: string): string | null {
  if (!contains(home, real) || contains(realOf(tmpdir()), real) || contains(realOf(core.dataDir), real)) return null;
  const parts = relative(home, real).split(sep).filter(Boolean);
  const lower = parts.map((part) => part.toLowerCase());
  if (lower[0] === 'library' && (lower[1] === 'cloudstorage' || lower[1] === 'mobile documents')) return null;
  const folder = HOME_LOGIN_FOLDERS.find((segments) => segments.every((segment, index) => lower[index] === segment));
  return folder === undefined ? null : parts.slice(0, folder.length).join('/');
}

/** A known login folder of the home folder that `real` holds, such as `.config/gh` for `~/.config`. */
function heldLoginFolder(home: string, real: string): string | null {
  if (!contains(home, real) || real === home) return null;
  const folder = HOME_LOGIN_FOLDERS.find((segments) => contains(real, join(home, ...segments)));
  return folder === undefined ? null : folder.join('/');
}

function loginRefusal(entry: string, path: string, threadId?: ThreadId): RpcFailure {
  return refused(`a paired device does not read credential files (the home folder's ${entry} holds logins); open ${path} on the owner's machine`, { ...(threadId ? { threadId } : {}), path, expected: `a path outside the home folder's ${entry}` });
}

/**
 * Inside a readable tree, a paired device still leaves three things to the owner.
 * The core's own data (journal, accounts, tokens) when a project contains it,
 * which happens when a project is a home or desktop folder; a project or
 * worktree folder kept under the data folder stays readable. The home folder's
 * hidden entries, where every CLI keeps its login, when the thread's folder or
 * project is the home folder or holds it; a folder the owner chose inside one
 * (a shared worktree folder in `~/.worktrees`, a drive in `~/Library`) keeps
 * its reads, unless it is inside a known login folder. And files that
 * hold credentials, since a phone that is lost or borrowed should not carry a
 * key away. A path outside the tree is left to the read itself to refuse.
 */
export function assertDeviceFile(core: Core, threadId: ThreadId, cwd: string, path: string | undefined): void {
  const base = realOf(cwd);
  const absolute = resolve(cwd, path ?? '');
  const target = realOf(absolute);
  if (!contains(base, target)) return;
  assertDeviceTarget(core, threadId, base, target, absolute, path);
}

/** The rules above, for `target` inside the real folder `base`. */
function assertDeviceTarget(core: Core, threadId: ThreadId, base: string, target: string, absolute: string, path: string | undefined): void {
  const roots = deviceRoots(core, threadId);
  const data = realOf(core.dataDir);
  if (contains(data, target) && !roots.some((root) => root !== data && contains(data, root) && contains(root, target))) {
    throw refused(`a paired device does not read boite's data folder: ${path ?? ''}`, { threadId });
  }
  const parts = relative(base, target).split(sep).filter(Boolean);
  const home = realOf(homePath());
  const coversHome = [base, ...roots].some(root => contains(root, home));
  if (!coversHome) {
    const login = homeLoginFolder(core, home, target);
    if (login !== null) throw loginRefusal(login, path ?? '', threadId);
  }
  const entry = coversHome ? homeCredentialEntry(home, target) : null;
  if (entry !== null || isCredentialPath(core, home, absolute, target)
    || parts.some((part) => DEVICE_SECRET_DIRS.has(part.toLowerCase())) || DEVICE_SECRET_FILE.test(basename(target))) {
    throw refused(`a paired device does not read credential files${entry === null ? '' : ` (the home folder's ${entry} holds logins)`}; open ${path ?? ''} on the owner's machine`, { threadId });
  }
}

/**
 * The file `git.diff` reads at HEAD for its old side, as git names it: a
 * rename's origin, which the device may not have named. It answers to the
 * rules of a file, and stays inside the thread's folder like one. Git reads
 * the name HEAD records, not where a link in today's tree leads, so that name
 * is checked as written as well as followed: `.aws/notes.txt` stays a
 * credential file when `.aws` is now a link to an ordinary folder.
 */
export function assertDeviceHistoryFile(core: Core, threadId: ThreadId, cwd: string, absolute: string): void {
  const base = realOf(cwd);
  const recorded = resolve(base, relative(resolve(cwd), resolve(absolute)));
  // A moved origin is on no disk: where it would lie is where its parent resolves.
  const followed = landing(resolve(absolute), true);
  for (const target of [recorded, followed]) {
    if (target === null || !contains(base, target)) {
      throw refused(`a paired device does not read ${absolute} at HEAD: it is outside the thread's working directory`, { threadId });
    }
    assertDeviceTarget(core, threadId, base, target, absolute, absolute);
  }
}

/**
 * A folder a paired device adds as a project becomes a root the checks above
 * read from, so it is held to the same rules first: not boite's data folder or
 * inside it, not the home folder, one of its parents or a disk root (they hold
 * every login), not one of the home folder's known login folders, a folder
 * inside one or a folder that holds one, and not a folder that holds keys or
 * tokens or one inside it. This includes declared login paths outside the
 * default home layout. A folder
 * inside another hidden entry of the home folder (`~/.worktrees`, `~/.dotfiles`)
 * is allowed: it is a root of its own, and the entry's other folders stay out
 * of it. Its links are followed, as a read follows them.
 */
export function assertDeviceProjectFolder(core: Core, folder: string): void {
  const real = realOf(folder);
  if (contains(realOf(core.dataDir), real)) {
    throw refused(`a paired device does not add boite's data folder, or a folder inside it, as a project: ${folder}`, { field: 'path', path: folder, expected: 'a folder outside boite\'s data folder' });
  }
  const home = realOf(homePath());
  if (contains(real, home) || dirname(real) === real) {
    throw refused(`a paired device does not add the home folder, a folder that contains it or a disk root as a project, since it holds every login on this machine; add a folder inside it, or add ${folder} on the owner's machine`, { field: 'path', path: folder, expected: `a folder inside ${home}, not ${home} itself or a parent of it` });
  }
  const login = homeLoginFolder(core, home, real) ?? heldLoginFolder(home, real);
  if (login !== null) {
    throw refused(`a paired device does not add a folder that holds keys or tokens as a project: the home folder's ${login} holds logins; add ${folder} on the owner's machine`, { field: 'path', path: folder, expected: `a folder outside the home folder's ${login}` });
  }
  if (isCredentialPath(core, home, resolve(folder), real, true) || real.split(sep).some((part) => DEVICE_SECRET_DIRS.has(part.toLowerCase()))) {
    throw refused(`a paired device does not add a folder that holds keys or tokens as a project; add ${folder} on the owner's machine`, { field: 'path', path: folder, expected: `a folder outside ${[...DEVICE_SECRET_DIRS].join(', ')}` });
  }
}

function realOf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    // A directory that cannot be resolved is compared as it was written.
    return resolve(path);
  }
}

function contains(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function relativeForm(root: string, target: string): string {
  return relative(root, target).split(sep).join('/');
}

/**
 * A path a caller named, resolved inside the thread's working directory:
 * relative to it, or absolute as long as it stays in. Nothing is read here, so
 * a path that does not exist yet passes; `existingInside` is the one that also
 * follows the links.
 */
export function resolveInside(cwd: string, path: string, what: string): InsidePath {
  if (typeof path !== 'string') throw refused(`${what} must be a path, got ${typeof path}`, { what });
  const root = resolve(cwd);
  const absolute = isAbsolute(path) ? resolve(path) : resolve(root, path);
  if (!contains(root, absolute)) throw refused(`${what} leaves the thread's working directory: ${path}`, { what, path });
  return { absolute, relative: relativeForm(root, absolute) };
}

/**
 * The same, for something that has to be there already. The link is followed
 * before the check, so a junction inside the directory pointing outside it is
 * refused like a `..` would be.
 */
export function existingInside(
  cwd: string,
  path: string,
  expect: 'file' | 'dir',
  what: string,
): InsidePath & { stats: BigIntStats; real: string } {
  const found = resolveInside(cwd, path, what);
  let real: string;
  let stats: BigIntStats;
  try {
    real = realpathSync(found.absolute);
    // Exact ids: NTFS ones pass 2^53, where numbers round neighbours together.
    stats = statSync(real, { bigint: true });
  } catch {
    throw refused(`${what} does not exist: ${path}`, { what, path });
  }
  if (!contains(realOf(cwd), real)) {
    throw refused(`${what} leaves the thread's working directory: ${path}`, { what, path });
  }
  if (expect === 'file' && !stats.isFile()) throw refused(`${what} is not a file: ${path}`, { what, path });
  if (expect === 'dir' && !stats.isDirectory()) throw refused(`${what} is not a directory: ${path}`, { what, path });
  return { ...found, real, stats };
}

const NOFOLLOW = constants.O_NOFOLLOW ?? 0;

async function writeAll(handle: FileHandle, data: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < data.length) {
    const { bytesWritten } = await handle.write(data, offset);
    if (bytesWritten <= 0) throw refused('the file write made no progress');
    offset += bytesWritten;
  }
}

/** Open the real directory checked a moment ago. The handle stays on that inode if its path is renamed. */
export function openHeldDirectory(real: string, dev: bigint, ino: bigint, what: string, path: string): Promise<FileHandle> {
  return openChecked(real, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0), dev, ino, what, path, 'dir');
}

/**
 * Create `name` inside a directory the caller holds. On Linux the new file is
 * opened through that inode, so renaming the directory onto an outside link
 * cannot redirect it. Elsewhere the fallback path is opened after the inode
 * check; a swap in that gap can still create the file outside.
 */
export async function createExclusiveFile(dir: FileHandle, name: string, fallbackPath: string): Promise<FileHandle> {
  if (name.length === 0 || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
    throw refused(`files.write path is not a file name: ${name}`, { what: 'files.write path', path: name });
  }
  const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW;
  const target = currentOs() === 'linux' ? `/proc/self/fd/${dir.fd}/${name}` : fallbackPath;
  return open(target, flags, 0o666);
}

/** Open the real file checked a moment ago, and refuse a symlink swapped in since. */
export async function openChecked(
  real: string, flags: number, dev: bigint, ino: bigint, what: string, path: string, expect: 'file' | 'dir' = 'file',
): Promise<FileHandle> {
  let handle: FileHandle;
  try {
    handle = await open(real, flags | NOFOLLOW);
  } catch {
    throw refused(`${what} changed while it was opened: ${path}`, { what, path });
  }
  try {
    const stats = await handle.stat({ bigint: true });
    const matches = expect === 'dir' ? stats.isDirectory() : stats.isFile();
    if (!matches || stats.dev !== dev || stats.ino !== ino) {
      throw refused(`${what} changed while it was opened: ${path}`, { what, path });
    }
    return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
}

/**
 * Whether a write to `path` would land inside the working directory once every
 * link on the way is followed. A file that does not exist yet is judged by its
 * nearest existing parent, which is where the write would create it; a link to
 * nothing, or a path that cannot be read, is judged outside.
 */
export function writeLandsInside(cwd: string, path: string): boolean {
  const root = resolve(cwd);
  const absolute = isAbsolute(path) ? resolve(path) : resolve(root, path);
  if (!contains(root, absolute)) return false;
  const lands = landing(absolute);
  return lands !== null && contains(realOf(root), lands);
}

/**
 * Where `absolute` lies once every link on the way is followed: its real path,
 * or for a name that is not there, its nearest existing parent's with the rest
 * appended. Null for a link to nothing or a path that cannot be read.
 * `pastFiles` also climbs past a file standing where a folder of the path was
 * (`ENOTDIR`): a name read from history, never one a write would create.
 */
function landing(absolute: string, pastFiles = false): string | null {
  const missing: string[] = [];
  let probe = absolute;
  for (;;) {
    try {
      return join(realpathSync(probe), ...missing);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EACCES' || code === 'EPERM') {
        // Bun on macOS resolves a path by opening it, so a file its owner may
        // not read fails here. Only a link moves a name: anything else lies
        // where its parent resolves.
        try {
          if (lstatSync(probe).isSymbolicLink()) return null;
        } catch {
          return null;
        }
        const parent = dirname(probe);
        if (parent === probe) return null;
        missing.unshift(basename(probe));
        probe = parent;
        continue;
      }
      if (code === 'ENOTDIR' && pastFiles) {
        // A parent of the name is a file now: that file decides, links followed.
      } else if (code !== 'ENOENT') {
        return null;
      } else {
        try {
          lstatSync(probe);
          return null;
        } catch {
          // Not there at all: its parent decides.
        }
      }
      const parent = dirname(probe);
      if (parent === probe) return null;
      missing.unshift(basename(probe));
      probe = parent;
    }
  }
}

function byName(a: { name: string }, b: { name: string }): number {
  const left = a.name.toLowerCase();
  const right = b.name.toLowerCase();
  if (left !== right) return left < right ? -1 : 1;
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/**
 * One directory, directories first. A symbolic link is listed as the file it
 * is: following every one to decide would cost a stat per entry on a tree
 * nobody asked to walk, and the link is followed when a client opens it.
 */
async function listDirectory(cwd: string, path: string | undefined): Promise<FileEntry[]> {
  const directory = path === undefined || path === '' ? '.' : path;
  const what = 'files.list path';
  const target = existingInside(cwd, directory, 'dir', what);
  const dirents = await readdir(target.absolute, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'EACCES' || error.code === 'EPERM') throw refused(`${what} cannot be read: ${directory}`, { what, path: directory });
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') throw refused(`${what} is no longer a directory: ${directory}`, { what, path: directory });
    throw error;
  });
  const ordered = dirents
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || byName(a, b))
    .slice(0, FILES_LIST_MAX);
  return await Promise.all(
    ordered.map(async (entry): Promise<FileEntry> => {
      const full = join(target.absolute, entry.name);
      const kind = entry.isDirectory() ? 'dir' : 'file';
      let bytes: number | null = null;
      let modifiedAt = 0;
      try {
        const stats = await stat(full);
        bytes = kind === 'dir' ? null : stats.size;
        modifiedAt = Math.round(stats.mtimeMs);
      } catch {
        // A file gone or refused between the listing and the stat: named, unmeasured.
      }
      return {
        name: entry.name,
        path: target.relative.length === 0 ? entry.name : `${target.relative}/${entry.name}`,
        kind,
        bytes,
        modifiedAt,
      };
    }),
  );
}

export function hasNul(data: Uint8Array, probe = TEXT_PROBE_BYTES): boolean {
  const end = Math.min(data.length, probe);
  for (let at = 0; at < end; at += 1) if (data[at] === 0) return true;
  return false;
}

const LANGUAGES: ReadonlyMap<string, string> = new Map([
  ['ts', 'typescript'], ['tsx', 'tsx'], ['js', 'javascript'], ['jsx', 'jsx'], ['json', 'json'],
  ['md', 'markdown'], ['svelte', 'svelte'], ['rs', 'rust'], ['py', 'python'], ['go', 'go'],
  ['css', 'css'], ['html', 'html'], ['yaml', 'yaml'], ['yml', 'yaml'], ['toml', 'toml'],
  ['sh', 'shell'], ['ps1', 'powershell'], ['sql', 'sql'], ['c', 'c'], ['cpp', 'cpp'],
  ['h', 'c'], ['java', 'java'], ['kt', 'kotlin'], ['rb', 'ruby'], ['php', 'php'],
  ['xml', 'xml'], ['txt', 'plaintext'],
]);

const MEDIA: ReadonlyMap<string, { kind: 'image' | 'video' | 'audio'; mime: string }> = new Map([
  ['png', { kind: 'image', mime: 'image/png' }],
  ['jpg', { kind: 'image', mime: 'image/jpeg' }],
  ['jpeg', { kind: 'image', mime: 'image/jpeg' }],
  ['gif', { kind: 'image', mime: 'image/gif' }],
  ['webp', { kind: 'image', mime: 'image/webp' }],
  ['svg', { kind: 'image', mime: 'image/svg+xml' }],
  ['bmp', { kind: 'image', mime: 'image/bmp' }],
  ['avif', { kind: 'image', mime: 'image/avif' }],
  ['ico', { kind: 'image', mime: 'image/x-icon' }],
  ['mp4', { kind: 'video', mime: 'video/mp4' }],
  ['webm', { kind: 'video', mime: 'video/webm' }],
  ['mov', { kind: 'video', mime: 'video/quicktime' }],
  ['mkv', { kind: 'video', mime: 'video/x-matroska' }],
  ['m4v', { kind: 'video', mime: 'video/x-m4v' }],
  ['mp3', { kind: 'audio', mime: 'audio/mpeg' }],
  ['wav', { kind: 'audio', mime: 'audio/wav' }],
  ['ogg', { kind: 'audio', mime: 'audio/ogg' }],
  ['flac', { kind: 'audio', mime: 'audio/flac' }],
  ['m4a', { kind: 'audio', mime: 'audio/mp4' }],
  ['aac', { kind: 'audio', mime: 'audio/aac' }],
]);

function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
}

/** The highlighter's name for a file, or null when the extension says nothing. */
export function languageOf(path: string): string | null {
  return LANGUAGES.get(extensionOf(path)) ?? null;
}

/** What a file no client can read as text is: a picture, a video, a sound, or bytes. */
export function mediaOf(path: string): { kind: 'image' | 'video' | 'audio' | 'binary'; mime: string } {
  if (extensionOf(path) === 'pdf') return { kind: 'binary', mime: 'application/pdf' };
  return MEDIA.get(extensionOf(path)) ?? { kind: 'binary', mime: 'application/octet-stream' };
}

/**
 * Text comes inline; everything else comes as a url. A file over
 * `FILE_MAX_BYTES` takes the url too, whatever its extension says, so a
 * gigabyte of log never becomes one JSON frame.
 */
async function readFileContent(core: Core, cwd: string, path: string, permit?: SharedFilePermit): Promise<FileContent> {
  const found = existingInside(cwd, path, 'file', 'files.read path');
  const modifiedAt = Math.round(Number(found.stats.mtimeNs) / 1e6);
  const size = Number(found.stats.size);
  const media = mediaOf(found.relative);
  const handle = await openChecked(found.real, constants.O_RDONLY, found.stats.dev, found.stats.ino, 'files.read path', path);
  let ticketIdentity: string | null = null;
  try {
    if (permit) permit.opened?.(found.real, await handle.stat({bigint: true}));
    if (size <= FILE_MAX_BYTES && media.mime === 'application/octet-stream') {
      const data = Buffer.alloc(size);
      let offset = 0;
      while (offset < data.length) {
        const { bytesRead } = await handle.read(data, offset, data.length - offset, offset);
        if (bytesRead === 0) break;
        offset += bytesRead;
      }
      const read = data.subarray(0, offset);
      permit?.inspect(read);
      if (!hasNul(read)) {
        const cut = read.length > FILE_MAX_BYTES;
        const text = new TextDecoder().decode(cut ? read.subarray(0, FILE_MAX_BYTES) : read);
        return {
          kind: 'text',
          path: found.relative,
          bytes: read.length,
          modifiedAt,
          text,
          truncated: cut,
          language: languageOf(found.relative),
        };
      }
    }
    if (permit) {
      // Inspect the whole captured file before minting a ticket. A byte range must not skip a credential marker.
      const buffer = Buffer.alloc(64 * 1024);
      let offset = 0, tail = '';
      for (;;) {
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
        if (!bytesRead) break;
        const text = buffer.subarray(0, bytesRead).toString('utf8');
        permit.inspect(tail + text); tail = text.slice(-512);
        offset += bytesRead;
      }
      permit.opened?.(found.real, await handle.stat({bigint: true}));
    }
    const held = await handle.stat({ bigint: true });
    ticketIdentity = `${found.real}|${held.dev}|${held.ino}|${held.size}|${held.mtimeNs}|${held.ctimeNs}`;
  } finally {
    await handle.close();
  }
  if (ticketIdentity === null) throw refused(`files.read path changed while it was opened: ${path}`, { what: 'files.read path', path });
  permit?.check();
  // The identity comes from the handle, not a second walk. A parent swapped
  // before mint would otherwise bind the ticket to the new file.
  const ticket = core.fileTickets.mint(found.real, media.mime, Date.now(), basename(found.absolute), ticketIdentity, false, permit);
  return {
    kind: media.kind,
    path: found.relative,
    bytes: size,
    modifiedAt,
    mime: media.mime,
    // A path, not an address: the client knows which host it reached this core
    // by, and a shell driving a core elsewhere would get nothing from 127.0.0.1.
    url: `${FILE_ROUTE}/${ticket}`,
  };
}

/** The editor's save: the file may be new, its directory may not. */
async function writeFileText(
  cwd: string,
  path: string,
  text: string,
): Promise<{ bytes: number; modifiedAt: Timestamp }> {
  if (typeof text !== 'string') throw refused(`files.write text must be a string, got ${typeof text}`, { path });
  const found = resolveInside(cwd, path, 'files.write path');
  // Named by its relative form, so a refusal never prints where the data lives.
  const parent = found.relative.includes('/') ? found.relative.slice(0, found.relative.lastIndexOf('/')) : '.';
  const parentInside = existingInside(cwd, parent, 'dir', 'files.write path directory');
  // The entry itself, not what it points at: a link to nothing is still there,
  // and the write would follow it and create its target wherever that is.
  let entry: Stats | null = null;
  try {
    entry = lstatSync(found.absolute);
  } catch {
    entry = null;
  }
  const data = new TextEncoder().encode(text);
  if (entry !== null) {
    if (entry.isSymbolicLink() && !existsSync(found.absolute)) {
      throw refused(`files.write path is a link to nothing: ${path}`, { what: 'files.write path', path });
    }
    // The write follows a link: the real file has to be inside the working directory too.
    const inside = existingInside(cwd, path, 'file', 'files.write path');
    // Truncate only after the inode matches. Windows Bun 1.4.2 returns EINVAL
    // for O_WRONLY|O_TRUNC on an ordinary file, and truncating first would
    // also shorten a file the check then refuses.
    const handle = await openChecked(inside.real, constants.O_WRONLY, inside.stats.dev, inside.stats.ino, 'files.write path', path);
    try {
      await handle.truncate(0);
      await writeAll(handle, data);
    } finally {
      await handle.close();
    }
  } else {
    // Create the name in the held parent inode. O_EXCL plus O_NOFOLLOW still
    // refuses a symlink that appears at that name. On Linux the create goes
    // through the directory fd, so a parent renamed onto an outside link
    // cannot receive the bytes. Other platforms open the path after this
    // inode check; a swap in that gap can still create the file outside.
    const dir = await openHeldDirectory(parentInside.real, parentInside.stats.dev, parentInside.stats.ino, 'files.write path directory', path);
    try {
      let handle: FileHandle;
      try {
        handle = await createExclusiveFile(dir, basename(found.absolute), join(parentInside.real, basename(found.absolute)));
      } catch (error) {
        if (error instanceof RpcFailure) throw error;
        throw refused(`files.write path changed while it was opened: ${path}`, { what: 'files.write path', path });
      }
      try {
        await writeAll(handle, data);
      } finally {
        await handle.close();
      }
    } finally {
      await dir.close();
    }
  }
  const stats = await stat(found.absolute);
  return { bytes: data.length, modifiedAt: Math.round(stats.mtimeMs) };
}

export interface FileTicketTarget {
  path: string;
  mime: string;
  name?: string;
  /** A published view: the one kind of ticket `VIEW_ROUTE` opens as a page. Any other only downloads. */
  view?: true;
}

function fileIdentity(path: string): string | null {
  try {
    const real = realpathSync(path);
    const stats = statSync(real, { bigint: true });
    if (!stats.isFile()) return null;
    return `${real}|${stats.dev}|${stats.ino}|${stats.size}|${stats.mtimeNs}|${stats.ctimeNs}`;
  } catch { return null; }
}

/**
 * Bytes the core holds rather than a file it can open: a picture's copy or
 * original, read from the journal when the route is asked. The bytes behind
 * a key never change, so the route lets a client cache them for good.
 */
export interface HeldBytes {
  data: Uint8Array;
  mime: string;
  name?: string;
  /** Kept by no cache: a picture of an incognito conversation, which leaves nothing behind. */
  noStore?: true;
  /** A ```view block's page (`viewBlock`): `VIEW_ROUTE` opens it, the file route only downloads it. */
  view?: true;
}

interface BytesTicket {
  key: string;
  read: () => HeldBytes | null;
  expiresAt: number;
}

/**
 * The tickets the file route answers. Random, held in memory, bound to one
 * absolute path and good for `FILE_TICKET_TTL_MS`: a url that ends up in a
 * screenshot or a log opens nothing ten minutes later, and no client ever
 * names a path to the HTTP server.
 */
export class FileTickets {
  readonly #held = new Map<string, FileTicketTarget & { expiresAt: number; identity: string | null; permit?: SharedFilePermit }>();
  readonly #bytesHeld = new Map<string, BytesTicket>();
  /** The live ticket of each key, so a part asked again keeps its address and the client's HTTP cache. */
  readonly #bytesKeys = new Map<string, string>();

  mint(path: string, mime: string, now = Date.now(), name?: string, identity?: string, view = false, permit?: SharedFilePermit): string {
    this.#sweep(now);
    const ticket = newToken();
    this.#held.set(ticket, {
      path,
      mime,
      ...(name ? { name } : {}),
      ...(view ? { view: true as const } : {}),
      expiresAt: now + FILE_TICKET_TTL_MS,
      identity: identity ?? fileIdentity(path),
      ...(permit ? {permit} : {}),
    });
    return ticket;
  }

  /** Only an authenticated artifact read can keep its own URL alive during playback. */
  renew(ticket: string, path: string, now = Date.now()): boolean {
    const target = this.resolve(ticket, now);
    if (!target || target.path !== path) return false;
    this.#held.get(ticket)!.expiresAt = now + FILE_TICKET_TTL_MS;
    return true;
  }

  resolve(ticket: string, now = Date.now()): FileTicketTarget | null {
    this.#sweep(now);
    const entry = this.#held.get(ticket);
    if (entry === undefined) return null;
    try { entry.permit?.check(); } catch { this.#held.delete(ticket); return null; }
    if (entry.identity === null || fileIdentity(entry.path) !== entry.identity) {
      this.#held.delete(ticket);
      return null;
    }
    return { path: entry.path, mime: entry.mime, ...(entry.name ? { name: entry.name } : {}), ...(entry.view ? { view: true as const } : {}) };
  }

  /**
   * A ticket for bytes `read` gives when the route is asked, null once they
   * are gone (a deleted thread). `key` names what they are; while its ticket
   * lives the same one comes back, renewed, so its address stays the same.
   */
  mintBytes(key: string, read: () => HeldBytes | null, now = Date.now()): string {
    this.#sweep(now);
    const live = this.#bytesKeys.get(key);
    const entry = live === undefined ? undefined : this.#bytesHeld.get(live);
    if (live !== undefined && entry !== undefined) {
      entry.expiresAt = now + FILE_TICKET_TTL_MS;
      return live;
    }
    const ticket = newToken();
    this.#bytesHeld.set(ticket, { key, read, expiresAt: now + FILE_TICKET_TTL_MS });
    this.#bytesKeys.set(key, ticket);
    return ticket;
  }

  /** What a bytes ticket opens, renewing it, or null when it is not one, has expired or its bytes are gone. */
  bytes(ticket: string, now = Date.now()): HeldBytes | null {
    this.#sweep(now);
    const entry = this.#bytesHeld.get(ticket);
    if (entry === undefined) return null;
    // A picture still drawn keeps its address: a ticket lives ten minutes past its last use.
    entry.expiresAt = now + FILE_TICKET_TTL_MS;
    let found: HeldBytes | null;
    try { found = entry.read(); } catch { found = null; }
    if (found === null) this.#dropBytes(ticket, entry);
    return found;
  }

  /** Drop every ticket. A revoked session must not keep a bearer URL alive. */
  forgetAll(): void {
    this.#held.clear();
    this.#bytesHeld.clear();
    this.#bytesKeys.clear();
  }

  /** Drop tickets for files under `root`. Artifact tickets live outside a project cwd, so they stay. */
  forgetUnder(root: string): void {
    const base = realOf(root);
    for (const [ticket, entry] of this.#held) {
      if (contains(base, realOf(entry.path))) this.#held.delete(ticket);
    }
  }

  /**
   * Open the ticket's file without following a symlink swapped in after the
   * mint. The handle is the caller's to close. A mismatch drops the ticket.
   */
  async open(ticket: string, now = Date.now()): Promise<{ handle: FileHandle; path: string; mime: string; name?: string; size: number; view?: true; permit?: SharedFilePermit } | null> {
    this.#sweep(now);
    const entry = this.#held.get(ticket);
    if (entry === undefined || entry.identity === null) {
      if (entry !== undefined) this.#held.delete(ticket);
      return null;
    }
    let handle: FileHandle;
    try {
      entry.permit?.check();
      handle = await open(entry.path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | NOFOLLOW);
    } catch {
      this.#held.delete(ticket);
      return null;
    }
    try {
      const stats = await handle.stat({ bigint: true });
      entry.permit?.check();
      // The stored identity leads with the real path. Comparing the fstat tail
      // still rejects a swapped inode, including when the ticket named a link.
      const suffix = `|${stats.dev}|${stats.ino}|${stats.size}|${stats.mtimeNs}|${stats.ctimeNs}`;
      if (!stats.isFile() || suffix.length >= entry.identity.length || !entry.identity.endsWith(suffix)) {
        this.#held.delete(ticket);
        await handle.close();
        return null;
      }
      return { handle, path: entry.path, mime: entry.mime, ...(entry.name ? { name: entry.name } : {}), size: Number(stats.size), ...(entry.view ? { view: true as const } : {}), ...(entry.permit ? {permit: entry.permit} : {}) };
    } catch {
      await handle.close();
      this.#held.delete(ticket);
      return null;
    }
  }

  #sweep(now: number): void {
    for (const [ticket, entry] of this.#held) {
      if (entry.expiresAt <= now) this.#held.delete(ticket);
    }
    for (const [ticket, entry] of this.#bytesHeld) {
      if (entry.expiresAt <= now) this.#dropBytes(ticket, entry);
    }
  }

  #dropBytes(ticket: string, entry: BytesTicket): void {
    this.#bytesHeld.delete(ticket);
    if (this.#bytesKeys.get(entry.key) === ticket) this.#bytesKeys.delete(entry.key);
  }
}

/** The working directory a read is resolved against, held to the project for a paired device or a plugin. */
function readCwd(core: Core, threadId: ThreadId, ctx: RpcContext, path?: string): string {
  const cwd = threadCwd(core, threadId);
  if (deviceBound(ctx.connection.identity.principal)) {
    assertDeviceReadable(core, threadId);
    assertDeviceFile(core, threadId, cwd, path);
  }
  return cwd;
}

export function registerWorkdirMethods(core: Core): void {
  core.router.register('files.list', async (params, ctx) => {
    const permit = core.sharedAccess.file(params.threadId, params.path || '.', 'read', true);
    const entries = await listDirectory(readCwd(core, params.threadId, ctx, params.path), params.path);
    permit?.check();
    return permit ? entries.filter(entry => {
      try { core.sharedAccess.file(params.threadId, `${params.path || '.'}/${entry.name}`, 'read', entry.kind === 'dir', true); return true; } catch { return false; }
    }) : entries;
  });
  core.router.register('files.read', (params, ctx) => {
    const permit = core.sharedAccess.file(params.threadId, params.path);
    return readFileContent(core, readCwd(core, params.threadId, ctx, params.path), params.path, permit);
  });
  // Owner only: a chat link the owner clicks, which may name a file in an ignored tree.
  core.router.register('files.locate', (params) => {
    core.sharedAccess.file(params.threadId, params.path);
    return locateFile(threadCwd(core, params.threadId), params.path);
  });
  // Owner only, absent from both permission maps: the agent already has its own
  // hands on the disk, and a paired phone has no business writing a file.
  core.router.register('files.write', (params) =>
    writeFileText(threadCwd(core, params.threadId), params.path, params.text),
  );
}
