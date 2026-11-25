import type { Database } from 'bun:sqlite';
import type { RpcParams, ThreadMessageMatch } from '@boite/contracts';
import { searchChat, type ChatHit, type ChatSearch } from './chat-search.ts';
import { unavailable } from './errors.ts';
import { searchThreadMessages } from './journal/message-search.ts';
import { workerEntry } from './worker-entry.ts';

export type JournalSearch = { kind: 'chat'; search: ChatSearch } | { kind: 'messages'; params: RpcParams<'threads.search'> };
export type JournalSearchRequest = JournalSearch & { path: string };
export type ChatSearchReply = { hits: ChatHit[] } | { error: string };
export type JournalSearchReply = ChatSearchReply | { hits: ThreadMessageMatch[] };

/** A search waits and runs for this long at most, under the two minutes a caller waits for its answer. */
const TIMEOUT_MS = 110_000;

/** The searches run one at a time: ten agents searching at once cost one thread, not ten. */
const last = { chat: Promise.resolve<unknown>(undefined), messages: Promise.resolve<unknown>(undefined) };

export function assertSearchActive(signal?: AbortSignal): void {
  if (signal?.aborted) throw unavailable('Conversation search cancelled');
}

/** Stop waiting for a remote answer if the connection leaves. */
export async function waitForSearch<T>(request: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return request;
  const cancelled = Promise.withResolvers<never>();
  const abort = () => cancelled.reject(unavailable('Conversation search cancelled'));
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  try {
    const result = await Promise.race([cancelled.promise, request]);
    assertSearchActive(signal);
    return result;
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

/**
 * `searchChat` through a worker's own read-only connection to the journal `db`
 * came from. A scan of every reachable thread's chat took 35 s on a 10 GB
 * journal: on `db` it held the core's only thread, and every client with it,
 * for that long. The caller awaits, so it checks again afterwards what the
 * asker may still reach. `timeoutMs` counts the wait behind other searches. A
 * journal with no file (in memory) has no second connection and is read in place.
 */
export async function searchJournalChat(db: Database, search: ChatSearch, { timeoutMs = TIMEOUT_MS, signal }: { timeoutMs?: number; signal?: AbortSignal | undefined } = {}): Promise<ChatHit[]> {
  return readSearch(db, { kind: 'chat', search }, () => searchChat(db, search), timeoutMs, signal);
}

export function searchJournalMessages(db: Database, params: RpcParams<'threads.search'>, signal?: AbortSignal): Promise<ThreadMessageMatch[]> {
  return readSearch(db, { kind: 'messages', params }, () => searchThreadMessages(db, params.query, params), 8_000, signal);
}

async function readSearch<T extends ChatHit | ThreadMessageMatch>(db: Database, request: JournalSearch, inMemory: () => T[], timeoutMs: number, signal: AbortSignal | undefined): Promise<T[]> {
  assertSearchActive(signal);
  const path = db.filename;
  if (!path || path === ':memory:') return Promise.resolve().then(() => {
    assertSearchActive(signal);
    return inMemory();
  });
  return new Promise((resolve, reject) => {
    let worker: Worker | undefined;
    let settled = false;
    let release = (): void => {};
    const turn = last[request.kind];
    // The next search starts once the ones before this one and this one are over.
    last[request.kind] = turn.then(() => new Promise<void>(done => { release = done; if (settled) done(); }));
    const finish = (error?: Error, hits?: T[]): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      // Bun asks SQLite to stop and returns before the native query has exited.
      // Keep the slot until the worker actually closes.
      if (worker) worker.terminate(); else release();
      if (hits) resolve(hits); else reject(error);
    };
    const timeout = setTimeout(() => finish(unavailable(`chat search timed out after ${Math.round(timeoutMs / 1000)} s`)), timeoutMs);
    timeout.unref();
    const abort = () => finish(unavailable('Conversation search cancelled'));
    signal?.addEventListener('abort', abort, { once: true });
    void turn.then(() => {
      if (settled) return;
      try {
        // The journal's reader worker (`artifact-retention-worker.ts`), the one installers already ship.
        worker = new Worker(workerEntry(import.meta.url, 'artifact-retention-worker', './artifact-retention-worker.js'));
        worker.addEventListener('close', () => {
          worker = undefined;
          if (settled) release();
          else finish(new Error('Conversation search worker closed before replying'));
        }, { once: true });
        // A scan never holds a stopping core. Typed structurally: the DOM lib's Worker has no unref.
        (worker as { unref?: () => void }).unref?.();
        worker.onerror = event => finish(new Error(event.message));
        worker.onmessage = (event: MessageEvent<JournalSearchReply>) => {
          if ('error' in event.data) finish(new Error(event.data.error)); else finish(undefined, event.data.hits as T[]);
        };
        worker.postMessage({ path, ...request } satisfies JournalSearchRequest);
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
}
