import type { Usage } from '@boite/contracts';
import type { TurnContext, TurnResult } from '../types.ts';
import { DecidedTurnParts, ToolCards } from '../turn-parts.ts';
import type { ToolView } from './protocol.ts';

// ---------------------------------------------------------------------------
// The turn and what it draws
// ---------------------------------------------------------------------------

/**
 * One `turn/start`, or one `session/compact`, and what it wrote. The parts are
 * drawn the way every other driver draws them: one text part the deltas append
 * to, one part per tool item, one part per approval and per question.
 */
export class MuseTurn extends DecidedTurnParts {
  readonly #tools = new ToolCards(this);
  /** Per item and field, the text already drawn: a snapshot only adds what is past it. */
  readonly #surfaces = new Map<string, string>();

  #status: TurnResult['status'] = 'done';
  #error: string | null = null;
  #diagnosticError: string | undefined;

  sessionId: string | null;
  /** The Muse turn id: the `commandId` of the `turn/start`, then the one its ack names. */
  turnId: string | null = null;
  usage: Usage | null = null;
  /** `session/tokenUsage` summed over the turn, for a `turn/completed` that carries none. */
  observed: Usage | null = null;

  constructor(ctx: TurnContext) {
    super(ctx);
    this.sessionId = ctx.sessionId;
  }

  get compacting(): boolean {
    return this.ctx.turn.execution?.operation === 'compact';
  }

  /** The turn's outcome as `turn/completed` states it. */
  finish(terminal: string, error: string | null): void {
    if (this.decided) return;
    if (terminal === 'cancelled') this.#status = 'stopped';
    else if (terminal !== 'completed') {
      this.fail(error ?? `the muse turn ended ${terminal}`);
      return;
    }
    this.decided = true;
    this.decide();
  }

  endStopped(): void {
    this.finish('cancelled', null);
  }

  fail(reason: string, diagnostic?: string): void {
    if (this.decided) return;
    this.decided = true;
    this.#status = 'error';
    this.#error = reason;
    this.#diagnosticError = diagnostic;
    this.part(this.takeIndex(), { type: 'error', message: reason });
    this.decide();
  }

  settle(): void {
    if (this.settled) return;
    this.settled = true;
    this.decided = true;
    this.wake();
    this.decide();
    this.resolve({
      status: this.#status,
      sessionId: this.sessionId,
      usage: this.usage ?? this.observed,
      error: this.#error ?? undefined,
      ...(this.#diagnosticError === undefined ? {} : { diagnosticError: this.#diagnosticError }),
    });
  }

  // -- parts ----------------------------------------------------------------

  #write(kind: 'text' | 'thinking', text: string): void {
    if (kind === 'text') this.writeText(text);
    else this.writeThinking(text);
  }

  /** An `item/delta`: appended as it comes, and remembered so the next snapshot skips it. */
  appendDelta(itemId: string, field: string, kind: 'text' | 'thinking', delta: string): void {
    const key = `${itemId}:${field}`;
    this.#surfaces.set(key, (this.#surfaces.get(key) ?? '') + delta);
    this.#write(kind, delta);
  }

  /**
   * A snapshot of the whole text so far. Only the suffix nobody drew yet goes
   * out; a snapshot that does not extend what was drawn replaces nothing,
   * because a delta already sent cannot be taken back.
   */
  appendSnapshot(itemId: string, field: string, kind: 'text' | 'thinking', text: string | undefined): void {
    if (text === undefined || text.length === 0) return;
    const key = `${itemId}:${field}`;
    const drawn = this.#surfaces.get(key) ?? '';
    if (text.length <= drawn.length || !text.startsWith(drawn)) return;
    this.#surfaces.set(key, text);
    this.#write(kind, text.slice(drawn.length));
  }

  /** Every item notification redraws the same card, found by item id. */
  upsertTool(itemId: string, view: ToolView): void {
    this.#tools.upsert(itemId, view);
  }
}
