import type { ContextUse } from '@boite/contracts';
import type { TurnContext } from '../types.ts';
import { addCounts, countsOf, mapUsage, usageDelta, type CodexTokenCounts } from './mapping.ts';
import type { CodexTokenUsage } from './protocol.ts';
import type { CodexTurn } from './turn.ts';

/** A terminal turn update does not mark the end of its usage notifications. */
const USAGE_DRAIN_MS = 250;

interface Tally {
  usageCounts: CodexTokenCounts | null;
  usageTotal: CodexTokenCounts | null;
  usageLast: CodexTokenCounts | null;
}

function sameCounts(a: CodexTokenCounts | null, b: CodexTokenCounts): boolean {
  return a !== null && a.input === b.input && a.cached === b.cached && a.cacheWrite === b.cacheWrite && a.output === b.output;
}

/** Usage may arrive while another turn runs. Keep each finished turn's tally and journal sink for this native session. */
export class CodexUsageReports {
  readonly #finished = new Map<string, Tally & { report: NonNullable<TurnContext['reportLateUsage']> }>();
  #drainUntil = 0;

  get drainMs(): number { return Math.max(0, this.#drainUntil - performance.now()); }

  finish(turn: CodexTurn): void {
    const report = turn.ctx.reportLateUsage;
    if (turn.turnId === null || !report) return;
    this.#drainUntil = turn.nativeFinished ? performance.now() + USAGE_DRAIN_MS : 0;
    const { usageCounts, usageTotal, usageLast } = turn;
    this.#finished.set(turn.turnId, { usageCounts, usageTotal, usageLast, report });
  }

  clear(): void { this.#finished.clear(); }

  update(params: Record<string, unknown>, current: CodexTurn | null): Omit<ContextUse, 'at'> | null {
    const usage = params['tokenUsage'] as { total?: CodexTokenUsage; last?: CodexTokenUsage; modelContextWindow?: number } | undefined;
    if (!usage?.last) return null;
    const { last, total } = usage;
    const turnId = params['turnId'];
    const turn = typeof turnId === 'string' && turnId === current?.turnId ? current : null;
    const finished = typeof turnId === 'string' && !turn ? this.#finished.get(turnId) : undefined;
    const tally = turn ?? finished;
    if (tally) {
      const latest = countsOf(last);
      const cumulative = total ? countsOf(total) : null;
      // Without a cumulative total, a late replay repeats the last snapshot.
      const replay = cumulative ? sameCounts(tally.usageTotal, cumulative) : finished && sameCounts(tally.usageLast, latest);
      if (!replay) {
        const delta = usageDelta(tally.usageTotal, total, last);
        tally.usageCounts = tally.usageCounts ? addCounts(tally.usageCounts, delta) : delta;
        tally.usageTotal = cumulative;
        tally.usageLast = latest;
        const measured = mapUsage(tally.usageCounts);
        if (turn) turn.usage = measured;
        else finished?.report(measured);
      }
    }
    const cache = last.cachedInputTokens ?? 0;
    const breakdown = typeof last.inputTokens === 'number' && typeof last.outputTokens === 'number'
      ? { input: last.inputTokens - cache, cache, output: last.outputTokens } : undefined;
    const tokens = last.totalTokens ?? (breakdown ? breakdown.input + cache + breakdown.output : null);
    return tokens === null ? null : { tokens, window: usage.modelContextWindow ?? null, ...(breakdown ? { breakdown } : {}) };
  }
}
