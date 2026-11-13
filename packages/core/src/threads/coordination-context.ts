/**
 * The coordination guide and an entrusted thread's instructions go to a
 * native session once: whole on a fresh session or when their text changed
 * (coordination paused or resumed, contacts reachable or not, the Contacts
 * bot's role, the entrusted agent's instructions), else nothing, since the
 * session already holds them. One record per thread says what the session
 * holds: the hash of the text and the session generation it went to.
 *
 * The record is written when the turn that carried the text ends done, not
 * when the prompt is composed: a turn that failed or was stopped may never
 * have handed it to the agent, so the next one sends it again. A compaction
 * sums the text up with the rest of the session, so it drops the record
 * (`forgetCoordinationGuide`); a turn at capacity continues on a short prompt
 * without the text and marks nothing (`coordinationGuideUnsent`). A new generation (an
 * account or provider switch, a rewind, a background compaction adopted) and
 * a session id the turn starts without send it again.
 */
import { createHash } from 'node:crypto';
import type { ThreadSummary, Turn } from '@boite/contracts';
import type { Core } from '../core.ts';

/** Per-thread settings key; `journal.ts` deletes it with the thread. */
export const COORDINATION_SENT_PREFIX = 'coordination-sent:';

interface GuideSent { hash: string; sessionGeneration: number }

/** What a running turn carried, by thread, until that turn ends; in memory, so a core that stops mid-turn marks nothing. */
const carried = new WeakMap<Core, Map<string, GuideSent & { turnId: string }>>();

function carriedBy(core: Core): Map<string, GuideSent & { turnId: string }> {
  let map = carried.get(core);
  if (!map) carried.set(core, map = new Map());
  return map;
}

/** The guide for one composed prompt: `text` whole, or '' when this session already holds it. */
export function coordinationGuideFor(core: Core, thread: ThreadSummary, sessionId: string | null, turnId: string, text: string): string {
  if (!text) return '';
  const sent = core.journal.getSetting(`${COORDINATION_SENT_PREFIX}${thread.id}`) as GuideSent | undefined;
  const sessionGeneration = thread.sessionGeneration ?? 0;
  const hash = createHash('sha256').update(text).digest('hex');
  if (sessionId !== null && sent?.hash === hash && sent.sessionGeneration === sessionGeneration) return '';
  carriedBy(core).set(thread.id, { hash, sessionGeneration, turnId });
  return text;
}

/** The session no longer holds the guide, or the running turn's prompt went without it: the next turn carries it. */
export function forgetCoordinationGuide(core: Core, threadId: string): void {
  carriedBy(core).delete(threadId);
  if (core.journal.getSetting(`${COORDINATION_SENT_PREFIX}${threadId}`) !== undefined) core.journal.deleteSetting(`${COORDINATION_SENT_PREFIX}${threadId}`);
}

/** The running turn's prompt went without the guide after all (a retry on a short prompt): what the session held before stands. */
export function coordinationGuideUnsent(core: Core, threadId: string): void {
  carriedBy(core).delete(threadId);
}

/** A turn ended: what it carried is held by the session when the agent took the turn to its end, and by nothing after a compaction. */
export function coordinationGuideEnded(core: Core, turn: Turn): void {
  const map = carriedBy(core);
  const pending = map.get(turn.threadId);
  if (turn.execution?.operation === 'compact') return forgetCoordinationGuide(core, turn.threadId);
  if (pending?.turnId !== turn.id) return;
  map.delete(turn.threadId);
  if (turn.status === 'done') core.journal.setSetting(`${COORDINATION_SENT_PREFIX}${turn.threadId}`, { hash: pending.hash, sessionGeneration: pending.sessionGeneration } satisfies GuideSent);
}
