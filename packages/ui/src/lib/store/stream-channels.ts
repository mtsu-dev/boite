import type { StreamChannel, ThreadId } from '@boite/contracts';
import { onPhone } from '../onboarding';
import type { StoreContext } from './context';

/** Every channel but a running command's output: what a phone takes while its tool cards are folded. */
const FOLDED: readonly StreamChannel[] = ['text', 'tools'];

/**
 * Which stream channels this window subscribes a thread with. A desktop window
 * names none and receives everything, as before channels existed. A phone
 * leaves a running command's live output on the core (a driver redraws it as
 * often as once a second, thousands of characters each time) until a card
 * showing a running call opens; then it asks for it, for that thread, until
 * the last such card closes. A finished call reaches it either way.
 */
export class StreamChannels {
  /** Open cards on a running call, by thread. */
  readonly #watching = new Map<ThreadId, number>();
  /** Whether this window draws the phone layout. A test sets it. */
  phone: () => boolean = onPhone;

  constructor(private readonly ctx: StoreContext) {}

  #narrows(): boolean {
    return this.ctx.store.core?.features?.streamChannels === true && this.phone();
  }

  /** The `channels` that `threads.subscribe` and an opening `threads.get` carry for `threadId`. */
  params(threadId: ThreadId): { channels?: StreamChannel[] } {
    if (!this.#narrows() || this.#watching.has(threadId)) return {};
    return { channels: [...FOLDED] };
  }

  /** A card shows a running call of `threadId`: its live output streams to this window until the release. */
  watch(threadId: ThreadId): () => void {
    const count = this.#watching.get(threadId) ?? 0;
    this.#watching.set(threadId, count + 1);
    if (count === 0) this.#resubscribe(threadId);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const left = (this.#watching.get(threadId) ?? 1) - 1;
      if (left > 0) { this.#watching.set(threadId, left); return; }
      this.#watching.delete(threadId);
      this.#resubscribe(threadId);
    };
  }

  /** The thread's channels changed: the core hears it when this window follows that thread. */
  #resubscribe(threadId: ThreadId): void {
    const client = this.ctx.client;
    if (!client || this.ctx.store.connection !== 'ready' || !this.#narrows()) return;
    if (this.ctx.threads.subscribedThreadId !== threadId && this.ctx.delegation.delegationSubscribedThreadId !== threadId) return;
    void client.call('threads.subscribe', { threadId, ...this.params(threadId) }).catch(() => undefined);
  }
}
