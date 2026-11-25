import type { Database } from 'bun:sqlite';
import { runTranscriptRequest, type TranscriptReply, type TranscriptRequest } from './transcripts/jobs.ts';
import { workerEntry } from './worker-entry.ts';

/** A session of hundreds of megabytes took 43 s; ten minutes says the worker hangs. */
const TIMEOUT_MS = 600_000;

/** One at a time: a transcript job reads and compresses as fast as one thread goes. */
let last: Promise<unknown> = Promise.resolve();

/**
 * Runs a transcript request (`transcripts/jobs.ts`) in the journal's reader
 * worker, the one installers already ship, and resolves to its answer. `db`
 * is the journal for a request that reads it: one kept in memory has no file
 * a worker could open, so the request then runs here.
 */
export function transcriptJob<T extends TranscriptReply>(request: TranscriptRequest, db?: Database, timeoutMs = TIMEOUT_MS): Promise<Exclude<T, { error: string }>> {
  const run = async (): Promise<TranscriptReply> => {
    if (db !== undefined && (!db.filename || db.filename === ':memory:')) return runTranscriptRequest(request, db);
    return new Promise<TranscriptReply>((resolve, reject) => {
      const worker = new Worker(workerEntry(import.meta.url, 'artifact-retention-worker', './artifact-retention-worker.js'));
      let settled = false;
      const finish = (error: Error | null, reply?: TranscriptReply): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        worker.terminate();
        if (reply !== undefined) resolve(reply); else reject(error);
      };
      const timeout = setTimeout(() => finish(new Error(`transcript job timed out after ${Math.round(timeoutMs / 1000)} s`)), timeoutMs);
      timeout.unref();
      (worker as { unref?: () => void }).unref?.();
      worker.addEventListener('close', () => finish(new Error('transcript worker closed before replying')), { once: true });
      worker.onerror = event => finish(new Error(event.message));
      worker.onmessage = (event: MessageEvent<TranscriptReply>) => finish(null, event.data);
      worker.postMessage(request);
    });
  };
  const turn = last.then(run, run);
  last = turn.catch(() => undefined);
  return turn.then(reply => {
    if ('error' in reply) throw new Error(reply.error);
    return reply as Exclude<T, { error: string }>;
  });
}
