/*
 * The transcript work the reader worker does for the core, one request a
 * worker: a provider session into an archive, a thread of the journal into
 * one, and the list of sessions the journal names. Each reads much and would
 * hold the core's only thread; none of them knows the core.
 */

import { Database } from 'bun:sqlite';
import { namedSessions, type NamedSession } from '../threads/native-sessions.ts';
import { journalRecords } from './journal-source.ts';
import { ArchiveWriter, compactSession, type ArchiveResult, type SessionJob, type SessionResult } from './session.ts';

export interface JournalJob {
  /** The journal's file. */
  path: string;
  threadId: string;
  out: string;
  blobs: string;
  keepBlobs: boolean;
}

export type TranscriptRequest = { transcript: SessionJob } | { journal: JournalJob } | { named: string };
export type TranscriptReply = { session: SessionResult } | { archive: ArchiveResult } | { named: NamedSession[] } | { error: string };

export async function archiveJournalThread(db: Database, job: Omit<JournalJob, 'path'>): Promise<ArchiveResult> {
  const writer = new ArchiveWriter(job.out, job.blobs, job.keepBlobs);
  try {
    await journalRecords(db, job.threadId, writer.sink, writer.emit, () => writer.flush());
    return await writer.finish();
  } catch (error) {
    await writer.abort();
    throw error;
  }
}

/** Answers one request; `db` is the journal when the caller already holds it (one kept in memory has no file to open). */
export async function runTranscriptRequest(request: TranscriptRequest, db?: Database): Promise<TranscriptReply> {
  if ('transcript' in request) return { session: await compactSession(request.transcript) };
  const path = 'journal' in request ? request.journal.path : request.named;
  const journal = db ?? new Database(path, { readonly: true });
  try {
    if ('journal' in request) return { archive: await archiveJournalThread(journal, request.journal) };
    return { named: namedSessions(journal) };
  } finally {
    if (db === undefined) journal.close();
  }
}
