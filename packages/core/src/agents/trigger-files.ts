import { lstatSync, readdirSync, watch, type FSWatcher } from 'node:fs';
import { join, sep } from 'node:path';

const IGNORED = new Set(['.git', 'node_modules', '.boite', 'dist', 'target']);
const PATHS_PER_EVENT = 50;

export function watchTriggerFiles(
  folder: string,
  patterns: string[],
  debounceMs: number,
  publish: (paths: string[]) => void,
  failed: (error: Error) => void,
): () => void {
  const globs = patterns.map(pattern => new Bun.Glob(pattern));
  const changed = new Set<string>();
  const watches = new Map<string, FSWatcher>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  function close() {
    closed = true;
    for (const watcher of watches.values()) watcher.close();
    watches.clear();
    clearTimeout(timer);
    changed.clear();
  }

  function record(relative: string) {
    if (patterns.length && !patterns.some((pattern, index) => relative === pattern || relative.startsWith(pattern + '/') || globs[index]!.match(relative))) return;
    if (changed.size < PATHS_PER_EVENT) changed.add(relative);
    timer ??= setTimeout(() => {
      timer = undefined;
      const paths = [...changed].sort();
      changed.clear();
      publish(paths);
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

  function isDirectory(relative: string) {
    return lstatSync(join(folder, relative), { throwIfNoEntry: false })?.isDirectory() ?? false;
  }

  function scan(directory: string, reportNew: boolean) {
    for (const entry of readdirSync(join(folder, directory), { withFileTypes: true })) {
      if (ignored(entry.name)) continue;
      const relative = childOf(directory, entry.name);
      if (entry.isDirectory()) addTree(relative, reportNew);
      else if (reportNew && entry.isFile()) record(relative);
    }
  }

  function changedIn(directory: string, event: string, name: string | null) {
    if (closed) return;
    if (name === null) {
      if (isDirectory(directory)) scan(directory, true);
      return;
    }
    if (ignored(name)) return;
    const relative = childOf(directory, name);
    if (event === 'rename') {
      if (watches.has(relative)) removeTree(relative);
      if (isDirectory(relative)) addTree(relative, true);
    }
    record(relative);
  }

  function failure(error: Error) {
    close();
    failed(error);
  }

  function addTree(directory: string, reportNew: boolean) {
    if (watches.has(directory) || (directory && !isDirectory(directory))) return;
    try {
      const watcher = watch(join(folder, directory), { persistent: false }, (event, name) => {
        try { changedIn(directory, event, name); }
        catch (error) { failure(error as Error); }
      });
      watches.set(directory, watcher);
      watcher.on('error', error => {
        if (closed || watches.get(directory) !== watcher) return;
        try {
          if (directory && !isDirectory(directory)) removeTree(directory);
          else failure(error);
        } catch (statError) { failure(statError as Error); }
      });
      scan(directory, reportNew);
    } catch (error) {
      if (directory && (error as NodeJS.ErrnoException).code === 'ENOENT') removeTree(directory);
      else throw error;
    }
  }

  // Non-recursive watches let ignored directories stay outside the OS watcher tree.
  try { addTree('', false); }
  catch (error) { close(); throw error; }
  return close;
}
