import type { Message } from '@boite/contracts';
import { messageChars } from '../reading-cache';

const BLOCK_MESSAGES = 64;

/** Weights follow the reactive messages in this mounted timeline, including edits to a held part. */
export class LiveWeights {
  readonly #messages = new WeakMap<Message, () => number>();
  #page: readonly Message[] | undefined;
  #blocks: (() => number)[] = [];

  message(message: Message): number {
    let read = this.#messages.get(message);
    if (!read) {
      const chars = $derived(messageChars(message));
      this.#messages.set(message, read = () => chars);
    }
    return read();
  }

  total(page: readonly Message[]): number {
    if (this.#page !== page) {
      this.#page = page;
      this.#blocks = [];
    }
    const blocks = Math.ceil(page.length / BLOCK_MESSAGES);
    this.#blocks.length = Math.min(this.#blocks.length, blocks);
    let total = 0;
    for (let index = 0; index < blocks; index++) {
      let read = this.#blocks[index];
      if (!read) {
        const first = index * BLOCK_MESSAGES;
        const chars = $derived.by(() => {
          let sum = 0;
          for (let at = first; at < first + BLOCK_MESSAGES; at++) {
            const message = page[at];
            if (!message) break;
            sum += this.message(message);
          }
          return sum;
        });
        this.#blocks[index] = read = () => chars;
      }
      total += read();
    }
    return total;
  }
}
