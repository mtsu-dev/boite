import { watch, type FSWatcher } from 'node:fs';
import { sep } from 'node:path';

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
  let timer: ReturnType<typeof setTimeout> | undefined;
  let watcher: FSWatcher;
  function close() {
    watcher.close();
    clearTimeout(timer);
    changed.clear();
  }

  watcher = watch(folder, { recursive: true, persistent: false }, (_, path) => {
    if (!path) return;
    const parts = path.split(sep === '\\' ? /[/\\]/ : '/');
    if (parts.some(part => !part || part === '.' || part === '..' || IGNORED.has(part.toLowerCase()))) return;
    const relative = parts.join('/');
    if (patterns.length && !patterns.some((pattern, index) => relative === pattern || relative.startsWith(pattern + '/') || globs[index]!.match(relative))) return;
    if (changed.size < PATHS_PER_EVENT) changed.add(relative);
    timer ??= setTimeout(() => {
      timer = undefined;
      const paths = [...changed].sort();
      changed.clear();
      publish(paths);
    }, debounceMs);
    timer.unref();
  });
  watcher.on('error', error => {
    close();
    failed(error);
  });
  return close;
}
