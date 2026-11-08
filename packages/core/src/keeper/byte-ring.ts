/* The last bytes of a stream: a PTY's history, an agent's stderr. */

/** Kept as the chunks that came in. */
export class ByteRing {
  #chunks: Uint8Array[] = [];
  #length = 0;

  constructor(private readonly max: number) {}

  push(bytes: Uint8Array): void {
    this.#chunks.push(bytes);
    this.#length += bytes.length;
    while (this.#chunks.length > 1 && this.#length - this.#chunks[0]!.length >= this.max) {
      this.#length -= this.#chunks.shift()!.length;
    }
    // Still too long: the oldest chunk keeps its tail.
    if (this.#length > this.max) {
      this.#chunks[0] = this.#chunks[0]!.slice(this.#length - this.max);
      this.#length = this.max;
    }
  }

  bytes(): Uint8Array {
    const out = new Uint8Array(this.#length);
    let at = 0;
    for (const chunk of this.#chunks) { out.set(chunk, at); at += chunk.length; }
    // A long-lived shell's history stays one chunk instead of thousands.
    this.#chunks = this.#length > 0 ? [out] : [];
    return out;
  }
}
