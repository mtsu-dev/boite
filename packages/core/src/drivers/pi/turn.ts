import type { Usage } from '@boite/contracts';
import type { PromptCacheLife, TurnContext, TurnResult } from '../types.ts';
import { DecidedTurnParts, ToolCards } from '../turn-parts.ts';
import type { PiUsage, ToolView } from './protocol.ts';

/**
 * One `prompt` command and what it wrote. The parts are drawn the way every
 * other driver draws them: one text part the deltas append to, one thinking
 * part, one part per tool call.
 */
export class PiTurn extends DecidedTurnParts {
  readonly #tools = new ToolCards(this);

  #status: TurnResult['status'] = 'done';
  #error: string | null = null;
  #diagnosticError: string | undefined;

  /** The pi session id the process was launched with, kept as the thread's. */
  sessionId: string | null;
  checkpoint?: TurnResult['checkpoint'];
  usage: Usage | null = null;
  /** The prompt cache lifetime of the last request that named one. */
  cacheLife: PromptCacheLife | null = null;
  /** When the last assistant message started streaming, a little after its request left (`TurnResult.cacheAt`). */
  requestAt: number | null = null;
  /** The error of the last assistant message, promoted only if the run settles on it. */
  pendingError: string | null = null;
  /** Set once the stop deadline runs for this turn. */
  stopDeadline = false;
  /**
   * Set while `runTurn` waits on pi's answer to a command of its own: the
   * setup, the prompt, the state check after it. pi holds the prompt's answer
   * through its preflight, so a stop there decides the turn and nothing else
   * ends it.
   */
  awaitingPi = false;

  constructor(ctx: TurnContext) {
    super(ctx);
    this.sessionId = ctx.sessionId;
  }

  noteSession(sessionId: string): void {
    this.sessionId = sessionId;
  }

  /**
   * How the last assistant message ended: its error, or null when it went well.
   * pi retries an overloaded or dropped request by itself (`auto_retry_*`) and
   * recovers from a context overflow by compacting, inside the same run, so an
   * error may still be followed by a good answer. Nothing is drawn until
   * `agent_settled`, and only the outcome standing then counts.
   */
  noteOutcome(error: string | null): void {
    this.pendingError = error;
  }

  /**
   * `agent_settled`: the run is over, whatever happened inside it. A stop wins
   * over the error of a request the stop itself cut short.
   */
  settleRun(): void {
    if (this.decided) return;
    if (this.#error === null && this.pendingError !== null && !this.isStopped) {
      this.#error = this.pendingError;
      this.part(this.takeIndex(), { type: 'error', message: this.#error });
    }
    if (this.#error !== null) this.#status = 'error';
    else if (this.isStopped) this.#status = 'stopped';
    this.decided = true;
    this.decide();
  }

  /** A stopped turn whose run never settled: it ends as one that did. */
  endStopped(): void {
    this.settleRun();
  }

  /** The turn cannot go on: a dead child, a refused command. */
  fail(reason: string, diagnostic?: string): void {
    if (this.decided) return;
    this.decided = true;
    this.#status = 'error';
    if (this.#error === null) {
      this.#error = reason;
      this.#diagnosticError = diagnostic;
      this.part(this.takeIndex(), { type: 'error', message: reason });
    }
    this.decide();
  }

  settle(): void {
    if (this.settled) return;
    this.settled = true;
    this.decided = true;
    this.wake();
    this.decide();
    this.resolve(this.#status, () => ({
      status: this.#status,
      sessionId: this.sessionId,
      ...(this.#status === 'done' && this.checkpoint ? { checkpoint: this.checkpoint } : {}),
      usage: this.usage,
      error: this.#error ?? undefined,
      ...(this.#diagnosticError === undefined ? {} : { diagnosticError: this.#diagnosticError }),
      promptCache: this.cacheLife,
      ...(this.requestAt === null ? {} : { cacheAt: this.requestAt }),
    }));
  }

  /** pi reports usage per assistant message, so a turn is the sum of its calls. */
  addUsage(usage: PiUsage): void {
    const base = this.usage ?? {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsdEquivalent: null,
    };
    const cost = usage.cost?.total;
    const written = usage.cacheWrite ?? 0;
    // Anthropic's split, which pi passes through: the part written for an hour.
    const hour = (base.cacheWriteHourTokens ?? 0) + Math.min(Math.max(0, usage.cacheWrite1h ?? 0), written);
    this.usage = {
      inputTokens: base.inputTokens + (usage.input ?? 0),
      outputTokens: base.outputTokens + (usage.output ?? 0),
      cacheReadTokens: base.cacheReadTokens + (usage.cacheRead ?? 0),
      cacheWriteTokens: base.cacheWriteTokens + written,
      ...(hour > 0 ? { cacheWriteHourTokens: hour } : {}),
      costUsdEquivalent:
        typeof cost === 'number' ? (base.costUsdEquivalent ?? 0) + cost : base.costUsdEquivalent,
    };
  }

  /** `tool_execution_start` opens the part, `tool_execution_end` replaces it. */
  upsertTool(toolCallId: string, view: ToolView): void {
    this.#tools.upsert(toolCallId, view);
  }
}
