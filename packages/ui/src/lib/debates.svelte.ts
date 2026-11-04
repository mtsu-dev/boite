/*
 * The debates of one machine (`docs/debates.md`), read for what draws them: a
 * thread's cards read the debates it started with `debates.list`, a salon
 * reads its debate and posts with `debates.get`. Both read again on
 * `debates.changed` for their own debate or thread, a burst of changes making
 * one read. A core that refuses the read (the experiment off there, or an older
 * core without debates) leaves the reader `refused`; the desktop turning the
 * experiment on reads it again.
 */

import { RpcErrorCode, type Debate, type DebatePost, type DebatesRpcEvents, type ThreadId } from '@boite/contracts';
import { untrack } from 'svelte';
import type { Client } from './client';
import { RpcFailure } from './rpc-error';
import { fill, strings } from './strings';
import type { Store } from './store.svelte';

/** Changes closer together than this make one read: a round closing moves several debaters at once. */
const SETTLE_MS = 40;

type Changed = DebatesRpcEvents['debates.changed'];

class DebateReader<T> {
  /** What the last read answered, kept while a newer read runs. */
  value = $state.raw<T | null>(null);
  /** A first read answered, refused or failed: nothing then means nothing. */
  loaded = $state(false);
  /** The core does not serve debates to this client: the experiment is off there, or it predates them. */
  refused = $state(false);
  /** The debate no longer exists. */
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
      const changed = client.on('debates.changed', event => { if (this.#concerns(event)) this.#soon(); });
      // The core gates debates on the desktop's experiments: a read made before it heard of them was refused.
      const switched = client.on('client.desktopExperiments', ({ experiments }) => { if (experiments.includes('debates')) this.#soon(); });
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
      // Only an answer about debates themselves changes what the reader knows: a timeout or a dropped socket keeps it.
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

/** The debates one thread started, newest first. */
export class ThreadDebates extends DebateReader<Debate[]> {
  constructor(store: Store, threadId: ThreadId) {
    super(store, async client => (await client.call('debates.list', { threadId })).debates, event => event.threadId === threadId);
  }
}

/** One debate and its posts, for its salon. */
export class DebateRoom extends DebateReader<{ debate: Debate; posts: DebatePost[] }> {
  constructor(store: Store, debateId: string) {
    super(store, client => client.call('debates.get', { debateId }), event => event.debateId === debateId);
  }
}

const threads = new WeakMap<Store, Map<ThreadId, ThreadDebates>>();
const rooms = new WeakMap<Store, Map<string, DebateRoom>>();

function kept<K, V>(table: WeakMap<Store, Map<K, V>>, store: Store, key: K, make: () => V): V {
  let byKey = table.get(store);
  if (!byKey) table.set(store, byKey = new Map());
  let value = byKey.get(key);
  if (!value) byKey.set(key, value = make());
  return value;
}

/** One reader per thread of a machine, kept while its Store lives, so a second visit draws at once. */
export function debatesOf(store: Store, threadId: ThreadId): ThreadDebates {
  return kept(threads, store, threadId, () => new ThreadDebates(store, threadId));
}

/** One reader per debate of a machine. */
export function debateRoom(store: Store, debateId: string): DebateRoom {
  return kept(rooms, store, debateId, () => new DebateRoom(store, debateId));
}

/** The letter on a debater's face: the first letter or digit of its model's name. */
export function faceOf(name: string): string {
  return (/[\p{L}\p{N}]/u.exec(name)?.[0] ?? '?').toUpperCase();
}

/**
 * The summarizer's face: its role's letter, as the salon's chip names it
 * (S for Summary, R for Résumé), not its model's, which a debater may share.
 * The placeholder is left out, wherever a language puts it.
 */
export function summarizerFace(): string {
  return faceOf(strings.debates.summarizer.replace(/\{\w+\}/g, ''));
}

/**
 * A summary's first lines without their Markdown marks, for the card: the
 * thread and the salon hold the whole text. Tables, rules and code fences are
 * left out. Plain text keeps the card off `Prose`, which reaches the card
 * back through `Deferred` (`lib/deferred-parts.ts`).
 */
export function summaryLines(markdown: string, max = 4): string[] {
  const lines: string[] = [];
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('|') || line.startsWith('```') || /^[-*_=]{3,}$/.test(line)) continue;
    const text = line.replace(/^#{1,6}\s+/, '').replace(/^>\s?/, '').replace(/^[-*+]\s+/, '• ')
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/(\*\*|__|\*|`)(?=\S)(.*?\S)\1/g, '$2').trim();
    if (text) lines.push(text);
    if (lines.length === max) break;
  }
  return lines;
}

/** Where a debate stands, as its card's chip says it, and the chip's tone. */
export function debateStatus(debate: Pick<Debate, 'status' | 'round' | 'rounds'>): { tone: 'live' | 'success' | 'quiet' | 'danger'; text: string } {
  const labels = strings.debates;
  switch (debate.status) {
    case 'running': return { tone: 'live', text: debate.round > 0 ? fill(labels.roundOf, { round: String(debate.round), rounds: String(debate.rounds) }) : labels.starting };
    case 'summarizing': return { tone: 'live', text: labels.summarizing };
    case 'done': return { tone: 'success', text: labels.done };
    case 'stopped': return { tone: 'quiet', text: labels.stopped };
    case 'failed': return { tone: 'danger', text: labels.failed };
  }
}

/** Keeps a reader read while the caller is drawn, and follows its machine's reconnections. */
export function followDebates(reader: () => { store: Store; watch(): () => void; follow(): void } | null): void {
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
