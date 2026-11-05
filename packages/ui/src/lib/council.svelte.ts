/*
 * The councils of one machine (`docs/council.md`), read for what draws them: a
 * thread's cards read the councils it started with `council.list`, a salon
 * reads its council and posts with `council.get`. Both read again on
 * `council.changed` for their own council or thread, a burst of changes making
 * one read. A core that refuses the read (the experiment off there, or an older
 * core without the council) leaves the reader `refused`; the desktop turning
 * the experiment on reads it again.
 */

import { COUNCIL_EXPERIMENT, RpcErrorCode, type Council, type CouncilPost, type CouncilRpcEvents, type ThreadId } from '@boite/contracts';
import { untrack } from 'svelte';
import type { Client } from './client';
import { RpcFailure } from './rpc-error';
import { fill, strings } from './strings';
import type { Store } from './store.svelte';

/** Changes closer together than this make one read: a round closing moves several members at once. */
const SETTLE_MS = 40;

type Changed = CouncilRpcEvents['council.changed'];

class CouncilReader<T> {
  /** What the last read answered, kept while a newer read runs. */
  value = $state.raw<T | null>(null);
  /** A first read answered, refused or failed: nothing then means nothing. */
  loaded = $state(false);
  /** The core does not serve councils to this client: the experiment is off there, or it predates them. */
  refused = $state(false);
  /** The council no longer exists. */
  missing = $state(false);

  readonly store: Store;
  readonly #read: (client: Client) => Promise<T>;
  readonly #concerns: (event: Changed) => boolean;
  #watchers = 0;
  #release: (() => void) | null = null;
  #client: unknown = null;
  #ready = false;
  #reading = 0;
  #timer: ReturnType<typeof setTimeout> | null = null;

  constructor(store: Store, read: (client: Client) => Promise<T>, concerns: (event: Changed) => boolean) {
    this.store = store;
    this.#read = read;
    this.#concerns = concerns;
  }

  /** Reads and follows the changes while something draws them. Returns the release. */
  watch(): () => void {
    this.#watchers += 1;
    this.follow();
    return () => {
      this.#watchers -= 1;
      if (this.#watchers > 0) return;
      this.#release?.();
      this.#release = null;
      this.#client = null;
      this.#ready = false;
      this.#reading += 1;
      this.#settle();
    };
  }

  /** A socket can reconnect on the same client: read again after either one changes. */
  follow(): void {
    const client = this.store.client;
    const ready = this.store.connection === 'ready';
    if (this.#watchers === 0 || (client === this.#client && ready === this.#ready)) return;
    this.#release?.();
    this.#client = client;
    this.#ready = ready;
    this.#reading += 1;
    if (client) {
      const changed = client.on('council.changed', event => { if (this.#concerns(event)) this.#soon(); });
      // The core gates councils on the desktop's experiments: a read made before it heard of them was refused.
      const switched = client.on('client.desktopExperiments', ({ experiments }) => { if (experiments.includes(COUNCIL_EXPERIMENT)) this.#soon(); });
      this.#release = () => { changed(); switched(); };
    } else this.#release = null;
    if (ready) void this.refresh();
  }

  #soon(): void {
    if (this.#timer !== null) return;
    this.#timer = setTimeout(() => { this.#timer = null; void this.refresh(); }, SETTLE_MS);
  }

  #settle(): void {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
  }

  async refresh(): Promise<void> {
    this.#settle();
    const read = ++this.#reading;
    const client = this.store.client;
    if (!client || this.store.connection !== 'ready') return;
    try {
      const value = await this.#read(client);
      // An older read that lands after a newer one must not put back what changed since.
      if (read !== this.#reading || client !== this.store.client) return;
      this.value = value;
      this.refused = false;
      this.missing = false;
    } catch (failure) {
      if (read !== this.#reading || client !== this.store.client) return;
      // Only an answer about councils themselves changes what the reader knows: a timeout or a dropped socket keeps it.
      const code = failure instanceof RpcFailure ? failure.code : null;
      if (code === RpcErrorCode.Refused || code === RpcErrorCode.MethodNotFound || code === RpcErrorCode.NotFound) {
        this.refused = code !== RpcErrorCode.NotFound;
        this.missing = code === RpcErrorCode.NotFound;
        this.value = null;
      }
    }
    this.loaded = true;
  }
}

/** The councils one thread started, newest first. */
export class ThreadCouncils extends CouncilReader<Council[]> {
  constructor(store: Store, threadId: ThreadId) {
    super(store, async client => (await client.call('council.list', { threadId })).councils, event => event.threadId === threadId);
  }
}

/** One council and its posts, for its salon. */
export class CouncilRoom extends CouncilReader<{ council: Council; posts: CouncilPost[] }> {
  constructor(store: Store, councilId: string) {
    super(store, client => client.call('council.get', { councilId }), event => event.councilId === councilId);
  }
}

const threads = new WeakMap<Store, Map<ThreadId, ThreadCouncils>>();
const rooms = new WeakMap<Store, Map<string, CouncilRoom>>();

function kept<K, V>(table: WeakMap<Store, Map<K, V>>, store: Store, key: K, make: () => V): V {
  let byKey = table.get(store);
  if (!byKey) table.set(store, byKey = new Map());
  let value = byKey.get(key);
  if (!value) byKey.set(key, value = make());
  return value;
}

/** One reader per thread of a machine, kept while its Store lives, so a second visit draws at once. */
export function councilsOf(store: Store, threadId: ThreadId): ThreadCouncils {
  return kept(threads, store, threadId, () => new ThreadCouncils(store, threadId));
}

/** One reader per council of a machine. */
export function councilRoom(store: Store, councilId: string): CouncilRoom {
  return kept(rooms, store, councilId, () => new CouncilRoom(store, councilId));
}

/** The letter on a member's face: the first letter or digit of its model's name. */
export function faceOf(name: string): string {
  return (/[\p{L}\p{N}]/u.exec(name)?.[0] ?? '?').toUpperCase();
}

/** Where a council stands, as its card's chip says it, and the chip's tone. */
export function councilStatus(council: Pick<Council, 'status' | 'round'>): { tone: 'live' | 'success' | 'quiet' | 'danger'; text: string } {
  const labels = strings.council;
  switch (council.status) {
    case 'running': return { tone: 'live', text: council.round > 0 ? fill(labels.round, { round: String(council.round) }) : labels.starting };
    case 'waiting': return { tone: 'quiet', text: fill(labels.waiting, { round: String(council.round) }) };
    case 'done': return { tone: 'success', text: labels.done };
    case 'stopped': return { tone: 'quiet', text: labels.stopped };
    case 'failed': return { tone: 'danger', text: labels.failed };
  }
}

/** Keeps a reader read while the caller is drawn, and follows its machine's reconnections. */
export function followCouncil(reader: () => { store: Store; watch(): () => void; follow(): void } | null): void {
  $effect(() => {
    const current = reader();
    if (!current) return;
    return untrack(() => current.watch());
  });
  $effect(() => {
    const current = reader();
    if (!current) return;
    void current.store.client;
    void current.store.connection;
    untrack(() => current.follow());
  });
}
