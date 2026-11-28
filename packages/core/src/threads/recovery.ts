import { ACTIVE_THREAD_STATUSES } from '@boite/contracts';
import type { RpcParams, ThreadId, ThreadSummary, Turn } from '@boite/contracts';
import type { Core } from '../core.ts';
import { assertDriverRunnable } from '../drivers/index.ts';
import { notFound, refused } from '../errors.ts';
import { requireAgent } from './agentless.ts';
import { HANDOFF, type HandoffResult } from './handoff.ts';
import { markQueued, settleStatus } from './lifecycle.ts';
import { checkStoredEffort, checkStoredSpeed } from './selection.ts';
import { announceFinished, finishProviderTurn, finishTurn, matchesProviderSession, userStopKey } from './turn-settlement.ts';
import { addErrorPart, closeAsError, openTurnMessage } from './turn-error.ts';

/** What a turn a dead core left behind says, once the next core has closed it. */
export const CRASH_WHILE_RUNNING = 'The core stopped while this turn was running.';
/** The same, for a turn that resumes by itself once the core started (`threads/auto-continue.ts`). */
export const CRASH_RESUMING = 'The core stopped while this turn was running; Boite resumes it.';
const CRASH_WHILE_QUEUED = 'The core stopped while this turn was queued; send the prompt again.';

/**
 * Closes what a core that died mid-turn left open, before the next one
 * accepts a connection.
 */
export class ThreadRecovery {
  readonly #core: Core;

  constructor(core: Core) {
    this.#core = core;
  }

  /**
   * A core that dies mid-turn leaves that turn `running` or `queued` in the
   * journal, and the next start comes up with an empty scheduler: nothing would
   * ever finish it. Unsent ordinary prompts retain their identity and frozen
   * selection, returning to the queue after a recent crash. A turn that may
   * have reached its provider becomes an error; it is never replayed here, but
   * a conversation's turn cut within the hour gets a continuation once the
   * core started (`threads/auto-continue.ts`).
   */
  recoverStuckTurns(): number {
    const stuck = this.#core.journal.unfinishedTurns();
    const handoff = this.#core.threads.handoff;
    const inherited = handoff.inheritedTurns();
    const recentCrash = stuck.length > 0 && this.#core.threads.autoContinue.previousRunCut();
    /** Threads whose queued turn goes back in line once the server listens. */
    const waiting = new Set<ThreadId>();
    const counts = { requeued: 0, held: 0, handedOver: 0, stopped: 0, failed: 0 };
    for (const turn of stuck) {
      const previous = turn.status;
      if (this.#core.journal.getSetting(userStopKey(turn.id)) === true) {
        const result = handoff.stoppedResult(turn.id);
        this.#core.bus.afterCommit(() => this.#core.journal.db.transaction(() => {
          handoff.forget(turn.threadId);
          this.#core.threads.resumes.forget(turn.threadId);
          this.#closeTurn(turn, 'stopped', 'user-stop', result);
        })());
        counts.stopped += 1;
        continue;
      }
      if (handoff.requeues(turn)) {
        counts.requeued += 1;
        this.#core.logs.info(`Turn ${turn.id} was handed over by the previous core and goes back in the queue`, { source: 'turns', event: 'turn.recovery.requeued', threadId: turn.threadId, turnId: turn.id, data: { previous } });
        waiting.add(turn.threadId);
        continue;
      }
      const thread = this.#core.journal.getThread(turn.threadId);
      const target = turn.execution;
      // The workflow already recorded this summary as delivered. Its queued
      // turn is the only copy that can reach the driver after a restart.
      if (previous === 'queued' && turn.startedAt === null && !turn.queueHold && target?.workflowSummary
        && thread && !thread.archived && !thread.parentThreadId) {
        this.#core.scheduler.enqueue(turn, target.accountId, { recovering: true });
        counts.requeued += 1;
        waiting.add(turn.threadId);
        continue;
      }
      const manual = this.#core.threads.resumes.manuallyAdmitted(turn);
      if (previous === 'queued' && turn.startedAt === null && target && thread && !thread.archived && !thread.parentThreadId
        && (!target.operation || manual || this.#core.threads.resumes.admitted(turn))) {
        if (recentCrash && !turn.queueHold && Date.now() - turn.queuedAt <= HANDOFF.maxAgeMs) {
          this.#core.scheduler.enqueue(turn, target.accountId, { recovering: true });
          counts.requeued += 1;
          waiting.add(turn.threadId);
          continue;
        }
        // An expired automatic continuation has nothing new for the owner to resume.
        if (target.operation && !manual) {
          this.#core.threads.markQueuedStopped(turn.id);
          counts.stopped += 1;
          continue;
        }
        const held: Turn = { ...turn, queueHold: turn.queueHold ?? { reason: 'core-restarted', since: Date.now() } };
        this.#core.bus.afterCommit(() => this.#core.journal.db.transaction(() => {
          if (!turn.queueHold) this.#core.journal.append({ type: 'turn.held', threadId: turn.threadId, version: 1, payload: held }, () => this.#core.journal.putTurn(held));
          markQueued(this.#core, turn.threadId);
        })());
        this.#core.scheduler.enqueue(held, held.execution!.accountId);
        counts.held += 1;
        this.#core.logs.info(`Turn ${turn.id} was queued when the previous core stopped; it is held until the user resumes or discards it`, { source: 'turns', event: 'turn.recovery.held', threadId: turn.threadId, turnId: turn.id, data: { reason: held.queueHold!.reason } });
        waiting.add(turn.threadId);
        continue;
      }
      if (previous === 'running' && inherited.get(turn.id) === 'running') {
        const queuedInput = handoff.inheritedQueuedInputOutcome(turn.id);
        const completed = queuedInput?.queuedInputCompleted === true;
        const recovered: Turn = !completed && turn.execution && queuedInput ? { ...turn, execution: {
          ...turn.execution,
          ...('queuedInputSession' in queuedInput ? { queuedInputSession: queuedInput.queuedInputSession } : { queuedInputInterrupted: true }),
        } } : turn;
        const status = completed ? 'done' : 'stopped';
        this.#core.bus.afterCommit(() => this.#core.journal.db.transaction(() => this.#closeTurn(recovered, status, 'handed-over', queuedInput))());
        counts.handedOver += 1;
        const next = queuedInput ? 'the composer queue owns the follow-up' : "the thread's next turn resumes it";
        this.#core.logs.info(`Turn ${turn.id} was recovered as ${status} after a restart handoff. ${next}`, { source: 'turns', event: 'turn.recovery.handed-over', threadId: turn.threadId, turnId: turn.id });
        continue;
      }
      const blocker = previous === 'running' ? this.#core.threads.autoContinue.crashBlocker(turn) : null;
      const resumes = previous === 'running' && blocker === null;
      this.#core.journal.db.transaction(() => {
        this.#failStuckTurn(turn, previous === 'running' ? resumes ? CRASH_RESUMING : CRASH_WHILE_RUNNING : CRASH_WHILE_QUEUED);
        if (previous === 'queued' && turn.execution?.operation === 'coordination') this.#core.coordination.queuedCancelled(turn.threadId, turn.id);
      })();
      const operation = turn.execution?.operation;
      if (previous === 'running' && thread && !thread.archived && !thread.parentThreadId
        && operation !== 'compact' && operation !== 'coordination' && operation !== 'keepalive') {
        this.#core.threads.resumes.offer(turn, {
          kind: 'interrupted',
          detail: blocker ?? 'the core stopped unexpectedly',
        });
      }
      counts.failed += 1;
      this.#core.log(
        'warn',
        `recovered turn ${turn.id} of thread ${turn.threadId}, left ${previous} by a stopped core`,
        { source: 'turns', event: 'turn.recovery.failed', threadId: turn.threadId, turnId: turn.id, data: { previous } },
      );
    }
    if (stuck.length > 0) {
      // Requeued, held or handed over turns are a normal restart: only a failed one is worth a warning.
      this.#core.logs.record(counts.failed > 0 ? 'warn' : 'info', `Recovered ${stuck.length} unfinished turns left by the previous core: ${counts.requeued} requeued, ${counts.held} held, ${counts.handedOver} handed over, ${counts.stopped} stopped, ${counts.failed} marked failed`, {
        source: 'startup', event: 'startup.turns-recovered', data: { total: stuck.length, ...counts },
      });
    }
    for (const thread of this.#core.journal.listThreadsWithStatus(ACTIVE_THREAD_STATUSES)) {
      if (!waiting.has(thread.id)) settleStatus(this.#core, thread.id);
    }
    return stuck.length;
  }

  /** Changing a held prompt never makes a second turn or input receipt. */
  recover(params: RpcParams<'turns.recover'>): Turn {
    const { threadId, turnId, action } = params;
    if (action !== 'resume' && action !== 'discard') throw refused('action must be resume or discard', { field: 'action', expected: ['resume', 'discard'] });
    if (this.#core.stopping) throw refused('the core is stopping; reconnect before recovering a prompt');
    const thread = requireAgent(this.#core.threads, threadId);
    const turn = this.#core.journal.getTurn(turnId);
    if (!turn || turn.threadId !== threadId) throw notFound('turnId must name a turn of this thread', { field: 'turnId', threadId, turnId });
    // A response lost after admission is an idempotent read, not another launch.
    if (turn.status !== 'queued' || !turn.queueHold) return turn;
    if (action === 'discard') {
      if (!this.#core.scheduler.stop(threadId)) this.#core.threads.markQueuedStopped(turnId);
      return this.#core.journal.getTurn(turnId)!;
    }
    if (thread.archived) throw refused('cannot resume a prompt on an archived thread', { threadId });
    const target = turn.execution;
    if (!target || (target.operation && !this.#core.threads.resumes.manuallyAdmitted(turn)) || thread.parentThreadId) throw refused('only an unsent conversation prompt can be resumed', { turnId });
    this.#core.threads.codeCheckpoints.assertAvailable(thread.cwd);
    const provider = this.#core.providers.require(target.providerId);
    const account = this.#core.accounts.require(target.accountId);
    if (account.providerId !== provider.id) throw refused('the saved account belongs to another provider', { accountId: account.id, providerId: provider.id });
    // A provider updating holds the resumed prompt in the queue until its updater is done.
    assertDriverRunnable(provider.protocol, this.#core.providers.summary(provider.id), account, () => this.#core.providers.launcherScriptOnly(provider.id));
    checkStoredEffort(provider, account.id, target.model, target.effort);
    checkStoredSpeed(provider, account.id, target.model, target.speed ?? null);
    const resumed: Turn = { ...turn, queueHold: null };
    this.#core.journal.append({ type: 'turn.resumed', threadId, version: 1, payload: resumed }, () => this.#core.journal.putTurn(resumed));
    this.#core.scheduler.enqueue(resumed, account.id);
    return resumed;
  }

  /** The previous core did not commit the end of this turn. */
  #closeTurn(turn: Turn, status: 'done' | 'stopped', cause: 'handed-over' | 'user-stop', result?: HandoffResult): void {
    const threadId = turn.threadId;
    for (const message of this.#core.journal.walkTurnMessages(threadId, turn.id, { blobs: false })) {
      if (message.state !== 'streaming') continue;
      this.#core.journal.append(
        { type: 'message.completed', threadId, version: 1, payload: { messageId: message.id, state: 'complete' } },
        () => {
          this.#core.journal.setMessageState(message.id, 'complete');
        },
      );
      this.#core.bus.emit('message.completed', { threadId, messageId: message.id, state: 'complete' });
    }
    const finished: Turn = { ...turn, status, finishedAt: Date.now(), usage: turn.usage ?? result?.usage ?? null };
    const { execution } = finished;
    const sessionId = result?.sessionId;
    const patch = sessionId === undefined || execution === undefined ? undefined : (current: ThreadSummary) =>
      current.sessionId !== sessionId && matchesProviderSession(current, execution) ? { ...current, sessionId, sessionResumeAt: null } : current;
    if (status === 'done') this.#core.threads.accountSessions.settledElsewhere(finished, sessionId ?? null, result?.cwd);
    const settled = status === 'done'
      ? finishProviderTurn(this.#core, finished, 'handed-over', patch)
      : finishTurn(this.#core, finished, cause, patch);
    announceFinished(this.#core, finished, settled);
  }

  #failStuckTurn(turn: Turn, reason: string): void {
    const threadId = turn.threadId;
    if (this.#core.journal.getThread(threadId) !== null) {
      // The turn's own messages, and only the ones still open: a caret left
      // blinking on a message nobody will ever write to again is the visible half
      // of this bug.
      // Through the turn index: the rest of the thread, images included, is never parsed.
      const streaming = Array.from(this.#core.journal.walkTurnMessages(threadId, turn.id, { blobs: false }))
        .filter((message) => message.state === 'streaming');
      const carrier = streaming.at(-1) ?? openTurnMessage(this.#core, turn);
      addErrorPart(this.#core, threadId, carrier, reason);
      for (const message of streaming) if (message.id !== carrier.id) closeAsError(this.#core, threadId, message.id);
      closeAsError(this.#core, threadId, carrier.id);
    }

    // The thread rests where a live failure leaves it: `error` (`threads/lifecycle.ts`).
    const finished: Turn = { ...turn, status: 'error', finishedAt: Date.now(), error: reason };
    announceFinished(this.#core, finished, finishTurn(this.#core, finished, 'crashed'));
  }
}
