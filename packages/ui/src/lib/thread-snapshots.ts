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
 * Windows of one browser share the database, so every guard against a write
 * landing after what should have stopped it lives in it: a purge generation
 * per machine and a drop generation per thread, each bumped in the same
 * transaction as the deletion. A write reads them and the machine's key when
 * it is asked, before it takes its page, encrypts outside any transaction, and
 * commits in one transaction that stores nothing unless both generations and
 * the key are unchanged. Making a missing key checks the purge generation the
 * same way. A purge is also told to the other windows on a `BroadcastChannel`,
 * only so they let their waiting writes go early.
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

/**
 * Where a write stands, read when it is asked: the generations of a purge of
 * everything, of its machine, of its address (`address`, the URL this device
 * reaches the machine at, none for 0) and of a drop of its thread, and the id
 * of the machine's key then, null when it had none.
 */
export interface SnapshotMark { all: number; purge: number; url: number; drop: number; address: string | null; keyId: string | null }

/** The generations a mark compares with what is stored. */
type Generations = Pick<SnapshotMark, 'all' | 'purge' | 'url' | 'drop'>;

/** A mark that never matches: what a write carries when its mark could not be read. */
const UNREADABLE: SnapshotMark = { all: Number.NaN, purge: Number.NaN, url: Number.NaN, drop: Number.NaN, address: null, keyId: '' };

/** The storage the snapshots sit in: IndexedDB in the app, a Map in tests. Each method is one atomic step. */
export interface SnapshotDb {
  machine(machine: string): Promise<SnapshotMachine | undefined>;
  machines(): Promise<SnapshotMachine[]>;
  /** The generations and key a write of `threadId`, reaching the machine at `address`, starts from. */
  mark(machine: string, threadId: string, address: string | null): Promise<SnapshotMark>;
  /**
   * Keeps `entry` unless the machine has a key already, and only while no
   * purge of everything, of the machine or of the mark's address came since
   * `mark`; the address is recorded with the key in the same step: answers the key kept, so two windows making a
   * machine's first key at once both use the one that won, or undefined.
   */
  addMachine(entry: SnapshotMachine, mark: SnapshotMark): Promise<SnapshotMachine | undefined>;
  /** Adds `url` to the machine's addresses, only while the machine has a key. */
  noteUrl(machine: string, url: string): Promise<void>;
  metas(): Promise<SnapshotMeta[]>;
  data(machine: string, threadId: string): Promise<SnapshotData | undefined>;
  /**
   * Stores the record only while no purge or drop of it came since `mark` and
   * the machine's stored key is the one with id `keyId`, all checked in the
   * same step as the write. Answers whether it was stored.
   */
  put(meta: SnapshotMeta, data: SnapshotData, mark: SnapshotMark, keyId: string): Promise<boolean>;
  /** The thread's record goes, and its drop generation moves on. */
  delete(machine: string, threadId: string): Promise<void>;
  /** The machine's key and every record of it go, and its purge generation moves on. */
  deleteMachine(machine: string): Promise<void>;
  /** `deleteMachine` for every machine reached at `url`, and the address's generation moves on, even with no machine at it yet; answers which. */
  deleteUrl(url: string): Promise<string[]>;
  /** Everything goes, and the generation of a purge of everything moves on. */
  clear(): Promise<void>;
}

/** What a snapshot gives back: the page and the cursor the catch-up asks from. */
export interface ThreadSnapshot { thread: Thread; after: MessageId | null }

const recordKey = (machine: string, threadId: string) => JSON.stringify([machine, threadId]);

/** The keys of the generations: one for everything, one per machine, one per address, one per thread. */
type GenerationKey = ['all'] | ['purge', string] | ['url', string] | ['drop', string, string];
const allKey = (): GenerationKey => ['all'];
const purgeKey = (machine: string): GenerationKey => ['purge', machine];
/** No address reads the generation of '', which no purge moves. */
const urlKey = (url: string | null): GenerationKey => ['url', url ?? ''];
const dropKey = (machine: string, threadId: string): GenerationKey => ['drop', machine, threadId];

/** Whether a write marked `mark` may still land, given what is stored now. */
function unchanged(mark: SnapshotMark, now: Generations): boolean {
  return mark.all === now.all && mark.purge === now.purge && mark.url === now.url && mark.drop === now.drop;
}

/** A Map behind the same interface; what tests and a page without IndexedDB would use. Each method runs without an await, so it is atomic. */
export class MemorySnapshotDb implements SnapshotDb {
  readonly keys = new Map<string, SnapshotMachine>();
  readonly meta = new Map<string, SnapshotMeta>();
  readonly records = new Map<string, SnapshotData>();
  readonly generations = new Map<string, number>();
  #gen(key: GenerationKey): number { return this.generations.get(JSON.stringify(key)) ?? 0; }
  #bump(key: GenerationKey): void { this.generations.set(JSON.stringify(key), this.#gen(key) + 1); }
  #now(machine: string, threadId: string, address: string | null): Generations {
    return { all: this.#gen(allKey()), purge: this.#gen(purgeKey(machine)), url: this.#gen(urlKey(address)), drop: this.#gen(dropKey(machine, threadId)) };
  }
  async machine(machine: string) { return this.keys.get(machine); }
  async machines() { return [...this.keys.values()]; }
  async mark(machine: string, threadId: string, address: string | null) { return { ...this.#now(machine, threadId, address), address, keyId: this.keys.get(machine)?.id ?? null }; }
  async addMachine(entry: SnapshotMachine, mark: SnapshotMark) {
    if (!unchanged(mark, { ...this.#now(entry.machine, '', mark.address), drop: mark.drop })) return undefined;
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
  async put(meta: SnapshotMeta, data: SnapshotData, mark: SnapshotMark, keyId: string) {
    if (!unchanged(mark, this.#now(meta.machine, meta.threadId, mark.address)) || this.keys.get(meta.machine)?.id !== keyId) return false;
    const key = recordKey(meta.machine, meta.threadId);
    this.meta.set(key, meta);
    this.records.set(key, data);
    return true;
  }
  async delete(machine: string, threadId: string) {
    this.#bump(dropKey(machine, threadId));
    const key = recordKey(machine, threadId);
    this.meta.delete(key);
    this.records.delete(key);
  }
  #deleteMachine(machine: string) {
    this.#bump(purgeKey(machine));
    this.keys.delete(machine);
    for (const [key, meta] of this.meta) if (meta.machine === machine) { this.meta.delete(key); this.records.delete(key); }
    // The purge generation outdates every drop generation of the machine.
    for (const key of this.generations.keys()) if (key.startsWith(JSON.stringify(['drop', machine]).slice(0, -1) + ',')) this.generations.delete(key);
  }
  async deleteMachine(machine: string) { this.#deleteMachine(machine); }
  async deleteUrl(url: string) {
    this.#bump(urlKey(url));
    const machines = [...this.keys.values()].filter(entry => entry.urls.includes(url)).map(entry => entry.machine);
    for (const machine of machines) this.#deleteMachine(machine);
    return machines;
  }
  async clear() {
    this.#bump(allKey());
    this.keys.clear(); this.meta.clear(); this.records.clear();
    for (const key of this.generations.keys()) if (key.startsWith('["drop",')) this.generations.delete(key);
  }
}

const DATABASE = 'boite-thread-snapshots-v1';
/** 2: keys carry an id, and the generations store exists. What version 1 held is dropped. */
const DATABASE_VERSION = 2;
type StoreName = 'machines' | 'meta' | 'data' | 'generations';
const STORES: StoreName[] = ['machines', 'meta', 'data', 'generations'];

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

/** Reads `requests` one after the other inside a transaction, then hands their results over. */
function readAll(asks: (() => IDBRequest)[], then: (results: unknown[]) => void): void {
  const results: unknown[] = [];
  const next = () => {
    const ask = asks[results.length];
    if (!ask) { then(results); return; }
    const request = ask();
    request.onsuccess = () => { results.push(request.result); next(); };
  };
  next();
}

const dropRange = (machine?: string) => machine === undefined ? IDBKeyRange.bound(['drop'], ['drop', []]) : IDBKeyRange.bound(['drop', machine], ['drop', machine, []]);

/** IndexedDB: machines by id, metadata and encrypted data by `[machine, threadId]`, generations by `GenerationKey`. */
export class IndexedSnapshotDb implements SnapshotDb {
  #db: Promise<IDBDatabase> | null = null;

  #open(): Promise<IDBDatabase> {
    return this.#db ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DATABASE, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const name of [...db.objectStoreNames]) db.deleteObjectStore(name);
        db.createObjectStore('machines', { keyPath: 'machine' });
        db.createObjectStore('meta', { keyPath: ['machine', 'threadId'] });
        db.createObjectStore('data');
        db.createObjectStore('generations');
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

  /** One transaction over `stores`; what `change` leaves in its result once it committed. */
  async #write<T>(stores: StoreName[], mode: IDBTransactionMode, change: (transaction: IDBTransaction, answer: (value: T) => void) => void, fallback: T): Promise<T> {
    const db = await this.#open();
    const transaction = db.transaction(stores, mode);
    const finished = committed(transaction);
    let result = fallback;
    change(transaction, value => { result = value; });
    await finished;
    return result;
  }

  /** The generations as stored now, read inside `t`. */
  #now(t: IDBTransaction, machine: string, threadId: string, address: string | null, then: (now: Generations, entry: SnapshotMachine | undefined) => void): void {
    const generations = t.objectStore('generations');
    const asks = [allKey(), purgeKey(machine), urlKey(address), dropKey(machine, threadId)].map(key => () => generations.get(key));
    readAll([...asks, () => t.objectStore('machines').get(machine)], ([all, purge, url, drop, entry]) => {
      const count = (value: unknown) => (value as number | undefined) ?? 0;
      then({ all: count(all), purge: count(purge), url: count(url), drop: count(drop) }, entry as SnapshotMachine | undefined);
    });
  }

  #bump(t: IDBTransaction, key: GenerationKey): void {
    const generations = t.objectStore('generations');
    const reading = generations.get(key);
    reading.onsuccess = () => { generations.put(((reading.result as number | undefined) ?? 0) + 1, key); };
  }

  #deleteMachine(t: IDBTransaction, machine: string): void {
    const range = IDBKeyRange.bound([machine], [machine, []]);
    this.#bump(t, purgeKey(machine));
    t.objectStore('machines').delete(machine);
    t.objectStore('meta').delete(range);
    t.objectStore('data').delete(range);
    t.objectStore('generations').delete(dropRange(machine));
  }

  machine(machine: string) { return this.#read<SnapshotMachine | undefined>('machines', store => store.get(machine)); }
  machines() { return this.#read<SnapshotMachine[]>('machines', store => store.getAll()); }
  mark(machine: string, threadId: string, address: string | null) {
    return this.#write<SnapshotMark>(['machines', 'generations'], 'readonly', (t, answer) => {
      this.#now(t, machine, threadId, address, (now, entry) => answer({ ...now, address, keyId: entry?.id ?? null }));
    }, UNREADABLE);
  }
  addMachine(entry: SnapshotMachine, mark: SnapshotMark) {
    return this.#write<SnapshotMachine | undefined>(['machines', 'generations'], 'readwrite', (t, answer) => {
      this.#now(t, entry.machine, '', mark.address, (now, held) => {
        if (!unchanged(mark, { ...now, drop: mark.drop })) return;
        if (held) { answer(held); return; }
        // add, never put: should another window's key be there by now, the transaction fails and nothing is replaced.
        t.objectStore('machines').add(entry).onsuccess = () => answer(entry);
      });
    }, undefined);
  }
  noteUrl(machine: string, url: string) {
    return this.#write<void>(['machines'], 'readwrite', t => {
      const store = t.objectStore('machines');
      const reading = store.get(machine) as IDBRequest<SnapshotMachine | undefined>;
      reading.onsuccess = () => {
        const entry = reading.result;
        if (entry && !entry.urls.includes(url)) store.put({ ...entry, urls: [...entry.urls, url] });
      };
    }, undefined);
  }
  metas() { return this.#read<SnapshotMeta[]>('meta', store => store.getAll()); }
  data(machine: string, threadId: string) { return this.#read<SnapshotData | undefined>('data', store => store.get([machine, threadId])); }
  put(meta: SnapshotMeta, data: SnapshotData, mark: SnapshotMark, keyId: string) {
    // One transaction over the generations, the key and the record: no other window's purge, drop or new key comes between the check and the write.
    return this.#write<boolean>(STORES, 'readwrite', (t, answer) => {
      this.#now(t, meta.machine, meta.threadId, mark.address, (now, entry) => {
        if (!unchanged(mark, now) || entry?.id !== keyId) return;
        t.objectStore('meta').put(meta);
        t.objectStore('data').put(data, [meta.machine, meta.threadId]);
        answer(true);
      });
    }, false);
  }
  delete(machine: string, threadId: string) {
    return this.#write<void>(['meta', 'data', 'generations'], 'readwrite', t => {
      this.#bump(t, dropKey(machine, threadId));
      t.objectStore('meta').delete([machine, threadId]);
      t.objectStore('data').delete([machine, threadId]);
    }, undefined);
  }
  deleteMachine(machine: string) {
    return this.#write<void>(STORES, 'readwrite', t => this.#deleteMachine(t, machine), undefined);
  }
  deleteUrl(url: string) {
    return this.#write<string[]>(STORES, 'readwrite', (t, answer) => {
      // Moved on even with no machine at the address yet: a first key being made for it is kept out.
      this.#bump(t, urlKey(url));
      const reading = t.objectStore('machines').getAll() as IDBRequest<SnapshotMachine[]>;
      reading.onsuccess = () => {
        const machines = reading.result.filter(entry => entry.urls.includes(url)).map(entry => entry.machine);
        for (const machine of machines) this.#deleteMachine(t, machine);
        answer(machines);
      };
    }, []);
  }
  clear() {
    return this.#write<void>(STORES, 'readwrite', t => {
      this.#bump(t, allKey());
      for (const store of ['machines', 'meta', 'data'] as const) t.objectStore(store).clear();
      t.objectStore('generations').delete(dropRange());
    }, undefined);
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
  /** Where this page tells its other windows of a purge, and hears theirs, so they let their waiting writes go early; none by default. */
  channel?: BroadcastChannel | null;
}

/** What a purge tells the other windows. */
export interface PurgeNotice { machines: string[]; urls: string[]; all: boolean }

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
  /** This page's writes and deletes run one after the other, so eviction counts what is there. */
  #queue: Promise<unknown> = Promise.resolve();
  /** The keys this page read; a write uses one only when it is the key its mark names. */
  readonly #keys = new Map<string, Promise<HeldKey>>();
  readonly #channel: BroadcastChannel | null;
  readonly #listeners = new Set<(notice: PurgeNotice) => void>();

  constructor(options: SnapshotOptions) {
    this.#db = options.db;
    this.#subtle = options.subtle;
    this.#now = options.now ?? Date.now;
    this.#channel = options.channel ?? null;
    this.#channel?.addEventListener('message', (event: MessageEvent<Partial<PurgeNotice>>) => {
      const notice = event.data;
      if (!notice || typeof notice !== 'object') return;
      const strings = (list: unknown) => Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string') : [];
      this.#purged({ machines: strings(notice.machines), urls: strings(notice.urls), all: notice.all === true });
    });
  }

  /** Stops hearing other windows. */
  close(): void { this.#channel?.close(); }

  /** Hears of every purge, this page's or another window's: the waiting writes it concerns may go. */
  onPurge(listener: (notice: PurgeNotice) => void): () => void {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }

  /** Forgets what this page held of a purge, and says so. */
  #purged(notice: PurgeNotice): void {
    if (notice.all) { this.#keys.clear(); this.#known?.clear(); }
    for (const machine of notice.machines) { this.#keys.delete(machine); this.#known?.delete(machine); }
    for (const listener of [...this.#listeners]) listener(notice);
  }

  #told(notice: PurgeNotice): void {
    this.#purged(notice);
    try { this.#channel?.postMessage(notice); } catch { /* A closed channel: the generations still hold. */ }
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

  /**
   * Where a write of `threadId`, reaching the machine at `url`, asked now starts from: read before the page
   * is taken, so that a purge or a drop after this point keeps it out. Read
   * behind this page's drops and purges already asked, which come before it.
   */
  mark(machine: string, threadId: string, url: string | null = null): Promise<SnapshotMark> {
    return this.#serial(() => this.#db.mark(machine, threadId, url)).catch(() => UNREADABLE);
  }

  /** Starts reading which threads have a record, so a later `mayHold` answers without waiting. */
  warm(): void { void this.#loadIndex(); }

  /** False only when the index is read and holds no record of `threadId`: an open then skips the read. */
  mayHold(machine: string, threadId: string): boolean {
    if (!this.#known) { this.warm(); return true; }
    return this.#known.get(machine)?.has(threadId) ?? false;
  }

  /**
   * The machine's key: the one `mark` names, or for a write whose machine had
   * none, the one stored since or one made now, non-extractable, unless a
   * purge came since. Without a
   * mark (a read), whichever is stored. `url` is where this device reaches it.
   */
  async #key(machine: string, url: string | null, mark: SnapshotMark | null): Promise<HeldKey | undefined> {
    const cached = await this.#keys.get(machine)?.catch(() => undefined);
    let held = cached && (!mark || cached.id === mark.keyId) ? cached : undefined;
    if (!held) {
      const entry = await this.#db.machine(machine);
      // A key made since a mark that found none is fine: the commit checks no purge came since.
      let kept = entry && (!mark || mark.keyId === null || entry.id === mark.keyId) ? entry : undefined;
      if (!entry && mark?.keyId === null) {
        const key = await this.#subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
        // Another window may make this machine's first key at the same time: the one stored first is everyone's.
        // Made for the mark's address: a purge of that address since keeps it out, before any key maps the address to the machine.
        kept = await this.#db.addMachine({ machine, id: crypto.randomUUID(), key, urls: mark.address === null ? [] : [mark.address] }, mark);
      }
      if (!kept) return undefined;
      held = { id: kept.id, key: kept.key, urls: new Set(kept.urls) };
      this.#keys.set(machine, Promise.resolve(held));
    }
    if (url !== null && !held.urls.has(url)) { await this.#db.noteUrl(machine, url); held.urls.add(url); }
    return held;
  }

  /**
   * Keeps `thread` as `machine`'s most recently opened, unless it may not be
   * kept or is over `SNAPSHOT_BYTES`; then drops the oldest records until the
   * bounds hold. Answers whether it was kept. A thread that may not be kept
   * loses any record it had. `mark` (`mark()`) is where the write was asked,
   * read before its page was taken: a purge of the machine or a drop of the
   * thread since, or another key, keeps it out.
   */
  write(machine: string, url: string | null, thread: Thread, after: MessageId | null, mark: Promise<SnapshotMark> = this.mark(machine, thread.id, url)): Promise<boolean> {
    return this.#serial(async () => {
      try {
        const marked = await mark;
        if (!snapshotAllowed(thread)) { await this.#drop(machine, thread.id); return false; }
        const plain = bytes(JSON.stringify({ thread, after }));
        if (plain.byteLength > SNAPSHOT_BYTES) { await this.#drop(machine, thread.id); return false; }
        const held = await this.#key(machine, url, marked);
        if (!held) return false;
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const data = await this.#subtle.encrypt({ name: 'AES-GCM', iv, additionalData: bytes(recordKey(machine, thread.id)) }, held.key, plain);
        await this.#loadIndex();
        if (!await this.#db.put({ machine, threadId: thread.id, bytes: data.byteLength, openedAt: this.#now() }, { iv, data }, marked, held.id)) {
          // A purge, a drop or another key came first, maybe from another window: what this page held of the key may be stale.
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
      const held = await this.#key(machine, null, null);
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

  /**
   * Forgets one thread's record: the core refused its cursor, or the thread
   * changed under it. Always in the database, and its drop generation keeps
   * out any write of it asked before, in this window or another.
   */
  drop(machine: string, threadId: string): Promise<void> {
    return this.#serial(() => this.#drop(machine, threadId)).catch(() => undefined);
  }

  /** Forgets a machine: its key and every record of it. */
  purgeMachine(machine: string): Promise<void> {
    this.#told({ machines: [machine], urls: [], all: false });
    return this.#serial(() => this.#db.deleteMachine(machine)).catch(() => undefined);
  }

  /** Forgets every machine this device reached at `url`. */
  purgeUrl(url: string): Promise<void> {
    return this.#serial(async () => {
      const machines = await this.#db.deleteUrl(url);
      this.#told({ machines, urls: [url], all: false });
    }).catch(() => undefined);
  }

  /** Forgets everything on this device. */
  purgeAll(): Promise<void> {
    this.#told({ machines: [], urls: [], all: true });
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
