import type { ThreadId, Timestamp } from './ids';

// ---------------------------------------------------------------------------
// Transcript storage: what a machine keeps of a conversation as it ages. A
// compacted conversation lives in the archive under the data directory, one
// format whatever agent wrote it, and stays readable for an audit. Usage
// (tokens, cost, model, timings) is kept in every mode.
// ---------------------------------------------------------------------------

/** Days before each step; null never takes it, 0 takes it at once. */
export interface TranscriptPolicy {
  /** An open conversation nobody wrote to: its provider transcripts are compacted. It stays whole in the app. */
  idleCompactDays: number | null;
  /** A deleted conversation: compacted, and from then on read by audits only. */
  deletedCompactDays: number | null;
  /** A deleted conversation: erased from disk. */
  deletedEraseDays: number | null;
  /** A deleted conversation: its images erased. Their place in the conversation stays. */
  imagesEraseDays: number | null;
}

export type TranscriptPreset = 'delete' | 'classic' | 'storage';
export type TranscriptMode = TranscriptPreset | 'custom';

export const TRANSCRIPT_PRESETS: Record<TranscriptPreset, TranscriptPolicy> = {
  delete: { idleCompactDays: null, deletedCompactDays: 0, deletedEraseDays: 7, imagesEraseDays: 7 },
  classic: { idleCompactDays: null, deletedCompactDays: 7, deletedEraseDays: null, imagesEraseDays: 30 },
  storage: { idleCompactDays: 30, deletedCompactDays: 30, deletedEraseDays: null, imagesEraseDays: null },
};

export const TRANSCRIPT_MODES: readonly TranscriptMode[] = ['delete', 'classic', 'storage', 'custom'];
export const TRANSCRIPT_POLICY_FIELDS: readonly (keyof TranscriptPolicy)[] = ['idleCompactDays', 'deletedCompactDays', 'deletedEraseDays', 'imagesEraseDays'];
export const TRANSCRIPT_DAYS_MAX = 3650;

/** The setting: a mode, and the delays of Custom, kept when another mode is picked. */
export interface TranscriptStorage {
  mode: TranscriptMode;
  custom?: TranscriptPolicy;
}

/**
 * The delays a setting stands for. Custom with nothing set, and a machine that
 * never picked a mode, behave as before the modes existed: nothing is
 * compacted, a deleted conversation goes after `deletionDays` (0 keeps it).
 */
export function transcriptPolicy(storage: TranscriptStorage | undefined, deletionDays: number): TranscriptPolicy {
  if (storage !== undefined && storage.mode !== 'custom') return TRANSCRIPT_PRESETS[storage.mode];
  return storage?.custom ?? { idleCompactDays: null, deletedCompactDays: null, deletedEraseDays: deletionDays === 0 ? null : deletionDays, imagesEraseDays: null };
}

export function transcriptPolicyValid(value: unknown): value is TranscriptPolicy {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const fields = value as Record<string, unknown>;
  return Object.keys(fields).every(key => (TRANSCRIPT_POLICY_FIELDS as readonly string[]).includes(key))
    && TRANSCRIPT_POLICY_FIELDS.every(key => fields[key] === null || (typeof fields[key] === 'number' && Number.isInteger(fields[key]) && fields[key] >= 0 && fields[key] <= TRANSCRIPT_DAYS_MAX));
}

/** One step of a preview: how many conversations it takes now, and the bytes they hold on disk. */
export interface TranscriptStep {
  threads: number;
  bytes: number;
}

/**
 * What applying a policy would do right now, computed without changing
 * anything. `freedBytes` is an estimate: what erasing frees is exact, what
 * compacting keeps is `keptRatio` of the bytes read, measured on a sample of
 * this machine's own transcripts (null when there was none to sample).
 */
export interface TranscriptPreview {
  policy: TranscriptPolicy;
  /** Provider transcripts and the archive, as files on disk. */
  totalBytes: number;
  archiveBytes: number;
  compact: TranscriptStep;
  erase: TranscriptStep;
  /** Images of compacted conversations due to go. */
  images: { count: number; bytes: number };
  freedBytes: number;
  keptRatio: number | null;
  /** Provider sessions on disk that no conversation names: `transcripts.compactUnlinked` archives them. */
  unlinked: { sessions: number; bytes: number };
}

/** The pass that applies the policy: what it did since the core started. */
export interface TranscriptProgress {
  running: boolean;
  /** Sessions archived and conversations erased by the pass under way or the last one. */
  compacted: number;
  erased: number;
  freedBytes: number;
  /** Steps left in the pass under way. */
  remaining: number;
  lastError: string | null;
  finishedAt: Timestamp | null;
}

/** A conversation in the archive. */
export interface ArchivedTranscript {
  threadId: ThreadId;
  title: string;
  projectPath: string | null;
  provider: string | null;
  model: string | null;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
  /** Null while the conversation is still open in the app. */
  deletedAt: Timestamp | null;
  compactedAt: Timestamp;
  sessions: number;
  records: number;
  bytes: number;
  failures: number;
}

/** A failure the archive's index lists: a failed tool, an API error, a harness error. */
export interface ArchivedFailure {
  threadId: ThreadId;
  sessionId: string;
  line: number;
  at: Timestamp | null;
  kind: string;
  tool: string | null;
  text: string;
}

/** What `transcripts.read` answers at most, in records and in bytes of JSON. */
export const TRANSCRIPT_READ_MAX_RECORDS = 500;
export const TRANSCRIPT_READ_MAX_BYTES = 262_144;

export interface TranscriptsRpcMethods {
  'transcripts.preview': { params: { policy: TranscriptPolicy }; result: TranscriptPreview };
  'transcripts.progress': { params: Record<string, never>; result: TranscriptProgress };
  /** Archives the provider sessions no conversation names, idle for `days`; never erases one. */
  'transcripts.compactUnlinked': { params: { days: number }; result: TranscriptProgress };
  /**
   * Archived conversations, newest first, optionally those whose title or
   * folder holds `query`. In the three reads below `threadId` is the calling
   * agent's own thread, as every agent method names it; the owner leaves it out.
   */
  'transcripts.list': { params: { threadId?: ThreadId; query?: string; limit?: number }; result: ArchivedTranscript[] };
  /** Failures of the archive, newest first, of one conversation or all. */
  'transcripts.failures': { params: { threadId?: ThreadId; conversation?: string; query?: string; limit?: number }; result: ArchivedFailure[] };
  /**
   * Records of the archived `conversation`, in order from `after` (a line of
   * a session, 0 at first), of the given kinds, whose JSON holds `query`.
   * `next` is the line to ask from again, null at the end of the session.
   */
  'transcripts.read': {
    params: { threadId?: ThreadId; conversation: string; sessionId?: string; after?: number; kinds?: string[]; query?: string; limit?: number };
    result: { sessionId: string | null; sessions: string[]; records: { line: number; record: Record<string, unknown> }[]; next: number | null };
  };
}

export interface TranscriptsRpcEvents {
  'transcripts.progress': TranscriptProgress;
}
