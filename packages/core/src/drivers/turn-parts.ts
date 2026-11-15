import type { MessageId, MessagePart, ToolStatus } from '@boite/contracts';
import type { TurnContext, TurnResult } from './types.ts';

/**
 * What the ACP, Codex, Muse and pi turns share: the assistant message and its
 * part indexes, one text part and one thinking part the deltas append to, and
 * the promises a session waits on. Each protocol's turn adds its own outcome,
 * usage and tool cards on top.
 */
export class TurnParts {
  #messageId: MessageId | null = null;
  #nextIndex = 0;
  #textIndex: number | null = null;
  #thinkingIndex: number | null = null;
  #resolve: (result: TurnResult) => void = () => undefined;
  #wake: () => void = () => undefined;

  readonly done: Promise<TurnResult>;
  /** Resolves on `stop()`, so anything waiting on the user can move on. */
  readonly stopped: Promise<void>;
  isStopped = false;
  settled = false;

  constructor(readonly ctx: TurnContext) {
    this.done = new Promise<TurnResult>((resolve) => {
      this.#resolve = resolve;
    });
    this.stopped = new Promise<void>((resolve) => {
      this.#wake = resolve;
    });
  }

  markStopped(): void {
    this.isStopped = true;
    this.wake();
  }

  /** Resolves `stopped`: a settled turn has nobody left to wait on. */
  protected wake(): void {
    this.#wake();
  }

  /**
   * The end of `settle()`: the message closes, then `done` carries the result.
   * The result is read after the close, which a subscriber sees synchronously.
   */
  protected resolve(status: TurnResult['status'], result: () => TurnResult): void {
    if (this.#messageId !== null) {
      this.ctx.emit.complete(this.#messageId, status === 'error' ? 'error' : 'complete');
    }
    this.#resolve(result());
  }

  // -- parts ----------------------------------------------------------------

  protected message(): MessageId {
    if (this.#messageId === null) this.#messageId = this.ctx.emit.startMessage('assistant');
    return this.#messageId;
  }

  /** The open thinking part, null when the next thinking delta starts one. */
  protected get thinkingIndex(): number | null {
    return this.#thinkingIndex;
  }

  part(index: number, part: MessagePart): void {
    this.ctx.emit.part(this.message(), index, part);
  }

  takeIndex(): number {
    this.#textIndex = null;
    this.#thinkingIndex = null;
    const index = this.#nextIndex;
    this.#nextIndex += 1;
    return index;
  }

  writeText(text: string): void {
    if (text.length === 0) return;
    if (this.#textIndex === null) {
      const index = this.#nextIndex;
      this.#nextIndex += 1;
      this.#textIndex = index;
      // A text delta after a thinking delta answers in its own part.
      this.#thinkingIndex = null;
      this.part(index, { type: 'text', text: '' });
    }
    this.ctx.emit.delta(this.message(), this.#textIndex, text);
  }

  /** The reasoning deltas, which the UI folds. Their own part, like the text. */
  writeThinking(text: string): void {
    if (text.length === 0) return;
    if (this.#thinkingIndex === null) {
      const index = this.#nextIndex;
      this.#nextIndex += 1;
      this.#thinkingIndex = index;
      this.#textIndex = null;
      this.part(index, { type: 'thinking', text: '' });
    }
    this.ctx.emit.delta(this.message(), this.#thinkingIndex, text);
  }
}

/** `TurnParts` for a protocol that states the outcome before the turn is journalled. */
export class DecidedTurnParts extends TurnParts {
  #decide: () => void = () => undefined;
  /** Resolves the moment the outcome is known, before anything is journalled. */
  readonly finished: Promise<void>;
  decided = false;

  constructor(ctx: TurnContext) {
    super(ctx);
    this.finished = new Promise<void>((resolve) => {
      this.#decide = resolve;
    });
  }

  /** Resolves `finished`; the caller has set `decided`. */
  protected decide(): void {
    this.#decide();
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
