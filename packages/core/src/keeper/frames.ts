/*
 * Frames over a Bun socket, either end. A write the kernel takes only in part
 * keeps the rest, in order, until the socket drains: a burst of output must
 * reach the other side whole or not at all.
 */

import type { Socket } from 'bun';

export class FrameSocket<Out> {
  readonly #socket: Socket<unknown>;
  #pending: Uint8Array[] = [];
  #pendingBytes = 0;
  readonly #encoder = new TextEncoder();
  #closed = false;

  constructor(socket: Socket<unknown>, private readonly maxPending: number, private readonly onOverflow: () => void) {
    this.#socket = socket;
  }

  get closed(): boolean { return this.#closed; }

  send(frame: Out): void {
    if (this.#closed) return;
    const bytes = this.#encoder.encode(`${JSON.stringify(frame)}\n`);
    if (this.#pending.length > 0) { this.#hold(bytes); return; }
    const written = this.#socket.write(bytes);
    if (written < bytes.length) this.#hold(bytes.subarray(Math.max(0, written)));
  }

  /** The socket can take more: what waited goes first. */
  drain(): void {
    while (this.#pending.length > 0) {
      const head = this.#pending[0]!;
      const written = this.#socket.write(head);
      if (written >= head.length) {
        this.#pending.shift();
        this.#pendingBytes -= head.length;
        if (this.#pending.length === 0 && this.#closed) this.#end();
        continue;
      }
      if (written > 0) {
        this.#pending[0] = head.subarray(written);
        this.#pendingBytes -= written;
      }
      return;
    }
  }

  /** Ends the connection once what waits is written: a `release` sent just before still arrives. */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#pending.length === 0) this.#end();
  }

  #end(): void {
    this.#pending = [];
    this.#pendingBytes = 0;
    try { this.#socket.end(); } catch { /* already gone */ }
  }

  /** Marks the socket gone without touching it: its `close` handler already ran. */
  gone(): void {
    this.#closed = true;
    this.#pending = [];
    this.#pendingBytes = 0;
  }

  #hold(bytes: Uint8Array): void {
    this.#pending.push(bytes);
    this.#pendingBytes += bytes.length;
    if (this.#pendingBytes > this.maxPending) {
      this.#closed = true;
      this.#end();
      this.onOverflow();
    }
  }
}
