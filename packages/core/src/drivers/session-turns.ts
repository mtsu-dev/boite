/** A native session runs one turn at a time and stays busy until the last queued turn ends. */
export class SessionTurns<Turn> {
  #queue = Promise.resolve();
  #running = 0;

  constructor(
    private readonly run: (turn: Turn) => Promise<void>,
    private readonly failed: (turn: Turn, error: unknown) => void,
  ) {}

  get busy(): boolean {
    return this.#running > 0;
  }

  enqueue(turn: Turn): void {
    this.#running += 1;
    this.#queue = this.#queue.then(async () => {
      try {
        await this.run(turn);
      } catch (error) {
        this.failed(turn, error);
      }
    });
  }

  end(): void {
    this.#running = Math.max(0, this.#running - 1);
  }
}
