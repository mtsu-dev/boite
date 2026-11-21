import type { Usage, UsageHistory, UsageHistoryProject, UsageHistoryThread, UsagePrice, UsageThreadTurn } from '@boite/contracts';
import { fill, strings } from './strings';
import { count, formatTokens } from './format';
import { formatLocale } from './i18n.svelte';

export type UsageMetric = 'tokens' | 'cost' | 'turns';
export const USAGE_METRICS: readonly UsageMetric[] = ['tokens', 'cost', 'turns'];
export const USAGE_RANGES = [7, 30, 90] as const;
export type UsageRange = (typeof USAGE_RANGES)[number];

/**
 * The provider stack, bottom first. Fixed, so a provider keeps its place
 * whatever the range shows; one missing here stacks after them, by name.
 */
const PROVIDER_ORDER = ['claude', 'codex', 'opencode', 'opencode-v2', 'grok', 'antigravity', 'pi', 'muse', 'vibe', 'hermes', 'echo'] as const;
const KNOWN = new Set<string>(PROVIDER_ORDER);

/**
 * A provider's colour: its own token (`--provider-<id>` in tokens.css) near its
 * maker's colour, or a hue drawn from its id at the same lightness and chroma,
 * so a provider Boite does not know yet never borrows another's colour.
 */
export function providerColor(providerId: string): string {
  if (KNOWN.has(providerId)) return `var(--provider-${providerId})`;
  if (!providerId.trim()) return 'var(--series-other)';
  return `oklch(var(--series-l) var(--series-c) ${hueOf(providerId)})`;
}

/** A stable hue for a name: the same id always lands on the same colour. */
function hueOf(name: string): number {
  let hash = 2166136261;
  for (let index = 0; index < name.length; index++) hash = Math.imul(hash ^ name.charCodeAt(index), 16777619);
  return (hash >>> 0) % 360;
}

/** The colour of the `index`th series of a breakdown that has no fixed palette, models of one thread: golden-angle hues. */
export function rankColor(index: number): string {
  return `oklch(var(--series-l) var(--series-c) ${Math.round((42 + index * 137.508) % 360)})`;
}

export const OTHER = 'other';

/** Local midnights from `days - 1` days before `now` to the coming one: `days + 1` edges. */
export function dayEdges(days: number, now = Date.now()): number[] {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  const edges: number[] = [];
  for (let index = 0; index <= days; index++) {
    const edge = new Date(start);
    edge.setDate(start.getDate() + index);
    edges.push(edge.getTime());
  }
  return edges;
}

/** Every token the provider processed, cache included. */
export function totalTokens(usage: Usage): number {
  return usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
}

export function measure(metric: UsageMetric, turns: number, usage: Usage): number {
  if (metric === 'turns') return turns;
  if (metric === 'cost') return usage.costUsdEquivalent ?? 0;
  return totalTokens(usage);
}

/**
 * Axis ticks on 1, 2 or 5 steps, from zero to the first tick at or above the
 * peak. `minStep` keeps a count of turns on whole numbers.
 */
export function niceScale(peak: number, count = 4, minStep = 0): { max: number; ticks: number[] } {
  if (!(peak > 0) || !Number.isFinite(peak)) return { max: Math.max(1, minStep), ticks: [0, Math.max(1, minStep)] };
  const raw = peak / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const nice = [1, 2, 5, 10].map((factor) => factor * magnitude).find((candidate) => candidate >= raw) ?? 10 * magnitude;
  const step = Math.max(nice, minStep);
  const steps = Math.max(1, Math.ceil(peak / step - 1e-9));
  const ticks = Array.from({ length: steps + 1 }, (_, index) => Number((index * step).toPrecision(12)));
  return { max: ticks[ticks.length - 1]!, ticks };
}

/*
 * Money in dollars, written the way the language the app speaks writes it:
 * `$113.23` in English, `113,23 $US` in French. `k` follows the last digit.
 */
const dollarSets = new Map<string, Intl.NumberFormat>();
function dollars(value: number, least: number, most: number, thousands = false): string {
  const key = `${formatLocale()}:${least}:${most}`;
  let money = dollarSets.get(key);
  if (!money) {
    money = new Intl.NumberFormat(formatLocale(), { style: 'currency', currency: 'USD', minimumFractionDigits: least, maximumFractionDigits: most });
    dollarSets.set(key, money);
  }
  const parts = money.formatToParts(thousands ? value / 1000 : value);
  const last = parts.findLastIndex((part) => part.type === 'integer' || part.type === 'fraction');
  return parts.map((part, index) => part.value + (thousands && index === last ? 'k' : '')).join('');
}

export function formatMetric(metric: UsageMetric, value: number): string {
  if (metric === 'turns') return count(value);
  if (metric === 'tokens') return formatTokens(value);
  if (value >= 10_000) return dollars(value, 0, 1, true);
  if (value >= 1000) return dollars(value, 0, 0);
  if (value > 0 && value < 0.01) return dollars(value, 3, 3);
  return dollars(value, 2, 2);
}

/** A missing report is unknown, while a day without turns really is zero. */
export function reportedValue(metric: UsageMetric, value: number, coverage: { turns: number; reported: number; priced: number }): string {
  if (coverage.turns > 0) {
    if (metric === 'cost' && coverage.priced === 0) return strings.usage.noPrice;
    if (metric === 'tokens' && coverage.reported === 0) return strings.usage.noUsage;
  }
  return formatMetric(metric, value);
}

/** A per-million rate as precise as the price list writes it: `$4`, `$0.2`, `$0.125`. */
export function formatRate(value: number): string {
  return dollars(value, 0, 3);
}

/**
 * Where a model's cost comes from, for the "i" beside its name: the public
 * rates it was priced at, the agent's own figure, or nothing. Then the Cache
 * column taken apart, since a written token costs dozens of read ones.
 */
export function priceNote(row: { price: UsagePrice | null; priced: number; reported: number; olderCore?: boolean; usage?: Usage }): string {
  const price = row.price;
  // Rates price nothing without tokens: Grok reports none.
  if (row.reported === 0 && row.priced === 0) return strings.usage.noTokens;
  if (price !== null) {
    const { input, output, cacheRead, cacheWrite } = price.rates;
    return `${fill(strings.usage.rates, {
      model: price.model,
      input: formatRate(input),
      output: formatRate(output),
      cacheRead: formatRate(cacheRead),
      cacheWrite: formatRate(cacheWrite),
    })}${cacheSplit(row.usage, price)}`;
  }
  // A core from before public prices knows no rate at all, whatever the model.
  if (row.olderCore) return strings.usage.olderCore;
  return `${row.priced > 0 ? strings.usage.reportedCost : strings.usage.noRates}${cacheSplit(row.usage, null)}`;
}

/** What the Cache column adds up, read and written apart, priced at the rates when there are some. */
function cacheSplit(usage: Usage | undefined, price: UsagePrice | null): string {
  if (!usage || usage.cacheReadTokens + usage.cacheWriteTokens === 0) return '';
  const read = formatMetric('tokens', usage.cacheReadTokens);
  const write = formatMetric('tokens', usage.cacheWriteTokens);
  if (price === null) return ` ${fill(strings.usage.cacheSplit, { read, write })}`;
  return ` ${fill(strings.usage.cacheSplitCost, {
    read,
    write,
    readCost: formatMetric('cost', usage.cacheReadTokens * price.rates.cacheRead / 1e6),
    writeCost: formatMetric('cost', usage.cacheWriteTokens * price.rates.cacheWrite / 1e6),
  })}`;
}

/** A shorter label for an axis: `$2.5`, `$1.5k`. Token counts already drop a `.0`. */
export function formatTick(metric: UsageMetric, value: number): string {
  if (metric !== 'cost') return formatMetric(metric, value);
  if (value >= 1000) return dollars(value, 0, 1, true);
  return dollars(value, 0, 3);
}

export interface UsageSeries {
  key: string;
  color: string;
  providerIds: string[];
}

export interface UsageTotals {
  turns: number;
  reported: number;
  priced: number;
  usage: Usage;
}

export interface UsageBucket {
  start: number;
  end: number;
  values: Record<string, number>;
  total: number;
  turns: number;
  reported: number;
  priced: number;
  coverage: Record<string, { turns: number; reported: number; priced: number }>;
}

interface ModelRow extends UsageTotals {
  providerId: string;
  model: string | null;
  value: number;
  /** The public rates the core priced this model at, null when it had none. */
  price: UsagePrice | null;
  /** Some of its turns came from a core older than public prices, which sends no `price`. */
  olderCore?: boolean;
}

interface DayRow extends UsageTotals {
  start: number;
  value: number;
}

export interface UsageView {
  series: UsageSeries[];
  buckets: UsageBucket[];
  /** Per series key. */
  bySeries: Record<string, UsageTotals & { value: number }>;
  total: UsageTotals & { value: number };
  models: ModelRow[];
  days: DayRow[];
  /** Providers with turns in the range but no price on any of them. */
  unpriced: string[];
}

function emptyTotals(): UsageTotals {
  return { turns: 0, reported: 0, priced: 0, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsdEquivalent: null } };
}

function addTotals(into: UsageTotals, turns: number, reported: number, priced: number, usage: Usage): void {
  into.turns += turns;
  into.reported += reported;
  into.priced += priced;
  into.usage.inputTokens += usage.inputTokens;
  into.usage.outputTokens += usage.outputTokens;
  into.usage.cacheReadTokens += usage.cacheReadTokens;
  into.usage.cacheWriteTokens += usage.cacheWriteTokens;
  if (usage.costUsdEquivalent !== null) into.usage.costUsdEquivalent = (into.usage.costUsdEquivalent ?? 0) + usage.costUsdEquivalent;
}

/** Which series each provider draws in, known providers first in their fixed order. */
export function seriesFor(providerIds: Iterable<string>): { series: UsageSeries[]; keyOf: (providerId: string) => string } {
  const present = new Set(providerIds);
  const known: string[] = PROVIDER_ORDER.filter((providerId) => present.has(providerId));
  const others = [...present].filter((providerId) => !KNOWN.has(providerId)).sort();
  // Echo is Boite's test provider: it stays after every real one.
  const last = known.at(-1) === 'echo' ? known.splice(-1) : [];
  const series = [...known, ...others, ...last].map((providerId) => ({ key: providerId, color: providerColor(providerId), providerIds: [providerId] }));
  const keys = new Set(series.map((entry) => entry.key));
  return { series, keyOf: (providerId) => keys.has(providerId) ? providerId : OTHER };
}

/**
 * A model id without its own provider's prefix: a delegated thread records
 * `claude/claude-opus-5-5` where the picker records `claude-opus-5-5`, and both
 * ran the same model.
 */
export function ownModel(providerId: string, model: string | null): string | null {
  return model?.startsWith(`${providerId}/`) ? model.slice(providerId.length + 1) : model;
}

export function summarize(history: UsageHistory, metric: UsageMetric, providerIds: Iterable<string> = []): UsageView {
  const { series, keyOf } = seriesFor([...providerIds, ...history.rows.map((row) => row.providerId)]);
  const buckets: UsageBucket[] = history.edges.slice(0, -1).map((start, index) => ({
    start,
    end: history.edges[index + 1]!,
    values: Object.fromEntries(series.map((entry) => [entry.key, 0])),
    total: 0,
    turns: 0,
    reported: 0,
    priced: 0,
    coverage: Object.fromEntries(series.map((entry) => [entry.key, { turns: 0, reported: 0, priced: 0 }])),
  }));
  const bySeries: UsageView['bySeries'] = Object.fromEntries(series.map((entry) => [entry.key, { ...emptyTotals(), value: 0 }]));
  const total = { ...emptyTotals(), value: 0 };
  const models = new Map<string, ModelRow>();
  const days = buckets.map((bucket) => ({ ...emptyTotals(), start: bucket.start, value: 0 }));
  const providers = new Map<string, UsageTotals>();

  for (const row of history.rows) {
    const bucket = buckets[row.bucket];
    if (bucket === undefined) continue;
    const key = keyOf(row.providerId);
    const value = measure(metric, row.turns, row.usage);
    bucket.values[key] = (bucket.values[key] ?? 0) + value;
    bucket.total += value;
    bucket.turns += row.turns;
    bucket.reported += row.reported;
    bucket.priced += row.priced;
    const coverage = bucket.coverage[key]!;
    coverage.turns += row.turns;
    coverage.reported += row.reported;
    coverage.priced += row.priced;
    const serie = bySeries[key]!;
    addTotals(serie, row.turns, row.reported, row.priced, row.usage);
    serie.value += value;
    addTotals(total, row.turns, row.reported, row.priced, row.usage);
    total.value += value;
    const id = ownModel(row.providerId, row.model);
    const modelKey = `${row.providerId}\u0000${id ?? ''}`;
    const model = models.get(modelKey) ?? { ...emptyTotals(), providerId: row.providerId, model: id, value: 0, price: null };
    addTotals(model, row.turns, row.reported, row.priced, row.usage);
    model.value += value;
    model.price ??= row.price ?? null;
    if (row.price === undefined) model.olderCore = true;
    models.set(modelKey, model);
    const day = days[row.bucket]!;
    addTotals(day, row.turns, row.reported, row.priced, row.usage);
    day.value += value;
    const provider = providers.get(row.providerId) ?? emptyTotals();
    addTotals(provider, row.turns, row.reported, row.priced, row.usage);
    providers.set(row.providerId, provider);
  }

  const unpriced = [...providers].filter(([, totals]) => totals.turns > 0 && totals.priced === 0).map(([providerId]) => providerId);
  return {
    series,
    buckets,
    bySeries,
    total,
    models: [...models.values()].sort((a, b) => b.value - a.value || b.turns - a.turns),
    days: days.reverse(),
    unpriced,
  };
}

/**
 * Several machines' histories read over the same edges, as one. `summarize`
 * adds rows that share a bucket, provider and model, so they are only joined.
 * A project lives on one machine, so its line is never added to another's.
 */
export function mergeHistories<T extends UsageHistoryThread, P extends UsageHistoryProject = UsageHistoryProject>(
  edges: number[],
  parts: { rows: UsageHistory['rows']; threads: T[]; projects?: P[]; pricing?: UsageHistory['pricing'] }[]
): Omit<UsageHistory, 'threads' | 'projects'> & { threads: T[]; projects: P[] } {
  const pricing = parts.find((part) => part.pricing?.origin === 'live')?.pricing ?? parts.find((part) => part.pricing)?.pricing;
  return {
    edges,
    rows: parts.flatMap((part) => part.rows),
    threads: parts.flatMap((part) => part.threads),
    projects: parts.flatMap((part) => part.projects ?? []),
    ...(pricing === undefined ? {} : { pricing })
  };
}

/** Projects ordered by the selected measure, with unmeasured projects still available to the picker. */
export function rankProjects<P extends UsageHistoryProject>(projects: P[], metric: UsageMetric): (P & { value: number })[] {
  return projects
    .map((project) => ({ ...project, value: measure(metric, project.turns, project.usage) }))
    .sort((a, b) => b.value - a.value || b.turns - a.turns);
}

/**
 * One thread's turns as day columns stacked by model, for the thread's page.
 * Series are its models, biggest first, each on its own hue.
 */
export function threadView(edges: number[], turns: UsageThreadTurn[], metric: UsageMetric, providerId: string): { series: UsageSeries[]; buckets: UsageBucket[]; models: ModelRow[] } {
  const models = new Map<string, ModelRow>();
  const perTurn = turns.map((turn) => {
    const model = ownModel(providerId, turn.model);
    const key = model ?? '';
    const usage = turn.usage ?? emptyTotals().usage;
    const reported = turn.usage === null ? 0 : 1;
    const priced = turn.usage?.costUsdEquivalent == null ? 0 : 1;
    const value = measure(metric, 1, usage);
    const row = models.get(key) ?? { ...emptyTotals(), providerId, model, value: 0, price: null };
    addTotals(row, 1, reported, priced, usage);
    row.value += value;
    row.price ??= turn.price;
    models.set(key, row);
    return { turn, key, value, reported, priced };
  });
  const ranked = [...models.entries()].sort(([, a], [, b]) => b.value - a.value || b.turns - a.turns);
  const series = ranked.map(([key], index) => ({ key, color: rankColor(index), providerIds: [providerId] }));
  const buckets: UsageBucket[] = edges.slice(0, -1).map((start, index) => ({
    start,
    end: edges[index + 1]!,
    values: Object.fromEntries(series.map((entry) => [entry.key, 0])),
    total: 0,
    turns: 0,
    reported: 0,
    priced: 0,
    coverage: Object.fromEntries(series.map((entry) => [entry.key, { turns: 0, reported: 0, priced: 0 }]))
  }));
  for (const { turn, key, value, reported, priced } of perTurn) {
    const index = edges.findLastIndex((edge) => edge <= turn.finishedAt);
    const bucket = buckets[index];
    if (bucket === undefined) continue;
    bucket.values[key] = (bucket.values[key] ?? 0) + value;
    bucket.total += value;
    bucket.turns += 1;
    bucket.reported += reported;
    bucket.priced += priced;
    const coverage = bucket.coverage[key]!;
    coverage.turns += 1;
    coverage.reported += reported;
    coverage.priced += priced;
  }
  return { series, buckets, models: ranked.map(([, row]) => row) };
}

/** The threads that spent the most by this metric, largest first. */
export function topThreads<T extends UsageHistoryThread>(threads: T[], metric: UsageMetric, limit = 10): (T & { value: number })[] {
  return threads
    .map((thread) => ({ ...thread, value: measure(metric, thread.turns, thread.usage) }))
    .filter((thread) => thread.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

/** A readable name for a model id, from the provider's catalogue when it has one. */
export function modelName(model: string | null, names: Map<string, string>, providerId?: string): string {
  if (model === null) return strings.usage.defaultModel;
  return names.get(providerId === undefined ? model : `${providerId}\u0000${model}`) ?? model;
}
