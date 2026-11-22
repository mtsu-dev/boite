import type { MessageId, MessagePart, ToolStatus } from '@boite/contracts';
import type { TurnContext, TurnResult } from './types.ts';

/**
 * What native turns share: the assistant message and its
 * part indexes, one text part and one thinking part the deltas append to, and
 * the promises a session waits on. Each protocol's turn adds its own outcome,
 * usage and tool cards on top.
 */
export class TurnParts {
  protected messageId: MessageId | null = null;
  protected nextIndex = 0;
  protected textIndex: number | null = null;
  protected thinkingIndex: number | null = null;
  readonly #completion = Promise.withResolvers<TurnResult>();
  readonly #stop = Promise.withResolvers<void>();

  readonly done = this.#completion.promise;
  /** Resolves on stop or settlement, so a card no longer waits for the user. */
  readonly stopped = this.#stop.promise;
  isStopped = false;
  settled = false;

  constructor(public ctx: TurnContext) {}

  markStopped(): void {
    this.isStopped = true;
    this.wake();
  }

  /** Resolves `stopped`: a settled turn has nobody left to wait on. */
  protected wake(): void {
    this.#stop.resolve();
  }

  /**
   * The end of `settle()`: the message closes, then `done` carries the result.
   * The result is read after the close, which a subscriber sees synchronously.
   */
  protected resolve(status: TurnResult['status'], result: () => TurnResult): void {
    if (this.messageId !== null) {
      this.ctx.emit.complete(this.messageId, status === 'error' ? 'error' : 'complete');
    }
    this.#completion.resolve(result());
  }

  // -- parts ----------------------------------------------------------------

  protected message(): MessageId {
    if (this.messageId === null) this.messageId = this.ctx.emit.startMessage('assistant');
    return this.messageId;
  }

  part(index: number, part: MessagePart): void {
    this.ctx.emit.part(this.message(), index, part);
  }

  takeIndex(): number {
    this.textIndex = null;
    this.thinkingIndex = null;
    const index = this.nextIndex;
    this.nextIndex += 1;
    return index;
  }

  writeText(text: string): void {
    if (text.length === 0) return;
    const index = this.openText();
    this.ctx.emit.delta(this.message(), index, text);
  }

  /** A text delta after a thinking delta answers in its own part. */
  protected openText(): number {
    if (this.textIndex !== null) return this.textIndex;
    const index = this.takeIndex();
    this.textIndex = index;
    this.part(index, { type: 'text', text: '' });
    return index;
  }

  /** The reasoning deltas, which the UI folds. Their own part, like the text. */
  writeThinking(text: string): void {
    if (text.length === 0) return;
    const index = this.openThinking();
    this.ctx.emit.delta(this.message(), index, text);
  }

  protected openThinking(): number {
    if (this.thinkingIndex !== null) return this.thinkingIndex;
    const index = this.takeIndex();
    this.thinkingIndex = index;
    this.part(index, { type: 'thinking', text: '' });
    return index;
  }
}

/** `TurnParts` for a protocol that states the outcome before the turn is journalled. */
export class DecidedTurnParts extends TurnParts {
  readonly #decision = Promise.withResolvers<void>();
  /** Resolves the moment the outcome is known, before anything is journalled. */
  readonly finished = this.#decision.promise;
  decided = false;

  /** Resolves `finished`; the caller has set `decided`. */
  protected decide(): void {
    this.#decision.resolve();
  }
}

/** What a tool notification says of its call, when the protocol has nothing more than these four. */
export interface ToolCardView {
  name: string;
  input?: unknown;
  output: string | null;
  status: ToolStatus;
}

/** One tool part per call id: the first notification opens it, the later ones redraw the same part. */
export class ToolCards {
  readonly #tools = new Map<string, { index: number; name: string; input: unknown; output: string | null; status: ToolStatus }>();

  constructor(private readonly turn: TurnParts) {}

  upsert(toolId: string, view: ToolCardView): void {
    const entry = this.#tools.get(toolId) ?? {
      index: this.turn.takeIndex(),
      name: view.name,
      input: null,
      output: null,
      status: 'running' as ToolStatus,
    };
    entry.name = view.name;
    if (view.input !== undefined) entry.input = view.input;
    if (view.output !== null) entry.output = view.output;
    entry.status = view.status;
    this.#tools.set(toolId, entry);
    this.turn.part(entry.index, {
      type: 'tool',
      toolId,
      name: entry.name,
      input: entry.input,
      output: entry.output,
      status: entry.status,
    });
  }
}
