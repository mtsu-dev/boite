import { DEFAULT_THREAD_DELETION_RETENTION_DAYS } from '@boite/contracts';
import type { Core } from '../core.ts';
import { removeTranscripts, threadSessions, type NativeSession } from './transcript-purge.ts';

/** Catch up at startup and check once a minute while the core stays resident. */
export function scheduleThreadDeletionRetention(core: Core, everyMs = 60_000): () => void {
  const pass = () => {
    try { core.threads.purgeDeleted(); }
    catch (error) { core.log('error', `thread deletion retention: ${error instanceof Error ? error.message : String(error)}`); }
  };
  pass();
  const timer = setInterval(pass, everyMs);
  timer.unref();
  return () => clearInterval(timer);
}

/**
 * Expiry uses the deletion date. Listeners release resources after the purge
 * commits. Once a storage mode is picked, the transcript pass decides what a
 * deleted conversation becomes and when (`transcripts/engine.ts`).
 */
export function purgeExpiredThreads(core: Core): void {
  if (core.settings.get().transcriptStorage !== undefined) return;
  const days = core.settings.get().threadDeletionRetentionDays ?? DEFAULT_THREAD_DELETION_RETENTION_DAYS;
  if (days === 0) return;
  let sessions: NativeSession[] = [];
  let purgedIds: string[] = [];
  const purged = core.journal.purgeDeletedThreads(Date.now() - days * 86_400_000, ids => {
    sessions = threadSessions(core.journal.db, ids);
    purgedIds = ids;
  });
  if (purged === 0) return;
  for (const threadId of purgedIds) core.bus.emit('thread.removed', { threadId });
  core.bus.emit('thread.deletionsUpdated', {});
  core.threads.transcriptPurge = removeTranscripts(core, sessions);
}
