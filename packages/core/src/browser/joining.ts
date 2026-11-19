/*
 * Tabs on their way into a conversation. Attaching a tab takes several round
 * trips to the browser: the tab limits count the tabs still attaching, and a
 * command that names no tab waits for the windows a page just opened, so the
 * page read right after the click that opened one is that window's.
 */
import type { ThreadId } from '@boite/contracts';

/** How long a command that names no tab waits for a window still joining its conversation. */
export const JOIN_WAIT_MS = 5_000;

export class TabsJoining {
  #attaching = new Map<ThreadId, number>();
  #attachingAll = 0;
  #windows = new Map<ThreadId, Set<Promise<void>>>();
  /** A pause before a window a page opened is attached; tests lengthen it to hold that window joining. */
  delayMs = 0;

  /** Tabs of `threadId` still attaching, or of every conversation without one. */
  count(threadId?: ThreadId): number {
    return threadId === undefined ? this.#attachingAll : this.#attaching.get(threadId) ?? 0;
  }

  /** Holds a tab's place from the limit check until it is attached or failed: a burst of windows sees each other. */
  reserve(threadId: ThreadId): () => void {
    this.#attaching.set(threadId, this.count(threadId) + 1); this.#attachingAll++;
    let held = true;
    return () => {
      if (!held) return;
      held = false; this.#attachingAll--;
      const left = this.count(threadId) - 1;
      if (left > 0) this.#attaching.set(threadId, left); else this.#attaching.delete(threadId);
    };
  }

  /** Runs the attaching of a window a page of `threadId` opened, held from now until it ends. */
  window(threadId: ThreadId, attach: () => Promise<void>): Promise<void> {
    const pending = this.#windows.get(threadId) ?? new Set<Promise<void>>();
    this.#windows.set(threadId, pending);
    const delay = this.delayMs;
    const joined: Promise<void> = (delay > 0 ? Bun.sleep(delay) : Promise.resolve()).then(attach).catch(() => {}).finally(() => {
      pending.delete(joined);
      if (pending.size === 0 && this.#windows.get(threadId) === pending) this.#windows.delete(threadId);
    });
    pending.add(joined);
    return joined;
  }

  /**
   * Waits, within `JOIN_WAIT_MS`, for the windows of `threadId` still joining
   * it, those announced while it waits included. True when it waited.
   */
  async windows(threadId: ThreadId): Promise<boolean> {
    if (!this.#windows.get(threadId)?.size) return false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const out = new Promise<'out'>(resolve => { timer = setTimeout(() => resolve('out'), JOIN_WAIT_MS); });
    for (let pending = this.#windows.get(threadId); pending?.size; pending = this.#windows.get(threadId)) {
      if (await Promise.race([Promise.all(pending), out]) === 'out') break;
    }
    clearTimeout(timer);
    return true;
  }
}
