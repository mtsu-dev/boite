/*
 * An agent process the keeper holds on three pipes. Its stdout is a protocol
 * stream: every byte the core has not acknowledged stays here, numbered from
 * the first, so a core that lost some can ask for them again, and a stream
 * that passes `KEEPER_OUT_WINDOW_BYTES` unacknowledged is no longer read
 * until the core catches up. Its stderr is only a tail.
 */

import { KEEPER_ERR_BYTES, KEEPER_OUT_WINDOW_BYTES } from './protocol.ts';
import { ByteRing } from './byte-ring.ts';

/** The unacknowledged end of a stream: bytes from `acked` to `end`. */
export class OutWindow {
  #chunks: Uint8Array[] = [];
  #acked = 0;
  #end = 0;

  get acked(): number { return this.#acked; }
  get end(): number { return this.#end; }
  get held(): number { return this.#end - this.#acked; }

  push(bytes: Uint8Array): void {
    if (bytes.length === 0) return;
    this.#chunks.push(bytes);
    this.#end += bytes.length;
  }

  /** Lets go of everything before `offset`. An offset past the end or before the last one changes nothing. */
  ack(offset: number): void {
    if (!Number.isInteger(offset) || offset <= this.#acked || offset > this.#end) return;
    let drop = offset - this.#acked;
    while (drop > 0) {
      const head = this.#chunks[0]!;
      if (head.length <= drop) { this.#chunks.shift(); drop -= head.length; continue; }
      this.#chunks[0] = head.subarray(drop);
      drop = 0;
    }
    this.#acked = offset;
  }

  /** The bytes from `from` on, or from the acknowledged end when `from` is before it. */
  since(from: number): { at: number; bytes: Uint8Array } {
    const at = Math.min(this.#end, Math.max(this.#acked, Number.isInteger(from) ? from : 0));
    const out = new Uint8Array(this.#end - at);
    let skip = at - this.#acked;
    let written = 0;
    for (const chunk of this.#chunks) {
      if (skip >= chunk.length) { skip -= chunk.length; continue; }
      const part = chunk.subarray(skip);
      skip = 0;
      out.set(part, written);
      written += part.length;
    }
    return { at, bytes: out };
  }
}

export interface PipeHandlers {
  /** A chunk of a stream, `at` its first byte's offset there. */
  output(stream: 'out' | 'err', at: number, bytes: Uint8Array): void;
  eof(stream: 'out' | 'err'): void;
}

/** A process on pipes and what the keeper keeps of its output. */
export class PipeProcess {
  readonly proc: Bun.Subprocess<'pipe', 'pipe', 'pipe'>;
  readonly out = new OutWindow();
  readonly err = new ByteRing(KEEPER_ERR_BYTES);
  errWritten = 0;
  readonly ended = { out: false, err: false };
  #resume: (() => void) | null = null;
  #released = false;

  constructor(cmd: string, args: string[], cwd: string, env: Record<string, string>, private readonly handlers: PipeHandlers) {
    this.proc = Bun.spawn({ cmd: [cmd, ...args], cwd, env, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe', detached: true });
    void this.#pump('out', this.proc.stdout);
    void this.#pump('err', this.proc.stderr);
  }

  write(bytes: Uint8Array): void {
    try { this.proc.stdin.write(bytes); this.proc.stdin.flush(); } catch { /* the process closed its stdin or exited */ }
  }

  closeStdin(): void {
    try { void this.proc.stdin.end(); } catch { /* already closed */ }
  }

  ack(offset: number): void {
    this.out.ack(offset);
    if (this.out.held < KEEPER_OUT_WINDOW_BYTES) { const resume = this.#resume; this.#resume = null; resume?.(); }
  }

  /** Nobody wants its output any more: a pump waiting for an acknowledgement stops, the pipes close. */
  release(): void {
    this.#released = true;
    const resume = this.#resume; this.#resume = null; resume?.();
  }

  async #pump(stream: 'out' | 'err', source: ReadableStream<Uint8Array>): Promise<void> {
    const reader = source.getReader();
    try {
      for (;;) {
        // A full window: the pipe is left to fill, and the agent waits on its write.
        if (stream === 'out' && this.out.held >= KEEPER_OUT_WINDOW_BYTES && !this.#released) await new Promise<void>((resume) => { this.#resume = resume; });
        if (this.#released) { void reader.cancel().catch(() => undefined); return; }
        const { done, value } = await reader.read();
        if (done) break;
        if (value.length === 0) continue;
        const bytes = new Uint8Array(value);
        if (stream === 'out') {
          const at = this.out.end;
          this.out.push(bytes);
          this.handlers.output('out', at, bytes);
        } else {
          const at = this.errWritten;
          this.err.push(bytes);
          this.errWritten += bytes.length;
          this.handlers.output('err', at, bytes);
        }
      }
    } catch { /* the pipe broke: its end is all there is */ }
    this.ended[stream] = true;
    this.handlers.eof(stream);
  }
}
