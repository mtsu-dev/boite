import { Database } from 'bun:sqlite';
import { ARTIFACT_REFERENCES } from './journal/artifact-references.ts';
import { searchChat } from './chat-search.ts';
import { searchThreadMessages } from './journal/message-search.ts';
import type { JournalSearchReply, JournalSearchRequest } from './journal-reads.ts';
import { runTranscriptRequest, type TranscriptReply, type TranscriptRequest } from './transcripts/jobs.ts';

export type ArtifactScanReply = { ids: string[] } | { error: string };

const scope = globalThis as unknown as {
  onmessage: ((event: { data: string | JournalSearchRequest | TranscriptRequest }) => void) | null;
  postMessage(message: ArtifactScanReply | JournalSearchReply | TranscriptReply): void;
  close(): void;
};

// The journal's reader: one request, one answer, then it ends. It keeps the
// name installers and the shell already list beside the core.
// Large inline attachments make even a reference-only JSON scan expensive, and
// so is a search of many threads' chat (`journal-reads.ts`) and the reading of
// a whole transcript (`transcripts/jobs.ts`).
// Read through a separate WAL connection so RPC and journal writes can continue.
scope.onmessage = ({ data }): void => {
  if (typeof data !== 'string' && !('kind' in data)) {
    void runTranscriptRequest(data)
      .catch((error: unknown): TranscriptReply => ({ error: error instanceof Error ? error.message : String(error) }))
      .then(reply => { scope.postMessage(reply); scope.close(); });
    return;
  }
  let db: Database | undefined;
  try {
    db = new Database(typeof data === 'string' ? data : data.path, { readonly: true });
    if (typeof data === 'string') {
      // A streaming message keeps its latest parts in streaming_parts until its row is written whole.
      const rows = db.query(ARTIFACT_REFERENCES).all() as { id: string }[];
      scope.postMessage({ ids: rows.map(row => row.id) });
    } else if (data.kind === 'chat') {
      scope.postMessage({ hits: searchChat(db, data.search) });
    } else {
      scope.postMessage({ hits: searchThreadMessages(db, data.params.query, data.params) });
    }
  } catch (error) {
    scope.postMessage({ error: error instanceof Error ? error.message : String(error) });
  } finally {
    db?.close();
    scope.close();
  }
};
