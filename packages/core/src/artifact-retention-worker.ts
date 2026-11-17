import { Database } from 'bun:sqlite';
import { ARTIFACT_REFERENCES } from './journal/artifact-references.ts';

export type ArtifactScanReply = { ids: string[] } | { error: string };

const scope = globalThis as unknown as {
  onmessage: ((event: { data: string }) => void) | null;
  postMessage(message: ArtifactScanReply): void;
  close(): void;
};

// Large inline attachments make even a reference-only JSON scan expensive.
// Read through a separate WAL connection so RPC and journal writes can continue.
scope.onmessage = ({ data: path }): void => {
  let db: Database | undefined;
  try {
    db = new Database(path, { readonly: true });
    // A streaming message keeps its latest parts in streaming_parts until its row is written whole.
    const rows = db.query(ARTIFACT_REFERENCES).all() as { id: string }[];
    scope.postMessage({ ids: rows.map(row => row.id) });
  } catch (error) {
    scope.postMessage({ error: error instanceof Error ? error.message : String(error) });
  } finally {
    db?.close();
    scope.close();
  }
};
