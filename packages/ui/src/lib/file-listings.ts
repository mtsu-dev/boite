import { FILES_LIST_MAX, type FileEntry } from '@boite/contracts';
import type { FileAnswer, Store } from './store.svelte';

/** A small working set of directories, shared only by tabs on the same machine connection. */
const MAX_DIRECTORIES = 32;
const MAX_ENTRIES = 4 * FILES_LIST_MAX;
type Listing = FileAnswer<FileEntry[]>;
type PendingListing = { answer: Promise<Listing>; blocked?: Extract<Listing, { ok: false }> };

class FileListings {
  readonly #entries = new Map<string, FileEntry[]>();
  readonly #pending = new Map<string, PendingListing>();
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

  read(threadId: string, cwd: string, path: string): Promise<Listing> {
    const key = JSON.stringify([threadId, cwd, path]);
    const held = this.#pending.get(key);
    if (held) return held.answer;
    const pending: PendingListing = { answer: this.store.listFiles(threadId, path || undefined).then(answer => {
      if (pending.blocked) return pending.blocked;
      if (answer.ok) {
        this.#drop(key);
        this.#entries.set(key, answer.value);
        this.#total += answer.value.length;
        while (this.#total > MAX_ENTRIES || this.#entries.size > MAX_DIRECTORIES) this.#drop(this.#entries.keys().next().value!);
      } else if (answer.inaccessible) {
        const blocked = (name: string) => {
          const [owner, directory, relative] = JSON.parse(name) as [string, string, string];
          return owner === threadId && directory === cwd && atOrUnder(relative, path);
        };
        for (const name of this.#entries.keys()) if (blocked(name)) this.#drop(name);
        for (const [name, request] of this.#pending) if (blocked(name)) request.blocked = answer;
      }
      return answer;
    }).finally(() => this.#pending.delete(key)) };
    this.#pending.set(key, pending);
    return pending.answer;
  }

  #drop(key: string): void {
    this.#total -= this.#entries.get(key)?.length ?? 0;
    this.#entries.delete(key);
  }
}

export function atOrUnder(path: string, root: string): boolean {
  return root === '' || path === root || path.startsWith(root + '/');
}

const stores = new WeakMap<Store, { generation: number; listings: FileListings }>();

export function fileListings(store: Store): FileListings {
  const generation = store.clientGeneration;
  let held = stores.get(store);
  if (!held || held.generation !== generation) stores.set(store, held = { generation, listings: new FileListings(store) });
  return held.listings;
}
