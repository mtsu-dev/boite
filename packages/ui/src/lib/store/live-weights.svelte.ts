import { projectMessage, type Message, type TransportOptions } from '@boite/contracts';
import { READING_CACHE_BYTES, READING_CACHE_MESSAGES, messageChars } from '../reading-cache';

const BLOCK_MESSAGES = 64;
type Weight = () => number;
interface Compacted { messages: Message[]; bytes: number }
interface Block { chars: Weight; compact: () => Compacted }

/** Weights follow the reactive messages in this mounted timeline, including edits to a held part. */
export class LiveWeights {
  readonly #messages = new WeakMap<Message, Weight>();
  #pages = new WeakMap<readonly Message[], Block[]>();
  #activeBlocks = $derived.by(() => {
    const page = this.activePage();
    if (!page || page.length > READING_CACHE_MESSAGES) return null;
    let blocks = this.#pages.get(page);
    if (!blocks) this.#pages.set(page, blocks = []);
    const count = Math.ceil(page.length / BLOCK_MESSAGES);
    blocks.length = Math.min(blocks.length, count);
    while (blocks.length < count) blocks.push(this.#blockWeight(page, blocks.length * BLOCK_MESSAGES));
    return blocks.slice();
  });
  #bytes = $derived.by(() => {
    const blocks = this.#activeBlocks;
    if (!blocks) return READING_CACHE_BYTES + 1;
    let chars = 0;
    for (const block of blocks) chars += block.chars();
    return chars * 2;
  });
  #compacted = $derived.by((): Compacted | undefined => {
    const blocks = this.#activeBlocks;
    if (!blocks || this.#bytes <= READING_CACHE_BYTES) return;
    const messages: Message[] = [];
    let bytes = 0;
    for (const block of blocks) {
      const light = block.compact();
      bytes += light.bytes;
      if (bytes > READING_CACHE_BYTES) return;
      messages.push(...light.messages);
    }
    return { messages, bytes };
  });

  constructor(private readonly activePage: () => readonly Message[] | undefined, private readonly transport: () => TransportOptions) {}

  get bytes(): number { return this.#bytes; }
  get compacted(): Compacted | undefined { return this.#compacted; }

  /** Keep the active page measured while the reader is still on it. */
  watch(): () => void {
    const stop = $effect.root(() => {
      $effect.pre(() => { void this.#bytes; void this.#compacted; });
    });
    return () => { stop(); this.reset(); };
  }

  reset(): void {
    this.#pages = new WeakMap();
  }

  message(message: Message): number {
    return this.#messageWeight(message)();
  }

  #messageWeight(message: Message): Weight {
    let read = this.#messages.get(message);
    if (!read) {
      const chars = $derived(messageChars(message));
      this.#messages.set(message, read = () => chars);
    }
    return read;
  }

  #blockWeight(page: readonly Message[], first: number): Block {
    // Svelte skips tracking derived values read in the reaction that creates
    // them. Prepare each block's readers separately from summing their weights.
    const weights = $derived.by(() => {
      const reads: { message: Message; chars: Weight }[] = [];
      for (let at = first; at < first + BLOCK_MESSAGES; at++) {
        const message = page[at];
        if (!message) break;
        reads.push({ message, chars: this.#messageWeight(message) });
      }
      return reads;
    });
    const chars = $derived.by(() => {
      let sum = 0;
      for (const weight of weights) sum += weight.chars();
      return sum;
    });
    const compacted = $derived.by((): Compacted => {
      const options = this.transport();
      const messages: Message[] = [];
      let chars = 0;
      for (const weight of weights) {
        const message = projectMessage(weight.message, options);
        chars += message === weight.message ? weight.chars() : messageChars(message);
        messages.push(message);
      }
      return { messages, bytes: chars * 2 };
    });
    return { chars: () => chars, compact: () => compacted };
  }
}
