/**
 * The bottom message's height, at most once per `gap` ms: what a pinned
 * timeline follows (MessageList). A height noted inside the gap is read again
 * from `current` when the gap ends, so the last one always lands.
 */
export class TailHeight {
  value = $state(0);
  #at = 0;
  #timer = 0;
  readonly #gap: number;
  readonly #current: () => number;

  constructor(gap: number, current: () => number) {
    this.#gap = gap;
    this.#current = current;
  }

  note(height: number): void {
    if (this.#timer) return;
    const wait = this.#gap - (performance.now() - this.#at);
    if (wait <= 0) {
      this.#at = performance.now();
      this.value = height;
      return;
    }
    this.#timer = window.setTimeout(() => {
      this.#timer = 0;
      this.#at = performance.now();
      this.value = this.#current();
    }, wait);
  }

  stop(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = 0;
  }
}
