import { expect, test } from 'bun:test';
import { CodexUsageReports } from '../src/drivers/codex/usage-report.ts';
import type { CodexTurn } from '../src/drivers/codex/turn.ts';

const turn = (turnId: string, nativeFinished: boolean) => ({
  turnId, nativeFinished, usageCounts: null, usageTotal: null, usageLast: null,
  ctx: { turn: { id: turnId, startedAt: 1 }, openLateUsage: () => ({ save() {}, load: () => undefined, close() {} }) },
}) as unknown as CodexTurn;

test('a turn that ends without its native completion keeps the previous turn\'s usage window open', () => {
  const reports = new CodexUsageReports();
  expect(reports.drainMs).toBe(0);
  reports.finish(turn('first', true));
  expect(reports.drainMs).toBeGreaterThan(0);
  reports.finish(turn('second', false));
  expect(reports.drainMs).toBeGreaterThan(0);
});
