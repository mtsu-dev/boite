import type { ThreadId } from '@boite/contracts';
import type { TurnHandle } from '../drivers/types.ts';
import { abortable } from '../abortable.ts';

type Steer = NonNullable<TurnHandle['steer']>;

/** One write at a time to the active native attempt, even if its provider never acknowledges. */
export class TurnSteering {
  readonly #active = new Map<ThreadId, AbortController>();

  get size(): number { return this.#active.size; }

  has(threadId: ThreadId): boolean { return this.#active.has(threadId); }

  begin(threadId: ThreadId) {
    if (this.#active.has(threadId)) return null;
    const controller = new AbortController();
    this.#active.set(threadId, controller);
    const { signal } = controller;
    return {
      signal,
      send: async (steer: Steer, text: string, images?: Parameters<Steer>[1], accepted?: () => void): Promise<boolean> => {
        signal.throwIfAborted();
        return abortable(steer(text, images, accepted && (() => { if (!signal.aborted) accepted(); }), signal), signal);
      },
      release: () => { if (this.#active.get(threadId) === controller) this.end(threadId); },
    };
  }

  end(threadId: ThreadId): void {
    const controller = this.#active.get(threadId);
    this.#active.delete(threadId);
    controller?.abort(new Error('the native attempt ended before acknowledgement'));
  }
}
