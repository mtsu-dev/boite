/**
 * The shared brain's instructions go to a native session once: whole on a
 * fresh session or when their text changed since the turn that last carried
 * them, else nothing, since the session already holds them. One record per
 * thread says what went out: the hash of the text, the session generation it
 * went to and the turn that carried it. A new generation (an account or
 * provider switch, a rewind, a background compaction adopted) and a session
 * id the turn starts without (a first turn, a continuation, the core's retry
 * on a fresh session) send it again. So do a compaction and a turn that did
 * not finish, through `brainContextEnded` and `forgetBrainContext`.
 */
import { createHash } from 'node:crypto';
import type { ThreadSummary, Turn } from '@boite/contracts';
import type { Core } from '../core.ts';

/** Per-thread settings key; `journal.ts` deletes it with the thread. */
export const BRAIN_SENT_PREFIX = 'brain-sent:';

interface BrainSent { hash: string; sessionGeneration: number; turnId: string }

/** The instructions for one composed prompt: `text` whole, or '' when this session already holds it. */
export function brainContextFor(core: Core, thread: ThreadSummary, sessionId: string | null, turnId: string, text: string): string {
  if (!text) return '';
  const key = `${BRAIN_SENT_PREFIX}${thread.id}`;
  const sent = core.journal.getSetting(key) as BrainSent | undefined;
  const generation = thread.sessionGeneration ?? 0;
  const hash = createHash('sha256').update(text).digest('hex');
  if (sessionId !== null && sent?.hash === hash && sent.sessionGeneration === generation) return '';
  core.journal.setSetting(key, { hash, sessionGeneration: generation, turnId } satisfies BrainSent);
  return text;
}

/** The session summed up its history, the instructions with it: the next turn carries them again. */
export function forgetBrainContext(core: Core, threadId: string): void {
  if (core.journal.getSetting(`${BRAIN_SENT_PREFIX}${threadId}`) !== undefined) core.journal.deleteSetting(`${BRAIN_SENT_PREFIX}${threadId}`);
}

/**
 * After a compaction the instructions are a summary at best; a turn that
 * failed or was stopped may never have handed them to the agent. Either way
 * the next turn sends them whole.
 */
export function brainContextEnded(core: Core, turn: Turn): void {
  const sent = core.journal.getSetting(`${BRAIN_SENT_PREFIX}${turn.threadId}`) as BrainSent | undefined;
  if (!sent) return;
  if (turn.execution?.operation === 'compact' || (turn.status !== 'done' && sent.turnId === turn.id)) forgetBrainContext(core, turn.threadId);
}
