/*
 * What the thread store asks of the device's snapshots (`lib/thread-snapshots.ts`):
 * one read before an open with nothing in memory, a write once a page settles
 * or is left, and a drop when the thread changed in a way the snapshot cannot
 * be caught up from.
 */

import { forTransport, withoutTrailingSlashes, type Thread, type ThreadId, type TransportOptions } from '@boite/contracts';
import { whenIdle } from '../idle';
import { SNAPSHOT_READ_WAIT_MS, SNAPSHOT_WRITE_DELAY_MS, threadSnapshots, type ThreadSnapshots } from '../thread-snapshots';
import type { StoreContext } from './context';
import { lightPage, type ReadingPosition } from './reading-pages.svelte';
import { readingAround } from './thread-preload';
import { snapshotPayload } from './snapshot-payload';

/** The page a visit leaves in the reading cache, and on the device: an expanded tool gives its full output back to the core first. */
export function readingPage(ctx: StoreContext, thread: Thread): Thread {
  const messages = forTransport(thread.messages, lightPage(ctx));
  return messages.every((message, index) => message === thread.messages[index]) ? thread : { ...thread, messages };
}

/** What a write reads of the thread store when its time comes, and where an open's reader left each thread. */
interface Pages {
  readonly openThread: Thread | null;
  readonly readingThreads: { get(threadId: string): Thread | undefined };
  readonly readingPositions: Map<string, ReadingPosition>;
}

export class DeviceSnapshots {
  /** The writes waiting for their page to settle, by thread. */
  readonly #writes = new Map<ThreadId, () => void>();
  readonly #versions = new WeakMap<Thread, number>();
  /** Bumped when the store lets its machine go: a write that fires after it is not made. */
  #generation = 0;
  /** Stops hearing of purges, which let the waiting writes go early (the database keeps them out anyway). */
  #unlisten: (() => void) | null = null;

  /** `unloaded` holds the threads shown as a bare row, their page not in yet: nothing to write. */
  constructor(private readonly ctx: StoreContext, private readonly pages: Pages, private readonly unloaded: ReadonlySet<ThreadId>) {
    // Which threads the device holds is read as the page starts: an open asks for a snapshot only once it is known.
    threadSnapshots()?.warm();
  }

  /** What to write for a thread: its page on screen, or the one the reading cache holds. */
  #page(threadId: ThreadId): { thread?: Thread; transport?: TransportOptions } {
    const open = this.pages.openThread;
    return open?.id === threadId && !this.unloaded.has(threadId) ? { thread: open, transport: lightPage(this.ctx) } : { thread: this.pages.readingThreads.get(threadId) };
  }

  changed(thread: Thread): void {
    const version = this.#versions.get(thread);
    if (version !== undefined) this.#versions.set(thread, version + 1);
  }

  /**
   * False when there is nothing to read for `threadId`: the open then never
   * waits. False too when the reader left it away from its end: the snapshot
   * is the last page, and the open asks for the page around their message.
   */
  mayHold(threadId: ThreadId): boolean {
    if (readingAround(this.ctx, this.pages, threadId) !== undefined) return false;
    const target = this.#target();
    return target !== null && target.snapshots.mayHold(target.machine, threadId);
  }

  /**
   * This machine's snapshots, when there are any: never on a page without
   * IndexedDB or WebCrypto, a core that gives no id, or a connection that is
   * not the owner's own or a paired device's.
   */
  #target(): { snapshots: ThreadSnapshots; machine: string; url: string | null } | null {
    const snapshots = threadSnapshots();
    const s = this.ctx.store;
    const machine = s.core?.coreId;
    if (!snapshots || !machine || (s.principal !== 'owner' && s.principal !== 'session')) return null;
    const url = this.ctx.connection.endpointUrl;
    return { snapshots, machine, url: url === null ? null : withoutTrailingSlashes(url) };
  }

  /** The snapshot of `threadId`, when one is read and decrypted within `SNAPSHOT_READ_WAIT_MS`. */
  async read(threadId: ThreadId): Promise<Thread | undefined> {
    const target = this.#target();
    if (!target?.snapshots.mayHold(target.machine, threadId)) return undefined;
    let late: ReturnType<typeof setTimeout> | undefined;
    const waited = new Promise<undefined>(resolve => { late = setTimeout(() => resolve(undefined), SNAPSHOT_READ_WAIT_MS); });
    // A read that fails (the database blocked by another tab) is no snapshot: the open goes to the machine.
    const read = await Promise.race([target.snapshots.read(target.machine, threadId).catch(() => undefined), waited]).finally(() => clearTimeout(late));
    return read?.thread;
  }

  /**
   * Writes `threadId`'s page once it has stayed put for
   * `SNAPSHOT_WRITE_DELAY_MS` and the page is idle: the page on screen or the
   * one the reading cache holds, taken only once the write's generations are
   * read, and nothing when neither holds it any more.
   */
  schedule(threadId: ThreadId): void {
    const target = this.#target();
    if (!target) return;
    this.#writes.get(threadId)?.();
    this.#listen(target.snapshots);
    // A purge of the machine or a drop of the thread after this point, in any window, keeps the write out.
    const mark = target.snapshots.mark(target.machine, threadId, target.url);
    const generation = this.#generation;
    let live = true;
    let cancelIdle: (() => void) | null = null;
    const active = () => live && this.#generation === generation && this.ctx.store.core?.coreId === target.machine;
    const idle = () => new Promise<boolean>(resolve => {
      if (!active()) { resolve(false); return; }
      const cancel = whenIdle(() => { cancelIdle = null; resolve(active()); }, { fallback: 20 });
      cancelIdle = () => { cancel(); resolve(false); };
    });
    const run = async () => {
      // The mark precedes every read of the page. Even if IndexedDB was busy,
      // projection begins in an idle turn and returns there between batches.
      await mark;
      if (!await idle()) return;
      const { thread, transport } = this.#page(threadId);
      if (!thread?.messages.length) return;
      const version = this.#versions.get(thread) ?? 0;
      this.#versions.set(thread, version);
      const messages = thread.messages, count = messages.length, turns = thread.turns, turnCount = turns.length;
      const current = () => active() && this.#versions.get(thread) === version && thread.messages === messages && messages.length === count && thread.turns === turns && turns.length === turnCount;
      const plain = await snapshotPayload(thread, transport, async () => await idle() && current());
      if (plain !== undefined && current()) await target.snapshots.writePrepared(target.machine, target.url, threadId, mark, plain, current);
      if (active() && !current()) this.schedule(threadId);
    };
    const timer = setTimeout(() => {
      void run().catch(() => undefined).finally(() => {
        if (this.#writes.get(threadId) === cancel) this.#writes.delete(threadId);
      });
    }, SNAPSHOT_WRITE_DELAY_MS);
    const cancel = () => { live = false; clearTimeout(timer); cancelIdle?.(); this.#writes.delete(threadId); };
    this.#writes.set(threadId, cancel);
  }

  /** A purge here or in another window that concerns this machine lets the waiting writes go. */
  #listen(snapshots: ThreadSnapshots): void {
    this.#unlisten ??= snapshots.onPurge(({ machines, urls, all }) => {
      const machine = this.ctx.store.core?.coreId;
      const url = this.ctx.connection.endpointUrl;
      if (all || (machine && machines.includes(machine)) || (url !== null && urls.includes(withoutTrailingSlashes(url)))) this.#cancelAll();
    });
  }

  #cancelAll(): void {
    for (const cancel of [...this.#writes.values()]) cancel();
  }

  /** The store lets its machine go: the writes still waiting are not made. */
  stop(): void {
    this.#generation++;
    this.#cancelAll();
    this.#unlisten?.();
    this.#unlisten = null;
  }

  /** The thread changed in a way its snapshot cannot be caught up from: it goes. */
  drop(threadId: ThreadId): void {
    this.#writes.get(threadId)?.();
    const target = this.#target();
    if (target) void target.snapshots.drop(target.machine, threadId);
  }
}
