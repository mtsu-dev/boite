/**
 * The rate table `priceOf` reads: the bundled `rates.json` overlaid by the
 * models.dev catalogue this core last fetched, so a model released after this
 * build is priced without a release (`docs/internals/usage.md`).
 *
 * Nothing here runs at startup. `initPricing` only records where the cache
 * lives; the cache is read on the first lookup, and a fetch starts in the
 * background when that lookup finds the table older than a day, or when a
 * model is missing from it. Lookups stay synchronous: the next one after a
 * fetch sees its rates. Without `initPricing` (tests, scripts) nothing is read
 * and nothing is fetched.
 */
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import bundled from './rates.json';
import { RATES_SOURCE, REQUIRED_MAKERS, rateOf, reduceCatalogue, type Rate } from './reduce.ts';

/** A day after the last success, the next lookup checks the catalogue again. */
export const RATES_TTL_MS = 24 * 60 * 60 * 1000;
/** After a failure, and between two fetches a missing model forces. */
export const RATES_RETRY_MS = 60 * 60 * 1000;
export const RATES_TIMEOUT_MS = 10_000;
/** The catalogue is about 7 MB; past this it is not one. */
const MAX_CATALOGUE_BYTES = 64 * 1024 * 1024;
/** The reduced table is under 10 KB. */
const MAX_CACHE_BYTES = 1024 * 1024;
/** Unknown ids remembered so each forces one fetch at most; past this none forces any. */
const MAX_TRIED = 1000;

type Row = (number | null)[];
type Fetch = (input: string, init: RequestInit) => Promise<Response>;

/** What `<dataDir>/pricing/rates.json` holds: the reduced catalogue and how it was fetched. */
export interface StoredRates {
  source: string;
  fetchedAt: number;
  etag: string | null;
  models: Record<string, Rate>;
}

export interface PricingInit {
  dataDir: string;
  log(level: 'info' | 'warn', message: string, data?: Record<string, string | number | boolean | null>): void;
  /** True while the admin policy forbids the fetch (`modelPrices: false`); the cached and bundled tables still price. */
  blocked?: () => boolean;
  /** Tests inject a fake; the default is the global `fetch`. */
  fetch?: Fetch;
  now?: () => number;
  /** The catalogue's address; null fetches nothing. Defaults to `BOITE_MODEL_PRICES_URL`, else models.dev. */
  source?: string | null;
}

const BUNDLED: Record<string, Row> = bundled.models;
const BUNDLED_IDS = Object.keys(BUNDLED);
const BUNDLED_AT = Date.parse(bundled.date);

let config: (PricingInit & { source: string | null }) | null = null;
let loaded = false;
let cached: StoredRates | null = null;
let table: Record<string, Row> = BUNDLED;
let inflight: Promise<void> | null = null;
let failedAt: number | null = null;
let forcedAt: number | null = null;
const tried = new Set<string>();
/** Bumped by each init and reset, so a fetch an older init started changes nothing. */
let generation = 0;

/**
 * Where this core keeps fetched rates and how it logs. The core calls it once
 * at startup; it reads nothing and fetches nothing.
 */
export function initPricing(init: PricingInit): void {
  resetPricing();
  config = { ...init, source: init.source === undefined ? sourceFromEnv(init) : init.source };
}

/** Back to the bundled table with nothing to fetch: what a process that never called `initPricing` has. */
export function resetPricing(): void {
  generation += 1;
  config = null;
  loaded = false;
  cached = null;
  table = BUNDLED;
  inflight = null;
  failedAt = null;
  forcedAt = null;
  tried.clear();
}

/** The fetch running now, if any: tests wait on it. */
export function pricingIdle(): Promise<void> {
  return inflight ?? Promise.resolve();
}

/** The table a lookup reads. Starts a background fetch when the rates are a day old. */
export function ratesTable(): Record<string, Row> {
  load();
  refresh(null);
  return table;
}

/** A lookup found nothing for `id`: fetch once for it, at most once an hour. `default` and empty ids never fetch. */
export function noteMissing(id: string): void {
  if (id === '' || id === 'default') return;
  refresh(id);
}

/** Where the rates the lookups read came from. */
export function ratesOrigin(): { origin: 'live' | 'bundled'; source: string; updatedAt: number; models: number } {
  load();
  const models = Object.keys(table).length;
  return cached === null
    ? { origin: 'bundled', source: bundled.source, updatedAt: BUNDLED_AT, models }
    : { origin: 'live', source: cached.source, updatedAt: cached.fetchedAt, models };
}

function sourceFromEnv(init: PricingInit): string | null {
  const named = process.env.BOITE_MODEL_PRICES_URL;
  if (named === undefined) return RATES_SOURCE;
  if (named === '') return null;
  try {
    const url = new URL(named);
    if (url.protocol === 'https:' || url.protocol === 'http:') return url.href;
  } catch { /* reported below */ }
  init.log('warn', 'BOITE_MODEL_PRICES_URL is not an http(s) URL: model prices are not fetched', {});
  return null;
}

function cacheFile(dataDir: string): string {
  return join(dataDir, 'pricing', 'rates.json');
}

/** Reads the cached table once per `initPricing`. A bad file is ignored, and the next fetch replaces it. */
function load(): void {
  if (loaded || config === null) return;
  loaded = true;
  const file = cacheFile(config.dataDir);
  let text: string;
  try {
    if (statSync(file).size > MAX_CACHE_BYTES) throw new Error(`more than ${MAX_CACHE_BYTES} bytes`);
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') config.log('warn', `Model prices: ${file} cannot be read, using the bundled rates`, { error: describe(error) });
    return;
  }
  const stored = parseStored(text);
  if (stored === null) { config.log('warn', `Model prices: ${file} is not a rate table, using the bundled rates`, {}); return; }
  use(stored);
}

function parseStored(text: string): StoredRates | null {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return null; }
  if (typeof raw !== 'object' || raw === null) return null;
  const { source, fetchedAt, etag, models } = raw as Record<string, unknown>;
  if (typeof source !== 'string' || typeof fetchedAt !== 'number' || !Number.isFinite(fetchedAt)) return null;
  if (etag !== null && typeof etag !== 'string') return null;
  if (typeof models !== 'object' || models === null || Array.isArray(models)) return null;
  const kept: Record<string, Rate> = {};
  for (const [id, value] of Object.entries(models)) {
    const rate = rateOf(value);
    if (rate !== null) kept[id] = rate;
  }
  return Object.keys(kept).length === 0 ? null : { source, fetchedAt, etag, models: kept };
}

/** Bundled ids overlaid by the cache's: an older cache never removes a model this build knows. */
function use(stored: StoredRates): void {
  cached = stored;
  table = { ...BUNDLED, ...stored.models };
}

/** Starts a fetch when one is due: `missing` is the unknown id that asks for it, null for the daily check. */
function refresh(missing: string | null): void {
  if (config === null || config.source === null || inflight !== null) return;
  if (config.blocked?.() === true) return;
  const now = (config.now ?? Date.now)();
  if (failedAt !== null && now - failedAt < RATES_RETRY_MS) return;
  if (missing === null) {
    if (cached !== null && now - cached.fetchedAt < RATES_TTL_MS) return;
  } else {
    if (tried.has(missing) || tried.size >= MAX_TRIED) return;
    if (forcedAt !== null && now - forcedAt < RATES_RETRY_MS) return;
    tried.add(missing);
    forcedAt = now;
  }
  // `fetchRates` never rejects: a failure is logged and waits an hour.
  const running: Promise<void> = fetchRates(config, config.source, generation).finally(() => { if (inflight === running) inflight = null; });
  inflight = running;
}

async function fetchRates(init: PricingInit, source: string, started: number): Promise<void> {
  const now = init.now ?? Date.now;
  const current = (): boolean => generation === started;
  const headers: Record<string, string> = { 'user-agent': 'boite', accept: 'application/json' };
  const previous = cached;
  if (previous?.etag) headers['if-none-match'] = previous.etag;
  try {
    const response = await (init.fetch ?? fetch)(source, { headers, redirect: 'error', signal: AbortSignal.timeout(RATES_TIMEOUT_MS) });
    if (!current()) return;
    if (response.status === 304 && previous !== null) {
      await response.body?.cancel().catch(() => {});
      if (!current()) return;
      save(init, { ...previous, fetchedAt: now() });
      failedAt = null;
      return;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const length = Number(response.headers.get('content-length'));
    if (length > MAX_CATALOGUE_BYTES) throw new Error(`the catalogue is ${length} bytes, more than ${MAX_CATALOGUE_BYTES}`);
    const text = await response.text();
    if (text.length > MAX_CATALOGUE_BYTES) throw new Error(`the catalogue is more than ${MAX_CATALOGUE_BYTES} bytes`);
    const { models, missing } = reduceCatalogue(JSON.parse(text));
    const absent = REQUIRED_MAKERS.filter(maker => missing.includes(maker));
    if (absent.length > 0) throw new Error(`no ${absent.join(' or ')} section`);
    const kept = BUNDLED_IDS.filter(id => Object.hasOwn(models, id)).length;
    if (kept * 2 < BUNDLED_IDS.length) throw new Error(`only ${kept} of the ${BUNDLED_IDS.length} bundled models are listed`);
    if (!current()) return;
    save(init, { source, fetchedAt: now(), etag: response.headers.get('etag'), models });
    failedAt = null;
    init.log('info', `Model prices fetched from ${source}: ${Object.keys(models).length} models`, { models: Object.keys(models).length });
  } catch (error) {
    if (!current()) return;
    failedAt = now();
    init.log('warn', `Model prices: ${source} rejected or unreachable, keeping the ${cached === null ? 'bundled' : 'cached'} rates`, { error: describe(error) });
  }
}

/** Uses `stored` at once and writes it beside the data, atomically; a failed write still prices from memory. */
function save(init: PricingInit, stored: StoredRates): void {
  use(stored);
  const file = cacheFile(init.dataDir);
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    mkdirSync(join(init.dataDir, 'pricing'), { recursive: true });
    writeFileSync(temp, `${JSON.stringify(stored)}\n`);
    renameSync(temp, file);
  } catch (error) {
    try { rmSync(temp, { force: true }); } catch { /* the write error is the one to report */ }
    init.log('warn', `Model prices: ${file} cannot be written`, { error: describe(error) });
  }
}

function describe(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 200);
}
