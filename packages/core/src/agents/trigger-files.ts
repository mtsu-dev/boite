import { constants, watch, type BigIntStats, type FSWatcher } from 'node:fs';
import { lstat, open as openFile, readdir, realpath, stat } from 'node:fs/promises';
import { basename, dirname, join, sep } from 'node:path';
import { ignoredNames } from '../files.ts';

const ALWAYS_IGNORED = new Set(['.git', 'node_modules', '.boite']);
const DEFAULT_IGNORED = new Set([...ALWAYS_IGNORED, 'dist', 'target', '.venv', 'venv', '__pycache__', '.next', '.nuxt', 'build', 'coverage']);
const GITIGNORE_MAX_BYTES = 64 * 1024;
export const PATHS_PER_EVENT = 50;
export const MAX_WATCH_DIRS = 512;

export class WatchLimitError extends Error {}

type WatchCallbacks = {
  publish: (paths: string[], more: number) => void;
  ready: () => void;
  failed: (error: unknown) => void;
  suppressed?: () => boolean;
};
type RootAnchor = {
  realPath?: string;
  allowInitialLink?: boolean;
  onAnchor?: (realPath: string) => void;
};
type WatchedDirectory = { directory: string; watcher: FSWatcher };
type RootSample = { stats: BigIntStats; realPath: string; isLink: boolean };

type RootResult = { root: RootSample } | { error: unknown };
type RootReceivers = Set<(result: RootResult) => void>;
type RootRead = { waiting: RootReceivers; active?: RootReceivers; invalidated: boolean };

const rootKey = (folder: string) => process.platform === 'win32' ? folder.toLowerCase() : folder;

async function readGitignore(root: string): Promise<string> {
  const path = join(root, '.gitignore');
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isFile()) return '';
  const handle = await openFile(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const opened = await handle.stat();
    if (!opened.isFile()) return '';
    const buf = Buffer.allocUnsafe(Math.min(Math.max(opened.size, 0), GITIGNORE_MAX_BYTES));
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
    return buf.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}

export class TriggerRootProbes {
  readonly #reads = new Map<string, RootRead>();

  probe(folder: string, signal: AbortSignal): Promise<RootSample> {
    if (signal.aborted) return Promise.reject(signal.reason);
    const key = rootKey(folder);
    let read = this.#reads.get(key);
    if (!read) {
      const started: RootRead = { waiting: new Set(), invalidated: false };
      this.#reads.set(key, started);
      queueMicrotask(() => { void this.#run(folder, key, started); });
      read = started;
    }
    const pending = read;
    return new Promise((resolve, reject) => {
      const cancel = () => {
        pending.waiting.delete(receive);
        pending.active?.delete(receive);
        reject(signal.reason);
      };
      const receive = (result: RootResult) => {
        signal.removeEventListener('abort', cancel);
        if ('root' in result) resolve(result.root);
        else reject(result.error);
      };
      pending.waiting.add(receive);
      signal.addEventListener('abort', cancel, { once: true });
    });
  }

  invalidate(folder: string): void {
    const read = this.#reads.get(rootKey(folder));
    if (read?.active) read.invalidated = true;
  }

  async #run(folder: string, key: string, read: RootRead): Promise<void> {
    while (read.waiting.size) {
      // A request made during the read needs a newer sample.
      const active = read.waiting;
      read.active = active;
      read.waiting = new Set();
      read.invalidated = false;
      let result: RootResult;
      try {
        const link = await lstat(folder, { bigint: true });
        const realPath = await realpath(folder);
        const stats = link.isSymbolicLink() ? await stat(realPath, { bigint: true }) : link;
        result = { root: { stats, realPath, isLink: link.isSymbolicLink() } };
      } catch (error) { result = { error }; }
      // A root rename observed during the read may postdate the sample.
      if (read.invalidated) {
        for (const receive of active) read.waiting.add(receive);
      } else {
        for (const receive of active) receive(result);
      }
      read.active = undefined;
    }
    this.#reads.delete(key);
  }
}

export function watchTriggerFiles(
  folder: string,
  patterns: string[],
  debounceMs: number,
  roots: TriggerRootProbes,
  { publish, ready, failed, suppressed }: WatchCallbacks,
  maxWatchDirs = MAX_WATCH_DIRS,
  anchor?: RootAnchor,
): { close: () => void; checkRoot: (validated?: () => void) => void } {
  const globs = patterns.map(pattern => new Bun.Glob(pattern));
  const patternParts = patterns.map(pattern => pattern.split('/'));
  const explicitSegments = new Set(
    patternParts.flat().filter(part => !/[*?[\]{}]/.test(part)).map(part => part.toLowerCase()),
  );
  let ignoredSet = new Set([...DEFAULT_IGNORED].filter(name => ALWAYS_IGNORED.has(name) || !explicitSegments.has(name)));
  const changed = new Set<string>();
  const watches = new Map<string, { watcher: FSWatcher; dev: bigint; ino: bigint }>();
  const lookups = new Map<string, { parent?: WatchedDirectory }>();
  const rootName = rootKey(basename(folder));
  const parentFolder = dirname(folder);
  const parentName = rootKey(basename(parentFolder));
  const stop = new AbortController();
  const { signal } = stop;
  let parentWatch: FSWatcher | undefined;
  let refreshParent = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let root: RootSample | undefined;
  let checking = false;
  let due = false;
  let overflow = 0;
  const pendingValidated = new Set<() => void>();

  function close() {
    stop.abort();
    parentWatch?.close();
    parentWatch = undefined;
    for (const entry of watches.values()) entry.watcher.close();
    watches.clear();
    lookups.clear();
    clearTimeout(timer);
    timer = undefined;
    changed.clear();
    pendingValidated.clear();
    overflow = 0;
    due = false;
  }

  async function assertRoot(expected: RootSample) {
    const current = await roots.probe(folder, signal);
    if (!current.stats.isDirectory()
      || rootKey(current.realPath) !== rootKey(expected.realPath)
      || current.stats.dev !== expected.stats.dev
      || current.stats.ino !== expected.stats.ino) {
      throw new Error(`project root was replaced: ${folder}`);
    }
    if (refreshParent && !signal.aborted) {
      refreshParent = false;
      watchRootEntry();
    }
  }

  function checkRoot(validated?: () => void) {
    if (signal.aborted || !root) return;
    if (validated) pendingValidated.add(validated);
    if (checking) return;
    checking = true;
    // A batch can only use a probe requested after its debounce elapsed.
    const paths = due ? [...changed].sort() : undefined;
    const more = due ? overflow : 0;
    if (due) { changed.clear(); overflow = 0; }
    due = false;
    const callbacks = [...pendingValidated];
    pendingValidated.clear();
    void assertRoot(root).then(() => {
      if (signal.aborted) return;
      if (paths) publish(paths, more);
      for (const callback of callbacks) callback();
    }).catch(failure).finally(() => {
      checking = false;
      if (due || pendingValidated.size > 0) checkRoot();
    });
  }

  function record(relative: string) {
    if (suppressed?.()) return;
    if (patterns.length && !patterns.some((pattern, index) => relative === pattern || relative.startsWith(pattern + '/') || globs[index]!.match(relative))) return;
    if (!changed.has(relative)) {
      if (changed.size < PATHS_PER_EVENT) changed.add(relative);
      else overflow++;
    }
    if (due) return;
    timer ??= setTimeout(() => {
      timer = undefined;
      due = true;
      checkRoot();
    }, debounceMs);
    timer.unref();
  }

  const childOf = (directory: string, name: string) => directory ? directory + '/' + name : name;
  function ignored(name: string) {
    return !name || name === '.' || name === '..' || name.includes('/') || (sep === '\\' && name.includes('\\')) || ignoredSet.has(name.toLowerCase());
  }

  function mayMatch(directory: string): boolean {
    if (!patternParts.length || !directory) return true;
    const parts = directory.split('/');
    return patternParts.some(pParts => {
      for (let i = 0; i < parts.length; i++) {
        if (i >= pParts.length) return true;
        const segment = pParts[i]!;
        if (segment.includes('**') || segment.includes('{') || segment.includes('}')) return true;
        if (/[*?[\]]/.test(segment)) {
          try { if (!new Bun.Glob(segment).match(parts[i]!)) return false; }
          catch { return true; }
        } else if (segment !== parts[i]) return false;
      }
      return true;
    });
  }

  function removeTree(directory: string) {
    for (const [relative, entry] of watches) {
      if (relative === directory || relative.startsWith(directory + '/')) {
        watches.delete(relative);
        entry.watcher.close();
      }
    }
  }

  function skippable(error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'ENOENT' || code === 'ENOTDIR' || code === 'EACCES' || code === 'EPERM' || code === 'ELOOP';
  }

  async function scan(directory: string, reportNew: boolean, watcher: FSWatcher, recheckExisting = false) {
    const prefix = directory ? directory + '/' : '';
    const existingChildren = recheckExisting ? new Map<string, { watcher: FSWatcher; dev: bigint; ino: bigint }>() : undefined;
    if (existingChildren) {
      for (const [watched, entry] of watches) {
        if (watched && watched !== directory && watched.startsWith(prefix) && !watched.slice(prefix.length).includes('/')) {
          existingChildren.set(watched, entry);
        }
      }
    }
    let entries;
    try { entries = await readdir(join(folder, directory), { withFileTypes: true }); }
    catch (error) {
      watchError(directory, watcher, error);
      return;
    }
    const parent = { directory, watcher };
    const seenDirs = recheckExisting ? new Set<string>() : undefined;
    for (const entry of entries) {
      if (watches.get(directory)?.watcher !== watcher) return;
      if (ignored(entry.name)) continue;
      const relative = childOf(directory, entry.name);
      if (entry.isDirectory()) {
        if (!mayMatch(relative)) continue;
        seenDirs?.add(relative);
        const existing = watches.get(relative);
        if (existing) {
          if (!recheckExisting) continue;
          try {
            const current = await lstat(join(folder, relative), { bigint: true });
            if (watches.get(directory)?.watcher !== watcher || watches.get(relative) !== existing) continue;
            if (!current.isDirectory()) { removeTree(relative); continue; }
            if (current.dev === existing.dev && current.ino === existing.ino) continue;
            removeTree(relative);
          } catch (error) {
            if (skippable(error)) { if (watches.get(relative) === existing) removeTree(relative); continue; }
            watchError(directory, watcher, error);
            return;
          }
        }
        if (lookups.get(relative)?.parent?.watcher !== watcher) await addTree(relative, reportNew, parent);
      } else if (reportNew && entry.isFile()) record(relative);
    }
    if (seenDirs && existingChildren && watches.get(directory)?.watcher === watcher) {
      for (const [watched, entry] of existingChildren) {
        if (!seenDirs.has(watched) && watches.get(watched) === entry) removeTree(watched);
      }
    }
  }

  async function changedIn(directory: string, watcher: FSWatcher, event: string, name: string | null) {
    if (watches.get(directory)?.watcher !== watcher) return;
    const wasSuppressed = suppressed?.() ?? false;
    // A readable project can have an unwatchable parent. Be conservative there.
    if (!directory && !parentWatch && parentFolder !== folder
      && (name === null || (event === 'rename' && rootKey(name) === rootName))) {
      roots.invalidate(folder);
    }
    if (name === null) {
      await scan(directory, !wasSuppressed, watcher, true);
      return;
    }
    if (ignored(name)) return;
    const relative = childOf(directory, name);
    let wasWatched = false;
    if (event === 'rename') {
      wasWatched = watches.has(relative);
      if (wasWatched) removeTree(relative);
      if (mayMatch(relative) && !await addTree(relative, !wasSuppressed, { directory, watcher })) return;
    }
    if (!wasSuppressed && watches.get(directory)?.watcher === watcher && !wasWatched && !watches.has(relative)) record(relative);
  }

  function failure(error: unknown) {
    if (signal.aborted) return;
    close();
    failed(error);
  }

  async function addTree(directory: string, reportNew: boolean, parent?: WatchedDirectory, rootStats?: BigIntStats): Promise<boolean> {
    const parentIsCurrent = () => !signal.aborted && (!parent || watches.get(parent.directory)?.watcher === parent.watcher);
    if (!parentIsCurrent() || watches.has(directory)) return false;
    // Each rename supersedes the lookup for that path, even when it finds a file.
    const lookup = { parent };
    lookups.set(directory, lookup);
    const isCurrent = () => lookups.get(directory) === lookup && parentIsCurrent();
    let watcher: FSWatcher;
    let stats: BigIntStats | undefined = rootStats;
    try {
      const path = join(folder, directory);
      if (directory) {
        stats = await lstat(path, { bigint: true });
        if (!stats.isDirectory()) return isCurrent();
      }
      if (!isCurrent()) return false;
      if (watches.size >= maxWatchDirs) {
        failure(new WatchLimitError(`project has more than ${maxWatchDirs} watchable directories; narrow the trigger patterns`));
        return false;
      }
      watcher = watch(path, { persistent: false }, (event, name) => {
        void changedIn(directory, watcher, event, name).catch(error => watchError(directory, watcher, error));
      });
    } catch (error) {
      if (!isCurrent()) return false;
      if (directory && skippable(error)) return true;
      failure(error);
      return false;
    } finally {
      if (lookups.get(directory) === lookup) lookups.delete(directory);
    }
    watches.set(directory, { watcher, dev: stats?.dev ?? 0n, ino: stats?.ino ?? 0n });
    watcher.on('error', error => watchError(directory, watcher, error));
    await scan(directory, reportNew, watcher);
    return watches.get(directory)?.watcher === watcher;
  }

  function watchError(directory: string, watcher: FSWatcher, error: unknown) {
    if (watches.get(directory)?.watcher !== watcher) return;
    if (directory && skippable(error)) removeTree(directory);
    else failure(error);
  }

  function retireParent(watcher: FSWatcher) {
    if (parentWatch !== watcher) return;
    parentWatch = undefined;
    roots.invalidate(folder);
    watcher.close();
  }

  function watchRootEntry() {
    if (parentFolder === folder) return;
    let watcher: FSWatcher;
    try {
      // Parent notifications refer to the project's directory entry, separately from its contents.
      watcher = watch(parentFolder, { persistent: false, recursive: false }, (event, name) => {
        if (parentWatch !== watcher || event !== 'rename') return;
        // The project's inode can survive a move to a different parent directory.
        if (name === null || rootKey(name) === parentName) {
          refreshParent = true;
          retireParent(watcher);
        } else if (rootKey(name) === rootName) roots.invalidate(folder);
      });
    } catch {
      return;
    }
    parentWatch = watcher;
    watcher.on('error', () => retireParent(watcher));
  }

  async function open() {
    const initial = await roots.probe(folder, signal);
    if (signal.aborted) return;
    if (!initial.stats.isDirectory()) throw new Error(`project root is not a directory: ${folder}`);
    if (anchor?.realPath !== undefined) {
      if (rootKey(initial.realPath) !== rootKey(anchor.realPath)) {
        throw new Error(`project root escaped granted path: ${folder}`);
      }
    } else {
      if (initial.isLink && !anchor?.allowInitialLink) {
        throw new Error(`project root is a symbolic link: ${folder}`);
      }
      anchor?.onAnchor?.(initial.realPath);
    }
    try {
      const extra = ignoredNames(await readGitignore(initial.realPath));
      if (extra.size > 0) {
        const merged = new Set(ignoredSet);
        for (const name of extra) {
          const lower = name.toLowerCase();
          if (ALWAYS_IGNORED.has(lower) || !explicitSegments.has(lower)) merged.add(lower);
        }
        ignoredSet = merged;
      }
    } catch {
      // No readable .gitignore: default ignored names still apply.
    }
    if (signal.aborted) return;
    watchRootEntry();
    // Non-recursive watches let ignored directories stay outside the OS watcher tree.
    await addTree('', false, undefined, initial.stats);
    if (signal.aborted) return;
    await assertRoot(initial);
    if (signal.aborted) return;
    root = initial;
    ready();
    if (due) checkRoot();
  }

  void open().catch(failure);

  return { close, checkRoot };
}
