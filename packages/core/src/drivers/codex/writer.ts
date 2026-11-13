/** A session's writer is released by process closure, including inherited teardown. */
export class CodexWriter {
  readonly #closed = Promise.withResolvers<void>();
  readonly #closing = Promise.withResolvers<void>();
  readonly closed = this.#closed.promise;

  constructor(private readonly previousClosed: Promise<void>) { }

  /** Cancellation wakes startup without releasing a predecessor's writer. */
  wait(stopped?: Promise<void>): Promise<void> {
    return Promise.race([this.previousClosed, this.#closing.promise, ...(stopped ? [stopped] : [])]);
  }

  release(processClosed: Promise<void>, onClosed: () => void): void {
    this.#closing.resolve();
    // An abandoned replacement may never have spawned. Its successor must still
    // wait for the original writer, not just that replacement's empty process.
    void Promise.all([this.previousClosed, processClosed]).then(() => {
      onClosed();
      this.#closed.resolve();
    });
  }
}
