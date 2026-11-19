/**
 * Coordination and delegation instructions go to a native session in full
 * on the first eligible turn and whenever the corresponding text changes.
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
type GuideKind = 'coordination' | 'delegation';
type GuidesSent = Partial<Record<GuideKind, GuideSent>>;
interface Pending { turnId: string; guides: GuidesSent }

function storedGuides(core: Core, threadId: string): GuideSent | GuidesSent {
  return (core.journal.getSetting(`${COORDINATION_SENT_PREFIX}${threadId}`) as GuideSent | GuidesSent | undefined) ?? {};
}

function sentGuides(core: Core, threadId: string): GuidesSent {
  const value = storedGuides(core, threadId);
  return 'hash' in value ? { coordination: value } : value;
}

function guideHeldBy(core: Core, thread: ThreadSummary, sessionId: string | null, kind: GuideKind): GuideSent | undefined {
  if (sessionId === null) return undefined;
  const sent = sentGuides(core, thread.id)[kind];
  return sent?.sessionGeneration === (thread.sessionGeneration ?? 0) ? sent : undefined;
}

/** Whether this native session may already know the guide and needs policy updates. */
export function sessionHoldsGuide(core: Core, thread: ThreadSummary, sessionId: string | null, kind: GuideKind): boolean {
  if (sessionId === null) return false;
  const value = storedGuides(core, thread.id);
  // Legacy receipts recorded coordination alone. The same session may already know delegation.
  const sent = 'hash' in value ? value : value[kind];
  return sent?.sessionGeneration === (thread.sessionGeneration ?? 0);
}

/** What a running turn carried, by thread, until that turn ends; in memory, so a core that stops mid-turn marks nothing. */
const carried = new WeakMap<Core, Map<string, Pending>>();

function carriedBy(core: Core): Map<string, Pending> {
  let map = carried.get(core);
  if (!map) carried.set(core, map = new Map());
  return map;
}

/** The guide for one composed prompt: `text` whole, or '' when this session already holds it. */
export function coordinationGuideFor(core: Core, thread: ThreadSummary, sessionId: string | null, turnId: string, text: string, kind: GuideKind = 'coordination'): string {
  if (!text) return '';
  const hash = createHash('sha256').update(text).digest('hex');
  if (guideHeldBy(core, thread, sessionId, kind)?.hash === hash) return '';
  const map = carriedBy(core);
  const pending = map.get(thread.id);
  const guides = pending?.turnId === turnId ? pending.guides : {};
  map.set(thread.id, { turnId, guides: { ...guides, [kind]: { hash, sessionGeneration: thread.sessionGeneration ?? 0 } } });
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
  if (turn.status === 'done') core.journal.setSetting(`${COORDINATION_SENT_PREFIX}${turn.threadId}`, { ...sentGuides(core, turn.threadId), ...pending.guides });
}
