import type { AgentContact, AgentMatch } from '@boite/contracts';
import type { Core } from './core.ts';
import { searchContacts } from './coordination-lookup.ts';
import type { SearchRequest, SearchReply } from './coordination-search-worker.ts';
import { unavailable } from './errors.ts';
import { workerEntry } from './worker-entry.ts';

/** Searches share one reader per core: parallel full-history scans compete for the same disk. */
const readers = new WeakMap<Core, Promise<void>>();

function searchStopped(signal: AbortSignal) {
  return unavailable(signal.reason?.name === 'TimeoutError' ? 'Conversation search timed out' : 'Conversation search cancelled');
}

export async function searchLocalContacts(
  core: Core, candidates: AgentContact[], words: string[], readChat = true, redact = false, caller?: AbortSignal,
): Promise<AgentMatch[]> {
  const deadline = AbortSignal.timeout(120_000);
  const signal = caller === undefined ? deadline : AbortSignal.any([caller, deadline]);
  if (signal.aborted) throw searchStopped(signal);
  if (!readChat || candidates.length === 0) return searchContacts(core.journal.db, candidates, words, false);
  const run = (readers.get(core) ?? Promise.resolve()).then(() => {
    if (signal.aborted) throw searchStopped(signal);
    if (core.journal.isClosed()) throw unavailable('Conversation search stopped with the core');
    return readHistory({ file: core.journal.db.filename, candidates, words, redact }, signal);
  });
  const tail = run.then(release, release);
  readers.set(core, tail);
  function release(): void { if (readers.get(core) === tail) readers.delete(core); }

  const waiting = Promise.withResolvers<never>();
  const abort = () => waiting.reject(searchStopped(signal));
  signal.addEventListener('abort', abort, { once: true });
  try { return await Promise.race([run, waiting.promise]); }
  finally { signal.removeEventListener('abort', abort); }
}

function readHistory(request: SearchRequest, signal: AbortSignal): Promise<AgentMatch[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerEntry(import.meta.url, 'coordination-search-worker', './coordination-search-worker.js'));
    let settled = false;
    const finish = (result: SearchReply) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      worker.terminate();
      if ('error' in result) reject(unavailable(result.error));
      else resolve(result.matches);
    };
    const abort = () => finish({ error: searchStopped(signal).message });
    signal.addEventListener('abort', abort, { once: true });
    worker.onerror = event => finish({ error: event.message });
    worker.onmessage = (event: MessageEvent<SearchReply>) => finish(event.data);
    try { worker.postMessage(request); }
    catch (error) { finish({ error: String(error) }); }
  });
}
