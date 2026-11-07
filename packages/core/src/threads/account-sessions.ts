/*
 * One native session per account of a thread. Moving a thread to another
 * account starts a new session there, but the session it leaves still holds
 * everything up to the switch. It is kept, so a switch back resumes it and its
 * next prompt carries only the exchanges it missed (`switchBackInput`), rather
 * than starting fresh with excerpts of the whole conversation
 * (`continuationInput`).
 *
 * One journal setting per thread holds them, erased with the thread. A switch
 * back takes the saved session when it ran on the same provider in the same
 * folder, the turn it ended on is still in the journal (an edit before it
 * removes it) and what came since fits `RECENT_LIMIT`; otherwise the thread
 * starts fresh as before. A resumed session gets a new session generation, so
 * every guard on a late result of the account left in between still holds.
 *
 * An agent that no longer has the session (pruned transcript, deleted
 * rollout) answers the turn as a lost session, and the core retries it on a
 * fresh one with the whole history (`TurnAttempts`). An agent that cannot
 * reopen a session at all opens a new one and takes the context's
 * `continuation`, the same whole history.
 */

import type { AccountId, ContextUse, ProviderId, ThreadId, ThreadSummary, Turn, TurnId } from '@boite/contracts';
import { switchGapFits, type TailAnchor } from '../continuation.ts';
import type { Core } from '../core.ts';
import type { TurnResult } from '../drivers/types.ts';
import { compactionTail } from './background-compact.ts';

/** The journal setting holding a thread's saved sessions, erased with the thread (`Journal.deleteThreads`). */
export const ACCOUNT_SESSIONS_PREFIX = 'account-sessions:';

/** A native session the thread left on an account, as a switch back finds it. */
export interface SavedSession {
  providerId: ProviderId;
  sessionId: string;
  resumeAt: string | null;
  /** Where the session's own history ends: after this turn, or inside it. */
  after: TailAnchor;
  cwd: string;
  /** The session generations it ran on, newest first: its usage is theirs together. */
  generations: number[];
  /** Its last context reading, shown again once it is resumed. */
  context: ContextUse | null;
  savedAt: number;
}

/** The thread's current generation resumed a saved session. */
export interface ResumedSession {
  generation: number;
  /** The generations the session ran on before this one. */
  earlier: number[];
  /** The exchanges after this point go with the next prompt; null once a turn carried them. */
  after: TailAnchor | null;
}

interface Stored { saved: Partial<Record<AccountId, SavedSession>>; resumed?: ResumedSession }

/** What a switch back puts on the thread. */
export interface Restored { sessionId: string; resumeAt: string | null; context: ContextUse | null }

/**
 * Why a switch back to `to` cannot resume `saved`, or null when it can: the
 * one place that decides between resuming and starting fresh.
 */
export function resumeRefusal(core: Core, thread: ThreadSummary, to: { providerId: ProviderId }, saved: SavedSession): string | null {
  if (saved.providerId !== to.providerId) return 'it ran on another provider';
  if (saved.cwd !== thread.cwd) return 'the thread moved to another folder since';
  if (!switchGapFits(core.journal, thread.id, saved.after)) return 'what came since is past the bound or no longer in the conversation';
  return null;
}

export class AccountSessions {
  readonly #core: Core;
  /** The turn whose prompt carries the missed exchanges, per thread. */
  readonly #carrying = new Map<ThreadId, TurnId>();

  constructor(core: Core) { this.#core = core; }

  #read(threadId: ThreadId): Stored {
    const value = this.#core.journal.getSetting(`${ACCOUNT_SESSIONS_PREFIX}${threadId}`) as Stored | undefined;
    return value ?? { saved: {} };
  }

  #write(threadId: ThreadId, stored: Stored): void {
    const key = `${ACCOUNT_SESSIONS_PREFIX}${threadId}`;
    if (Object.keys(stored.saved).length === 0 && stored.resumed === undefined) this.#core.journal.deleteSetting(key);
    else this.#core.journal.setSetting(key, stored);
  }

  /** The saved session of `accountId`, for a test or a log. */
  saved(threadId: ThreadId, accountId: AccountId): SavedSession | null {
    return this.#read(threadId).saved[accountId] ?? null;
  }

  /** The resumed session's record when it is the thread's current generation. */
  #resumed(thread: ThreadSummary, stored = this.#read(thread.id)): ResumedSession | null {
    return stored.resumed !== undefined && stored.resumed.generation === (thread.sessionGeneration ?? 0) ? stored.resumed : null;
  }

  /** The generations the thread's current session ran on, its current one first. */
  generations(thread: ThreadSummary): number[] {
    const generation = thread.sessionGeneration ?? 0;
    return [generation, ...this.#resumed(thread)?.earlier ?? []];
  }

  /** Where the history of the session the thread runs on now ends, or null when no turn of it is known. */
  #end(thread: ThreadSummary, resumed: ResumedSession | null): TailAnchor | null {
    // A swapped-in summary ends before the turns its tail still has to carry.
    const tail = compactionTail(this.#core, thread);
    if (tail !== null) return { turnId: tail.after, afterPart: tail.afterPart ?? null };
    // Missed exchanges no turn has carried yet are still missing from it.
    if (resumed?.after) return resumed.after;
    // The last answered turn: a stopped or failed one may be missing from the session, so it goes with the missed exchanges.
    const row = this.#core.journal.db.query(`SELECT id FROM turns WHERE thread_id = ? AND status = 'done'
      AND json_extract(execution, '$.accountId') = ? AND json_extract(execution, '$.sessionGeneration') = ?
      ORDER BY rowid DESC LIMIT 1`).get(thread.id, thread.accountId, thread.sessionGeneration ?? 0) as { id: TurnId } | null;
    return row === null ? null : { turnId: row.id, afterPart: null };
  }

  /**
   * The thread leaves its account for `to`, on session generation
   * `generation`: the session it leaves is saved, and the one `to` left
   * before, when it can be resumed, is taken back. Null: the thread starts
   * fresh. Runs in the transaction that saves the thread.
   */
  switching(thread: ThreadSummary, to: { providerId: ProviderId; accountId: AccountId }, generation: number): Restored | null {
    const stored = this.#read(thread.id);
    const resumed = this.#resumed(thread, stored);
    const end = thread.sessionId === null ? null : this.#end(thread, resumed);
    if (thread.sessionId !== null && end !== null) {
      stored.saved[thread.accountId] = {
        providerId: thread.providerId, sessionId: thread.sessionId, resumeAt: thread.sessionResumeAt ?? null, after: end, cwd: thread.cwd,
        generations: this.generations(thread), context: thread.context, savedAt: Date.now(),
      };
    } else delete stored.saved[thread.accountId];
    const saved = stored.saved[to.accountId];
    delete stored.saved[to.accountId];
    delete stored.resumed;
    this.#carrying.delete(thread.id);
    const refusal = saved === undefined ? null : resumeRefusal(this.#core, thread, to, saved);
    if (saved !== undefined && refusal === null) stored.resumed = { generation, earlier: saved.generations, after: saved.after };
    this.#write(thread.id, stored);
    if (saved === undefined) return null;
    if (refusal !== null) {
      this.#core.logs.info(`The thread starts a fresh session on account ${to.accountId} instead of resuming ${saved.sessionId}: ${refusal}`, {
        source: 'turns', event: 'thread.session-not-resumed', threadId: thread.id, data: { accountId: to.accountId, reason: refusal },
      });
      return null;
    }
    this.#core.logs.info(`The thread resumes its session ${saved.sessionId} on account ${to.accountId}; the next prompt carries what came since`, {
      source: 'turns', event: 'thread.session-resumed', threadId: thread.id, data: { accountId: to.accountId, after: saved.after.turnId },
    });
    return { sessionId: saved.sessionId, resumeAt: saved.resumeAt, context: saved.context };
  }

  /** The point after which the next prompt carries the missed exchanges, or null. */
  gap(thread: ThreadSummary): TailAnchor | null {
    return thread.sessionId === null ? null : this.#resumed(thread)?.after ?? null;
  }

  /** The prompt of `turnId` carries the missed exchanges; they are cleared once that turn is done. */
  carried(threadId: ThreadId, turnId: TurnId): void {
    this.#carrying.set(threadId, turnId);
  }

  /** The turn whose prompt carries the missed exchanges, if any. */
  carrying(threadId: ThreadId): TurnId | undefined {
    return this.#carrying.get(threadId);
  }

  /** A turn of the thread's current session ended. */
  turnFinished(thread: ThreadSummary, turn: Turn): void {
    if (this.#carrying.get(thread.id) !== turn.id) return;
    this.#carrying.delete(thread.id);
    if (turn.status !== 'done') return;
    const stored = this.#read(thread.id);
    const resumed = this.#resumed(thread, stored);
    if (resumed === null || resumed.after === null) return;
    stored.resumed = { ...resumed, after: null };
    this.#write(thread.id, stored);
  }

  /**
   * A turn accepted before the thread changed account settled after it, on
   * the session the thread left: that saved session now ends with it. Runs
   * in the transaction that settles the turn.
   */
  settledElsewhere(finished: Turn, result: TurnResult, ranIn: string): void {
    const execution = finished.execution;
    // Only an answered turn is sure to be in the session; the saved end stays before any other.
    if (!execution || result.sessionId === null || finished.status !== 'done') return;
    const current = this.#core.journal.getThread(finished.threadId);
    if (current === null || current.accountId === execution.accountId) return;
    const stored = this.#read(finished.threadId);
    const saved = stored.saved[execution.accountId];
    // A later session of that account replaced the one this turn ran on.
    if (saved !== undefined && saved.generations[0] !== execution.sessionGeneration) return;
    stored.saved[execution.accountId] = {
      providerId: execution.providerId, sessionId: result.sessionId, resumeAt: null, after: { turnId: finished.id, afterPart: null },
      cwd: saved?.cwd ?? ranIn, generations: saved?.generations ?? [execution.sessionGeneration], context: saved?.context ?? null, savedAt: Date.now(),
    };
    this.#write(finished.threadId, stored);
  }
}
