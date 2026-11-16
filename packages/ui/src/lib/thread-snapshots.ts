/*
 * The recent threads of each machine, kept on this device so that a thread
 * opened after a reload paints at once from its last page and then catches up
 * with the `after` cursor, like a visit the reading cache still holds.
 *
 * Bounds: `SNAPSHOT_THREADS` threads per machine, `SNAPSHOT_BYTES` per thread
 * and `SNAPSHOT_TOTAL` in all; the least recently opened goes first. Each
 * record is encrypted with AES-GCM under a key made once per machine,
 * non-extractable, and kept in IndexedDB as a CryptoKey that is never
 * exported; every record has its own random 96-bit IV, and the machine and
 * thread ids as additional data, so a record moved to another slot does not
 * decrypt. A record that does not decrypt or parse is dropped.
 *
 * Never kept: an incognito thread, a thread whose page holds a secret card
 * (pending or not: the card is the only thing that names a secret), and any
 * thread of a connection that is not this owner's (a contact never reaches a
 * Store, and only `owner` and `session` connections write here).
 *
 * A browser without IndexedDB or `crypto.subtle` skips all of it.
 */

import type { MessageId, Thread } from '@boite/contracts';

export const SNAPSHOT_THREADS = 8;
export const SNAPSHOT_BYTES = 512 * 1024;
export const SNAPSHOT_TOTAL = 4 * 1024 * 1024;
/** How long a page must stay settled before it is written, and the longest an open waits for a snapshot read. */
export const SNAPSHOT_WRITE_DELAY_MS = 1000;
export const SNAPSHOT_READ_WAIT_MS = 250;

/**
 * One machine's key, with a random id a write checks against the stored one
 * (a `CryptoKey` read back from IndexedDB is a new object each time), and the
 * addresses this device reached it at, for a purge by address.
 */
export interface SnapshotMachine { machine: string; id: string; key: CryptoKey; urls: string[] }
/** What can be listed without decrypting: which thread, how big, when last written. */
export interface SnapshotMeta { machine: string; threadId: string; bytes: number; openedAt: number }
export interface SnapshotData { iv: Uint8Array; data: ArrayBuffer }

/** The storage the snapshots sit in: IndexedDB in the app, a Map in tests. */
export interface SnapshotDb {
  machine(machine: string): Promise<SnapshotMachine | undefined>;
  machines(): Promise<SnapshotMachine[]>;
  /**
   * Keeps `entry` unless the machine has one already, in one step no other
   * window can come between: answers the entry kept, so two windows making a
   * machine's first key at once both use the one that won.
   */
  addMachine(entry: SnapshotMachine): Promise<SnapshotMachine>;
  /** Adds `url` to the machine's addresses, in one step, only while the machine has a key. */
  noteUrl(machine: string, url: string): Promise<void>;
  metas(): Promise<SnapshotMeta[]>;
  data(machine: string, threadId: string): Promise<SnapshotData | undefined>;
  /**
   * Stores the record only while the machine's stored key is the one with id
   * `keyId`, checked in the same step as the write: a key purged or replaced
   * by another window since drops it. Answers whether it was stored.
   */
  put(meta: SnapshotMeta, data: SnapshotData, keyId: string): Promise<boolean>;
  delete(machine: string, threadId: string): Promise<void>;
  /** The machine's key and every record of it. */
  deleteMachine(machine: string): Promise<void>;
  clear(): Promise<void>;
}

/** What a snapshot gives back: the page and the cursor the catch-up asks from. */
export interface ThreadSnapshot { thread: Thread; after: MessageId | null }

const recordKey = (machine: string, threadId: string) => JSON.stringify([machine, threadId]);

/** A Map behind the same interface; what tests and a page without IndexedDB would use. */
export class MemorySnapshotDb implements SnapshotDb {
  readonly keys = new Map<string, SnapshotMachine>();
  readonly meta = new Map<string, SnapshotMeta>();
  readonly records = new Map<string, SnapshotData>();
  async machine(machine: string) { return this.keys.get(machine); }
  async machines() { return [...this.keys.values()]; }
  async addMachine(entry: SnapshotMachine) {
    const held = this.keys.get(entry.machine);
    if (held) return held;
    this.keys.set(entry.machine, entry);
    return entry;
  }
  async noteUrl(machine: string, url: string) {
    const entry = this.keys.get(machine);
    if (entry && !entry.urls.includes(url)) this.keys.set(machine, { ...entry, urls: [...entry.urls, url] });
  }
  async metas() { return [...this.meta.values()]; }
  async data(machine: string, threadId: string) { return this.records.get(recordKey(machine, threadId)); }
  async put(meta: SnapshotMeta, data: SnapshotData, keyId: string) {
    if (this.keys.get(meta.machine)?.id !== keyId) return false;
    const key = recordKey(meta.machine, meta.threadId);
    this.meta.set(key, meta);
    this.records.set(key, data);
    return true;
  }
  async delete(machine: string, threadId: string) {
    const key = recordKey(machine, threadId);
    this.meta.delete(key);
    this.records.delete(key);
  }
  async deleteMachine(machine: string) {
    this.keys.delete(machine);
    for (const [key, meta] of this.meta) if (meta.machine === machine) { this.meta.delete(key); this.records.delete(key); }
  }
  async clear() { this.keys.clear(); this.meta.clear(); this.records.clear(); }
}

const DATABASE = 'boite-thread-snapshots-v1';
type StoreName = 'machines' | 'meta' | 'data';

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function committed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new DOMException('Snapshot write aborted', 'AbortError'));
  });
}

/** IndexedDB: machines by id, metadata and encrypted data by `[machine, threadId]`. */
export class IndexedSnapshotDb implements SnapshotDb {
  #db: Promise<IDBDatabase> | null = null;

  #open(): Promise<IDBDatabase> {
    return this.#db ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('machines', { keyPath: 'machine' });
        db.createObjectStore('meta', { keyPath: ['machine', 'threadId'] });
        db.createObjectStore('data');
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); this.#db = null; };
        db.onclose = () => { this.#db = null; };
        resolve(db);
      };
      request.onerror = () => { this.#db = null; reject(request.error); };
      request.onblocked = () => { this.#db = null; reject(new Error('Thread snapshots are blocked by another page')); };
    });
  }

  async #read<T>(store: StoreName, ask: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.#open();
    return done(ask(db.transaction(store, 'readonly').objectStore(store)));
  }

  async #write(stores: StoreName[], change: (transaction: IDBTransaction) => void): Promise<void> {
    const db = await this.#open();
    const transaction = db.transaction(stores, 'readwrite');
    const finished = committed(transaction);
    change(transaction);
    await finished;
  }

  machine(machine: string) { return this.#read<SnapshotMachine | undefined>('machines', store => store.get(machine)); }
  machines() { return this.#read<SnapshotMachine[]>('machines', store => store.getAll()); }
  async addMachine(entry: SnapshotMachine) {
    let kept: SnapshotMachine | undefined;
    await this.#write(['machines'], t => {
      const store = t.objectStore('machines');
      const reread = () => { store.get(entry.machine).onsuccess = (event) => { kept = (event.target as IDBRequest<SnapshotMachine | undefined>).result; }; };
      store.get(entry.machine).onsuccess = (event) => {
        kept = (event.target as IDBRequest<SnapshotMachine | undefined>).result;
        if (kept) return;
        // add, never put: should another window's key be there by now, it stays, and is the one read back.
        const adding = store.add(entry);
        adding.onsuccess = () => { kept = entry; };
        adding.onerror = (event) => {
          if (adding.error?.name !== 'ConstraintError') return;
          event.preventDefault();
          event.stopPropagation();
          reread();
        };
      };
    });
    if (!kept) throw new Error(`Thread snapshots: no key kept for machine ${entry.machine}`);
    return kept;
  }
  noteUrl(machine: string, url: string) {
    return this.#write(['machines'], t => {
      const store = t.objectStore('machines');
      const reading = store.get(machine) as IDBRequest<SnapshotMachine | undefined>;
      reading.onsuccess = () => {
        const entry = reading.result;
        if (entry && !entry.urls.includes(url)) store.put({ ...entry, urls: [...entry.urls, url] });
      };
    });
  }
  metas() { return this.#read<SnapshotMeta[]>('meta', store => store.getAll()); }
  data(machine: string, threadId: string) { return this.#read<SnapshotData | undefined>('data', store => store.get([machine, threadId])); }
  async put(meta: SnapshotMeta, data: SnapshotData, keyId: string) {
    let stored = false;
    // One transaction over the key and the record: no other window's purge or new key comes between the check and the write.
    await this.#write(['machines', 'meta', 'data'], t => {
      const reading = t.objectStore('machines').get(meta.machine) as IDBRequest<SnapshotMachine | undefined>;
      reading.onsuccess = () => {
        if (reading.result?.id !== keyId) return;
        t.objectStore('meta').put(meta);
        t.objectStore('data').put(data, [meta.machine, meta.threadId]);
        stored = true;
      };
    });
    return stored;
  }
  delete(machine: string, threadId: string) {
    return this.#write(['meta', 'data'], t => {
      t.objectStore('meta').delete([machine, threadId]);
      t.objectStore('data').delete([machine, threadId]);
    });
  }
  async deleteMachine(machine: string) {
    const range = IDBKeyRange.bound([machine], [machine, []]);
    await this.#write(['machines', 'meta', 'data'], t => {
      t.objectStore('machines').delete(machine);
      t.objectStore('meta').delete(range);
      t.objectStore('data').delete(range);
    });
  }
  clear() {
    return this.#write(['machines', 'meta', 'data'], t => {
      for (const store of ['machines', 'meta', 'data'] as const) t.objectStore(store).clear();
    });
  }
}

/** Why a thread is never written: incognito, or its page holds a secret card. */
export function snapshotAllowed(thread: Pick<Thread, 'incognito' | 'messages'>): boolean {
  if (thread.incognito) return false;
  return !thread.messages.some(message => message.parts.some(part => part.type === 'secret_request'));
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Bytes for WebCrypto, typed as the plain ArrayBuffer view it takes. */
const bytes = (text: string) => encoder.encode(text) as Uint8Array<ArrayBuffer>;

export interface SnapshotOptions {
  db: SnapshotDb;
  subtle: SubtleCrypto;
  now?: () => number;
  /** Where this page tells its other windows of a purge, and hears theirs; none by default. */
  channel?: BroadcastChannel | null;
}

/** A write's point of departure (`ThreadSnapshots.mark`). */
export interface SnapshotMark {
  /** The purge count when it was asked. */
  count: number;
  /** The id of the machine's key then, null when it had none: only then may the write make one. */
  key: Promise<string | null>;
}

/** What a purge tells the other windows. */
interface PurgeNotice { machines?: string[]; urls?: string[]; all?: boolean }

/** A key this page holds, and the addresses it knows the machine's entry has. */
interface HeldKey { id: string; key: CryptoKey; urls: Set<string> }

const CHANNEL = 'boite-thread-snapshots-v1';

/**
 * The snapshots of every machine on this device. Every method answers rather
 * than throws: a storage or crypto failure only means a thread loads cold.
 */
export class ThreadSnapshots {
  readonly #db: SnapshotDb;
  readonly #subtle: SubtleCrypto;
  readonly #now: () => number;
  /** Which threads have a record, read once; until then every thread may. */
  #index: Promise<Map<string, Set<string>>> | null = null;
  #known: Map<string, Set<string>> | null = null;
  /** Writes and deletes run one after the other, so eviction counts what is there. */
  #queue: Promise<unknown> = Promise.resolve();
  readonly #keys = new Map<string, Promise<HeldKey>>();
  readonly #channel: BroadcastChannel | null;
  /**
   * Counts the purges this page asked or heard of from another window. A
   * write asked at an earlier count than the last purge of its machine, its
   * address or everything is not kept: a debounced write must not bring back
   * what a removal or revocation purged. Across windows, the key check in
   * `SnapshotDb.put` holds even when the notice is late or missing.
   */
  #purges = 0;
  readonly #purgedMachines = new Map<string, number>();
  readonly #purgedUrls = new Map<string, number>();
  #purgedAll = 0;

  constructor(options: SnapshotOptions) {
    this.#db = options.db;
    this.#subtle = options.subtle;
    this.#now = options.now ?? Date.now;
    this.#channel = options.channel ?? null;
    this.#channel?.addEventListener('message', (event: MessageEvent<PurgeNotice>) => {
      const notice = event.data;
      if (!notice || typeof notice !== 'object') return;
      const strings = (list: unknown) => Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string') : [];
      this.#purged({ machines: strings(notice.machines), urls: strings(notice.urls), all: notice.all === true });
    });
  }

  /** Stops hearing other windows. */
  close(): void { this.#channel?.close(); }

  /** Counts a purge here, and forgets what this page held of it. */
  #purged({ machines = [], urls = [], all = false }: PurgeNotice, mark = ++this.#purges): number {
    if (all) { this.#purgedAll = mark; this.#keys.clear(); this.#known?.clear(); }
    for (const machine of machines) {
      this.#purgedMachines.set(machine, Math.max(this.#purgedMachines.get(machine) ?? 0, mark));
      this.#keys.delete(machine);
      this.#known?.delete(machine);
    }
    for (const url of urls) this.#purgedUrls.set(url, Math.max(this.#purgedUrls.get(url) ?? 0, mark));
    return mark;
  }

  #tell(notice: PurgeNotice): void {
    try { this.#channel?.postMessage(notice); } catch { /* A closed channel: the key check still holds. */ }
  }

  #serial<T>(task: () => Promise<T>): Promise<T> {
    const next = this.#queue.then(task, task);
    this.#queue = next.catch(() => undefined);
    return next;
  }

  #loadIndex(): Promise<Map<string, Set<string>>> {
    return this.#index ??= this.#db.metas().then(metas => {
      const index = new Map<string, Set<string>>();
      for (const meta of metas) {
        let threads = index.get(meta.machine);
        if (!threads) index.set(meta.machine, threads = new Set());
        threads.add(meta.threadId);
      }
      this.#known = index;
      return index;
    }, () => {
      this.#known = new Map();
      return this.#known;
    });
  }

  #noteIndex(machine: string, threadId: string, present: boolean): void {
    const known = this.#known;
    if (!known) return;
    let threads = known.get(machine);
    if (present) {
      if (!threads) known.set(machine, threads = new Set());
      threads.add(threadId);
    } else threads?.delete(threadId);
  }

  /** What a write scheduled now for `machine` carries (`write`'s `mark`). */
  mark(machine: string): SnapshotMark {
    const held = this.#keys.get(machine);
    const key = held ? held.then(entry => entry.id) : this.#db.machine(machine).then(entry => entry?.id ?? null);
    // Unreadable: a write may neither make a key nor use one.
    return { count: this.#purges, key: key.catch(() => '') };
  }

  #purgedSince(machine: string, url: string | null, mark: number): boolean {
    return this.#purgedAll > mark || (this.#purgedMachines.get(machine) ?? 0) > mark || (url !== null && (this.#purgedUrls.get(url) ?? 0) > mark);
  }

  /** Starts reading which threads have a record, so a later `mayHold` answers without waiting. */
  warm(): void { void this.#loadIndex(); }

  /** False only when the index is read and holds no record of `threadId`: an open then skips the read. */
  mayHold(machine: string, threadId: string): boolean {
    if (!this.#known) { this.warm(); return true; }
    return this.#known.get(machine)?.has(threadId) ?? false;
  }

  /**
   * The machine's key, made non-extractable on its first write when `create`
   * says the write may make one; `url` is where this device reaches it.
   */
  async #key(machine: string, url: string | null, create: boolean): Promise<HeldKey | undefined> {
    const cached = this.#keys.get(machine);
    if (cached) {
      const held = await cached;
      if (url !== null && !held.urls.has(url)) { await this.#db.noteUrl(machine, url); held.urls.add(url); }
      return held;
    }
    const entry = await this.#db.machine(machine);
    if (!entry && !create) return undefined;
    // Another window may make this machine's first key at the same time: the one stored first is everyone's.
    const kept = entry ?? await this.#db.addMachine({ machine, id: crypto.randomUUID(), key: await this.#subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']), urls: url === null ? [] : [url] });
    if (url !== null && !kept.urls.includes(url)) await this.#db.noteUrl(machine, url);
    const held: HeldKey = { id: kept.id, key: kept.key, urls: new Set(url === null ? kept.urls : [...kept.urls, url]) };
    this.#keys.set(machine, Promise.resolve(held));
    return held;
  }

  /**
   * Keeps `thread` as `machine`'s most recently opened, unless it may not be
   * kept or is over `SNAPSHOT_BYTES`; then drops the oldest records until the
   * bounds hold. Answers whether it was kept. A thread that may not be kept
   * loses any record it had. `mark` is where the write was asked
   * (`mark()`): a purge of the machine or its address since then skips it, and
   * so does a key other than the one the machine had then, or any key when it
   * had none and another window made one meanwhile. A write never makes a key
   * for a machine that had one when it was asked.
   */
  write(machine: string, url: string | null, thread: Thread, after: MessageId | null, mark: SnapshotMark = this.mark(machine)): Promise<boolean> {
    return this.#serial(async () => {
      const purged = () => this.#purgedSince(machine, url, mark.count);
      try {
        if (purged()) return false;
        if (!snapshotAllowed(thread)) { await this.#drop(machine, thread.id); return false; }
        const plain = bytes(JSON.stringify({ thread, after }));
        if (plain.byteLength > SNAPSHOT_BYTES) { await this.#drop(machine, thread.id); return false; }
        const expected = await mark.key;
        const held = await this.#key(machine, url, expected === null);
        if (!held || purged() || (expected !== null && held.id !== expected)) return false;
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const data = await this.#subtle.encrypt({ name: 'AES-GCM', iv, additionalData: bytes(recordKey(machine, thread.id)) }, held.key, plain);
        await this.#loadIndex();
        if (purged()) return false;
        if (!await this.#db.put({ machine, threadId: thread.id, bytes: data.byteLength, openedAt: this.#now() }, { iv, data }, held.id)) {
          // Purged or given a new key by another window: what this page held of it is stale.
          this.#keys.delete(machine);
          return false;
        }
        this.#noteIndex(machine, thread.id, true);
        await this.#evict(machine, thread.id);
        return true;
      } catch {
        return false;
      }
    });
  }

  async #evict(machine: string, newest: string): Promise<void> {
    const metas = (await this.#db.metas()).sort((a, b) => a.openedAt - b.openedAt);
    const gone = new Set<SnapshotMeta>();
    const mine = metas.filter(meta => meta.machine === machine);
    for (const meta of mine.slice(0, Math.max(0, mine.length - SNAPSHOT_THREADS))) gone.add(meta);
    let total = metas.reduce((sum, meta) => sum + (gone.has(meta) ? 0 : meta.bytes), 0);
    for (const meta of metas) {
      if (total <= SNAPSHOT_TOTAL) break;
      if (gone.has(meta) || (meta.machine === machine && meta.threadId === newest)) continue;
      gone.add(meta);
      total -= meta.bytes;
    }
    for (const meta of gone) await this.#drop(meta.machine, meta.threadId);
  }

  async #drop(machine: string, threadId: string): Promise<void> {
    await this.#db.delete(machine, threadId);
    this.#noteIndex(machine, threadId, false);
  }

  /** The snapshot of `threadId`, decrypted; a record that does not decrypt or parse is dropped. */
  async read(machine: string, threadId: string): Promise<ThreadSnapshot | undefined> {
    try {
      await this.#loadIndex();
      if (!this.mayHold(machine, threadId)) return undefined;
      const record = await this.#db.data(machine, threadId);
      if (!record) { this.#noteIndex(machine, threadId, false); return undefined; }
      const held = await this.#key(machine, null, false);
      if (!held) { await this.drop(machine, threadId); return undefined; }
      try {
        const plain = await this.#subtle.decrypt({ name: 'AES-GCM', iv: record.iv as Uint8Array<ArrayBuffer>, additionalData: bytes(recordKey(machine, threadId)) }, held.key, record.data);
        const parsed = JSON.parse(decoder.decode(plain)) as ThreadSnapshot;
        if (parsed?.thread?.id !== threadId || !Array.isArray(parsed.thread.messages)) throw new Error('Not a snapshot of this thread');
        return parsed;
      } catch {
        await this.drop(machine, threadId);
        return undefined;
      }
    } catch {
      return undefined;
    }
  }

  /** Forgets one thread's record: the core refused its cursor, or the thread changed under it. */
  drop(machine: string, threadId: string): Promise<void> {
    // Always in the database, behind every write asked before it: this page's index
    // knows neither a first write still pending nor a record another window wrote.
    return this.#serial(() => this.#drop(machine, threadId)).catch(() => undefined);
  }

  /** Forgets a machine: its key and every record of it. */
  purgeMachine(machine: string): Promise<void> {
    this.#purged({ machines: [machine] });
    this.#tell({ machines: [machine] });
    return this.#serial(() => this.#db.deleteMachine(machine)).catch(() => undefined);
  }

  /** Forgets every machine this device reached at `url`. */
  purgeUrl(url: string): Promise<void> {
    const mark = this.#purged({ urls: [url] });
    this.#tell({ urls: [url] });
    return this.#serial(async () => {
      for (const entry of await this.#db.machines()) {
        if (!entry.urls.includes(url)) continue;
        // A write asked before this purge, under another address or none, is not kept either, here or in another window.
        this.#purged({ machines: [entry.machine] }, mark);
        this.#tell({ machines: [entry.machine] });
        await this.#db.deleteMachine(entry.machine);
      }
    }).catch(() => undefined);
  }

  /** Forgets everything on this device. */
  purgeAll(): Promise<void> {
    this.#purged({ all: true });
    this.#tell({ all: true });
    return this.#serial(() => this.#db.clear()).catch(() => undefined);
  }
}

let shared: ThreadSnapshots | null | undefined;

/** The page's snapshots, or null where IndexedDB or WebCrypto is missing, and in unit tests unless one sets them. */
export function threadSnapshots(): ThreadSnapshots | null {
  if (shared !== undefined) return shared;
  const subtle = globalThis.crypto?.subtle;
  shared = typeof indexedDB === 'undefined' || !subtle || import.meta.env.MODE === 'test' ? null
    : new ThreadSnapshots({ db: new IndexedSnapshotDb(), subtle, channel: typeof BroadcastChannel === 'function' ? new BroadcastChannel(CHANNEL) : null });
  return shared;
}

/** Tests put their own snapshots in place, or none. */
export function setThreadSnapshots(snapshots: ThreadSnapshots | null | undefined): void {
  shared = snapshots;
}
