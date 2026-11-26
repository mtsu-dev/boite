import { watch, type BigIntStats, type FSWatcher } from 'node:fs';
import { lstat, readdir, stat } from 'node:fs/promises';
import { basename, dirname, join, sep } from 'node:path';

const IGNORED = new Set(['.git', 'node_modules', '.boite', 'dist', 'target']);
const PATHS_PER_EVENT = 50;

type WatchCallbacks = {
  publish: (paths: string[]) => void;
  ready: () => void;
  failed: (error: unknown) => void;
};
type WatchedDirectory = { directory: string; watcher: FSWatcher };

type RootResult = { root: BigIntStats } | { error: unknown };
type RootReceivers = Set<(result: RootResult) => void>;
type RootRead = { waiting: RootReceivers; active?: RootReceivers; invalidated: boolean };

const rootKey = (folder: string) => process.platform === 'win32' ? folder.toLowerCase() : folder;

export class TriggerRootProbes {
  readonly #reads = new Map<string, RootRead>();

  probe(folder: string, signal: AbortSignal): Promise<BigIntStats> {
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
      try { result = { root: await stat(folder, { bigint: true }) }; }
      catch (error) { result = { error }; }
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
  { publish, ready, failed }: WatchCallbacks,
): { close: () => void; checkRoot: (validated?: () => void) => void } {
  const globs = patterns.map(pattern => new Bun.Glob(pattern));
  const changed = new Set<string>();
  const watches = new Map<string, FSWatcher>();
  const lookups = new Map<string, { parent?: WatchedDirectory }>();
  const rootName = rootKey(basename(folder));
  const parentFolder = dirname(folder);
  const parentName = rootKey(basename(parentFolder));
  const stop = new AbortController();
  const { signal } = stop;
  let parentWatch: FSWatcher | undefined;
  let refreshParent = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let root: BigIntStats | undefined;
  let checking = false;
  let due = false;

  function close() {
    stop.abort();
    parentWatch?.close();
    parentWatch = undefined;
    for (const watcher of watches.values()) watcher.close();
    watches.clear();
    lookups.clear();
    clearTimeout(timer);
    changed.clear();
  }

  async function assertRoot(expected: BigIntStats) {
    const current = await roots.probe(folder, signal);
    if (!current.isDirectory() || current.dev !== expected.dev || current.ino !== expected.ino) {
      throw new Error(`project root was replaced: ${folder}`);
    }
    if (refreshParent && !signal.aborted) {
      refreshParent = false;
      watchRootEntry();
    }
  }

  function checkRoot(validated?: () => void) {
    if (signal.aborted || checking || !root) return;
    checking = true;
    // A batch can only use a probe requested after its debounce elapsed.
    const paths = due ? [...changed].sort() : undefined;
    if (due) changed.clear();
    due = false;
    void assertRoot(root).then(() => {
      if (signal.aborted) return;
      if (paths) publish(paths);
      validated?.();
    }).catch(failure).finally(() => {
      checking = false;
      if (due) checkRoot();
    });
  }

  function record(relative: string) {
    if (patterns.length && !patterns.some((pattern, index) => relative === pattern || relative.startsWith(pattern + '/') || globs[index]!.match(relative))) return;
    if (changed.size < PATHS_PER_EVENT) changed.add(relative);
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
    return !name || name === '.' || name === '..' || name.includes('/') || (sep === '\\' && name.includes('\\')) || IGNORED.has(name.toLowerCase());
  }

  function removeTree(directory: string) {
    for (const [relative, watcher] of watches) {
      if (relative === directory || relative.startsWith(directory + '/')) {
        watches.delete(relative);
        watcher.close();
      }
    }
  }

  function missing(error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'ENOENT' || code === 'ENOTDIR';
  }

  async function scan(directory: string, reportNew: boolean, watcher: FSWatcher) {
    let entries;
    try { entries = await readdir(join(folder, directory), { withFileTypes: true }); }
    catch (error) {
      watchError(directory, watcher, error);
      return;
    }
    const parent = { directory, watcher };
    for (const entry of entries) {
      if (watches.get(directory) !== watcher) return;
      if (ignored(entry.name)) continue;
      const relative = childOf(directory, entry.name);
      if (entry.isDirectory() && lookups.get(relative)?.parent?.watcher !== watcher) await addTree(relative, reportNew, parent);
      else if (reportNew && entry.isFile()) record(relative);
    }
  }

  async function changedIn(directory: string, watcher: FSWatcher, event: string, name: string | null) {
    if (watches.get(directory) !== watcher) return;
    // A readable project can have an unwatchable parent. Be conservative there.
    if (!directory && !parentWatch && parentFolder !== folder
      && (name === null || (event === 'rename' && rootKey(name) === rootName))) {
      roots.invalidate(folder);
    }
    if (name === null) {
      await scan(directory, true, watcher);
      return;
    }
    if (ignored(name)) return;
    const relative = childOf(directory, name);
    if (event === 'rename') {
      if (watches.has(relative)) removeTree(relative);
      if (!await addTree(relative, true, { directory, watcher })) return;
    }
    if (watches.get(directory) === watcher) record(relative);
  }

  function failure(error: unknown) {
    if (signal.aborted) return;
    close();
    failed(error);
  }

  async function addTree(directory: string, reportNew: boolean, parent?: WatchedDirectory): Promise<boolean> {
    const parentIsCurrent = () => !signal.aborted && (!parent || watches.get(parent.directory) === parent.watcher);
    if (!parentIsCurrent() || watches.has(directory)) return false;
    // Each rename supersedes the lookup for that path, even when it finds a file.
    const lookup = { parent };
    lookups.set(directory, lookup);
    const isCurrent = () => lookups.get(directory) === lookup && parentIsCurrent();
    let watcher: FSWatcher;
    try {
      const path = join(folder, directory);
      if (directory && !(await lstat(path)).isDirectory()) return isCurrent();
      if (!isCurrent()) return false;
      watcher = watch(path, { persistent: false }, (event, name) => {
        void changedIn(directory, watcher, event, name).catch(error => watchError(directory, watcher, error));
      });
    } catch (error) {
      if (!isCurrent()) return false;
      if (directory && missing(error)) return true;
      failure(error);
      return false;
    } finally {
      if (lookups.get(directory) === lookup) lookups.delete(directory);
    }
    watches.set(directory, watcher);
    watcher.on('error', error => watchError(directory, watcher, error));
    await scan(directory, reportNew, watcher);
    return watches.get(directory) === watcher;
  }

  function watchError(directory: string, watcher: FSWatcher, error: unknown) {
    if (watches.get(directory) !== watcher) return;
    if (directory && missing(error)) removeTree(directory);
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
    if (!initial.isDirectory()) throw new Error(`project root is not a directory: ${folder}`);
    watchRootEntry();
    // Non-recursive watches let ignored directories stay outside the OS watcher tree.
    await addTree('', false);
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
