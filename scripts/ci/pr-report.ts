/**
 * The reports a pull request's CI leaves for its comment
 * (docs/internals/ci.md#pull-request-comment): `transfer-report.json` from
 * Thread transfer and `bundle-report.json` from Bundle size. The jobs that
 * write them run the pull request's code with no write access;
 * pr-comment.yml reads them with write access, so a report is data and
 * nothing else: `parseReport` accepts only the exact shape below, which
 * holds the pull request's own numbers and the main commit it was compared
 * with. Main's numbers, the ceilings, the body's reasons and every verdict
 * the comment shows come from main's runs and the pull request itself, read
 * by the default branch's code.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { PROVIDER_LABELS, PROVIDERS, type ProviderName } from '../../bench/transfer/fixture.ts';
import type { TransferMetrics } from '../../bench/transfer/measure.ts';
import type { Sizes } from './budgets.ts';

/** What one recorded turn costs a phone, per agent. */
export type Transfer = Record<ProviderName, TransferMetrics>;

export const TRANSFER_METRICS = ['total', 'snapshot', 'liveWire', 'liveDecoded', 'liveMessages'] as const satisfies readonly (keyof TransferMetrics)[];
const TRANSFER_LABELS: Record<keyof TransferMetrics, string> = {
  total: 'Whole scenario',
  snapshot: 'Reopening the thread',
  liveWire: 'Live turn on the wire',
  liveDecoded: 'Live turn decoded',
  liveMessages: 'Live turn messages',
};
/** Bytes may grow this much over main before a pull request explains them. */
export const TRANSFER_HEADROOM = 0.01;
/** The pull request body section that explains growth above a ceiling. */
export const TRANSFER_REASON = 'Thread transfer';

/** `MEASURES` of budgets.ts, which imports this file: a test keeps the two equal. */
export const BUNDLE_MEASURES = ['uiEntryChunk', 'uiDist', 'coreBundle', 'coreJavaScript'] as const;
export type BundleSizes = Sizes;
/** `EXPLAIN_ABOVE` of budgets.ts, kept equal the same way. */
export const BUNDLE_EXPLAIN_ABOVE = 0.001;

interface Common {
  version: 1;
  /** The pull request number and its head commit, which pr-comment.yml checks against the run. */
  pr: number;
  head: string;
  /** The main commit the pull request was compared with, which pr-comment.yml checks is on main. */
  base: string;
}

export interface TransferReport extends Common {
  kind: 'transfer';
  metrics: Transfer;
}

export interface BundleReport extends Common {
  kind: 'bundle';
  sizes: BundleSizes;
}

export type Report = TransferReport | BundleReport;
export const REPORT_FILES = { transfer: 'transfer-report.json', bundle: 'bundle-report.json' } as const;
/** No report comes near this; a larger file is refused before it is parsed. */
export const MAX_REPORT_BYTES = 64 * 1024;
const MAX_VALUE = 1e12;

export function writeReport(path: string, report: Report): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(parseReport(JSON.stringify(report), report.kind), null, 2)}\n`);
}

/** A field: a byte or message count, a commit, a pull request number, one of a few literals or an object. */
type Shape = 'count' | 'sha' | 'pr' | readonly (string | number)[] | { [key: string]: Shape };

const counts = (keys: readonly string[]): Shape => Object.fromEntries(keys.map((key) => [key, 'count' as const]));
const transfer: Shape = Object.fromEntries(PROVIDERS.map((provider) => [provider, counts(TRANSFER_METRICS)]));
const bundle = counts(BUNDLE_MEASURES);
const common = { version: [1], pr: 'pr', head: 'sha', base: 'sha' } as const;
const SHAPES: Record<Report['kind'], Shape> = {
  transfer: { kind: ['transfer'], ...common, metrics: transfer },
  bundle: { kind: ['bundle'], ...common, sizes: bundle },
};

function check(value: unknown, shape: Shape, at: string): void {
  const fail = (expected: string): never => { throw new Error(`${at}: ${JSON.stringify(value)?.slice(0, 80) ?? 'missing'}, expected ${expected}`); };
  if (shape === 'count') {
    if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > MAX_VALUE) fail(`an integer from 0 to ${MAX_VALUE}`);
  } else if (shape === 'pr') {
    if (!Number.isSafeInteger(value) || (value as number) < 1) fail('a pull request number');
  } else if (shape === 'sha') {
    if (typeof value !== 'string' || !/^[0-9a-f]{40}$/.test(value)) fail('a 40-character commit hash');
  } else if (Array.isArray(shape)) {
    if (!shape.includes(value as string | number)) fail(shape.map((item) => JSON.stringify(item)).join(' or '));
  } else {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('an object');
    const keys = Object.keys(shape);
    const extra = Object.keys(value as object).filter((key) => !keys.includes(key));
    if (extra.length) throw new Error(`${at}: unexpected key ${JSON.stringify(extra[0])}, expected only ${keys.join(', ')}`);
    for (const key of keys) {
      if (!Object.hasOwn(value as object, key)) throw new Error(`${at}.${key}: missing`);
      check((value as Record<string, unknown>)[key], (shape as Record<string, Shape>)[key]!, `${at}.${key}`);
    }
  }
}

/** `text` as a `kind` report, or an error naming the first field that is not exactly what a report holds. */
export function parseReport<K extends Report['kind']>(text: string, kind: K): Extract<Report, { kind: K }> {
  if (Buffer.byteLength(text) > MAX_REPORT_BYTES) throw new Error(`${REPORT_FILES[kind]}: ${Buffer.byteLength(text)} bytes, expected at most ${MAX_REPORT_BYTES}`);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`${REPORT_FILES[kind]}: not JSON (${(error as Error).message})`);
  }
  check(value, SHAPES[kind], REPORT_FILES[kind]);
  return value as Extract<Report, { kind: K }>;
}

/** The most `metric` may reach before a pull request explains it: main plus 1 % for bytes, main for messages. */
export function transferCeiling(metric: keyof TransferMetrics, base: number): number {
  return metric === 'liveMessages' ? base : Math.floor(base * (1 + TRANSFER_HEADROOM));
}

/** Each measure above its ceiling, `Claude liveWire: 13,102 bytes, ceiling 13,050`. */
export function transferOverruns(metrics: Transfer, baseline: Transfer | null): string[] {
  if (baseline === null) return [];
  return PROVIDERS.flatMap((provider) => TRANSFER_METRICS.flatMap((metric) => {
    const limit = transferCeiling(metric, baseline[provider][metric]);
    const value = metrics[provider][metric];
    return value > limit ? [`${PROVIDER_LABELS[provider]} ${metric}: ${number(value)}, ceiling ${number(limit)} (main ${number(baseline[provider][metric])})`] : [];
  }));
}

const number = (value: number) => value.toLocaleString('en-US');

function impact(value: number, base: number | undefined): string {
  if (base === undefined) return 'n/a';
  const growth = value - base;
  const ratio = base === 0 ? 0 : (growth / base) * 100;
  return `${growth > 0 ? '+' : ''}${number(growth)} (${growth > 0 ? '+' : ''}${ratio.toFixed(2)} %)`;
}

const cell = (value: number | undefined) => (value === undefined ? 'n/a' : number(value));

/** One table per agent: main, this pull request, the impact, the ceiling and whether it holds. */
export function renderTransfer(report: { metrics: Transfer; baseline: Transfer | null }): string {
  const sections = PROVIDERS.map((provider) => {
    const rows = TRANSFER_METRICS.map((metric) => {
      const value = report.metrics[provider][metric];
      const base = report.baseline?.[provider][metric];
      const limit = base === undefined ? undefined : transferCeiling(metric, base);
      const status = limit === undefined ? '' : value <= limit ? '✅' : '❌';
      return `| ${TRANSFER_LABELS[metric]} | ${cell(base)} | ${number(value)} | ${impact(value, base)} | ${cell(limit)} | ${status} |`;
    });
    return [`#### ${PROVIDER_LABELS[provider]}`, '', '| Measure | main | This PR | Impact | Ceiling | |', '| --- | ---: | ---: | ---: | ---: | :---: |', ...rows].join('\n');
  });
  return sections.join('\n\n');
}

/**
 * Each bundle measure: main, this pull request, the impact, the published
 * ceiling and whether both rules of budgets.ts hold. Without main's sizes the
 * growth rule is not judged, and without a ceiling the ceiling rule.
 */
export function renderBundle(report: { sizes: BundleSizes; baseSizes: BundleSizes | null; ceiling: BundleSizes | null; reason: boolean }): string {
  const rows = BUNDLE_MEASURES.map((key) => {
    const value = report.sizes[key];
    const base = report.baseSizes?.[key];
    const limit = report.ceiling?.[key];
    const overCeiling = limit !== undefined && value > limit && (base === undefined || base <= limit || value > base);
    const unexplained = base !== undefined && base > 0 && (value - base) / base > BUNDLE_EXPLAIN_ABOVE && !report.reason;
    const status = base === undefined && limit === undefined ? '' : overCeiling || unexplained ? '❌' : '✅';
    return `| ${key} | ${cell(base)} | ${number(value)} | ${impact(value, base)} | ${cell(limit)} | ${status} |`;
  });
  return ['| Measure | main | This PR | Impact | Ceiling | |', '| --- | ---: | ---: | ---: | ---: | :---: |', ...rows].join('\n');
}
