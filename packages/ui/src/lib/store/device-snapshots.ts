/*
 * What the thread store asks of the device's snapshots (`lib/thread-snapshots.ts`):
 * one read before an open with nothing in memory, a write once a page settles
 * or is left, and a drop when the thread changed in a way the snapshot cannot
 * be caught up from.
 */

import { forTransport, withoutTrailingSlashes, type Thread, type ThreadId } from '@boite/contracts';
import { whenIdle } from '../idle';
import { resumeRequest } from '../thread-rows';
import { SNAPSHOT_READ_WAIT_MS, SNAPSHOT_WRITE_DELAY_MS, threadSnapshots, type ThreadSnapshots } from '../thread-snapshots';
import type { StoreContext } from './context';
import { lightPage } from './reading-pages.svelte';

/** The page a visit leaves in the reading cache, and on the device: an expanded tool gives its full output back to the core first. */
export function readingPage(ctx: StoreContext, thread: Thread): Thread {
  const messages = forTransport(thread.messages, lightPage(ctx));
  return messages.every((message, index) => message === thread.messages[index]) ? thread : { ...thread, messages };
}

/** What a write reads of the thread store when its time comes. */
interface Pages {
  readonly openThread: Thread | null;
  readonly readingThreads: { get(threadId: string): Thread | undefined };
}

export class DeviceSnapshots {
  /** The writes waiting for their page to settle, by thread. */
  readonly #writes = new Map<ThreadId, () => void>();
  /** Bumped when the store lets its machine go: a write that fires after it is not made. */
  #generation = 0;

  /** `unloaded` holds the threads shown as a bare row, their page not in yet: nothing to write. */
  constructor(private readonly ctx: StoreContext, private readonly pages: Pages, private readonly unloaded: ReadonlySet<ThreadId>) {}

  /** What to write for a thread: its page on screen, or the one the reading cache holds. */
  #page(threadId: ThreadId): Thread | undefined {
    const open = this.pages.openThread;
    return open?.id === threadId && !this.unloaded.has(threadId) ? readingPage(this.ctx, open) : this.pages.readingThreads.get(threadId);
  }

  /** False when there is nothing to read for `threadId`: the open then never waits. */
  mayHold(threadId: ThreadId): boolean {
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
    const read = await Promise.race([target.snapshots.read(target.machine, threadId), waited]).finally(() => clearTimeout(late));
    return read?.thread;
  }

  /**
   * Writes `threadId`'s page once it has stayed put for
   * `SNAPSHOT_WRITE_DELAY_MS` and the page is idle: what `page` answers then,
   * or `left` once the reader moved on and the reading cache let it go.
   */
  schedule(threadId: ThreadId, left?: Thread): void {
    const target = this.#target();
    if (!target) return;
    this.#writes.get(threadId)?.();
    // A purge of the machine or its address after this point, a removal or a revocation, skips the write.
    const mark = target.snapshots.mark();
    const generation = this.#generation;
    let cancelIdle: (() => void) | null = null;
    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      cancelIdle = whenIdle(() => {
        this.#writes.delete(threadId);
        if (this.#generation !== generation || this.ctx.store.core?.coreId !== target.machine) return;
        const thread = this.#page(threadId) ?? left;
        if (!thread || thread.messages.length === 0) return;
        void target.snapshots.write(target.machine, target.url, thread, resumeRequest(threadId, thread).after ?? null, mark);
      });
    }, SNAPSHOT_WRITE_DELAY_MS);
    this.#writes.set(threadId, () => { clearTimeout(timer); cancelIdle?.(); this.#writes.delete(threadId); });
  }

  /** The store lets its machine go: the writes still waiting are not made. */
  stop(): void {
    this.#generation++;
    for (const cancel of [...this.#writes.values()]) cancel();
  }

  /** The thread changed in a way its snapshot cannot be caught up from: it goes. */
  drop(threadId: ThreadId): void {
    this.#writes.get(threadId)?.();
    const target = this.#target();
    if (target) void target.snapshots.drop(target.machine, threadId);
  }
}
