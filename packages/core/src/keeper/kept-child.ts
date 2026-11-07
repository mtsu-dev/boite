/*
 * An agent process the keeper holds on pipes, seen from the core as the
 * `ChildProcess` a driver and the Claude SDK already use: `stdin`, `stdout`,
 * `stderr`, `pid`, `kill`, and the `spawn`, `exit`, `close` and `error`
 * events in node's order. A driver does not change to run on the keeper.
 *
 * It exists before the keeper has started the process, as node's child does
 * before `spawn`: `pid` stays undefined until the keeper answers, and what is
 * written to stdin meanwhile waits for it.
 *
 * Every stdout byte has an offset from 0. `received` is how many reached
 * `stdout`; `ack` tells the keeper which of them are committed, and it lets
 * go of those.
 */

import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import type { KeptProcess, KeptTag, ToKeeper } from './protocol.ts';
import { encodeBytes } from './protocol.ts';

type Send = (frame: ToKeeper) => void;

export class KeptChild extends EventEmitter {
  readonly tag: KeptTag;
  readonly spawnfile: string;
  readonly spawnargs: string[];
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr: Readable;
  readonly stdio: [Writable, Readable, Readable];
  /** The keeper's id for it, once it started. */
  id: string | null = null;
  pid: number | undefined = undefined;
  /** The keeper's pid when it started it. */
  keeperPid: number | null = null;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  killed = false;
  readonly connected = false;
  /** Stdout bytes that reached `stdout`: the offset of the next one. */
  received = 0;
  /** The last offset the keeper was told is committed. */
  acked = 0;
  /** Settled once the keeper started it (true) or could not (false). */
  readonly ready: Promise<boolean>;
  #ready!: (ok: boolean) => void;
  #send: Send | null = null;
  #exited = false;
  #closed = false;
  readonly #ends = { out: false, err: false };
  /** Each stream's readers saw its end, or it was destroyed: node's child closes only then. */
  readonly #drained = { out: false, err: false };
  #errAt = 0;
  #pendingKill: NodeJS.Signals | null = null;
  /** Called after each stdout chunk and once at `close`, for the ledger that commits offsets. */
  onProgress: (() => void) | null = null;

  constructor(tag: KeptTag, cmd: string, args: string[]) {
    super();
    this.tag = tag;
    this.spawnfile = cmd;
    this.spawnargs = [cmd, ...args];
    this.ready = new Promise<boolean>((resolve) => { this.#ready = resolve; });
    this.stdout = new Readable({ read() { /* pushed as frames arrive */ } });
    this.stderr = new Readable({ read() { /* pushed as frames arrive */ } });
    for (const [name, stream] of [['out', this.stdout], ['err', this.stderr]] as const) {
      // After every other `end` listener: a reader such as readline hands over its last line in its own.
      const drained = (): void => process.nextTick(() => { this.#drained[name] = true; this.#maybeClose(); });
      stream.once('end', drained);
      stream.once('close', drained);
    }
    this.stdin = new Writable({
      write: (chunk: Buffer | string, encoding: BufferEncoding, done: (error?: Error | null) => void) => {
        void this.ready.then((ok) => {
          const bytes = typeof chunk === 'string' ? Buffer.from(chunk, encoding) : chunk;
          if (ok && !this.#exited && this.id !== null) this.#send?.({ op: 'write', id: this.id, data: encodeBytes(bytes) });
          done();
        });
      },
      final: (done: (error?: Error | null) => void) => {
        void this.ready.then((ok) => {
          if (ok && !this.#exited && this.id !== null) this.#send?.({ op: 'closeStdin', id: this.id });
          done();
        });
      },
    });
    this.stdio = [this.stdin, this.stdout, this.stderr];
  }

  get running(): boolean { return this.pid !== undefined && !this.#exited; }
  /** Stdout bytes the reader of `stdout` took: the offset of the first one it has not seen. */
  get consumed(): number { return this.received - this.stdout.readableLength; }
  get closed(): boolean { return this.#closed; }

  /** The keeper started it. Called in the frame's own tick: output that follows on the socket finds it. */
  started(info: KeptProcess, keeperPid: number | null, send: Send): void {
    this.id = info.id;
    this.pid = info.pid;
    this.keeperPid = keeperPid;
    this.#send = send;
    this.#ready(true);
    this.emit('spawn');
    if (this.#pendingKill !== null) this.kill(this.#pendingKill);
  }

  /** The keeper could not start it, or was not there: node's `error` for a spawn that failed. */
  failed(error: Error): void {
    if (this.#exited) return;
    this.#ready(false);
    this.#exited = true;
    if (this.listenerCount('error') > 0) this.emit('error', error);
    this.#end('out');
    this.#end('err');
  }

  /** @internal A chunk of a stream. A part this core already had, after an attach again, is skipped. */
  output(stream: 'out' | 'err', at: number, bytes: Uint8Array): void {
    if (this.#ends[stream]) return;
    const had = stream === 'out' ? this.received : this.#errAt;
    // A gap, after a keeper that lost bytes: the stream goes on from what came.
    const skip = Math.max(0, Math.min(bytes.length, had - at));
    const fresh = bytes.subarray(skip);
    if (fresh.length === 0) return;
    if (stream === 'out') this.received = at + bytes.length;
    else this.#errAt = at + bytes.length;
    (stream === 'out' ? this.stdout : this.stderr).push(Buffer.from(fresh.buffer, fresh.byteOffset, fresh.byteLength));
    if (stream === 'out') this.onProgress?.();
  }

  /** @internal */
  eof(stream: 'out' | 'err'): void { this.#end(stream); }

  /**
   * @internal It exited, or is gone with the keeper (`lost`): its streams end
   * then too, since no more of them can come.
   */
  ended(code: number | null, signal: string | null, lost = false): void {
    if (!this.#exited) {
      this.#exited = true;
      this.exitCode = code;
      this.signalCode = (signal as NodeJS.Signals | null) ?? null;
      this.emit('exit', this.exitCode, this.signalCode);
    }
    if (lost) { this.#end('out'); this.#end('err'); }
    this.#maybeClose();
  }

  /** Asks the keeper for what this core lacks of stdout, after a connection lost and found again. */
  attach(): void {
    if (this.id !== null && !this.#closed) this.#send?.({ op: 'attach', id: this.id, from: this.received });
  }

  /** Stdout up to `offset` is committed. */
  ack(offset: number): void {
    if (this.id === null || offset <= this.acked) return;
    this.acked = offset;
    this.#send?.({ op: 'ack', id: this.id, offset });
  }

  /** The core is done with it: the keeper ends it if it runs and forgets it. */
  release(): void {
    if (this.id !== null) this.#send?.({ op: 'release', id: this.id });
    this.ended(this.exitCode, this.signalCode, true);
  }

  /**
   * The process alone, as node's `kill` does: the keeper is its parent and
   * holds it unreaped while it runs, so its pid is still its own.
   */
  kill(signal: NodeJS.Signals | number = 'SIGTERM'): boolean {
    if (this.#exited) return false;
    const name = typeof signal === 'number' ? 'SIGTERM' : signal;
    if (this.pid === undefined) { this.#pendingKill = name; this.killed = true; return true; }
    try { process.kill(this.pid, signal); this.killed = true; return true; } catch { return false; }
  }

  ref(): void { /* nothing of it holds this process's loop */ }
  unref(): void { /* see ref */ }
  disconnect(): void { /* no IPC channel */ }

  #end(stream: 'out' | 'err'): void {
    if (this.#ends[stream]) return;
    this.#ends[stream] = true;
    const readable = stream === 'out' ? this.stdout : this.stderr;
    readable.push(null);
    // Nothing left in it: it ends now, read or not, as an empty pipe does.
    if (readable.readableLength === 0) readable.read(0);
    this.#maybeClose();
  }

  #maybeClose(): void {
    if (this.#closed || !this.#exited || !this.#drained.out || !this.#drained.err) return;
    this.#closed = true;
    this.emit('close', this.exitCode, this.signalCode);
    this.onProgress?.();
  }
}
