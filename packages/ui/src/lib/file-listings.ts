import { FILES_LIST_MAX, type FileEntry } from '@boite/contracts';
import type { FileAnswer, Store } from './store.svelte';

/** A small working set of directories, shared only by tabs on the same machine connection. */
const MAX_DIRECTORIES = 32;
const MAX_ENTRIES = 4 * FILES_LIST_MAX;

class FileListings {
  readonly #entries = new Map<string, FileEntry[]>();
  readonly #pending = new Map<string, Promise<FileAnswer<FileEntry[]>>>();
  #total = 0;

  constructor(private readonly store: Store) {}

  peek(threadId: string, cwd: string, path: string): FileEntry[] | undefined {
    const key = JSON.stringify([threadId, cwd, path]);
    const files = this.#entries.get(key);
    if (files) {
      this.#entries.delete(key);
      this.#entries.set(key, files);
    }
    return files;
  }

  read(threadId: string, cwd: string, path: string): Promise<FileAnswer<FileEntry[]>> {
    const key = JSON.stringify([threadId, cwd, path]);
    const held = this.#pending.get(key);
    if (held) return held;
    const pending = this.store.listFiles(threadId, path || undefined).then(answer => {
      if (answer.ok) {
        this.#drop(key);
        this.#entries.set(key, answer.value);
        this.#total += answer.value.length;
        while (this.#total > MAX_ENTRIES || this.#entries.size > MAX_DIRECTORIES) this.#drop(this.#entries.keys().next().value!);
      }
      return answer;
    }).finally(() => this.#pending.delete(key));
    this.#pending.set(key, pending);
    return pending;
  }

  #drop(key: string): void {
    this.#total -= this.#entries.get(key)?.length ?? 0;
    this.#entries.delete(key);
  }
}

const stores = new WeakMap<Store, { generation: number; listings: FileListings }>();

export function fileListings(store: Store): FileListings {
  const generation = store.clientGeneration;
  let held = stores.get(store);
  if (!held || held.generation !== generation) stores.set(store, held = { generation, listings: new FileListings(store) });
  return held.listings;
}
