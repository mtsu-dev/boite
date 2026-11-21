import type { ContextUse } from '@boite/contracts';
import type { LateUsageReports } from '../types.ts';
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

/** Usage may arrive while another turn runs. The journal holds finished tallies for this process. */
export class CodexUsageReports {
  #finished: LateUsageReports<Tally> | undefined;
  #drainUntil = 0;

  get drainMs(): number { return Math.max(0, this.#drainUntil - performance.now()); }

  finish(turn: CodexTurn): void {
    if (turn.turnId === null || !turn.ctx.openLateUsage) return;
    this.#drainUntil = turn.nativeFinished ? performance.now() + USAGE_DRAIN_MS : 0;
    this.#finished ??= turn.ctx.openLateUsage<Tally>();
    const { id, startedAt } = turn.ctx.turn;
    const { usageCounts, usageTotal, usageLast } = turn;
    this.#finished.save(turn.turnId, { id, startedAt, tally: { usageCounts, usageTotal, usageLast } });
  }

  clear(): void {
    this.#finished?.close();
    this.#finished = undefined;
  }

  update(params: Record<string, unknown>, current: CodexTurn | null): Omit<ContextUse, 'at'> | null {
    const usage = params['tokenUsage'] as { total?: CodexTokenUsage; last?: CodexTokenUsage; modelContextWindow?: number } | undefined;
    if (!usage?.last) return null;
    const { last, total } = usage;
    const turnId = typeof params['turnId'] === 'string' ? params['turnId'] : null;
    const turn = turnId !== null && turnId === current?.turnId ? current : null;
    const finished = turnId !== null && !turn ? this.#finished?.load(turnId) : undefined;
    const tally = turn ?? finished?.tally;
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
        else if (finished && turnId !== null) this.#finished?.save(turnId, finished, measured);
      }
    }
    const cache = last.cachedInputTokens ?? 0;
    const breakdown = typeof last.inputTokens === 'number' && typeof last.outputTokens === 'number'
      ? { input: last.inputTokens - cache, cache, output: last.outputTokens } : undefined;
    const tokens = last.totalTokens ?? (breakdown ? breakdown.input + cache + breakdown.output : null);
    return tokens === null ? null : { tokens, window: usage.modelContextWindow ?? null, ...(breakdown ? { breakdown } : {}) };
  }
}
