import type { ProviderId, ThreadId, ThreadRetry, ThreadSummary, Turn, TurnId } from '@boite/contracts';
import type { Core } from '../core.ts';
import { assertDriverRunnable, getDriver, releaseThread } from '../drivers/index.ts';
import type { TurnHandle, TurnResult } from '../drivers/types.ts';
import { messageOf, refused, RpcFailure } from '../errors.ts';
import { logMessageOf } from '../log-errors.ts';
import { reportSettlementError, settleTurn } from './turn-settlement.ts';
import type { ThreadStore } from '../threads.ts';
import { withLoad } from './records.ts';
import { markRunning } from './lifecycle.ts';
import { STOP_DEADLINE, TurnAttempts, type TurnAttemptState } from './turn-attempts.ts';
import { stderrTail } from '../drivers/stderr-tail.ts';
import { turnSwitch } from './switch-notice.ts';
import { writeTurnError } from './turn-error.ts';
import { folderPresent, restoreThreadCwd, ThreadCwdGone } from './cwd.ts';
import { abortable } from '../abortable.ts';
import type { QueuedInputOutcome } from './handoff.ts';

export { STOP_DEADLINE } from './turn-attempts.ts';

/**
 * One turn from the scheduler to its end: the driver started and awaited,
 * a lost session retried once on a fresh one, a stop that the agent
 * ignores ended by the deadline, and what the finished turn leaves behind.
 */
export class TurnRunner {
  readonly #attempts: TurnAttempts;
  readonly handles: TurnAttempts['handles'];
  readonly steering: Pick<TurnAttempts['steering'], 'has' | 'size'>;
  /**
   * Standalone messages inserted during a running answer, with their timestamps.
   * The turn's emitter starts its next segment after the latest one.
   */
  readonly answerAfter = new Map<TurnId, number>();

  readonly #core: Core;

  constructor(core: Core, private readonly threads: ThreadStore) {
    this.#core = core;
    this.#attempts = new TurnAttempts(core, threads);
    this.handles = this.#attempts.handles;
    this.steering = this.#attempts.steering;
  }

  beginSteering(threadId: ThreadId, handle: TurnHandle) {
    return this.#attempts.beginSteering(threadId, handle);
  }

  /** Mail is a timeline boundary even when the provider has not accepted it yet. */
  noteMail(threadId: ThreadId, at: number, turnId?: TurnId): void {
    const turn = this.#core.journal.runningTurn(threadId);
    if (turn && (turnId === undefined || turn.id === turnId)) this.answerAfter.set(turn.id, Math.max(at, this.answerAfter.get(turn.id) ?? 0));
  }

  /** Asks a running turn to pause at its next tool boundary for an agent update. False when the thread runs no turn. */
  requestPause(threadId: ThreadId, providerId: ProviderId): boolean {
    return this.#attempts.requestPause(threadId, providerId);
  }

  /** Withdraws a pause not yet taken. */
  cancelPause(threadId: ThreadId): void {
    this.#attempts.cancelPause(threadId);
  }

  /** The capacity retry the thread's turn waits for, or null. */
  retryOf(threadId: ThreadId): ThreadRetry | null {
    return this.#attempts.retryOf(threadId);
  }

  /** Gives up a capacity retry: the turn fails with the refusal. False when none waits. */
  cancelRetry(threadId: ThreadId): boolean {
    return this.#attempts.cancelRetry(threadId);
  }

  /** True while the thread's turn waits for its agent's update. */
  isPaused(threadId: ThreadId): boolean {
    return this.#attempts.isPaused(threadId);
  }

  /** What a saved selection means for the turn that is running: its mode, its effort and its speed. */
  selectionChanged(before: ThreadSummary, next: ThreadSummary): void {
    this.#attempts.selectionChanged(before, next);
  }

  /**
   * A wake whose letters cannot cross stops and puts them back in the inbox: a refusal is that
   * ordinary stop, a fault also reaches the scheduler's error log.
   */
  private prepareWake(turnId: TurnId, threadId: ThreadId): boolean {
    try { return this.#core.coordination.prepareWake(threadId, turnId); } catch (error) {
      if (error instanceof RpcFailure) return false;
      this.threads.markQueuedStopped(turnId);
      throw error;
    }
  }

  async runTurn(turnId: TurnId, threadId: ThreadId): Promise<void> {
    const queued = this.#core.journal.getTurn(turnId);
    const selected = this.#core.journal.getThread(threadId);
    if (queued === null || selected === null) return;
    if (!this.#core.delegation.prepareTurn(queued)) {
      this.threads.markQueuedStopped(turnId);
      return;
    }
    if (queued.execution?.operation === 'coordination' && !this.prepareWake(turnId, threadId)) {
      this.threads.markQueuedStopped(turnId);
      return;
    }
    const state: TurnAttemptState = {
      threadId, turnId,
      stop: new AbortController(), finishing: false,
      thread: { ...selected, ...queued.execution, permissionMode: selected.permissionMode },
      running: { ...queued, status: 'running', startedAt: Date.now() },
    };
    // What changed since the transcript last stated a selection: the turn's divider (`threads/switch-notice.ts`).
    const switched = turnSwitch(this.#core, state.running);
    if (switched) state.running.switched = switched;
    const permissions = this.#attempts.open(state);

    let result: TurnResult;
    let started = false;
    try {
      // Commit the running state before a driver can spawn or stream output.
      this.threads.progress.begin(threadId, turnId);
      this.#core.bus.afterCommit(() => this.#core.journal.db.transaction(() => {
        this.#core.journal.append({ type: 'turn.started', threadId, version: 1, payload: state.running }, () => {
          this.#core.journal.putTurn(state.running);
        });
        this.#core.bus.emit('turn.started', state.running);
        markRunning(this.#core, threadId);
      })());
      started = true;
      // A delegated agent with a worktree of its own: made from its parent's HEAD before the agent starts in it.
      const entering = this.#core.delegation.worktrees.enter(threadId, () => {
        if (state.stop.signal.aborted) throw refused('worktree preparation was stopped');
      });
      if (entering) await entering;
      // Turns Boite starts by itself (a subagent's result, a resume) skip `turns.start`, which does this too.
      else {
        const restoring = restoreThreadCwd(this.#core, state.thread);
        if (restoring) await restoring;
      }
      // Any conversation in a checkout under its project's .boite, perhaps made by an older core, gets the marker.
      const project = state.thread.projectId === null ? null : this.#core.journal.getProject(state.thread.projectId);
      if (project !== null) this.#core.worktrees.markReused(project, state.thread.cwd);
      this.#core.workforce.resident.assertThreadRoute(threadId, state.thread);
      const provider = this.#core.providers.require(state.thread.providerId);
      const account = this.#core.accounts.require(state.thread.accountId);
      assertDriverRunnable(provider.protocol, this.#core.providers.summary(provider.id), account);
      const driver = getDriver(provider.protocol);
      result = await this.#attempts.run(queued, state, { provider, account, driver }, permissions);
      if (state.running.execution?.operation === 'coordination' && result.status === 'done') this.#core.coordination.submitted(threadId, turnId);
    } catch (error) {
      result = state.stop.signal.aborted
        ? { status: 'stopped', sessionId: state.thread.sessionId, usage: null }
        : { status: 'error', sessionId: state.thread.sessionId, usage: null, error: messageOf(error), diagnosticError: logMessageOf(error) };
    } finally {
      state.finishing = true;
      try { this.#attempts.finishAttempts(threadId); }
      catch (error) { reportSettlementError(this.#core, threadId, turnId, 'attempt cleanup', error); }
      this.answerAfter.delete(turnId);
    }

    const { thread, running } = state;
    const queuedInput = result.queuedInputCancelled && result.sessionId !== null
      ? { queuedInputSession: result.sessionId }
      : result.queuedInputInterrupted ? { queuedInputInterrupted: true as const } : undefined;
    const handoffOutcome: QueuedInputOutcome | undefined = result.status === 'done' && result.queuedInputCompleted
      ? { queuedInputInterrupted: true, queuedInputCompleted: true, usage: result.usage, sessionId: result.sessionId ?? undefined } : queuedInput;
    // The handoff can expire while a filesystem check or checkpoint is still pending.
    if (running.execution && handoffOutcome) this.threads.handoff.recordQueuedInputOutcome(turnId, handoffOutcome);

    // Read after the failure, so a turn that starts well never waits on the disk.
    if (result.status === 'error' && !result.refusal && !(await folderPresent(state.thread.cwd))) {
      const gone = new ThreadCwdGone(threadId, state.thread.cwd);
      result = { ...result, error: gone.message, diagnosticError: `${gone.message}; the agent said: ${result.diagnosticError ?? result.error ?? 'nothing'}`, cwdGone: true };
    }
    if (!this.#core.journal.isClosed()) {
      // A failure no driver wrote (route check, worktree, checkpoint, preparation) still says why, else the turn only reads "failed". A gone folder has its own notice.
      if (started && result.status === 'error' && !result.cwdGone && !this.#saidWhy(threadId, turnId)) {
        try { writeTurnError(this.#core, running, result.error ?? 'unknown error'); }
        catch (error) { reportSettlementError(this.#core, threadId, turnId, 'error message', error); }
      }
      try { await this.#finishCheckpoint(state); }
      catch (error) { reportSettlementError(this.#core, threadId, turnId, 'checkpoint', error); }
    }
    const finished: Turn = {
      ...running,
      status: result.status === 'done' ? 'done' : result.status,
      finishedAt: Date.now(),
      usage: result.usage,
      error: result.error ?? null,
      ...(running.execution && queuedInput ? { execution: { ...running.execution, ...queuedInput } } : {}),
      ...(result.checkpoint ? { checkpoint: result.checkpoint } : {}),
      ...(result.agentTotals ? { agentTotals: result.agentTotals } : {}),
    };
    const settlement = { queued, running, thread, result, started, finished };
    const completion = await settleTurn(this.#core, settlement).finally(() => {
      if (handoffOutcome) this.threads.handoff.releaseQueuedInputOutcome(turnId);
      this.#attempts.close(threadId);
    });
    // No in-memory events or after-finish effects run before the transaction
    // commits. Even a failure in the thread write cannot publish completion twice.
    if (completion === null) {
      // An abandoned result still owns its old progress, but a newer turn does not.
      if (!this.#core.journal.isClosed()) this.threads.progress.end(threadId, turnId);
      return;
    }
    result = settlement.result;
    const { next, sameSession, threadOwned } = completion;
    this.threads.progress.end(threadId, turnId);
    if (threadOwned) {
      try {
        this.threads.cards.clearPermissionsOf(threadId);
        this.threads.cards.clearQuestionsOf(threadId);
      } catch (error) { reportSettlementError(this.#core, threadId, turnId, 'card cleanup', error); }
    }
    this.#core.bus.emit('turn.finished', finished);
    if (result.status === 'error') {
      this.#core.log('error', `turn ${turnId} failed: ${result.diagnosticError ?? result.error ?? 'unknown error'}`, { source: thread.providerId, event: 'turn.failed', threadId, turnId });
      // The agent's own last words are usually the cause; provider output is otherwise never persisted.
      // Only this turn's: a quick retry must not blame the previous turn's lines on it.
      // After settlement: a diagnostic failure must not skip the moves, wakes and flushes below.
      try {
        const tail = stderrTail(threadId, undefined, undefined, running.startedAt ?? 0);
        if (tail !== null) this.#core.logs.warn(`The agent's last ${tail.length} characters on stderr before turn ${turnId} failed are in data.stderrTail and stay on this machine`, { source: thread.providerId, event: 'turn.failed.stderr', threadId, turnId, data: { stderrTail: tail } });
      } catch { /* the turn's own record above already says it failed */ }
    }
    if (!next) return;
    if (!threadOwned) {
      // This completion still belongs to its parent, even if the child thread
      // now names a newer execution. Do not run work against that execution.
      await this.threads.spawns.sendResult(threadId);
      return;
    }
    if (next.archived) releaseThread(threadId);
    this.#core.bus.emit('thread.updated', withLoad(this.#core, next));
    // A move the agent asked for during the turn happens now that no process
    // works in the old folder, before any wake or held answer starts the next.
    await this.threads.moves.applyWaiting(threadId);
    // Done the agent asked for during the turn, now that its answer is written. A move asked in the same turn went first.
    this.threads.agentDone.applyWaiting(threadId);
    // A thread an agent started answers it before a failure pauses its coordination.
    await this.threads.spawns.sendResult(threadId);
    // A Stop pauses coordination until the user's next message. Failures and queued follow-ups leave it available.
    // A keepalive was only waiting.
    const keepalive = queued.execution?.operation === 'keepalive';
    const queuedInputInterrupted = result.queuedInputInterrupted === true;
    if (result.status === 'stopped' && !keepalive && !result.queuedInputCancelled && !queuedInputInterrupted) this.#core.coordination.pause(threadId);
    // A spent subscription window: the thread may resume by itself once it resets (`threads/limit-resume.ts`).
    if (result.status === 'error' && !queuedInputInterrupted && result.refusal?.kind === 'usage-limit' && !next.archived && !keepalive) this.threads.limitResumes.turnFailed(next, finished, result.refusal.resetsAt);
    // Any other stop before the answer resumes by itself, twice in a row at most (`threads/auto-continue.ts`).
    this.threads.autoContinue.turnFinished(next, finished, result);
    if (result.status === 'done' && sameSession && !queued.execution?.operation) this.threads.titles.autoRefine(threadId);
    // Compaction plans from the conversation's own turns; a keepalive is not one.
    if (sameSession && !keepalive) this.threads.autoCompact.turnFinished(next, finished);
    if (sameSession) this.threads.cacheKeepalive.turnFinished(next, finished);
    if (sameSession) this.threads.accountSessions.turnFinished(next, finished);
    // A mochi's new conversation asked during the turn (`agents/new-session.ts`): last of what reads the
    // session this turn ended on, before a wake or held answer starts the next turn on a fresh one.
    this.#core.workforce.newSessions.applyWaiting(threadId, turnId);
    const woke = this.threads.deferred.pendingWakes.get(threadId);
    if (woke !== undefined) {
      this.threads.deferred.pendingWakes.delete(threadId);
      // First, so the output the agent wrote by itself goes before any held answer.
      if (!next.archived) setTimeout(() => this.threads.deferred.wake(threadId, woke), 0);
    }
    // Answers that came in while this turn could not take them go out now. A
    // stopped or failed turn keeps them for the next prompt the user sends.
    if (result.status === 'done' && !next.archived && this.threads.deferred.deferredAnswers.has(threadId)) {
      setTimeout(() => this.threads.deferred.flushDeferred(threadId), 0);
    }
  }

  stopRunning(threadId: ThreadId, reason?: 'restart'): boolean {
    return this.#attempts.stopRunning(threadId, reason);
  }

  async #finishCheckpoint(state: TurnAttemptState): Promise<void> {
    const { stop, threadId, turnId } = state;
    const capture = new AbortController();
    const checkpoint = this.threads.codeCheckpoints.end(turnId, capture.signal);
    if (!checkpoint) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onStop = () => {
      timer = setTimeout(() => capture.abort(new Error('file checkpoint did not finish within the Stop deadline')), STOP_DEADLINE.forceMs);
    };
    if (stop.signal.aborted) onStop();
    else stop.signal.addEventListener('abort', onStop, { once: true });
    try { await abortable(checkpoint, capture.signal); }
    catch (error) {
      if (!capture.signal.aborted) throw error;
      this.#core.logs.warn(messageOf(error), { source: 'turns', event: 'turn.checkpoint.stop-timeout', threadId, turnId });
    } finally {
      clearTimeout(timer);
      stop.signal.removeEventListener('abort', onStop);
    }
  }

  /** Whether the turn's transcript already holds an error part, as a driver writes one. */
  #saidWhy(threadId: ThreadId, turnId: TurnId): boolean {
    for (const message of this.#core.journal.walkTurnMessages(threadId, turnId, { blobs: false })) {
      if (message.parts.some(part => part.type === 'error')) return true;
    }
    return false;
  }
}
