/**
 * Conversation storage, after `packages/core/src/transcripts/engine.ts`. No
 * file here: the sizes are a fixed disk, split by what a policy reaches, and
 * applying a mode compacts nothing.
 */
import { RpcErrorCode, transcriptPolicyValid, type ArchivedTranscript, type TranscriptPolicy, type TranscriptProgress } from '@boite/contracts';
import { RpcFailure } from '../client';
import { T0 } from './shared';
import type { FakeContext, FakeMethods } from './context';

type TranscriptMethods = 'transcripts.preview' | 'transcripts.progress' | 'transcripts.compactUnlinked' | 'transcripts.list' | 'transcripts.failures' | 'transcripts.read';

const GIB = 1024 ** 3;
const DAY_MS = 86_400_000;
/** What a session keeps once archived, as the core would measure it. */
const KEPT = 0.06;
/** Provider sessions by what happened to their conversation: bytes, conversations, and the age in days of that state. */
const DISK = {
  open: [{ bytes: 9.4 * GIB, threads: 812, idle: 2 }, { bytes: 3.1 * GIB, threads: 344, idle: 45 }],
  deleted: [{ bytes: 6.2 * GIB, threads: 280, age: 3 }, { bytes: 11.5 * GIB, threads: 610, age: 18 }],
  unlinked: { bytes: 7.8 * GIB, sessions: 1930 },
};

const ARCHIVED: ArchivedTranscript = {
  threadId: 't-archived-audit', title: 'Fix the flaky upload test', projectPath: 'C:\\src\\boite', provider: 'claude', model: 'claude-sonnet-5-5',
  createdAt: T0 - 40 * DAY_MS, updatedAt: T0 - 39 * DAY_MS, deletedAt: T0 - 20 * DAY_MS, compactedAt: T0 - 13 * DAY_MS, sessions: 2, records: 4, bytes: 18_240, failures: 1,
};
const RECORDS = [
  { k: 'user', t: T0 - 40 * DAY_MS, text: 'The upload test fails one run in five.' },
  { k: 'call', t: T0 - 40 * DAY_MS + 4000, call: 'c1', tool: 'Bash', input: { command: 'bun test upload' } },
  { k: 'result', t: T0 - 40 * DAY_MS + 9000, call: 'c1', out: 'error: expected 200, received 503', exit: 1 },
  { k: 'assistant', t: T0 - 40 * DAY_MS + 15_000, text: 'The retry reads the body twice: fixed.' },
];

const due = (days: number | null, age: number): boolean => days !== null && age >= days;

export function transcriptMethods(ctx: FakeContext): Pick<FakeMethods, TranscriptMethods> {
  let progress: TranscriptProgress = { running: false, compacted: 0, erased: 0, freedBytes: 0, remaining: 0, lastError: null, finishedAt: null };
  let unlinked = DISK.unlinked;
  const owner = (method: string): void => {
    if (ctx.bus.principal !== 'owner') throw new RpcFailure({ code: RpcErrorCode.Refused, message: `${method} is the owner's` });
  };
  const matches = (query: string | undefined, text: string): boolean => query === undefined || text.toLowerCase().includes(query.toLowerCase());
  return {
    'transcripts.preview': async ({ policy }) => {
      owner('transcripts.preview');
      if (!transcriptPolicyValid(policy)) throw new RpcFailure({ code: RpcErrorCode.Refused, message: 'policy must set each delay, null (never) or a whole number of days', data: { field: 'policy' } });
      const p: TranscriptPolicy = policy;
      const compact = { threads: 0, bytes: 0 };
      const erase = { threads: 0, bytes: 0 };
      for (const pool of DISK.open) if (due(p.idleCompactDays, pool.idle)) { compact.threads += pool.threads; compact.bytes += pool.bytes; }
      for (const pool of DISK.deleted) {
        if (due(p.deletedEraseDays, pool.age)) { erase.threads += pool.threads; erase.bytes += pool.bytes; }
        else if (due(p.deletedCompactDays, pool.age)) { compact.threads += pool.threads; compact.bytes += pool.bytes; }
      }
      const totalBytes = [...DISK.open, ...DISK.deleted].reduce((sum, pool) => sum + pool.bytes, 0) + unlinked.bytes + ARCHIVED.bytes;
      return {
        policy: p, totalBytes, archiveBytes: ARCHIVED.bytes, compact, erase, images: { count: 0, bytes: 0 },
        freedBytes: Math.round(compact.bytes * (1 - KEPT)) + erase.bytes, keptRatio: KEPT, unlinked,
      };
    },
    'transcripts.progress': async () => { owner('transcripts.progress'); return progress; },
    'transcripts.compactUnlinked': async ({ days }) => {
      owner('transcripts.compactUnlinked');
      if (!Number.isInteger(days) || days < 0) throw new RpcFailure({ code: RpcErrorCode.Refused, message: 'days must be a whole number of days, 0 or more', data: { field: 'days' } });
      progress = { running: false, compacted: unlinked.sessions, erased: 0, freedBytes: Math.round(unlinked.bytes * (1 - KEPT)), remaining: 0, lastError: null, finishedAt: Date.now() };
      unlinked = { bytes: 0, sessions: 0 };
      ctx.emit('transcripts.progress', progress);
      return progress;
    },
    'transcripts.list': async ({ query }) => matches(query, ARCHIVED.title) ? [structuredClone(ARCHIVED)] : [],
    'transcripts.failures': async ({ conversation, query }) => (conversation === undefined || conversation === ARCHIVED.threadId) && matches(query, 'expected 200, received 503')
      ? [{ threadId: ARCHIVED.threadId, sessionId: 'journal', line: 3, at: T0 - 40 * DAY_MS + 9000, kind: 'tool', tool: 'Bash', text: 'error: expected 200, received 503' }]
      : [],
    'transcripts.read': async ({ conversation, kinds, query, after, limit }) => {
      if (conversation !== ARCHIVED.threadId) return { sessionId: null, sessions: [], records: [], next: null };
      const records = RECORDS.map((record, index) => ({ line: index + 1, record }))
        .filter(item => item.line > (after ?? 0) && (kinds === undefined || kinds.includes(item.record.k)) && matches(query, JSON.stringify(item.record)))
        .slice(0, limit ?? RECORDS.length);
      return { sessionId: 'journal', sessions: ['journal'], records, next: null };
    },
  };
}
