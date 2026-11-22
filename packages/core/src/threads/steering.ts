import type { ThreadId } from '@boite/contracts';
import type { TurnHandle } from '../drivers/types.ts';
import { abortable } from '../abortable.ts';

type Steer = NonNullable<TurnHandle['steer']>;
const MAIL_RECEIPT_GRACE_MS = 5_000;

export interface MailDelivery {
  release: () => void;
  signal: AbortSignal;
}

/** A finished attempt releases mail delivery even if its receipt is still in flight. */
export async function waitForMailReceipt(receipt: Promise<boolean>, attempt: AbortSignal, stop: AbortSignal, delivery?: MailDelivery): Promise<boolean> {
  const expiry = new AbortController();
  const signal = AbortSignal.any([stop, expiry.signal, ...(delivery ? [delivery.signal] : [])]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const ended = () => {
    delivery?.release();
    if (signal.aborted) return;
    timer = setTimeout(() => expiry.abort(new Error('Provider acknowledgement did not arrive after the native attempt ended')), MAIL_RECEIPT_GRACE_MS);
    timer.unref?.();
  };
  if (attempt.aborted) ended();
  else attempt.addEventListener('abort', ended, { once: true });
  try { return await abortable(receipt, signal); }
  finally { clearTimeout(timer); attempt.removeEventListener('abort', ended); }
}

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
