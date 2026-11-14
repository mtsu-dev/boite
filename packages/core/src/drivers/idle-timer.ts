/** The one deadline that ends a warm session nobody uses: arming replaces the one still pending. */
export class IdleTimer {
  #timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly expired: () => void) {}

  arm(ms: number): void {
    this.clear();
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.expired();
    }, ms);
    this.#timer.unref?.();
  }

  clear(): void {
    if (this.#timer === null) return;
    clearTimeout(this.#timer);
    this.#timer = null;
  }
}
