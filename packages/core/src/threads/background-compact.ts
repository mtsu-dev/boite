import { effectiveCompaction } from '@boite/contracts';
import type { Account, ContextUse, Message, MessagePart, ProviderDescriptor, ThreadId, ThreadSummary, Turn, TurnId } from '@boite/contracts';
import { stepTail, type PartPlace, type TailAnchor } from '../continuation.ts';
import type { Core } from '../core.ts';
import { getDriver, releaseThread } from '../drivers/index.ts';
import type { EmitSink, PermissionTicket, QuestionTicket, SessionContext, StepBoundary, StepDecision, TurnContext, TurnHandle, TurnResult } from '../drivers/types.ts';
import { messageOf } from '../errors.ts';
import { newId } from '../ids.ts';
import type { ThreadStore } from '../threads.ts';
import { backgroundWaitOf, saveThread, withLoad } from './records.ts';
import { removeTranscripts } from './transcript-purge.ts';

/**
 * The `backgroundCompaction` setting's bounds. A copy starts once the context
 * reaches `startRatio` of the `autoCompact` token limit and at least
 * `minTokens`, at a step boundary or at the end of a turn; it is used only
 * while what the thread added since the copy (its tail) stays within
 * `tailTokens` and `tailShare` of the limit. A thread stops trying after
 * `maxFailures` copies in a row failed, until its next swap or a restart. A
 * copy still running `timeoutMs` after it started is dropped and stopped,
 * which also ends the wait of a step that reached the limit. Mutable so a test
 * can change them.
 */
export const BACKGROUND_COMPACT = { startRatio: 0.85, minTokens: 64_000, tailTokens: 30_000, tailShare: 0.25, maxFailures: 2, timeoutMs: 300_000 };

/**
 * Whether a context of `tokens` has entered the band below `limit` where a
 * copy starts: `startRatio` of the limit and at least `minTokens`. The
 * `turn-end` and `background` moments of a rule with a limit apply from there too.
 */
export function nearLimit(tokens: number, limit: number): boolean {
  return tokens >= Math.max(BACKGROUND_COMPACT.minTokens, BACKGROUND_COMPACT.startRatio * limit);
}

/** The journal setting naming the turn a swapped-in summary ends at, until a turn carried what came after it. */
export const COMPACTION_TAIL_PREFIX = 'compaction-tail:';

/**
 * Turns after `after` ran on the session the summary replaced; `generation` is
 * the session they go to. `afterPart`: the summary ends inside `after`, before
 * that part, for a copy made at a step boundary.
 */
export interface CompactionTail { generation: number; after: TurnId; afterPart?: PartPlace }

/** The tail the thread's next prompt carries, or null when its session is not the one swapped in. */
export function compactionTail(core: Core, thread: ThreadSummary): CompactionTail | null {
  const tail = core.journal.getSetting(`${COMPACTION_TAIL_PREFIX}${thread.id}`) as CompactionTail | undefined;
  return tail !== undefined && tail.generation === (thread.sessionGeneration ?? 0) ? tail : null;
}

/** Whether the thread's driver takes a copy at a step boundary of a running turn (`DriverCapabilities.stepSwap`). */
function swapsInTurn(core: Core, thread: ThreadSummary): boolean {
  const provider = core.providers.get(thread.providerId);
  if (provider === undefined) return false;
  try { return getDriver(provider.protocol).capabilities?.stepSwap === true; } catch { return false; }
}

/** What the copy was made from: a thread that no longer matches it cannot take its summary. */
interface Source {
  sessionId: string;
  generation: number;
  providerId: string;
  accountId: string;
  model: string | null;
  cwd: string;
  /** Where the summary ends: after a turn, or inside one at a step boundary. */
  anchor: TailAnchor;
  /** The context when the copy started. */
  tokens: number;
}

interface Copy {
  source: Source;
  /** The effective policy at the fork; a changed policy cancels this copy. */
  policy: string;
  protocol: ProviderDescriptor['protocol'];
  handle: TurnHandle | null;
  /** Set when the copy is no longer wanted; a running one is stopped. */
  dropped: boolean;
  /** The compacted session, once the copy finished. */
  ready: { sessionId: string; postTokens: number | null; window: number | null } | null;
  /** Settles once the copy's run ended, whatever it gave. */
  settled: Promise<void>;
  /** Settles once the copy is dropped, so a step waiting for it goes on at once. */
  gone: ReturnType<typeof Promise.withResolvers<void>>;
}

/** The session a step's check compares the copy with, and the context the step carries. */
interface Live { sessionId: string | null; resumeAt: string | null; tokens: number | null }

/** The context the last step boundary of a running turn reported, on the session generation it ran on. */
interface Boundary { turnId: TurnId; generation: number; tokens: number; at: number }

/**
 * The experimental `backgroundCompaction` setting, ported from OpenCode v2's
 * precompute (`session/compaction.ts`): as a thread nears its `autoCompact`
 * token limit, a native fork of its session compacts in the background while
 * the conversation goes on. The copy starts at a step boundary of a running
 * turn (`TurnContext.step`) or at the end of a turn. At the first step
 * boundary where the context reaches the limit, a driver that declares
 * `stepSwap` takes the copy inside the same turn: the thread moves to the
 * compacted session and the driver sends what happened since the copy as its
 * first message (`stepTail`). A copy still running then is waited for. A
 * driver without `stepSwap` takes it at the first pause instead, and its next
 * prompt carries what was said since the fork (`compactionTail`). A copy that
 * no longer matches the thread, one whose tail grew too large, one the agent
 * made pointless by compacting by itself, or one that failed, is dropped: the
 * agent's own blocking compaction, or that of `AutoCompaction`, runs instead.
 *
 * Only drivers that can fork a session at a checkpoint take part: Claude
 * (resume at the checkpoint, forked), Codex (`forkSession`) and echo.
 * Copies are held in memory: a restart forgets them. The copy runs outside the
 * scheduler's account slots and its usage is recorded on no turn.
 */
export class BackgroundCompaction {
  readonly #copies = new Map<ThreadId, Copy>();
  readonly #failures = new Map<ThreadId, number>();
  /** The turn carrying a thread's tail, which clears it once done. */
  readonly #carrying = new Map<ThreadId, TurnId>();
  /** The latest context a running turn's step boundaries reported: an agent may report the thread's own only once its turn ends. */
  readonly #boundaries = new Map<ThreadId, Boundary>();
  #closed = false;

  readonly #core: Core;

  constructor(core: Core, private readonly threads: ThreadStore) {
    this.#core = core;
    core.bus.onCommitted((name, payload) => {
      if (name === 'settings.updated') {
        for (const [threadId, copy] of this.#copies) {
          const thread = core.journal.getThread(threadId);
          if (thread === null || this.policy(thread) !== copy.policy) this.#drop(threadId, 'the compaction policy changed');
        }
        return;
      }
      if (name !== 'thread.removed') return;
      const threadId = (payload as { threadId: ThreadId }).threadId;
      this.#drop(threadId);
      this.#failures.delete(threadId);
      this.#carrying.delete(threadId);
      this.#boundaries.delete(threadId);
    });
  }

  private policy(thread: ThreadSummary): string {
    return JSON.stringify(effectiveCompaction(this.#core.settings.get(), thread));
  }

  /** The token limit a copy works toward, or null when the setting or the limit is off. */
  private limit(thread: ThreadSummary): number | null {
    const settings = effectiveCompaction(this.#core.settings.get(), thread);
    return settings.backgroundCompaction === true ? settings.autoCompact?.tokens ?? null : null;
  }

  /** Called by `AutoCompaction.turnFinished`, before it plans anything. */
  turnFinished(thread: ThreadSummary, turn: Turn): void {
    // The turn's final result is the thread's context from now on.
    if (this.#boundaries.get(thread.id)?.turnId === turn.id) this.#boundaries.delete(thread.id);
    if (this.#carrying.get(thread.id) === turn.id) {
      this.#carrying.delete(thread.id);
      if (turn.status === 'done') this.#core.journal.deleteSetting(`${COMPACTION_TAIL_PREFIX}${thread.id}`);
    }
    const limit = this.limit(thread);
    const copy = this.#copies.get(thread.id);
    if (copy !== undefined) {
      // A compaction rewrote the context the copy was made from.
      const stale = limit === null ? 'the setting is off' : turn.execution?.operation === 'compact' ? 'the thread compacted' : this.#stale(thread, copy, limit);
      if (stale === null) return;
      this.#drop(thread.id, stale);
    }
    if (limit !== null && turn.status === 'done') this.#start(thread, turn, limit);
  }

  /** The carried prompt of `turnId` holds the thread's tail; it is cleared once that turn is done. */
  carried(threadId: ThreadId, turnId: TurnId): void {
    this.#carrying.set(threadId, turnId);
  }

  /**
   * Whether a finished copy waits for the thread's next pause. A driver that
   * swaps inside a turn keeps it for the step that reaches the limit, as
   * OpenCode keeps its precomputed summary until it is due.
   */
  ready(thread: ThreadSummary): boolean {
    return this.#copies.get(thread.id)?.ready != null && !swapsInTurn(this.#core, thread);
  }

  /**
   * Called when `AutoCompaction` would compact an idle thread. `swapped`: the
   * thread took a compacted copy. `waiting`: a copy that still matches is
   * running, and its end looks again. Null: compact the usual way.
   */
  due(thread: ThreadSummary): 'swapped' | 'waiting' | null {
    const copy = this.#copies.get(thread.id);
    if (copy === undefined) return null;
    const limit = this.limit(thread);
    const stale = limit === null ? 'the setting is off' : this.#stale(thread, copy, limit);
    if (stale !== null) { this.#drop(thread.id, stale); return null; }
    if (copy.ready === null) return 'waiting';
    // Taking the new session closes the process that runs them.
    if (this.#backgroundWork(thread.id)) { this.#drop(thread.id, 'background work is running'); return null; }
    try {
      this.#swap(thread, copy, copy.ready);
    } catch (error) {
      this.#drop(thread.id, `the swap failed: ${messageOf(error)}`);
      return null;
    }
    this.#copies.delete(thread.id);
    this.#failures.delete(thread.id);
    return 'swapped';
  }

  /**
   * `TurnContext.step` for a running turn of the thread, at a step boundary:
   * OpenCode's `compact` then `precompute` at the start of each step
   * (`session/runner/llm.ts`). Below the limit, a copy starts or keeps
   * running, and the step goes on at once. At the limit, the copy is taken:
   * awaited if it still runs, checked again, then swapped in. Null whenever
   * the driver should go on as it is.
   */
  async step(
    threadId: ThreadId,
    turn: Turn,
    boundary: StepBoundary,
    fileReference?: Parameters<typeof stepTail>[3],
  ): Promise<StepDecision | null> {
    if (this.#closed || this.#core.stopping || this.#core.journal.isClosed()) return null;
    const execution = turn.execution;
    if (!execution || execution.operation === 'compact' || execution.operation === 'keepalive' || execution.operation === 'background') return null;
    let thread = this.#core.journal.getThread(threadId);
    if (thread === null || this.#core.journal.runningTurn(threadId)?.id !== turn.id) return null;
    if (execution.providerId !== thread.providerId || execution.accountId !== thread.accountId) return null;
    const limit = this.limit(thread);
    if (limit === null) { this.#drop(threadId, 'the setting is off'); return null; }
    const tokens = Number.isFinite(boundary.tokens) && boundary.tokens >= 0 ? boundary.tokens : null;
    if (tokens === null) return null;
    this.#boundaries.set(threadId, { turnId: turn.id, generation: thread.sessionGeneration ?? 0, tokens, at: Date.now() });
    const sessionId = this.#liveSession(thread, turn, boundary);
    const live: Live = sessionId === null
      ? { sessionId: thread.sessionId, resumeAt: thread.sessionResumeAt ?? null, tokens }
      : { sessionId, resumeAt: null, tokens };
    const copy = this.#copies.get(threadId);
    if (tokens < limit) {
      if (copy !== undefined) {
        const stale = this.#stale(thread, copy, limit, live);
        if (stale === null) return null;
        this.#drop(threadId, stale);
      }
      if (sessionId === null || boundary.checkpoint === null) return null;
      // A first turn names its session only once it ends: the copy is made from the one it runs on.
      if (thread.sessionId === null) thread = saveThread(this.#core, { ...thread, sessionId, sessionResumeAt: null }, 'thread.updated');
      const anchor: TailAnchor = { turnId: turn.id, afterPart: this.#lastPart(threadId, turn.id) };
      this.#launch(thread, limit, tokens, { sessionId, entry: boundary.checkpoint.entry }, anchor);
      return null;
    }
    // A driver that cannot apply a swap inside its turn keeps the copy for the pause.
    if (copy === undefined || !swapsInTurn(this.#core, thread)) return null;
    return this.#takeInTurn(thread, turn, copy, live, fileReference);
  }

  /**
   * The agent compacted by itself inside a turn (a native, blocking
   * compaction): the context the copy was made from is gone, and a copy that
   * finishes later is thrown away (OpenCode's `due` after a compaction).
   */
  compactedInTurn(threadId: ThreadId): void {
    this.#drop(threadId, 'the agent compacted by itself');
  }

  /**
   * The thread's running turn is being stopped: a copy still running is
   * stopped and dropped, at the limit or below it, and a step waiting for it
   * goes on at once. A finished copy stays for the next turn.
   */
  turnStopped(threadId: ThreadId): void {
    if (this.#copies.get(threadId)?.ready === null) this.#drop(threadId, 'its turn was stopped');
  }

  close(): void {
    this.#closed = true;
    for (const threadId of [...this.#copies.keys()]) this.#drop(threadId);
  }

  /**
   * Whether work the thread started still runs outside its turn, which a new
   * session would lose or report to a context that no longer holds it: the
   * agent's own background tasks, a Boite child here or on another machine
   * still at work, or a workflow run of the conversation at work.
   */
  #backgroundWork(threadId: ThreadId): boolean {
    if ((this.threads.agentState.background.get(threadId)?.length ?? 0) > 0) return true;
    if (this.#core.workflows.atWork(threadId) || this.#core.delegation.remote.busy(threadId)) return true;
    const rows = this.#core.journal.db.query('SELECT id, status FROM threads WHERE parent_thread_id = ?').all(threadId) as { id: ThreadId; status: string }[];
    return rows.some(row => {
      // A persistent agent's memory pass is Boite's own housekeeping, outside the conversation.
      if (this.#core.workforce?.memory.owns(row.id)) return false;
      if (row.status === 'queued' || row.status === 'running' || row.status === 'waiting') return true;
      const tasks = this.threads.agentState.background.get(row.id) ?? [];
      if (tasks.length > 0) return true;
      const child = this.#core.journal.getThread(row.id);
      return child !== null && backgroundWaitOf(this.#core, child, tasks)?.state === 'waiting';
    });
  }

  /**
   * The thread's context now: what the last step boundary of its running turn
   * reported, unless the agent reported one since; the journal's otherwise.
   */
  #contextTokens(thread: ThreadSummary): number | null {
    const journal = thread.context ?? null;
    const boundary = this.#boundaries.get(thread.id);
    if (boundary === undefined || boundary.generation !== (thread.sessionGeneration ?? 0) || this.#core.journal.runningTurn(thread.id)?.id !== boundary.turnId) return journal?.tokens ?? null;
    return journal !== null && journal.at > boundary.at ? journal.tokens : boundary.tokens;
  }

  /**
   * The session the turn runs on at `boundary`, when the thread names it or
   * the turn opened it: null when the boundary has no checkpoint or names
   * another session (a resume forked away, a session the agent lost).
   */
  #liveSession(thread: ThreadSummary, turn: Turn, boundary: StepBoundary): string | null {
    const checkpoint = boundary.checkpoint;
    if (checkpoint === null || checkpoint.sessionId.length === 0 || checkpoint.entry.length === 0) return null;
    if ((thread.sessionResumeAt ?? null) !== null) return null;
    if (thread.sessionId === checkpoint.sessionId) return checkpoint.sessionId;
    const execution = turn.execution;
    const fresh = thread.sessionId === null && execution !== undefined && (execution.sessionId ?? null) === null
      && execution.sessionGeneration === (thread.sessionGeneration ?? 0);
    return fresh ? checkpoint.sessionId : null;
  }

  /** The last part the turn wrote so far, which a copy made now summarizes through. */
  #lastPart(threadId: ThreadId, turnId: TurnId): PartPlace | null {
    let last: PartPlace | null = null;
    for (const message of this.#core.journal.walkTurnMessages(threadId, turnId, { blobs: false })) last = { messageId: message.id, partIndex: message.parts.length };
    return last;
  }

  /**
   * At the limit, the copy replaces the session inside the turn, or null. One
   * still running is awaited (OpenCode's `Fiber.await`) until it ends, its
   * deadline drops it or the turn is stopped, and everything is checked again
   * when it returns: a copy that failed, timed out or no longer matches gives
   * null, and the agent's own compaction handles the limit.
   */
  async #takeInTurn(thread: ThreadSummary, turn: Turn, copy: Copy, live: Live, fileReference: Parameters<typeof stepTail>[3]): Promise<StepDecision | null> {
    let limit: number | null = this.limit(thread);
    let stale = limit === null ? 'the setting is off' : this.#stale(thread, copy, limit, live);
    if (stale !== null) { this.#drop(thread.id, stale); return null; }
    if (copy.ready === null) {
      await Promise.race([copy.settled, copy.gone.promise]);
      if (this.#closed || this.#core.journal.isClosed() || copy.dropped || this.#copies.get(thread.id) !== copy || copy.ready === null) return null;
      const current = this.#core.journal.getThread(thread.id);
      if (current === null || this.#core.journal.runningTurn(thread.id)?.id !== turn.id) return null;
      thread = current;
      limit = this.limit(thread);
      stale = limit === null ? 'the setting is off' : this.#stale(thread, copy, limit, live);
      if (stale !== null) { this.#drop(thread.id, stale); return null; }
    }
    const ready = copy.ready;
    if (ready === null) return null;
    // A new session loses what the agent still runs in the background.
    if (this.#backgroundWork(thread.id)) { this.#drop(thread.id, 'background work is running'); return null; }
    let decision: StepDecision;
    try {
      decision = this.#swapInTurn(thread, turn, copy, ready, live, fileReference);
    } catch (error) {
      this.#drop(thread.id, `the swap failed: ${messageOf(error)}`);
      return null;
    }
    this.#copies.delete(thread.id);
    this.#failures.delete(thread.id);
    return decision;
  }

  /** Why the copy cannot replace the thread's session now, or null. `live`: what a step of a running turn reports instead of the thread. */
  #stale(thread: ThreadSummary, copy: Copy, limit: number, live?: Live): string | null {
    const { source } = copy;
    const at: Live = live ?? { sessionId: thread.sessionId, resumeAt: thread.sessionResumeAt ?? null, tokens: this.#contextTokens(thread) };
    if (this.policy(thread) !== copy.policy) return 'the compaction policy changed';
    if (thread.archived) return 'the thread is archived';
    if (at.sessionId !== source.sessionId || (thread.sessionGeneration ?? 0) !== source.generation || at.resumeAt !== null) return 'the session changed';
    if (thread.providerId !== source.providerId || thread.accountId !== source.accountId || thread.model !== source.model || thread.cwd !== source.cwd) return 'the thread changed agent, account, model or folder';
    const tokens = at.tokens;
    // Less than when the copy started: the agent compacted by itself.
    if (tokens !== null && tokens < source.tokens) return 'the context shrank';
    if (tokens !== null && tokens - source.tokens > tailLimit(limit)) return 'too much happened since the copy';
    return null;
  }

  /** At the end of a done turn: a copy cut at that turn's checkpoint. */
  #start(thread: ThreadSummary, turn: Turn, limit: number): void {
    const tokens = thread.context?.tokens ?? null;
    if (tokens === null || thread.sessionId === null || (thread.sessionResumeAt ?? null) !== null) return;
    const execution = turn.execution;
    if (!execution || execution.operation === 'compact' || execution.operation === 'keepalive' || execution.operation === 'background') return;
    // Only a session the turn itself ran on.
    if (execution.sessionGeneration !== (thread.sessionGeneration ?? 0) || execution.providerId !== thread.providerId || execution.accountId !== thread.accountId) return;
    const provider = this.#core.providers.get(thread.providerId);
    if (provider === undefined) return;
    const checkpoint = this.#checkpointOf(provider, thread, turn);
    if (checkpoint === null) return;
    this.#launch(thread, limit, tokens, checkpoint, { turnId: turn.id, afterPart: null });
  }

  /** Starts a copy of the thread's session cut at `checkpoint`, when the context is near the limit and nothing forbids it. */
  #launch(thread: ThreadSummary, limit: number, tokens: number, checkpoint: { sessionId: string; entry: string }, anchor: TailAnchor): void {
    if (this.#closed || this.#core.stopping) return;
    if (tokens >= limit || !nearLimit(tokens, limit)) return;
    if (thread.archived || thread.incognito || thread.sessionId !== checkpoint.sessionId || (thread.sessionResumeAt ?? null) !== null) return;
    if ((this.#failures.get(thread.id) ?? 0) >= BACKGROUND_COMPACT.maxFailures || this.threads.compactRefusal(thread) !== null) return;
    const provider = this.#core.providers.get(thread.providerId);
    if (provider === undefined) return;
    if (provider.protocol !== 'echo' && provider.protocol !== 'claude-sdk' && getDriver(provider.protocol).forkSession === undefined) return;
    let account: Account;
    try { account = this.#core.accounts.require(thread.accountId); } catch { return; }
    const copy: Copy = {
      source: {
        sessionId: checkpoint.sessionId, generation: thread.sessionGeneration ?? 0, providerId: thread.providerId, accountId: thread.accountId,
        model: thread.model, cwd: thread.cwd, anchor, tokens,
      },
      policy: this.policy(thread),
      protocol: provider.protocol,
      handle: null,
      dropped: false,
      ready: null,
      settled: Promise.resolve(),
      gone: Promise.withResolvers<void>(),
    };
    this.#copies.set(thread.id, copy);
    this.#core.log('info', `thread ${thread.id}: background compaction started at ${tokens} of ${limit} tokens${anchor.afterPart === null ? '' : ' inside a turn'}`, { source: provider.id, threadId: thread.id });
    copy.settled = this.#run(thread, copy, provider, account, checkpoint).catch(() => undefined);
  }

  /** Where the copy forks the session: the end of `turn`, in the driver's own terms. Null when it cannot. */
  #checkpointOf(provider: ProviderDescriptor, thread: ThreadSummary, turn: Turn): { sessionId: string; entry: string } | null {
    if (thread.sessionId === null) return null;
    // Echo has no transcript to cut: its fork is named after the turn.
    if (provider.protocol === 'echo') return { sessionId: thread.sessionId, entry: turn.id };
    if (provider.protocol !== 'claude-sdk' && getDriver(provider.protocol).forkSession === undefined) return null;
    const checkpoint = turn.checkpoint ?? null;
    return checkpoint !== null && checkpoint.sessionId === thread.sessionId && checkpoint.entry.length > 0 ? checkpoint : null;
  }

  async #run(thread: ThreadSummary, copy: Copy, provider: ProviderDescriptor, account: Account, checkpoint: { sessionId: string; entry: string }): Promise<void> {
    // The copy's own driver session: never the thread's warm process.
    const key = `${thread.id}~compact`;
    const driver = getDriver(provider.protocol);
    let sessionId = checkpoint.sessionId;
    let resumeAt: string | null = checkpoint.entry;
    let result: TurnResult | null = null;
    // What the copy's agent wrote and read, kept from its sink.
    const seen: { compaction: Extract<MessagePart, { type: 'compaction' }> | null; use: Omit<ContextUse, 'at'> | null } = { compaction: null, use: null };
    // The deadline covers the fork too; past it, whatever the copy reports is thrown away.
    const deadline = setTimeout(() => this.#expire(thread.id, copy), BACKGROUND_COMPACT.timeoutMs);
    deadline.unref?.();
    try {
      // Codex forks first and compacts the fork; Claude and echo fork as the turn resumes at the checkpoint.
      if (provider.protocol !== 'claude-sdk' && provider.protocol !== 'echo') {
        const fork = await driver.forkSession!(this.#sessionContext(thread, key, provider, account, null, null), checkpoint);
        if (copy.dropped) { await fork.discard(); return; }
        await fork.release();
        sessionId = fork.sessionId;
        resumeAt = null;
      }
      if (copy.dropped) return;
      const sink: EmitSink = {
        startMessage: () => newId('msg_'),
        delta: () => undefined,
        part: (_messageId, _index, part) => { if (part.type === 'compaction') seen.compaction = part; },
        patchTool: () => undefined,
        complete: () => undefined,
      };
      const ctx = this.#turnContext(thread, key, provider, account, sessionId, resumeAt, sink, reading => { seen.use = reading; });
      copy.handle = driver.startTurn(ctx);
      result = await copy.handle.done;
    } catch (error) {
      this.#core.log('info', `thread ${thread.id}: background compaction failed: ${messageOf(error)}`, { source: provider.id, threadId: thread.id });
    } finally {
      clearTimeout(deadline);
      releaseThread(key);
    }
    if (this.#closed || this.#core.journal.isClosed()) return;
    const made = result !== null && result.sessionId !== null && result.sessionId !== copy.source.sessionId ? result.sessionId : null;
    // Dropped meanwhile, a native compaction included: a summary that finishes late is never applied.
    if (copy.dropped || this.#copies.get(thread.id) !== copy) {
      if (made !== null) this.discard(copy, made);
      return;
    }
    const done = seen.compaction;
    if (result?.status !== 'done' || made === null || done === null) {
      this.#copies.delete(thread.id);
      this.#failures.set(thread.id, (this.#failures.get(thread.id) ?? 0) + 1);
      if (made !== null) this.discard(copy, made);
      const reason = result === null ? 'it could not start' : result.status !== 'done' ? `it ended ${result.status}${result.error ? `: ${result.error}` : ''}` : made === null ? 'it named no new session' : 'the agent did not compact';
      this.#core.log('info', `thread ${thread.id}: background compaction dropped: ${reason}`, { source: provider.id, threadId: thread.id });
      this.threads.autoCompact.recheck(thread.id);
      return;
    }
    const reading = seen.use;
    // A reading of the compaction request itself is the old context, not the new one.
    const postTokens = done.postTokens ?? (reading !== null && reading.tokens < copy.source.tokens ? reading.tokens : null);
    copy.ready = { sessionId: made, postTokens, window: reading?.window ?? null };
    copy.handle = null;
    const current = this.#core.journal.getThread(thread.id);
    const limit = current === null ? null : this.limit(current);
    const stale = current === null ? 'the thread is gone' : limit === null ? 'the setting is off' : this.#stale(current, copy, limit);
    if (stale !== null) { this.#drop(thread.id, stale); return; }
    this.threads.autoCompact.recheck(thread.id);
  }

  /**
   * The copy's deadline: one still running counts as a failure and is dropped
   * now, which stops it and lets a step waiting for it go on at once. A
   * result it gives later finds it dropped and is thrown away.
   */
  #expire(threadId: ThreadId, copy: Copy): void {
    if (this.#copies.get(threadId) !== copy || copy.ready !== null) return;
    this.#failures.set(threadId, (this.#failures.get(threadId) ?? 0) + 1);
    this.#drop(threadId, 'it was still running after its time');
    if (!this.#closed && !this.#core.journal.isClosed()) this.threads.autoCompact.recheck(threadId);
  }

  /** The thread as the copy's driver sees it: its own id, so the thread's warm session is left alone. */
  #sessionContext(thread: ThreadSummary, key: string, provider: ProviderDescriptor, account: Account, sessionId: string | null, resumeAt: string | null): SessionContext {
    const base = this.threads.contexts.makeSessionContext(thread, provider, account);
    return {
      ...base,
      thread: { ...thread, id: key, sessionId, sessionResumeAt: resumeAt },
      sessionId,
      resumeAt,
      // Its process ends with the turn, and the native threshold has nothing to do in a compaction.
      warmProcessMinutes: 0,
      autoCompactTokens: () => null,
      // Nothing the copy reports belongs to the thread: its commands, tasks and context are the thread's own.
      commands: () => undefined,
      background: () => undefined,
      backgroundFinished: () => undefined,
      wake: () => undefined,
      log: (level, message, context) => { if (context?.kind !== 'provider-output') base.log(level, message, context); },
      // Traced under the thread, but never the thread's whole tree.
      spawnChild: this.threads.contexts.leasedSpawnChild(thread.id, provider),
      killTree: undefined,
    };
  }

  #turnContext(
    thread: ThreadSummary,
    key: string,
    provider: ProviderDescriptor,
    account: Account,
    sessionId: string,
    resumeAt: string | null,
    emit: EmitSink,
    context: (use: Omit<ContextUse, 'at'>) => void,
  ): TurnContext {
    const now = Date.now();
    const turn: Turn = {
      id: newId('trn_'), threadId: key, status: 'running', queuedAt: now, startedAt: now, finishedAt: null, usage: null, error: null,
      execution: {
        providerId: thread.providerId, accountId: thread.accountId, model: thread.model, effort: thread.effort, speed: thread.speed ?? null,
        permissionMode: thread.permissionMode, sessionId, ...(resumeAt ? { sessionResumeAt: resumeAt } : {}),
        sessionGeneration: thread.sessionGeneration ?? 0, selectionVersion: thread.selectionVersion ?? 0, operation: 'compact', automatic: true,
      },
    };
    // A compaction asks nothing; anything that does is refused rather than shown on the thread.
    const denied = (): PermissionTicket => Object.assign(Promise.resolve('deny' as const), { requestId: newId('req_'), withdraw: () => undefined });
    const unanswered = (): QuestionTicket => Object.assign(Promise.resolve(null), { questionId: newId('req_') });
    return {
      ...this.#sessionContext(thread, key, provider, account, sessionId, resumeAt),
      turn,
      prompt: provider.protocol === 'echo' ? '[compact]' : '/compact',
      attachments: [],
      emit,
      context,
      requestPermission: denied,
      askQuestion: unanswered,
      spawn: () => { throw new Error('a background compaction runs no command'); },
    };
  }

  /**
   * The thread takes the compacted session, as a rewind takes a fork: a new
   * generation, so nothing the old session reports late lands on it. The
   * divider marks where the summary took over, and the tail marker sends the
   * turns since the copy with the next prompt.
   */
  #swap(thread: ThreadSummary, copy: Copy, ready: NonNullable<Copy['ready']>): void {
    const now = Date.now();
    const generation = (thread.sessionGeneration ?? 0) + 1;
    const next = this.#swapped(thread, ready, generation, now);
    const divider = this.#divider(thread.id, this.#core.journal.lastTurn(thread.id)?.id ?? newId('trn_'), thread.context?.tokens ?? null, ready.postTokens, now);
    const { anchor } = copy.source;
    const tail: CompactionTail = { generation, after: anchor.turnId, ...(anchor.afterPart === null ? {} : { afterPart: anchor.afterPart }) };
    this.threads.releaseAgent(thread.id);
    this.#core.journal.append({
      type: 'thread.compacted.background', threadId: thread.id, version: 1,
      payload: { sessionId: ready.sessionId, previousSessionId: thread.sessionId, sessionGeneration: generation, after: anchor.turnId, messageId: divider.id },
    }, () => {
      this.#core.journal.putThread(next);
      this.#core.journal.putMessage(divider);
      this.#core.journal.setSetting(`${COMPACTION_TAIL_PREFIX}${thread.id}`, tail);
    });
    this.#announce(next, divider);
    this.#core.log('info', `thread ${thread.id}: swapped to a session compacted in the background`, { source: thread.providerId, threadId: thread.id });
  }

  /**
   * The same swap inside a running turn, OpenCode's at the start of a step:
   * the agent keeps its process and goes on in this turn on the compacted
   * session, so nothing is released, and the divider is a message of this
   * turn the answer goes on after. What happened since the copy goes to the
   * agent now (`StepDecision.swap.tail`), never with the next prompt.
   */
  #swapInTurn(thread: ThreadSummary, turn: Turn, copy: Copy, ready: NonNullable<Copy['ready']>, live: Live, fileReference: Parameters<typeof stepTail>[3]): StepDecision {
    // Read before the divider is written: the tail is what the agent did since the copy.
    const tail = stepTail(this.#core.journal, thread.id, copy.source.anchor, fileReference);
    const now = Date.now();
    const generation = (thread.sessionGeneration ?? 0) + 1;
    const next = this.#swapped(thread, ready, generation, now);
    const divider = this.#divider(thread.id, turn.id, live.tokens, ready.postTokens, now);
    const { anchor } = copy.source;
    this.#core.journal.append({
      type: 'thread.compacted.background', threadId: thread.id, version: 1,
      payload: {
        sessionId: ready.sessionId, previousSessionId: copy.source.sessionId, sessionGeneration: generation, after: anchor.turnId,
        ...(anchor.afterPart === null ? {} : { afterPart: anchor.afterPart }), messageId: divider.id, turnId: turn.id,
      },
    }, () => {
      this.#core.journal.putThread(next);
      this.#core.journal.putMessage(divider);
      // The tail goes with the swap: an older marker has nothing left to carry.
      this.#core.journal.deleteSetting(`${COMPACTION_TAIL_PREFIX}${thread.id}`);
    });
    this.#carrying.delete(thread.id);
    this.#boundaries.delete(thread.id);
    this.#announce(next, divider);
    // The answer goes on in a new message after the divider.
    this.threads.runner.answerAfter.set(turn.id, Math.max(divider.createdAt, this.threads.runner.answerAfter.get(turn.id) ?? 0));
    this.#core.log('info', `thread ${thread.id}: swapped to a session compacted in the background, inside turn ${turn.id}`, { source: thread.providerId, threadId: thread.id, turnId: turn.id });
    return { swap: { sessionId: ready.sessionId, tail, postTokens: ready.postTokens } };
  }

  /** The thread on the compacted session, a generation on. */
  #swapped(thread: ThreadSummary, ready: NonNullable<Copy['ready']>, generation: number, now: number): ThreadSummary {
    const context: ContextUse | null = ready.postTokens === null ? null : { tokens: ready.postTokens, window: ready.window ?? thread.context?.window ?? null, at: now };
    return { ...thread, sessionId: ready.sessionId, sessionResumeAt: null, sessionGeneration: generation, context, promptCache: null, updatedAt: now };
  }

  /** The divider where the summary took over. */
  #divider(threadId: ThreadId, turnId: TurnId, preTokens: number | null, postTokens: number | null, now: number): Message {
    return {
      id: newId('msg_'), threadId, turnId, role: 'system',
      parts: [{ type: 'compaction', trigger: 'auto', preTokens, postTokens, background: true }],
      state: 'complete', createdAt: now,
    };
  }

  #announce(next: ThreadSummary, divider: Message): void {
    this.#core.bus.emit('message.started', divider);
    this.#core.bus.emit('message.completed', { threadId: next.id, messageId: divider.id, state: 'complete' });
    this.#core.bus.emit('thread.updated', withLoad(this.#core, next));
  }

  /** Forgets the thread's copy, stopping it if it still runs. */
  #drop(threadId: ThreadId, reason?: string): void {
    const copy = this.#copies.get(threadId);
    if (copy === undefined) return;
    this.#copies.delete(threadId);
    copy.dropped = true;
    copy.gone.resolve();
    copy.handle?.stop();
    if (copy.ready !== null) this.discard(copy, copy.ready.sessionId);
    if (reason !== undefined) this.#core.log('info', `thread ${threadId}: background compaction dropped: ${reason}`, { source: copy.source.providerId, threadId });
  }

  /** A Claude copy nobody took leaves no transcript in an account Boite isolated. Codex keeps its fork. */
  private discard(copy: Copy, sessionId: string): void {
    if (copy.protocol !== 'claude-sdk' || this.#core.journal.isClosed()) return;
    void removeTranscripts(this.#core, [{ accountId: copy.source.accountId, sessionId }]).catch(() => undefined);
  }
}

/** The most a thread may add after its copy started for the copy to stay usable. */
function tailLimit(limit: number): number {
  return Math.min(BACKGROUND_COMPACT.tailTokens, BACKGROUND_COMPACT.tailShare * limit);
}
