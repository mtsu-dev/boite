import { isBackgroundCompaction } from './compaction.ts';
import { numberOf, textOf } from './mapping.ts';
import type { PiUsage } from './protocol.ts';
import type { PiTurn } from './turn.ts';

/**
 * An automatic compaction, on a threshold or to recover from an overflow,
 * drawn as the divider a manual one gets. A manual one is the `compact`
 * command's, which draws its own from the response.
 */
export function drawCompaction(turn: PiTurn, message: Record<string, unknown>): void {
  const reason = textOf(message['reason']);
  if (reason === 'manual' || message['aborted'] === true) return;
  const result = message['result'] as { tokensBefore?: unknown; estimatedTokensAfter?: unknown; usage?: PiUsage; details?: unknown } | undefined | null;
  if (result === undefined || result === null) {
    turn.ctx.log('warn', `pi: the automatic compaction failed: ${textOf(message['errorMessage']) || 'no reason given'}`);
    return;
  }
  if (result.usage !== undefined && result.usage !== null) turn.addUsage(result.usage);
  turn.part(turn.takeIndex(), {
    type: 'compaction',
    trigger: 'auto',
    preTokens: numberOf(result.tokensBefore),
    postTokens: numberOf(result.estimatedTokensAfter),
    // pi's threshold compaction took the copy Boite's extension made.
    ...(isBackgroundCompaction(result.details) ? { background: true as const } : {}),
  });
}

/**
 * An entry an extension appended. The one drawn is the compaction Boite's
 * extension appends at a `turn_end` that reached the limit: its copy, made
 * in the background, which pi announces with no `compaction_end`.
 */
export function drawEntry(turn: PiTurn, value: unknown): void {
  const entry = (value ?? {}) as { type?: unknown; tokensBefore?: unknown; details?: unknown; usage?: PiUsage };
  if (entry.type !== 'compaction' || !isBackgroundCompaction(entry.details)) return;
  if (entry.usage !== undefined && entry.usage !== null) turn.addUsage(entry.usage);
  turn.part(turn.takeIndex(), { type: 'compaction', trigger: 'auto', preTokens: numberOf(entry.tokensBefore), postTokens: null, background: true });
}
