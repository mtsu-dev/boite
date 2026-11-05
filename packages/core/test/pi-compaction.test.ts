import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, expect, test } from 'bun:test';
import { BACKGROUND_COMPACT } from '../src/threads/background-compact.ts';

/**
 * Boite's pi compaction extension, the very modules the driver writes, run
 * against a fake pi: the handlers it registers, a fake context and a fake
 * `compact`. No pi process and no model call.
 */

type Handler = (event: Record<string, unknown>, ctx: FakeCtx) => unknown;
interface Entry { id: string; type: string; message?: Record<string, unknown> }
interface FakeCtx { [key: string]: unknown }
interface Copy { preparation: Record<string, unknown>; model: unknown; apiKey: unknown; headers: unknown; signal: AbortSignal; resolve(result: unknown): void; reject(error: Error): void }

const LIMIT = 100_000;
const SUMMARY = { summary: 'earlier work', firstKeptEntryId: 'a2', tokensBefore: 90_000, usage: { input: 10, output: 5 }, details: { readFiles: ['src/a.ts'], modifiedFiles: [] } };
const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

/** The extension installed on a fake pi; each `compact` call is held until the test settles it. */
async function extension(ratios: Partial<typeof BACKGROUND_COMPACT> = {}) {
  const { extensionWriter, writeCompactionExtension } = await import('../src/drivers/pi/compaction.ts');
  const directory = mkdtempSync(join(tmpdir(), 'boite-pi-compaction-'));
  directories.push(directory);
  writeCompactionExtension(extensionWriter(directory));
  const run = await import(pathToFileURL(join(directory, 'pi-compaction-run.mjs')).href) as { install(pi: unknown, setting: unknown, deps: unknown): void };
  const handlers = new Map<string, Handler>();
  const copies: Copy[] = [];
  const compact = (preparation: Record<string, unknown>, model: unknown, apiKey: unknown, headers: unknown, _instructions: unknown, signal: AbortSignal) =>
    new Promise((resolve, reject) => { copies.push({ preparation, model, apiKey, headers, signal, resolve, reject }); });
  run.install({ on: (name: string, handler: Handler) => handlers.set(name, handler) },
    { tokens: LIMIT, background: true, ratios: { ...BACKGROUND_COMPACT, ...ratios } }, { compact, settings: { enabled: true, reserveTokens: 16_384, keepRecentTokens: 20_000 } });
  const session = { tokens: 0, entries: [] as Entry[] };
  const ctx: FakeCtx = {
    model: { provider: 'anthropic', id: 'claude-sonnet-5' },
    thinkingLevel: 'medium',
    getContextUsage: () => ({ tokens: session.tokens, contextWindow: 200_000, percent: null }),
    modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true, apiKey: 'key', headers: { 'x-team': 'boite' } }) },
    sessionManager: {
      getBranch: () => session.entries,
      buildSessionProjection: () => ({ entries: session.entries.map(entry => ({ sourceEntry: entry, messages: entry.message ? [entry.message] : [] })) }),
    },
  };
  const emit = (name: string, event: Record<string, unknown>) => handlers.get(name)?.(event, ctx);
  /** One pi turn: its assistant entry and its tool result, then `turn_end` with the context it leaves. */
  const turn = async (id: string, tokens: number, entries: unknown[] = []): Promise<unknown> => {
    session.entries.push({ id, type: 'message', message: { role: 'assistant', content: [{ type: 'toolCall', name: 'read', arguments: { path: 'src/a.ts' } }] } });
    session.entries.push({ id: `${id}-result`, type: 'message', message: { role: 'toolResult', content: [{ type: 'text', text: 'ok' }] } });
    session.tokens = tokens;
    const result = await emit('turn_end', { type: 'turn_end', messageEntryId: id, entries });
    // A copy reads its credentials before it calls `compact`.
    await Bun.sleep(0);
    return result;
  };
  session.entries.push({ id: 'u1', type: 'message', message: { role: 'user', content: 'Refactor the parser' } });
  return { session, copies, emit, turn };
}

const swap = (before: unknown[] = []) => ({ entries: [...before, { type: 'compaction', summary: 'earlier work', firstKeptEntryId: 'a2', details: { ...SUMMARY.details, boiteBackground: true }, usage: SUMMARY.usage }] });

test('a copy started in the band below the limit is appended at the turn end that reaches it, keeping the entries from its anchor', async () => {
  const pi = await extension();
  expect(await pi.turn('a1', 80_000)).toBeUndefined();
  expect(pi.copies).toHaveLength(0);
  // 85% of the limit: a copy of everything before this turn's assistant entry.
  expect(await pi.turn('a2', 90_000)).toBeUndefined();
  expect(pi.copies).toHaveLength(1);
  const copy = pi.copies[0]!;
  expect(copy.preparation['firstKeptEntryId']).toBe('a2');
  expect((copy.preparation['messagesToSummarize'] as { role: string }[]).map(message => message.role)).toEqual(['user', 'assistant', 'toolResult']);
  expect(copy.preparation['tokensBefore']).toBe(90_000);
  expect([...(copy.preparation['fileOps'] as { read: Set<string> }).read]).toEqual(['src/a.ts']);
  expect([copy.apiKey, copy.headers]).toEqual(['key', { 'x-team': 'boite' }]);
  copy.resolve(SUMMARY);
  expect(await pi.turn('a3', 95_000)).toBeUndefined();
  expect(pi.copies).toHaveLength(1);
  // Another extension's entry proposed at the same boundary stays in the chain.
  const other = { type: 'custom', customType: 'other', data: {} };
  expect(await pi.turn('a4', LIMIT, [other])).toEqual(swap([other]));
});

test('a copy still running at the limit is awaited, then appended', async () => {
  const pi = await extension();
  await pi.turn('a1', 70_000);
  await pi.turn('a2', 90_000);
  let answer: unknown = 'pending';
  const at = Promise.resolve(pi.turn('a3', LIMIT)).then(value => { answer = value; });
  await Bun.sleep(20);
  expect(answer).toBe('pending');
  pi.copies[0]!.resolve(SUMMARY);
  await at;
  expect(answer).toEqual(swap());
});

test('two failed copies stop the copies until the context is compacted again', async () => {
  const pi = await extension();
  await pi.turn('a1', 86_000);
  pi.copies[0]!.reject(new Error('the provider refused'));
  await Bun.sleep(0);
  await pi.turn('a2', 87_000);
  pi.copies[1]!.reject(new Error('the provider refused'));
  await Bun.sleep(0);
  await pi.turn('a3', 88_000);
  expect(pi.copies).toHaveLength(2);
  // At the limit with no copy, pi's own compaction runs.
  expect(await pi.turn('a4', LIMIT)).toBeUndefined();
  pi.emit('session_compact', { type: 'session_compact', fromExtension: false, reason: 'threshold' });
  pi.session.tokens = 0;
  await pi.turn('a5', 86_000);
  expect(pi.copies).toHaveLength(3);
});

test('pi\'s threshold compaction takes the ready copy, and an overflow is left to pi', async () => {
  const pi = await extension();
  await pi.turn('a1', 70_000);
  await pi.turn('a2', 90_000);
  pi.copies[0]!.resolve(SUMMARY);
  await Bun.sleep(0);
  const preparation = { tokensBefore: 95_000 };
  expect(await pi.emit('session_before_compact', { type: 'session_before_compact', reason: 'overflow', preparation })).toBeUndefined();
  expect(await pi.emit('session_before_compact', { type: 'session_before_compact', reason: 'threshold', preparation })).toEqual({
    compaction: { summary: 'earlier work', firstKeptEntryId: 'a2', tokensBefore: 95_000, usage: SUMMARY.usage, details: { ...SUMMARY.details, boiteBackground: true } },
  });
});

test('a copy is dropped when the context grew past the tail limit or no longer holds its anchor', async () => {
  const grown = await extension();
  await grown.turn('a1', 70_000);
  await grown.turn('a2', 86_000);
  grown.copies[0]!.resolve(SUMMARY);
  await Bun.sleep(0);
  // 25 000 tokens at most since the copy, the tail limit of a 100 000 limit.
  expect(await grown.turn('a3', 112_000)).toBeUndefined();

  const rewound = await extension();
  await rewound.turn('a1', 70_000);
  await rewound.turn('a2', 90_000);
  rewound.copies[0]!.resolve(SUMMARY);
  await Bun.sleep(0);
  rewound.session.entries = rewound.session.entries.filter(entry => !entry.id.startsWith('a2'));
  expect(await rewound.turn('a3', LIMIT)).toBeUndefined();
});

test('a copy still running after the timeout is stopped, and the limit goes on without it', async () => {
  const pi = await extension({ timeoutMs: 30 });
  await pi.turn('a1', 70_000);
  await pi.turn('a2', 90_000);
  const started = Date.now();
  expect(await pi.turn('a3', LIMIT)).toBeUndefined();
  expect(Date.now() - started).toBeLessThan(2_000);
  expect(pi.copies[0]!.signal.aborted).toBe(true);
});
