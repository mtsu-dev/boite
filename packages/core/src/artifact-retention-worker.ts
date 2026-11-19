import { Database } from 'bun:sqlite';
import { ARTIFACT_REFERENCES } from './journal/artifact-references.ts';
import type { JournalReadsReply, JournalReadsRequest } from './journal-reads.ts';

export type ArtifactScanReply = { ids: string[] } | { error: string };

const scope = globalThis as unknown as {
  onmessage: ((event: { data: string | JournalReadsRequest }) => void) | null;
  postMessage(message: ArtifactScanReply | JournalReadsReply): void;
  close(): void;
};

// The journal's reader: one request, one answer, then it ends. It keeps the
// name installers and the shell already list beside the core.
// Large inline attachments make even a reference-only JSON scan expensive, and
// so is a search of many threads' chat (`journal-reads.ts`).
// Read through a separate WAL connection so RPC and journal writes can continue.
scope.onmessage = ({ data }): void => {
  let db: Database | undefined;
  try {
    db = new Database(typeof data === 'string' ? data : data.path, { readonly: true });
    if (typeof data === 'string') {
      // A streaming message keeps its latest parts in streaming_parts until its row is written whole.
      const rows = db.query(ARTIFACT_REFERENCES).all() as { id: string }[];
      scope.postMessage({ ids: rows.map(row => row.id) });
    } else {
      const reader = db;
      scope.postMessage({ rows: data.reads.map(read => reader.query(read.sql).all(...read.params)) });
    }
  } catch (error) {
    scope.postMessage({ error: error instanceof Error ? error.message : String(error) });
  } finally {
    db?.close();
    scope.close();
  }
};
