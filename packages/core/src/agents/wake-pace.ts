/**
 * How often a desk thread's finished turns wake its mochi
 * (`docs/internals/mochis.md#paced-turn-facts`). A turn after which the thread
 * carries on by itself says nothing; the one it stops on is told, after a delay
 * that grows while the mochi's wakes about that thread end `[quiet]`. A wake
 * that failed before its agent answered gives its facts back.
 */
import type { Turn } from '@boite/contracts';
import type { Core } from '../core.ts';
import { RESIDENT_LETTERS } from '../coordination-letter.ts';
import { messageOf } from '../errors.ts';

/**
 * The delay a thread's finished turn waits before it wakes the mochi: the first
 * step, then one step further for each wake about that thread that ended
 * `[quiet]`, back to the first once one speaks. The last step bounds the delay.
 */
export const TURN_PACE_MS = [30_000, 5 * 60_000, 15 * 60_000, 30 * 60_000] as const;
/** A wake that failed before its agent answered gives its facts back; they wait this long, one step further for each failure. */
export const RETRY_PACE_MS = [60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000] as const;
/** The thread's answer a fact for the next routine quotes, at most: the mochi reads the rest with `boite thread show`. */
export const DEFERRED_ANSWER = 300;

/** A thread's answer as a fact for the next routine quotes it: its start, and where the rest is read (`address`, what `boite threads read` takes). */
export function cutAnswer(answer: string, address: string): string {
  const line = answer.replace(/\s+/g, ' ').trim();
  return line.length > DEFERRED_ANSWER ? `${line.slice(0, DEFERRED_ANSWER - 3)}... (the rest: boite threads read ${address})` : line;
}

const PACE = 'agents:pace:';
const DAY = 86_400_000;
/** A thread's step is forgotten this long after the last wake about it. */
const PACE_TTL = 7 * DAY;
/** A wake's record that never saw its turn end (a crash) goes after this. */
const WAKE_TTL = DAY;

/** What a wake carried, in the shape the runtime gave it back. */
export interface CarriedFact { key: string; paced?: string; tries?: number; notBefore: number }
interface PaceRecord<F> {
  /** Per paced thread: its step in `TURN_PACE_MS` and when it last changed. */
  steps: { [thread: string]: { step: number; at: number } };
  /** Per wake turn still running: the facts it carried. */
  wakes: { [turnId: string]: { facts: F[]; at: number } };
}

/**
 * A finished turn after which the thread goes on by itself: its next turn is
 * already queued, a goal or loop of its own is running, or the turn was the
 * thread's pull request watch at work. A turn that answered a letter from
 * another agent goes on by letter. An error is always told, and so is the turn
 * that answers the mochi's own letter: the mochi reads that answer only here
 * (`docs/internals/coordination.md#letters-from-the-mochi-of-a-project`).
 */
export function restartsAlone(core: Core, turn: Turn): boolean {
  if (turn.status === 'error') return false;
  const operation = turn.execution?.operation;
  if (operation === 'pull-request') return true;
  if (operation === 'coordination' && !answersMochi(core, turn)) return true;
  const newer = core.journal.db.query("SELECT id FROM turns WHERE thread_id = ? AND id != ? AND status IN ('queued', 'running') LIMIT 1").get(turn.threadId, turn.id);
  if (newer) return true;
  const { goal, loop } = core.activity.get(turn.threadId);
  // A reviewed goal's claim waits on its reviewer: that is where the thread stopped.
  return (goal?.status === 'active' && goal.review?.phase !== 'reviewing') || loop?.status === 'active';
}

/** A coordination turn that read a letter from the mochi looking after its thread. */
export function answersMochi(core: Core, turn: Turn): boolean {
  if (turn.execution?.operation !== 'coordination') return false;
  for (const message of core.journal.walkTurnMessages(turn.threadId, turn.id, { blobs: false })) {
    if (message.role === 'assistant') return false;
    if (message.parts.some(part => part.type === 'text' && part.text.includes(RESIDENT_LETTERS))) return true;
  }
  return false;
}

/**
 * Each mochi's pace, kept across restarts in `agents:pace:<agent>`: the step
 * of every thread whose turns it is told of, and the facts each of its wakes
 * still running carried, so a wake that fails gives them back.
 */
export class WakePace<F extends CarriedFact> {
  readonly #cache = new Map<string, PaceRecord<F>>();
  constructor(private readonly core: Core) {}

  /** How long a finished turn of this thread waits before it wakes the mochi. */
  delay(agentId: string, thread: string): number {
    return TURN_PACE_MS[this.step(agentId, thread)]!;
  }

  step(agentId: string, thread: string): number {
    const entry = this.#read(agentId).steps[thread];
    return entry && entry.at > Date.now() - PACE_TTL ? Math.min(entry.step, TURN_PACE_MS.length - 1) : 0;
  }

  /** A wake started with these facts. */
  carried(agentId: string, turnId: string, facts: readonly F[]): void {
    if (facts.length === 0) return;
    const record = this.#read(agentId);
    record.wakes[turnId] = { facts: [...facts], at: Date.now() };
    this.#write(agentId, record);
  }

  /**
   * A wake ended. A `[quiet]` one moves each thread whose turn it told of a
   * step further, one that spoke brings them back to the first. A wake that
   * failed before its agent answered returns its facts to be told again.
   */
  finished(agentId: string, turn: Turn, answered: boolean): F[] {
    const record = this.#read(agentId);
    const wake = record.wakes[turn.id];
    if (!wake) return [];
    delete record.wakes[turn.id];
    const now = Date.now();
    const threads = new Set(wake.facts.flatMap(fact => fact.paced ? [fact.paced] : []));
    if (turn.status === 'done') {
      for (const thread of threads) {
        const step = turn.quiet ? Math.min(this.step(agentId, thread) + 1, TURN_PACE_MS.length - 1) : 0;
        record.steps[thread] = { step, at: now };
      }
    }
    this.#write(agentId, record);
    return turn.status === 'error' && !answered ? wake.facts : [];
  }

  forget(agentId: string): void {
    this.#cache.delete(agentId);
    this.core.journal.deleteSetting(`${PACE}${agentId}`);
  }

  #read(agentId: string): PaceRecord<F> {
    const cached = this.#cache.get(agentId);
    if (cached) return cached;
    let record: PaceRecord<F> = { steps: {}, wakes: {} };
    try {
      const saved = this.core.journal.getSetting(`${PACE}${agentId}`) as Partial<PaceRecord<F>> | undefined;
      if (saved) record = { steps: saved.steps ?? {}, wakes: saved.wakes ?? {} };
    } catch (error) { this.core.log('warn', `agent pace ${agentId}: ${messageOf(error)}`); }
    this.#cache.set(agentId, record);
    return record;
  }

  #write(agentId: string, record: PaceRecord<F>): void {
    const now = Date.now();
    for (const [thread, entry] of Object.entries(record.steps)) if (entry.at <= now - PACE_TTL) delete record.steps[thread];
    for (const [turnId, wake] of Object.entries(record.wakes)) if (wake.at <= now - WAKE_TTL) delete record.wakes[turnId];
    this.#cache.set(agentId, record);
    if (Object.keys(record.steps).length === 0 && Object.keys(record.wakes).length === 0) this.core.journal.deleteSetting(`${PACE}${agentId}`);
    else this.core.journal.setSetting(`${PACE}${agentId}`, record);
  }
}
