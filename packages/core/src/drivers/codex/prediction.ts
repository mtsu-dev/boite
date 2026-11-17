import { messageOf } from '../../errors.ts';
import type { CodexRpc } from './rpc.ts';
import type { CodexTurn } from './turn.ts';

interface Pending {
  sourceTurnId: string;
  turnId: CodexTurn['ctx']['turn']['id'];
  suggestion: NonNullable<CodexTurn['ctx']['suggestion']>;
  diagnostic: CodexTurn['ctx']['diagnostic'];
}

/**
 * Codex's composer prediction for one session. After a completed turn of a
 * conversation the owner drives, asks the app-server's own prediction
 * (`thread/prediction/request`, experimental, no separate billed request) for
 * the owner's next message; the answer is `thread/prediction/updated`. Never
 * `thread/sample`, which bills a hidden fork. A failure shows nothing and the
 * debug log says so once per session.
 */
export class CodexPrediction {
  /** The prediction asked after the last completed turn, until its `thread/prediction/updated`: the turn's ids and callbacks only, so its context is let go. */
  #pending: Pending | null = null;
  /** The app-server refused the request: this session asks no more. */
  #off = false;
  #logged = false;

  ask(rpc: CodexRpc | null, threadId: string | null, turn: CodexTurn): void {
    const { promptSuggestions, suggestion, diagnostic } = turn.ctx;
    const sourceTurnId = turn.completedTurnId;
    if (promptSuggestions !== true || suggestion === undefined || this.#off) return;
    if (rpc === null || threadId === null || sourceTurnId === null || turn.isStopped) return;
    const pending: Pending = { sourceTurnId, turnId: turn.ctx.turn.id, suggestion, diagnostic };
    this.#pending = pending;
    void rpc.request('thread/prediction/request', { threadId, sourceTurnId }).catch((error: unknown) => {
      if (this.#pending?.sourceTurnId === sourceTurnId) this.#pending = null;
      // An app-server without it answers the same way every time: once is enough.
      this.#off = true;
      this.#debug(pending, `codex: composer prediction unavailable: ${messageOf(error)}`);
    });
  }

  /** `thread/prediction/updated`, already filtered to this session's thread. */
  updated(params: Record<string, unknown>): void {
    const pending = this.#pending;
    if (pending === null || params['sourceTurnId'] !== pending.sourceTurnId) return;
    this.#pending = null;
    const result = params['result'] as { type?: unknown; text?: unknown } | undefined;
    if (result?.type === 'completed' && typeof result.text === 'string' && result.text.trim().length > 0) {
      pending.suggestion(pending.turnId, result.text);
      return;
    }
    this.#debug(pending, `codex: composer prediction ${result?.type === 'completed' ? 'empty' : 'failed'}`);
  }

  #debug(pending: Pending, message: string): void {
    if (this.#logged) return;
    this.#logged = true;
    pending.diagnostic?.('debug', message, { event: 'codex.prediction' });
  }
}
