import type { Database } from 'bun:sqlite';
import { statSync } from 'node:fs';
import { messageOfError } from './stream-buffer.ts';

/**
 * SQLite's automatic checkpoint ran inside whichever commit crossed 1,000
 * pages: a 100 to 300 ms stall of the event loop during heavy streaming. The
 * journal turns it off and checkpoints from a Worker with its own connection
 * instead; a passive checkpoint from another connection never blocks a writer.
 */
export interface WalCheckpointOptions {
  /** Past this many bytes of WAL, a passive checkpoint runs. The journal's `journal_size_limit` matches it. */
  limitBytes?: number;
  /** How often writes and the WAL size are looked at. */
  tickMs?: number;
  /** After this long without a write, the WAL is checkpointed and truncated. */
  idleMs?: number;
  /** After a successful truncation, how long to wait before releasing idle memory. */
  workerIdleMs?: number;
  /** Stands in for the Worker, for tests of the fallback. */
  worker?: () => CheckpointWorker;
}

export interface CheckpointWorker {
  onmessage: ((event: MessageEvent<CheckpointReply>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(request: CheckpointRequest): void;
  terminate(): void;
  unref?(): void;
}

type Mode = 'PASSIVE' | 'TRUNCATE';
interface CheckpointRequest { file: string; mode: Mode; state: Int32Array }
type CheckpointReply = { busy: number; log: number; checkpointed: number } | { error: string };

export const WAL_LIMIT_BYTES = 4 * 1024 * 1024;
const TICK_MS = 1_000;
const IDLE_MS = 30_000;
const WORKER_IDLE_MS = 15_000;
/** Passive passes the Worker runs per request, at most. */
const PASSES = 3;
/**
 * Past this many times the limit, the Worker did not keep up: frames kept
 * landing during its passes and the WAL never restarted. This thread then
 * copies the frames left after the Worker's pass, as SQLite did on its own.
 */
const BEHIND = 4;
/** A Worker that has not answered for this long is taken for dead. */
const REPLY_MS = 60_000;
/** How long `close` waits for a checkpoint the Worker is running. */
const CLOSE_WAIT_MS = 5_000;

/**
 * The Worker's whole source, run from a blob URL: no file to stage beside the
 * core, the same in a compiled binary. It opens the journal for one checkpoint
 * and closes it, so no connection outlives the request. `state` goes back to 0
 * once the connection is closed: `close` waits on it.
 */
const SOURCE = `import { Database } from 'bun:sqlite';
onmessage = ({ data: { file, mode, state } }) => {
  let db;
  try {
    db = new Database(file, { readwrite: true });
    // A pass copies the frames written before it started. The WAL restarts at the
    // next write only once a pass ends with nothing newer, so passes repeat while
    // writes land during them.
    const passive = db.query('PRAGMA wal_checkpoint(PASSIVE)');
    let row = passive.get();
    for (let pass = 1; pass < ${PASSES} && row.busy === 0 && row.log === row.checkpointed; pass++) {
      const next = passive.get();
      const quiet = next.log === row.log;
      row = next;
      if (quiet) break;
    }
    if (mode === 'TRUNCATE') row = db.query('PRAGMA wal_checkpoint(TRUNCATE)').get();
    db.close();
    db = undefined;
    postMessage(row);
  } catch (error) {
    try { db?.close(); } catch {}
    postMessage({ error: error instanceof Error ? error.message : String(error) });
  } finally {
    Atomics.store(state, 0, 0);
    Atomics.notify(state, 0);
  }
};`;

let sourceUrl: string | undefined;
function startWorker(): CheckpointWorker {
  sourceUrl ??= URL.createObjectURL(new Blob([SOURCE], { type: 'application/javascript' }));
  return new Worker(sourceUrl) as unknown as CheckpointWorker;
}

export class WalCheckpoints {
  readonly #limitBytes: number;
  readonly #idleMs: number;
  readonly #workerIdleMs: number;
  readonly #makeWorker: () => CheckpointWorker;
  readonly #timer: ReturnType<typeof setInterval>;
  /** 1 while the Worker runs a request: its connection is open. */
  readonly #state = new Int32Array(new SharedArrayBuffer(4));
  #worker: CheckpointWorker | null = null;
  #workerIdleTimer: ReturnType<typeof setTimeout> | undefined;
  #mode: Mode | null = null;
  /** Set once the Worker failed: checkpoints run on this thread from then on. */
  #fallback = false;
  #changes: number;
  #lastWrite = performance.now();
  #sentAt = 0;
  #writtenSincePassive = false;
  #writtenSinceTruncate = false;
  #stopped = false;
  /** Checkpoints asked for, by where they ran: what the tests and the bench read. */
  readonly ran = { worker: 0, main: 0 };

  /** Checkpoints for `db`, or null when it has no WAL file (`:memory:`). */
  static start(db: Database, file: string, onError: (message: string) => void, options?: WalCheckpointOptions, onIdle?: () => void): WalCheckpoints | null {
    const mode = (db.query('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode;
    return mode === 'wal' ? new WalCheckpoints(db, file, onError, options, onIdle) : null;
  }

  readonly #db: Database;
  readonly #file: string;
  readonly #onError: (message: string) => void;
  readonly #onIdle: (() => void) | undefined;
  constructor(db: Database, file: string, onError: (message: string) => void, options: WalCheckpointOptions = {}, onIdle?: () => void) {
    this.#db = db;
    this.#file = file;
    this.#onError = onError;
    this.#limitBytes = options.limitBytes ?? WAL_LIMIT_BYTES;
    this.#idleMs = options.idleMs ?? IDLE_MS;
    this.#workerIdleMs = options.workerIdleMs ?? WORKER_IDLE_MS;
    this.#onIdle = onIdle;
    this.#makeWorker = options.worker ?? startWorker;
    db.exec('PRAGMA wal_autocheckpoint = 0');
    this.#changes = this.#totalChanges();
    this.#timer = setInterval(() => this.tick(), options.tickMs ?? TICK_MS);
    this.#timer.unref?.();
  }

  /** True until the Worker has closed its connection and the reply was handled. */
  get running(): boolean {
    return this.#mode !== null || Atomics.load(this.#state, 0) !== 0;
  }

  /**
   * True while the WAL is past twice its limit: the checkpoints have not caught
   * up with the writes. A background pass then skips its tick, so that its
   * writes keep the WAL short of `BEHIND`, where this thread copies it; a tick
   * that starts under the mark and writes more than the room left crosses it.
   */
  get behind(): boolean {
    return this.#walBytes() > this.#limitBytes * 2;
  }

  /** Looks for writes since the last tick and asks for the checkpoint they call for. */
  tick(): void {
    if (this.#stopped) return;
    try {
      this.#observeWrites();
      if (this.running) {
        // Still on the last request; one that never ends would stop every checkpoint.
        if (performance.now() - this.#sentAt > REPLY_MS) this.#fail(`no answer in ${REPLY_MS / 1000} s`);
        return;
      }
      // A truncation runs a passive checkpoint first, so it covers a WAL past its limit too.
      if (this.#writtenSinceTruncate && performance.now() - this.#lastWrite >= this.#idleMs) {
        this.#writtenSincePassive = false;
        this.#writtenSinceTruncate = false;
        this.#run('TRUNCATE');
      } else if (this.#writtenSincePassive && this.#walBytes() > this.#limitBytes) {
        this.#writtenSincePassive = false;
        this.#run('PASSIVE');
      }
    } catch (error) {
      this.#onError(`journal checkpoint: ${messageOfError(error)}`);
    }
  }

  /**
   * Stops the timer and the Worker, after the checkpoint it may be running,
   * then truncates the WAL from this connection.
   */
  close(): void {
    if (this.#stopped) return;
    this.#stopped = true;
    clearInterval(this.#timer);
    this.#cancelIdle();
    this.#mode = null;
    if (this.#worker !== null) {
      if (Atomics.load(this.#state, 0) !== 0) Atomics.wait(this.#state, 0, 1, CLOSE_WAIT_MS);
      this.#worker.terminate();
      this.#worker = null;
    }
    try {
      this.#db.query('PRAGMA wal_checkpoint(TRUNCATE)').get();
    } catch (error) {
      this.#onError(`journal checkpoint: ${messageOfError(error)}`);
    }
  }

  #run(mode: Mode): void {
    this.#cancelIdle();
    const worker = this.#fallback ? null : this.#ensureWorker();
    // Without a Worker this thread checkpoints, as SQLite did, but no more than once a tick.
    if (worker === null) return this.#here(mode);
    this.ran.worker++;
    Atomics.store(this.#state, 0, 1);
    this.#sentAt = performance.now();
    this.#mode = mode;
    try {
      worker.postMessage({ file: this.#file, mode, state: this.#state });
    } catch (error) {
      this.#fail(messageOfError(error));
      this.#here(mode);
    }
  }

  /**
   * A checkpoint on this thread. A truncation empties the WAL file, which a
   * passive one never does, so `behind` turns false without another write; one
   * that met a reader is tried again at the next idle tick, as the Worker's is.
   */
  #here(mode: Mode): void {
    this.ran.main++;
    try {
      const { busy } = this.#db.query(`PRAGMA wal_checkpoint(${mode})`).get() as { busy: number };
      if (mode === 'TRUNCATE') this.#truncated(busy);
    } catch (error) {
      this.#onError(`journal checkpoint: ${messageOfError(error)}`);
    }
  }

  #ensureWorker(): CheckpointWorker | null {
    if (this.#worker !== null) return this.#worker;
    try {
      const worker = this.#makeWorker();
      worker.onmessage = ({ data }) => {
        if (this.#stopped || worker !== this.#worker) return;
        if ('error' in data) return this.#fail(data.error);
        const mode = this.#mode;
        this.#mode = null;
        // A truncation that met a reader is tried again at the next idle tick.
        if (mode === 'TRUNCATE') this.#truncated(data.busy);
        else if (data.busy !== 0) this.#writtenSinceTruncate = true;
        if (this.#walBytes() > this.#limitBytes * BEHIND) this.#here('PASSIVE');
      };
      worker.onerror = (event) => {
        event.preventDefault?.();
        if (!this.#stopped && worker === this.#worker) this.#fail(event.message);
      };
      worker.unref?.();
      this.#worker = worker;
      return worker;
    } catch (error) {
      this.#fail(messageOfError(error));
      return null;
    }
  }

  /** The Worker is gone for good: this thread checkpoints from now on, and the owner hears it once. */
  #fail(reason: string): void {
    if (this.#fallback) return;
    this.#fallback = true;
    this.#worker?.terminate();
    this.#worker = null;
    Atomics.store(this.#state, 0, 0);
    if (this.#mode === 'TRUNCATE') this.#writtenSinceTruncate = true;
    this.#mode = null;
    this.#writtenSincePassive = true;
    this.#onError(`journal checkpoint worker unavailable, checkpointing on the main thread: ${reason}`);
  }

  #observeWrites(): void {
    const changes = this.#totalChanges();
    if (changes === this.#changes) return;
    this.#changes = changes;
    this.#lastWrite = performance.now();
    this.#writtenSincePassive = true;
    this.#writtenSinceTruncate = true;
    this.#cancelIdle();
  }

  #cancelIdle(): void {
    clearTimeout(this.#workerIdleTimer);
    this.#workerIdleTimer = undefined;
  }

  #truncated(busy: number): void {
    if (busy !== 0) { this.#writtenSinceTruncate = true; return; }
    this.#workerIdleTimer = setTimeout(() => {
      this.#workerIdleTimer = undefined;
      try {
        this.#observeWrites();
        if (this.#writtenSinceTruncate || this.running) return;
        this.#worker?.terminate();
        this.#worker = null;
        this.#onIdle?.();
      } catch (error) {
        this.#onError(`journal checkpoint idle cleanup: ${messageOfError(error)}`);
      }
    }, this.#workerIdleMs);
    this.#workerIdleTimer.unref();
  }

  #totalChanges(): number {
    return (this.#db.query('SELECT total_changes() AS n').get() as { n: number }).n;
  }

  #walBytes(): number {
    return statSync(`${this.#file}-wal`, { throwIfNoEntry: false })?.size ?? 0;
  }
}
