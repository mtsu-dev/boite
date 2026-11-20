import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import bundled from '../src/pricing/rates.json';
import { initPricing, priceOf, pricingIdle, pricingStatus, resetPricing, type PricingInit } from '../src/pricing/index.ts';
import { RATES_RETRY_MS, RATES_TTL_MS } from '../src/pricing/live.ts';
import { PolicyStore } from '../src/policy.ts';

const SOURCE = 'https://prices.test/api.json';
const HOUR = 60 * 60 * 1000;
const dirs: string[] = [];

afterEach(() => {
  resetPricing();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function dataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'boite-pricing-'));
  dirs.push(dir);
  return dir;
}

type Listing = Record<string, { release_date: string; cost: Record<string, number | undefined> }>;

/** A models.dev document listing every bundled model, plus `extra` under Anthropic. */
function catalogue(extra: Listing = {}, sections: string[] = ['anthropic', 'openai']): unknown {
  const models: Listing = {};
  for (const [id, [input, output, cacheRead, cacheWrite]] of Object.entries(bundled.models as Record<string, (number | null)[]>)) {
    models[id] = { release_date: '2026-01-01', cost: { input: input!, output: output!, cache_read: cacheRead ?? undefined, cache_write: cacheWrite ?? undefined } };
  }
  const document: Record<string, unknown> = {};
  if (sections.includes('anthropic')) document.anthropic = { models: { ...models, ...extra } };
  if (sections.includes('openai')) document.openai = { models: {} };
  return document;
}

const NEW_MODEL: Listing = { 'claude-test-9': { release_date: '2026-11-01', cost: { input: 7, output: 35, cache_read: 0.7, cache_write: 8.75 } } };

interface Harness {
  calls: { url: string; init: RequestInit }[];
  logs: { level: string; message: string }[];
  clock: { now: number };
  reply: (init: RequestInit) => Response | Promise<Response>;
}

function start(dir: string, reply: Harness['reply'], extra: Partial<PricingInit> = {}): Harness {
  const harness: Harness = { calls: [], logs: [], clock: { now: Date.parse('2026-11-19T12:00:00Z') }, reply };
  initPricing({
    dataDir: dir,
    source: SOURCE,
    now: () => harness.clock.now,
    log: (level, message) => { harness.logs.push({ level, message }); },
    fetch: async (url, init) => { harness.calls.push({ url, init }); return harness.reply(init); },
    ...extra,
  });
  return harness;
}

const ok = (body: unknown, etag = '"v1"'): Response => new Response(JSON.stringify(body), { status: 200, headers: { etag } });
const stored = (dir: string): { source: string; fetchedAt: number; etag: string | null; models: Record<string, unknown> } =>
  JSON.parse(readFileSync(join(dir, 'pricing', 'rates.json'), 'utf8'));

test('init reads and fetches nothing; the first lookup fetches in the background and the next one sees the new model', async () => {
  const dir = dataDir();
  const harness = start(dir, () => ok(catalogue(NEW_MODEL)));
  expect(harness.calls).toHaveLength(0);
  expect(pricingStatus()).toMatchObject({ origin: 'bundled', source: bundled.source });

  // The lookup stays synchronous: this one reads the bundled table.
  expect(priceOf('claude-test-9')).toBeNull();
  expect(harness.calls).toHaveLength(1);
  await pricingIdle();
  expect(priceOf('claude/claude-test-9-high')).toEqual({ model: 'claude-test-9', rates: { input: 7, output: 35, cacheRead: 0.7, cacheWrite: 8.75 } });

  const [call] = harness.calls;
  expect(call!.url).toBe(SOURCE);
  expect(call!.init).toMatchObject({ redirect: 'error', headers: { 'user-agent': 'boite' } });
  expect((call!.init.headers as Record<string, string>)['if-none-match']).toBeUndefined();
  expect(call!.init.signal).toBeInstanceOf(AbortSignal);

  const file = stored(dir);
  expect(file).toMatchObject({ source: SOURCE, fetchedAt: harness.clock.now, etag: '"v1"' });
  expect(file.models['claude-test-9']).toEqual([7, 35, 0.7, 8.75]);
  expect(pricingStatus()).toEqual({ origin: 'live', source: SOURCE, updatedAt: harness.clock.now, models: Object.keys(bundled.models).length + 1 });

  // A day has not passed: a known model asks nothing more.
  harness.clock.now += RATES_TTL_MS - 1;
  priceOf('claude-opus-5-5');
  expect(harness.calls).toHaveLength(1);
});

test('a 304 keeps the table, sends the stored ETag and bumps the fetch time', async () => {
  const dir = dataDir();
  const first = start(dir, () => ok(catalogue(NEW_MODEL), '"v7"'));
  priceOf('claude-opus-5-5');
  await pricingIdle();
  const fetchedAt = first.clock.now;

  // A later core on the same data reads the cache, then checks it once it is a day old.
  const later = start(dir, () => new Response(null, { status: 304 }));
  later.clock.now = fetchedAt + RATES_TTL_MS + 1;
  expect(priceOf('claude-test-9')?.model).toBe('claude-test-9');
  expect(later.calls).toHaveLength(1);
  expect((later.calls[0]!.init.headers as Record<string, string>)['if-none-match']).toBe('"v7"');
  await pricingIdle();
  expect(priceOf('claude-test-9')?.model).toBe('claude-test-9');
  expect(stored(dir)).toMatchObject({ fetchedAt: later.clock.now, etag: '"v7"' });
  expect(pricingStatus()).toMatchObject({ origin: 'live', updatedAt: later.clock.now });
});

test('a 304 that ends after another init changes neither that init nor the cache', async () => {
  const dir = dataDir();
  start(dir, () => ok(catalogue(NEW_MODEL), '"v7"'));
  priceOf('claude-opus-5-5');
  await pricingIdle();
  const fetchedAt = stored(dir).fetchedAt;

  // The 304's body cancels slowly; a new init lands meanwhile.
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let cancelling!: () => void;
  const cancelled = new Promise<void>((resolve) => { cancelling = resolve; });
  const later = start(dir, () => new Response(new ReadableStream({ cancel: () => { cancelling(); return gate; } }), { status: 304 }));
  later.clock.now = fetchedAt + RATES_TTL_MS + 1;
  priceOf('claude-opus-5-5');
  await cancelled;
  const other = dataDir();
  start(other, () => ok(catalogue()));
  release();
  await new Promise((resolve) => setTimeout(resolve, 20));

  expect(stored(dir).fetchedAt).toBe(fetchedAt);
  expect(existsSync(join(other, 'pricing', 'rates.json'))).toBe(false);
  expect(pricingStatus()).toMatchObject({ origin: 'bundled' });
});

test('a document without OpenAI, or that lost most bundled models, is rejected with one warning and the previous table kept', async () => {
  const dir = dataDir();
  const harness = start(dir, () => ok(catalogue(NEW_MODEL, ['anthropic'])));
  priceOf('claude-opus-5-5');
  await pricingIdle();
  expect(existsSync(join(dir, 'pricing', 'rates.json'))).toBe(false);
  expect(priceOf('claude-test-9')).toBeNull();
  expect(pricingStatus().origin).toBe('bundled');
  expect(harness.logs.filter(entry => entry.level === 'warn')).toEqual([{ level: 'warn', message: expect.stringContaining(SOURCE) }]);

  // With a cache in place, a catalogue that keeps a handful of models does not replace it.
  harness.reply = () => ok(catalogue(NEW_MODEL));
  harness.clock.now += RATES_RETRY_MS;
  priceOf('claude-opus-5-5');
  await pricingIdle();
  expect(priceOf('claude-test-9')?.model).toBe('claude-test-9');
  const before = readFileSync(join(dir, 'pricing', 'rates.json'), 'utf8');
  harness.reply = () => ok({ anthropic: { models: NEW_MODEL }, openai: { models: {} } });
  harness.clock.now += RATES_TTL_MS;
  priceOf('claude-opus-5-5');
  await pricingIdle();
  expect(harness.calls).toHaveLength(3);
  expect(readFileSync(join(dir, 'pricing', 'rates.json'), 'utf8')).toBe(before);
  expect(priceOf('claude-test-9')?.model).toBe('claude-test-9');
  expect(harness.logs.filter(entry => entry.level === 'warn').at(-1)!.message).toContain('keeping the cached rates');
});

test('an unknown model forces one fetch per id and at most one an hour; default and empty ids never fetch', async () => {
  const dir = dataDir();
  const harness = start(dir, () => ok(catalogue()));
  priceOf('claude-opus-5-5');
  await pricingIdle();
  expect(harness.calls).toHaveLength(1);

  for (const id of ['default', 'claude/default', '', '  ', null]) expect(priceOf(id)).toBeNull();
  expect(harness.calls).toHaveLength(1);

  expect(priceOf('mystery-1')).toBeNull();
  await pricingIdle();
  expect(harness.calls).toHaveLength(2);
  // Within the hour, another unknown id waits.
  harness.clock.now += 10 * 60 * 1000;
  priceOf('mystery-2');
  expect(harness.calls).toHaveLength(2);
  // After it, the same id never asks again, a new one does.
  harness.clock.now += HOUR;
  priceOf('mystery-1');
  priceOf('codex/mystery-1');
  expect(harness.calls).toHaveLength(2);
  priceOf('mystery-2');
  await pricingIdle();
  expect(harness.calls).toHaveLength(3);
});

test('modelPrices: false in the admin policy stops the fetch; the cached rates still price', async () => {
  const dir = dataDir();
  const first = start(dir, () => ok(catalogue(NEW_MODEL)));
  priceOf('claude-opus-5-5');
  await pricingIdle();
  expect(first.calls).toHaveLength(1);

  const policyFile = join(dir, 'policy.json');
  writeFileSync(policyFile, JSON.stringify({ modelPrices: false }));
  const policy = new PolicyStore(policyFile, { log: () => {}, changed: () => {} });
  expect(policy.state().locked).toEqual(['modelPrices']);
  const blocked = start(dir, () => ok(catalogue(NEW_MODEL)), { blocked: () => policy.modelPricesOff() });
  blocked.clock.now = first.clock.now + 2 * RATES_TTL_MS;
  expect(priceOf('claude-test-9')?.model).toBe('claude-test-9');
  expect(priceOf('mystery-1')).toBeNull();
  await pricingIdle();
  expect(blocked.calls).toHaveLength(0);
  expect(pricingStatus().origin).toBe('live');
  policy.close();
});

test('offline, the cache prices and then the bundled table; a failure waits an hour', async () => {
  const offline = (): Response => { throw new TypeError('fetch failed: getaddrinfo ENOTFOUND'); };

  // No cache: the bundled table.
  const fresh = start(dataDir(), offline);
  expect(priceOf('claude-opus-5-5')?.model).toBe('claude-opus-5-5');
  await pricingIdle();
  expect(pricingStatus().origin).toBe('bundled');
  expect(fresh.logs).toEqual([{ level: 'warn', message: expect.stringContaining('keeping the bundled rates') }]);
  fresh.clock.now += RATES_RETRY_MS - 1;
  priceOf('mystery-1');
  expect(fresh.calls).toHaveLength(1);
  fresh.clock.now += 1;
  priceOf('claude-opus-5-5');
  await pricingIdle();
  expect(fresh.calls).toHaveLength(2);

  // A cache of any age: its rates, bundled ids it lacks still priced.
  const dir = dataDir();
  const listing = catalogue(NEW_MODEL) as { anthropic: { models: Listing } };
  delete listing.anthropic.models['claude-opus-5-5'];
  start(dir, () => ok(listing));
  priceOf('claude-opus-5-5');
  await pricingIdle();
  expect(stored(dir).models['claude-opus-5-5']).toBeUndefined();
  const later = start(dir, offline);
  later.clock.now += 30 * RATES_TTL_MS;
  expect(priceOf('claude-test-9')?.model).toBe('claude-test-9');
  expect(priceOf('claude-opus-5-5')?.model).toBe('claude-opus-5-5');
  await pricingIdle();
  expect(later.calls).toHaveLength(1);
  expect(pricingStatus().origin).toBe('live');
  expect(later.logs.at(-1)!.message).toContain('keeping the cached rates');
});

test('without an init, a lookup never fetches', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = Object.assign(async () => { calls += 1; return new Response('{}'); }, { preconnect: () => {} }) as typeof fetch;
  try {
    expect(priceOf('mystery-model')).toBeNull();
    expect(priceOf('claude-opus-5-5')?.model).toBe('claude-opus-5-5');
    await pricingIdle();
    expect(calls).toBe(0);
    expect(pricingStatus().origin).toBe('bundled');
  } finally {
    globalThis.fetch = original;
  }
});
