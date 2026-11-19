/*
 * The page `open()` asks for, and the presses that ask for it ahead of their
 * click (`lib/press-preload.ts`).
 *
 * A press sends what the open would send, built by the same `askPage`, with
 * the subscription and without the open's other effects: a core with bundled
 * snapshots gets `open: { requests: false }`, so it neither leaves the thread
 * on screen nor marks anything read nor reads requests. The open that follows
 * claims the press and does those itself, after the page. Until the page is on
 * screen, events patch it like the open thread (`Threads.threadSnapshots`).
 *
 * Before any press, a ready machine reads its first sidebar threads ahead once
 * the page is idle (`IdlePreloads`): their first page goes into the reading
 * cache, so a click on one paints it at once, like a thread visited before.
 */

import { INITIAL_MESSAGE_PAGE, INITIAL_PAGE_BYTES, MESSAGE_PAGE_MAX, READING_PAGE_BYTES, type MessageId, type ProjectId, type RpcParams, type Thread, type ThreadId, type ThreadSnapshot, type ThreadSummary } from '@boite/contracts';
import { wasDropped, type Client } from '../client';
import { wasClosed } from '../rpc-error';
import { whenIdle } from '../idle';
import { readingCacheBytes } from '../reading-cache';
import { compareRecent } from '../thread-order';
import { lastIndexById, mergeResumed, snapshotResume } from '../thread-rows';
import type { StoreContext } from './context';
import { lightPage, setMessagesAfter, type ReadingPosition } from './reading-pages.svelte';

/** What `open()` sends for a thread: the page and, before bundled snapshots, the subscription. */
export interface PageAsk {
  subscribed: Promise<unknown> | null;
  fetched: Promise<ThreadSnapshot>;
  /** The reader's message the page is centred on, when it is. */
  around: MessageId | undefined;
  /** The first message the requested proof can certify. */
  proofFirst: MessageId | undefined;
}

/** A press waiting for its click, or claimed by the open it became. */
export interface Preload extends PageAsk {
  threadId: ThreadId;
  client: Client;
  held: Thread | undefined;
  thread: Thread | null;
  /** Its subscribe or page was refused: the open asks again rather than inherit the failure. */
  failed: boolean;
  summaryRead: ReturnType<StoreContext['threadReads']['begin']>;
}

/** What a press reads of the thread store. */
export interface Opener {
  readonly subscribedThreadId: ThreadId | null;
  readonly openThread: Thread | null;
  readonly openTarget: ThreadId | null;
  readonly readingThreads: { get(threadId: string): Thread | undefined };
  readonly readingPositions: Map<string, ReadingPosition>;
  loadingThreadId: ThreadId | null;
  loadingBytes: { threadId: ThreadId; received: number; total: number } | null;
}

/**
 * A long thread left away from its end opens where the reader was: the page
 * around the message at the top of their view, not the last one. Only for a
 * thread with no page held; the device's snapshot (the last page) yields to it.
 */
export function readingAround(ctx: StoreContext, opener: Pick<Opener, 'readingPositions'>, threadId: ThreadId): MessageId | undefined {
  const saved = ctx.store.core?.features?.readingPages ? opener.readingPositions.get(threadId) : undefined;
  return saved && !saved.pinned ? saved.anchor?.id : undefined;
}

/**
 * The page `threadId` opens on: a recent visit asks only for what it cannot
 * vouch for, a long thread left away from its end opens around the reader's
 * message, any other reads its last screen.
 */
function pageRequest(ctx: StoreContext, opener: Opener, threadId: ThreadId, held: Thread | undefined): { params: RpcParams<'threads.get'>; around: MessageId | undefined } {
  // A thread already in hand, open or among the recent ones, asks only for
  // what it cannot vouch for: a reconnect on a long conversation used to
  // download its last 120 messages again for the two that were new.
  const features = ctx.store.core?.features;
  const resume = snapshotResume(threadId, held, features?.threadPrefixProofs === true, true);
  const around = !held || features?.threadPrefixProofs ? readingAround(ctx, opener, threadId) : undefined;
  // A page holds about one screen; the rest comes as the reader scrolls. A resume tail is never cut.
  const { sync, ...target } = resume;
  const limit = target.after ? MESSAGE_PAGE_MAX : Math.min(MESSAGE_PAGE_MAX, Math.max(INITIAL_MESSAGE_PAGE, held?.messages.length ?? 0));
  return { params: { ...target, ...(features?.threadSnapshots ? { sync } : {}), limit, maxBytes: INITIAL_PAGE_BYTES, ...lightPage(ctx), ...(around ? { around } : {}) }, around };
}

/**
 * The page and subscription for `threadId` (`pageRequest`), and with a
 * bundled core the subscription in the same call with `open`. `current` says
 * whether the loading view may still count the page in.
 */
export function askPage(ctx: StoreContext, opener: Opener, client: Client, threadId: ThreadId, held: Thread | undefined, open: { previous?: ThreadId; requests?: boolean; markRead?: boolean }, current: () => boolean): PageAsk {
  const features = ctx.store.core?.features;
  const bundled = features?.threadSnapshots === true;
  const channels = ctx.streams.params(threadId);
  const subscribed = bundled ? null : client.call('threads.subscribe', { threadId, ...channels });
  const { params, around } = pageRequest(ctx, opener, threadId, held);
  const fetched = client.call('threads.get', { ...params,
    ...(bundled ? { open, ...channels } : {})
  }, held || !features?.chunkedAnswers ? {} : {
    // The loading view counts the page in as the core slices it.
    onProgress: (received, total) => { if (current() && opener.loadingThreadId === threadId) opener.loadingBytes = { threadId, received, total }; }
  });
  // Where the page sits, noted as it lands, whichever open or press ends up using it.
  void fetched.then((thread) => ctx.positions.note(threadId, thread.messages, thread.messageOffset), () => undefined);
  const proofFirst = features?.threadPrefixProofs && params.sync !== true ? params.sync?.prefix?.first : undefined;
  return { subscribed, fetched, around, proofFirst };
}

/** Re-read the held window beyond the snapshot, within the normal count and byte bounds of each page. */
function refreshHeldWindow(ctx: StoreContext, client: Client, held: Thread, fresh: Thread, current: () => boolean): Promise<void> | undefined {
  const first = fresh.messages[0]?.id;
  const last = fresh.messages.at(-1)?.id;
  let older = first === undefined || fresh.messagesBefore === null ? 0 : lastIndexById(held.messages, first);
  const lastIndex = last === undefined || !fresh.messagesAfter ? -1 : lastIndexById(held.messages, last);
  let newer = lastIndex < 0 ? 0 : held.messages.length - lastIndex - 1;
  if (older <= 0 && newer <= 0) return;

  return (async () => {
    const turns = new Map<string, Thread['turns'][number]>();
    while (current() && older > 0 && fresh.messagesBefore !== null) {
      const page = await client.call('messages.list', {
        threadId: fresh.id, before: fresh.messagesBefore, limit: Math.min(older, MESSAGE_PAGE_MAX),
        maxBytes: READING_PAGE_BYTES, ...lightPage(ctx),
      });
      if (!current() || page.messages.length === 0) break;
      ctx.positions.note(fresh.id, page.messages, page.offset);
      fresh.messageOffset = page.offset ?? fresh.messageOffset;
      fresh.messages = [...page.messages, ...fresh.messages];
      fresh.messagesBefore = page.before;
      older -= page.messages.length;
      for (const turn of page.turns ?? []) if (!turns.has(turn.id)) turns.set(turn.id, turn);
    }
    while (current() && newer > 0 && fresh.messagesAfter) {
      const page = await client.call('messages.list', {
        threadId: fresh.id, after: fresh.messagesAfter, limit: Math.min(newer, MESSAGE_PAGE_MAX),
        maxBytes: READING_PAGE_BYTES, ...lightPage(ctx),
      });
      if (!current() || page.messages.length === 0) break;
      ctx.positions.note(fresh.id, page.messages, page.offset);
      fresh.messages.push(...page.messages);
      setMessagesAfter(fresh, page.after);
      newer -= page.messages.length;
      for (const turn of page.turns ?? []) if (!turns.has(turn.id)) turns.set(turn.id, turn);
    }
    for (const turn of fresh.turns) turns.set(turn.id, turn);
    fresh.turns = [...turns.values()].sort((a, b) => a.queuedAt - b.queuedAt);
  })();
}

export class ThreadPreloads {
  /** The press waiting for its click, at most one. */
  #waiting: Preload | null = null;
  /** The press an `open()` took over, patched by events until its page is on screen. */
  #claimed: Preload | null = null;
  /** The fresh portion of a window whose remaining pages are being checked. */
  #repairing: Thread | null = null;
  /** The first sidebar threads, read ahead once the machine is ready and the page idle. */
  readonly idle: IdlePreloads;

  constructor(private readonly ctx: StoreContext, private readonly opener: ReadAheadSource) {
    this.idle = new IdlePreloads(ctx, opener, threadId => this.#waiting?.threadId === threadId);
  }

  /**
   * Asks for `threadId`'s page and subscription now. Answers the release, for
   * a press that never becomes an open: it gives the subscription back unless
   * something came to hold it meanwhile. A newer press releases the older.
   */
  preload(threadId: ThreadId): () => void {
    const client = this.ctx.client;
    const waiting = this.#waiting;
    if (waiting && waiting.threadId === threadId && waiting.client === client) return () => this.#release(waiting);
    this.#release(waiting);
    // The thread on screen is live already; a machine switched away from keeps
    // its last thread unsubscribed, and a press on it preloads like any other.
    if (!client || this.ctx.store.connection !== 'ready' || this.opener.subscribedThreadId === threadId) return () => {};
    const held = this.opener.openThread?.id === threadId ? this.opener.openThread : this.opener.readingThreads.get(threadId);
    const summaryRead = this.ctx.threadReads.begin(threadId);
    let preload: Preload | null = null;
    const ask = askPage(this.ctx, this.opener, client, threadId, held, { requests: false }, () => preload !== null && this.#claimed === preload);
    const made: Preload = { ...ask, threadId, client, held, thread: null, failed: false, summaryRead };
    const failed = () => { made.failed = true; };
    ask.subscribed?.catch(failed);
    ask.fetched.catch(failed);
    preload = made;
    this.#waiting = made;
    void ask.fetched.then((thread) => { made.thread = thread; }, () => undefined);
    return () => this.#release(made);
  }

  /** The waiting press on `threadId`, from this socket and the same visit, handed to the open asking for it. */
  claim(threadId: ThreadId, client: Client, held: Thread | undefined): Preload | null {
    const waiting = this.#waiting;
    if (!waiting || waiting.threadId !== threadId) return null;
    this.#waiting = null;
    if (waiting.client !== client || waiting.held !== held || waiting.failed) {
      this.giveBack(waiting);
      return null;
    }
    this.#claimed = waiting;
    return waiting;
  }

  /** The open showed the claimed page, or gave up on it: events stop patching it. */
  done(preload: Preload | null): void {
    if (preload && this.#claimed === preload) this.#claimed = null;
  }

  /** Unsubscribes a press nobody opened, unless the thread is held by now. */
  giveBack(preload: Preload): void {
    preload.summaryRead.cancel();
    const { threadId, client } = preload;
    void (preload.subscribed ?? preload.fetched).then(() => {
      if (client !== this.ctx.client || this.holds(threadId) || this.opener.openTarget === threadId) return;
      if (this.ctx.delegation.delegationSubscribedThreadId === threadId) return;
      return client.call('threads.unsubscribe', { threadId });
    }).catch(() => undefined);
  }

  /** Whether this side keeps `threadId` subscribed: the open thread, or a press on its way to opening it. */
  holds(threadId: ThreadId): boolean {
    return this.opener.subscribedThreadId === threadId || this.#waiting?.threadId === threadId || this.#claimed?.threadId === threadId;
  }

  /** The thread a press waits on, which an open leaving another thread must not unsubscribe. */
  get waitingThreadId(): ThreadId | undefined {
    return this.#waiting?.threadId;
  }

  cancelRepair(): void { this.#repairing = null; }

  /** Reuse the certified part of a held window and read any remaining pages before displaying the answer. */
  revalidate(client: Client, fresh: Thread, held: Thread | undefined, deviceSnapshot: boolean, around: MessageId | undefined, proofFirst: MessageId | undefined, newest: () => boolean): Promise<boolean> | undefined {
    const { readingThreads, readingPositions } = this.opener;
    const prefixProofs = this.ctx.store.core?.features?.threadPrefixProofs === true;
    let replaced = false;
    if (fresh.messagesFrom !== undefined && held) {
      const confirmedAt = proofFirst === undefined || proofFirst === held.messages[0]?.id ? 0 : lastIndexById(held.messages, proofFirst);
      if (confirmedAt > 0) {
        const messages = held.messages.slice(confirmedAt);
        const turns = new Set(messages.map(message => message.turnId));
        mergeResumed({ ...held, messages, turns: held.turns.filter(turn => turns.has(turn.id)), messagesBefore: proofFirst! }, fresh);
      } else mergeResumed(held, fresh);
    } else {
      const cached = deviceSnapshot || prefixProofs ? undefined : held ?? readingThreads.get(fresh.id);
      const ids = cached ? new Set(fresh.messages.map(message => message.id)) : undefined;
      const overlap = ids ? cached!.messages.findIndex(message => ids.has(message.id)) : -1;
      if (cached && overlap >= 0) {
        // Keep the loaded prefix before a legacy core's fresh, overlapping tail.
        fresh.messages = [...cached.messages.slice(0, overlap), ...fresh.messages];
        const turnIds = new Set(fresh.turns.map(turn => turn.id));
        fresh.turns = [...cached.turns.filter(turn => !turnIds.has(turn.id)), ...fresh.turns];
        fresh.messagesBefore = cached.messagesBefore;
      } else {
        readingThreads.forget(fresh.id);
        replaced = true;
      }
    }
    const place = () => {
      if (replaced && (!around || !fresh.messages.some(message => message.id === around))) readingPositions.delete(fresh.id);
    };
    if (held && prefixProofs) {
      const mark = readingThreads.mark();
      const current = () => newest() && !readingThreads.droppedSince(fresh.id, mark);
      const repair = refreshHeldWindow(this.ctx, client, held, fresh, current);
      if (repair) {
        this.#repairing = fresh;
        return repair.catch(error => {
          if (current() && !((wasDropped(error) || wasClosed(error)) && this.ctx.store.connection !== 'ready')) this.ctx.fail(error);
        }).then(() => {
          if (!current()) return false;
          place();
          return true;
        }).finally(() => { if (this.#repairing === fresh) this.#repairing = null; });
      }
    }
    place();
  }

  /** The pages presses loaded, which events patch beside the open thread. */
  pages(): (Thread | null | undefined)[] {
    const pages = [this.#waiting?.thread, this.#claimed?.thread];
    if (this.#repairing) pages.push(this.#repairing);
    return pages;
  }

  /** The page a press loaded for `threadId`, for the events that patch only the open thread. */
  thread(threadId: ThreadId): Thread | null {
    for (const page of this.pages()) if (page?.id === threadId) return page;
    return null;
  }

  #release(preload: Preload | null): void {
    if (!preload || this.#waiting !== preload) return;
    this.#waiting = null;
    this.giveBack(preload);
  }
}

/** How many threads a ready machine reads ahead, and on a connection that asks to save data. */
export const IDLE_PRELOADS = 4;
export const IDLE_PRELOADS_SAVING_DATA = 1;
/** Without requestIdleCallback, the wait before reading ahead; with it, the longest wait for an idle moment. */
export const IDLE_PRELOAD_WAIT_MS = 1000;

/** The threads to read ahead on this connection: one when it asks to save data (`navigator.connection.saveData`). */
export function idlePreloadCount(nav: { connection?: { saveData?: boolean } } | undefined = globalThis.navigator as { connection?: { saveData?: boolean } } | undefined): number {
  return nav?.connection?.saveData === true ? IDLE_PRELOADS_SAVING_DATA : IDLE_PRELOADS;
}

/** Off under a driven browser and in unit tests, which count their own calls, unless a test asked for it. */
export function idlePreloadAllowed(): boolean {
  if (typeof window !== 'undefined' && window.__BOITE_IDLE_PRELOAD_TEST__ === true) return true;
  if (import.meta.env.MODE === 'test') return false;
  return globalThis.navigator?.webdriver !== true;
}

/** What the read-ahead reads of the thread store, beside what a press reads. */
export interface ReadAheadSource extends Opener {
  readonly readingThreads: Opener['readingThreads'] & { has(threadId: string): boolean; prefill(threadId: string, thread: Thread, bytes: number): boolean; forget(threadId: string): boolean; mark(): number; droppedSince(threadId: string, mark: number): boolean };
  /** A project's rows as its card lists them: no archived, incognito or helper thread. */
  threadsOf(projectId: ProjectId): readonly ThreadSummary[];
}

/**
 * The first page of up to `IDLE_PRELOADS` threads, read ahead into the reading
 * cache once the machine is ready and the page idle, in the sidebar's order.
 * The open thread, archived and incognito ones and those already held are
 * skipped. One read at a time, each after the previous answered, and none
 * while a thread opens or a turn streams in the open one: an open or a drop
 * drops the rest, and an answer that lands after it. So is an answer whose
 * thread left the reading cache while it was read (a delete, an archive, a
 * rewind, a truncation) or is no longer one to read ahead. A read is a plain
 * `threads.get` with no `open`: it subscribes nothing, and the open that
 * follows asks only for what came after the page, as for any visit.
 */
export class IdlePreloads {
  /** The client the reads below went to; a drop or another client starts over. */
  #client: Client | null = null;
  /** The threads asked since the machine was ready, answered or refused. */
  readonly #asked = new Set<ThreadId>();
  #pauses = 0;
  #cancelIdle: (() => void) | null = null;
  /** The reads in progress; another value cancels them and drops their answer. */
  #run: object | null = null;

  /** `pressed` says a press waits on the thread: its page is on its way already. */
  constructor(private readonly ctx: StoreContext, private readonly source: ReadAheadSource, private readonly pressed: (threadId: ThreadId) => boolean) {}

  /** The threads read so far since the machine was ready. */
  get asked(): readonly ThreadId[] { return [...this.#asked]; }

  /** Looks at the machine again: starts the reads when it may, stops them when it must. */
  poke(): void {
    if (!idlePreloadAllowed()) return;
    const client = this.ctx.client;
    const ready = client !== null && this.ctx.store.connection === 'ready';
    if (!ready || client !== this.#client) {
      this.#cancel();
      this.#asked.clear();
      this.#client = ready ? client : null;
      if (!ready) return;
    }
    if (this.#held()) { this.#cancel(); return; }
    if (this.#run || this.#cancelIdle || this.#asked.size >= idlePreloadCount() || !this.#next()) return;
    this.#cancelIdle = whenIdle(() => { this.#cancelIdle = null; void this.#read(); }, { timeout: IDLE_PRELOAD_WAIT_MS, fallback: IDLE_PRELOAD_WAIT_MS });
  }

  /** An open holds the reads back until the returned resume: what was left waits for the next idle moment. */
  pause(): () => void {
    this.#pauses++;
    this.#cancel();
    let resumed = false;
    return () => {
      if (resumed) return;
      resumed = true;
      this.#pauses--;
      this.poke();
    };
  }

  /** The store lets this machine go. */
  stop(): void {
    this.#cancel();
    this.#asked.clear();
    this.#client = null;
  }

  /** An open on its way, or a turn running in the open thread, its answer streaming in. */
  #held(): boolean {
    return this.#pauses > 0 || this.source.loadingThreadId !== null || this.source.openThread?.status === 'running';
  }

  /** This machine's rows as Recent lists them (`compareRecent`): pins first, then the latest message. */
  #sidebarRows(): ThreadSummary[] {
    return this.ctx.store.projects.filter(project => project.archived !== true).flatMap(project => this.source.threadsOf(project.id))
      .sort((a, b) => compareRecent({ thread: a }, { thread: b }));
  }

  #cancel(): void {
    this.#cancelIdle?.();
    this.#cancelIdle = null;
    this.#run = null;
  }

  #wanted(row: ThreadSummary): boolean {
    const id = row.id;
    const { source } = this;
    return !row.archived && !row.incognito && !this.#asked.has(id) && !source.readingThreads.has(id)
      && source.openThread?.id !== id && source.subscribedThreadId !== id && source.openTarget !== id && !this.pressed(id);
  }

  #next(): ThreadSummary | undefined {
    return this.#sidebarRows().find(row => this.#wanted(row));
  }

  async #read(): Promise<void> {
    const client = this.#client;
    if (!client || this.#run || this.#held()) return;
    const run = {};
    this.#run = run;
    const current = () => this.#run === run && this.ctx.client === client && this.ctx.store.connection === 'ready';
    try {
      while (current() && !this.#held() && this.#asked.size < idlePreloadCount()) {
        const row = this.#next();
        if (!row) return;
        const threadId = row.id;
        this.#asked.add(threadId);
        const { params } = pageRequest(this.ctx, this.source, threadId, undefined);
        const mark = this.source.readingThreads.mark();
        let page: ThreadSnapshot;
        try {
          // The proof lets the open that follows hear "unchanged" instead of the page again.
          page = await client.call('threads.get', { ...params, ...(this.ctx.store.core?.features?.threadSnapshots ? { sync: true as const } : {}) });
        } catch {
          continue;
        }
        if (!current()) {
          // Cancelled: the thread may be read on the next idle moment.
          if (this.#client === client) this.#asked.delete(threadId);
          return;
        }
        const { opened: _opened, ...thread } = page;
        if (!this.#keepable(threadId, mark)) continue;
        this.ctx.positions.note(threadId, thread.messages, thread.messageOffset);
        this.#keep(threadId, thread);
      }
    } finally {
      if (this.#run === run) this.#run = null;
    }
  }

  /**
   * Whether an answer asked at `mark` may still go into the reading cache: its
   * thread was not dropped from it since (deleted, archived, rewound or
   * truncated), and its row is still one to read ahead.
   */
  #keepable(threadId: ThreadId, mark: number): boolean {
    if (this.source.readingThreads.droppedSince(threadId, mark)) return false;
    const row = this.ctx.store.projects.filter(project => project.archived !== true)
      .flatMap(project => this.source.threadsOf(project.id)).find(candidate => candidate.id === threadId);
    return row !== undefined && !row.archived && !row.incognito;
  }

  /** Into the reading cache, unless the thread came in meanwhile another way. */
  #keep(threadId: ThreadId, thread: Thread): void {
    const { source } = this;
    if (source.readingThreads.has(threadId) || source.openThread?.id === threadId || source.openTarget === threadId || this.pressed(threadId)) return;
    source.readingThreads.prefill(threadId, thread, readingCacheBytes(thread.messages));
  }
}
