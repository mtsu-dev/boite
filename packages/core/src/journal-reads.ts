import type { Database } from 'bun:sqlite';
import { workerEntry } from './worker-entry.ts';

/** One read-only statement and its parameters. */
export interface JournalRead { sql: string; params: (string | number)[] }
export interface JournalReadsRequest { path: string; reads: JournalRead[] }
export type JournalReadsReply = { rows: unknown[][] } | { error: string };

/** A scan of every reachable thread's chat took 35 s on a 10 GB journal; past this it is refused. */
const TIMEOUT_MS = 120_000;

/** The scans run one at a time: ten agents searching at once cost one thread, not ten. */
let last: Promise<unknown> = Promise.resolve();

function inWorker(request: JournalReadsRequest, timeoutMs: number): Promise<unknown[][]> {
  return new Promise((resolve, reject) => {
    // The journal's reader worker (`artifact-retention-worker.ts`), the one installers already ship.
    const worker = new Worker(workerEntry(import.meta.url, 'artifact-retention-worker'));
    // A scan never holds a stopping core. Typed structurally: the DOM lib's Worker has no unref.
    (worker as { unref?: () => void }).unref?.();
    let settled = false;
    const finish = (error?: Error, rows?: unknown[][]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      worker.terminate();
      if (rows) resolve(rows); else reject(error);
    };
    const timeout = setTimeout(() => finish(new Error(`journal read timed out after ${Math.round(timeoutMs / 1000)} s`)), timeoutMs);
    worker.onerror = event => finish(new Error(event.message));
    worker.onmessage = (event: MessageEvent<JournalReadsReply>) => {
      if ('error' in event.data) finish(new Error(event.data.error)); else finish(undefined, event.data.rows);
    };
    worker.postMessage(request);
  });
}

/**
 * The rows of each of `reads`, read through a worker's own connection to the
 * journal `db` came from. A statement that scans many threads' messages runs
 * for seconds on a large journal: on `db` it would hold the core's only
 * thread, and every client with it, for that long. A journal with no file
 * (in memory) has no second connection and is read in place.
 */
export function readJournal(db: Database, reads: JournalRead[], timeoutMs = TIMEOUT_MS): Promise<unknown[][]> {
  if (reads.length === 0) return Promise.resolve([]);
  const path = db.filename;
  if (!path || path === ':memory:') return Promise.resolve().then(() => reads.map(read => db.query(read.sql).all(...read.params)));
  const run = last.then(() => inWorker({ path, reads }, timeoutMs));
  last = run.catch(() => undefined);
  return run;
}
