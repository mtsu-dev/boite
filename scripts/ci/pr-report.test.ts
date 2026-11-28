import { describe, expect, test } from 'bun:test';
import { EXPLAIN_ABOVE, MEASURES } from './budgets.ts';
import { BUNDLE_EXPLAIN_ABOVE, BUNDLE_MEASURES, MAX_REPORT_BYTES, parseReport, renderBundle, renderTransfer, transferCeiling, transferOverruns, type BundleReport, type Transfer, type TransferReport } from './pr-report.ts';

const metrics = (total: number, liveMessages = 37): Transfer['claude'] => ({ total, snapshot: 2_143, liveWire: 12_655, liveDecoded: 21_802, liveMessages });
export const TRANSFER: Transfer = { claude: metrics(15_378), codex: metrics(18_010, 39), opencode: metrics(19_725, 47) };
const SHA = 'a'.repeat(40);
export const transferReport = (changes: Partial<TransferReport> = {}): TransferReport => ({ kind: 'transfer', version: 1, pr: 1210, head: SHA, base: 'b'.repeat(40), metrics: TRANSFER, ...changes });
export const SIZES = { uiEntryChunk: 1_000, uiDist: 2_000, coreBundle: 3_000, coreJavaScript: 4_000 };
export const bundleReport = (changes: Partial<BundleReport> = {}): BundleReport => ({ kind: 'bundle', version: 1, pr: 1210, head: SHA, base: 'b'.repeat(40), sizes: SIZES, ...changes });

describe('parseReport', () => {
  test('accepts the exact shape the jobs write', () => {
    expect(parseReport(JSON.stringify(transferReport()), 'transfer')).toEqual(transferReport());
    expect(parseReport(JSON.stringify(bundleReport()), 'bundle')).toEqual(bundleReport());
  });

  test("refuses anything else, naming the field, main's numbers and reasons included", () => {
    const text = (changes: Record<string, unknown>) => JSON.stringify({ ...transferReport(), ...changes });
    const refusals: [string, RegExp][] = [
      [text({ extra: 1 }), /unexpected key "extra"/],
      [text({ baseline: TRANSFER }), /unexpected key "baseline"/],
      [text({ reason: true }), /unexpected key "reason"/],
      [JSON.stringify(transferReport()).replace('{', '{"__proto__":{"polluted":1},'), /unexpected key "__proto__"/],
      [text({ kind: 'bundle' }), /\.kind: "bundle", expected "transfer"/],
      [text({ version: 2 }), /\.version: 2, expected 1/],
      [text({ pr: 0 }), /\.pr: 0, expected a pull request number/],
      [text({ head: 'abc' }), /\.head: "abc", expected a 40-character commit hash/],
      [text({ metrics: { ...TRANSFER, claude: { ...TRANSFER.claude, total: 1.5 } } }), /\.metrics\.claude\.total: 1\.5, expected an integer/],
      [text({ metrics: { ...TRANSFER, codex: { ...TRANSFER.codex, liveWire: -1 } } }), /\.metrics\.codex\.liveWire: -1/],
      [text({ metrics: { claude: TRANSFER.claude, codex: TRANSFER.codex } }), /\.metrics\.opencode: missing/],
      [text({ metrics: '<script>' }), /\.metrics: "<script>", expected an object/],
      ['not json', /not JSON/],
      [' '.repeat(MAX_REPORT_BYTES + 1), /expected at most 65536/],
    ];
    for (const [input, error] of refusals) expect(() => parseReport(input, 'transfer')).toThrow(error);
    expect(() => parseReport(JSON.stringify({ ...bundleReport(), ceiling: SIZES }), 'bundle')).toThrow(/unexpected key "ceiling"/);
  });
});

test('the bundle shape and threshold follow budgets.ts', () => {
  expect([...BUNDLE_MEASURES]).toEqual([...MEASURES]);
  expect(BUNDLE_EXPLAIN_ABOVE).toBe(EXPLAIN_ABOVE);
});

test('bytes may grow 1 % over main, messages not at all', () => {
  expect(transferCeiling('liveWire', 12_655)).toBe(12_781);
  expect(transferCeiling('liveMessages', 37)).toBe(37);
  const grown: Transfer = { ...TRANSFER, claude: { ...TRANSFER.claude, liveWire: 12_782, liveMessages: 38 } };
  expect(transferOverruns(grown, TRANSFER)).toEqual([
    'Claude liveWire: 12,782, ceiling 12,781 (main 12,655)',
    'Claude liveMessages: 38, ceiling 37 (main 37)',
  ]);
  expect(transferOverruns(grown, null)).toEqual([]);
  const table = renderTransfer({ metrics: grown, baseline: TRANSFER });
  expect(table).toContain('| Live turn on the wire | 12,655 | 12,782 | +127 (+1.00 %) | 12,781 | ❌ |');
  expect(table).toContain('| Reopening the thread | 2,143 | 2,143 | 0 (0.00 %) | 2,164 | ✅ |');
  expect(renderTransfer({ metrics: TRANSFER, baseline: null })).toContain('| Whole scenario | n/a | 15,378 | n/a | n/a |  |');
});

test('a bundle measure fails above its ceiling or on unexplained growth, as budgets.ts judges it', () => {
  const grown = { ...SIZES, uiEntryChunk: 1_002 };
  const row = (table: string) => table.split('\n').find((line) => line.startsWith('| uiEntryChunk'));
  expect(row(renderBundle({ sizes: grown, baseSizes: SIZES, ceiling: null, reason: false }))).toBe('| uiEntryChunk | 1,000 | 1,002 | +2 (+0.20 %) | n/a | ❌ |');
  expect(row(renderBundle({ sizes: grown, baseSizes: SIZES, ceiling: null, reason: true }))).toBe('| uiEntryChunk | 1,000 | 1,002 | +2 (+0.20 %) | n/a | ✅ |');
  expect(row(renderBundle({ sizes: grown, baseSizes: SIZES, ceiling: { ...SIZES, uiEntryChunk: 1_001 }, reason: true }))).toContain('| 1,001 | ❌ |');
  // Main already above the ceiling: only growth past main fails it.
  expect(row(renderBundle({ sizes: SIZES, baseSizes: SIZES, ceiling: { ...SIZES, uiEntryChunk: 900 }, reason: false }))).toContain('| 900 | ✅ |');
  expect(row(renderBundle({ sizes: grown, baseSizes: null, ceiling: null, reason: false }))).toBe('| uiEntryChunk | n/a | 1,002 | n/a | n/a |  |');
});
