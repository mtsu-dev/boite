import type { Message } from '@boite/contracts';

const BLOCK_SIZE = 64;

/** Read only the affected block when a prompt lands or a message is replaced. */
export class OutlinePrompts {
  readonly #blocks: (() => Message[])[] = [];
  #previous: Message[][] = [];
  #prompts: Message[] = [];

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
    const count = Math.ceil(this.messages().length / BLOCK_SIZE);
    if (this.#blocks.length > count) this.#blocks.length = count;
    while (this.#blocks.length < count) this.#blocks.push(this.#block(this.#blocks.length * BLOCK_SIZE));
    const blocks = this.#blocks.map(read => read());
    if (blocks.length !== this.#previous.length || blocks.some((block, index) => block !== this.#previous[index])) {
      this.#previous = blocks;
      this.#prompts = blocks.flat();
    }
    return this.#prompts;
  }
}
