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
  /** Per opener target: windows its page opened that Chrome has not announced yet, oldest first. */
  #announced = new Map<string, Array<() => void>>();
  /** Per opener target: windows Chrome announced before their page's `Page.windowOpen`. */
  #early = new Map<string, number>();
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
    const delay = this.delayMs;
    return this.#hold(threadId, (delay > 0 ? Bun.sleep(delay) : Promise.resolve()).then(attach));
  }

  /**
   * The page of target `opener` in `threadId` opened a window (`Page.windowOpen`, sent before the
   * script or the input event that opened it returns). Chrome's `Target.targetCreated` for that
   * window can come later, after the next command began: commands wait from now until it does,
   * `JOIN_WAIT_MS` at most. A window Chrome already announced (`adopted`) waits for nothing.
   */
  announce(threadId: ThreadId, opener: string): void {
    const early = this.#early.get(opener) ?? 0;
    if (early > 0) {
      if (early > 1) this.#early.set(opener, early - 1); else this.#early.delete(opener);
      return;
    }
    let done!: () => void;
    const adopted = new Promise<void>(resolve => { done = resolve; });
    const timer = setTimeout(() => this.#settle(opener, done), JOIN_WAIT_MS);
    this.#announced.set(opener, [...(this.#announced.get(opener) ?? []), done]);
    void this.#hold(threadId, adopted.finally(() => clearTimeout(timer)));
  }

  /** Chrome announced a window the page of `opener` opened; called once its attaching is held (`window`). */
  adopted(opener: string): void {
    const done = this.#announced.get(opener)?.[0];
    if (done) this.#settle(opener, done);
    else this.#early.set(opener, (this.#early.get(opener) ?? 0) + 1);
  }

  /** The tab of target `opener` is gone: nothing it announced is waited for any more. */
  forget(opener: string): void {
    for (const done of this.#announced.get(opener) ?? []) done();
    this.#announced.delete(opener);
    this.#early.delete(opener);
  }

  #settle(opener: string, done: () => void): void {
    const left = (this.#announced.get(opener) ?? []).filter(other => other !== done);
    if (left.length) this.#announced.set(opener, left); else this.#announced.delete(opener);
    done();
  }

  #hold(threadId: ThreadId, work: Promise<void>): Promise<void> {
    const pending = this.#windows.get(threadId) ?? new Set<Promise<void>>();
    this.#windows.set(threadId, pending);
    const joined: Promise<void> = work.catch(() => {}).finally(() => {
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
