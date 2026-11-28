import type { Message } from '@boite/contracts';

const BLOCK_SIZE = 64;

/** Read only the affected block when a prompt lands or a message is replaced. */
export class OutlinePrompts {
  readonly #blocks: (() => Message[])[] = [];
  #active: (() => Message[])[] = [];
  #previous: Message[][] = [];
  #prompts: Message[] = [];

  // Svelte skips tracking derived values read in the reaction that creates
  // them, leaving newly connected block deriveds orphaned on upstream signals.
  // Prepare the block readers in a separate derived from the one that reads them.
  #activeBlocks = $derived.by(() => {
    const count = Math.ceil(this.messages().length / BLOCK_SIZE);
    if (this.#blocks.length === count) return this.#active;
    if (this.#blocks.length > count) this.#blocks.length = count;
    while (this.#blocks.length < count) this.#blocks.push(this.#block(this.#blocks.length * BLOCK_SIZE));
    return this.#active = this.#blocks.slice();
  });

  #current = $derived.by(() => {
    const blocks = this.#activeBlocks.map(read => read());
    if (blocks.length !== this.#previous.length || blocks.some((block, index) => block !== this.#previous[index])) {
      this.#previous = blocks;
      this.#prompts = blocks.flat();
    }
    return this.#prompts;
  });

  constructor(private readonly messages: () => readonly Message[]) {}

  #block(start: number): () => Message[] {
    const prompts = $derived.by(() => {
      const messages = this.messages(), found: Message[] = [];
      for (let index = start; index < start + BLOCK_SIZE; index++) {
        const message = messages[index];
        if (!message) break;
        if (message.role === 'user') found.push(message);
      }
      return found;
    });
    return () => prompts;
  }

  get current(): Message[] {
    return this.#current;
  }
}
