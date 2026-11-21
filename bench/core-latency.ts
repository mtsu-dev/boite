/**
 * Offline turn latency over a real core WebSocket. Run with `bun bench/core-latency.ts`.
 * `--help` lists selectors for reproducing and profiling an individual case.
 */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { availableParallelism, loadavg, platform, arch } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { RpcEvents, RpcParams, ThreadSummary } from '../packages/contracts/src/index.ts';
import type { CoreClient } from '../packages/core/src/client.ts';
import { createCodexDriver } from '../packages/core/src/drivers/codex.ts';
import { releaseThread, setDriver } from '../packages/core/src/drivers/index.ts';
import { startTestCore, waitFor, type TestCore } from '../packages/core/test/harness.ts';
import { writeScriptedProvider } from '../packages/core/test/scripted-provider.ts';
import { median, percentile } from './lib/report.ts';

const PROVIDERS = ['echo', 'scripted'] as const;
const CONCURRENCY = [1, 8, 32] as const;
const ENTRIES = [0, 2, 100, 1_000, 5_000] as const;
type Provider = (typeof PROVIDERS)[number];
type ThreadState = 'new' | 'cold' | 'warm';
const SCRIPTED_ID = 'core-latency-fixture';
const SCRIPTED_MODEL = 'fake-codex';
const SCRIPTED_OPEN_MS = 75;
const TIMEOUT_MS = 20_000;
const STEER = '@follow-up!';

interface Options {
  runs: number;
  providers: readonly Provider[];
  concurrency: readonly number[];
  entries: readonly number[];
  state?: ThreadState;
}

function readOptions(): Options {
  const { values } = parseArgs({ options: {
    help: { type: 'boolean' }, runs: { type: 'string', default: '5' }, provider: { type: 'string' },
    concurrency: { type: 'string' }, entries: { type: 'string' }, state: { type: 'string' },
  } });
  if (values.help) {
    console.log('bun bench/core-latency.ts [--runs 5] [--provider echo|scripted] [--concurrency 1|8|32] [--entries 0|2|100|1000|5000] [--state new|cold|warm]');
    process.exit(0);
  }
  const runs = Number(values.runs);
  const concurrency = values.concurrency === undefined ? CONCURRENCY : [Number(values.concurrency)];
  const entries = values.entries === undefined ? ENTRIES : [Number(values.entries)];
  const provider = PROVIDERS.find(name => name === values.provider);
  const state = (['new', 'cold', 'warm'] as const).find(name => name === values.state);
  assert(Number.isSafeInteger(runs) && runs > 0, '--runs must be a positive integer');
  assert(concurrency.every(value => CONCURRENCY.some(n => n === value)), '--concurrency must be 1, 8 or 32');
  assert(entries.every(value => ENTRIES.some(n => n === value)), '--entries must be 0, 2, 100, 1000 or 5000');
  assert(values.provider === undefined || provider !== undefined, '--provider must be echo or scripted');
  assert(values.state === undefined || state !== undefined, '--state must be new, cold or warm');
  assert(state === undefined || entries.some(n => (state === 'new') === (n === 0)), 'new needs zero entries, cold and warm need existing history');
  return { runs, providers: provider ? [provider] : PROVIDERS, concurrency, entries, state };
}

type Creation = RpcParams<'threads.create'>;
interface Fixture { core: TestCore['core']; client: CoreClient; creation: Creation; provider: Provider }

async function fixture(harness: TestCore, provider: Provider): Promise<Fixture> {
  const client = await harness.connect();
  const path = join(harness.dataDir, 'workspace');
  await mkdir(path);
  const project = await client.call('projects.add', { path, name: 'Latency fixture' });
  const { core } = harness;
  const common = { projectId: project.id, title: 'Latency fixture' };
  if (provider === 'echo') {
    const account = (await client.call('accounts.list', {})).find(value => value.providerId === 'echo');
    assert(account, 'echo was not available');
    return { core, client, provider, creation: { ...common, providerId: 'echo', accountId: account.id } };
  }
  writeScriptedProvider(harness.dataDir, fileURLToPath(new URL('../packages/core/test/fixtures/codex-server.ts', import.meta.url)), {
    id: SCRIPTED_ID, schemaVersion: 1, name: 'Offline latency fixture', shortName: 'Latency',
    protocol: 'codex-appserver', roots: ['{isolationDir}'], auth: { kind: 'none' },
    models: [{ id: SCRIPTED_MODEL, name: 'Scripted model', default: true }],
    capabilities: { approvals: true, hooks: false, checkpoint: false, images: true, planMode: false, resume: true },
  });
  const catalog = await client.call('providers.reload', {});
  assert(catalog.loaded.some(value => value.id === SCRIPTED_ID && value.available), 'scripted agent was not available');
  const account = await client.call('accounts.add', { providerId: SCRIPTED_ID, label: 'Latency', useDefaultLocation: true });
  return { core, client, provider, creation: { ...common, providerId: SCRIPTED_ID, accountId: account.id, model: SCRIPTED_MODEL } };
}

/** One short text pair per completed turn. Seed before warming so row order matches time. */
function seedHistory({ core }: Fixture, thread: ThreadSummary, entries: number): void {
  const threadId = thread.id;
  const firstAt = Date.now() - entries - 1_000;
  core.journal.db.transaction(() => {
    for (let i = 0; i < entries; i += 2) {
      const id = `bench-turn-${threadId}-${i}`;
      const at = firstAt + i;
      core.journal.putTurn({
        id, threadId, status: 'done', queuedAt: at, startedAt: at, finishedAt: at + 1, error: null,
        execution: { providerId: thread.providerId, accountId: thread.accountId, model: thread.model, effort: thread.effort,
          permissionMode: thread.permissionMode, sessionId: null, sessionGeneration: 0, selectionVersion: 0 },
        usage: { inputTokens: 64, outputTokens: 64, cacheReadTokens: 0, cacheWriteTokens: 0, costUsdEquivalent: null },
      });
      for (const [offset, role] of (['user', 'assistant'] as const).entries()) {
        core.journal.putMessage({ id: `bench-message-${threadId}-${i + offset}`, threadId, turnId: id, role,
          state: 'complete', createdAt: at + offset, parts: [{ type: 'text', text: `${role} ${i}: ${'An earlier message in the conversation. '.repeat(7)}` }] });
      }
    }
  })();
}

async function existingThread(fixture: Fixture, entries: number, state: 'cold' | 'warm'): Promise<ThreadSummary> {
  const { client, core, creation, provider } = fixture;
  const made = await client.call('threads.create', { ...creation, subscribe: true });
  const threadId = made.id;
  // Existing conversations have already been named. Keep title work out of history setup.
  await client.call('threads.update', { threadId, title: 'Latency history' });
  seedHistory(fixture, made, entries - 2);
  const [finished, idle, accepted] = await Promise.all([
    client.next('turn.finished', row => row.threadId === threadId, TIMEOUT_MS),
    client.next('thread.updated', row => row.id === threadId && row.status === 'idle', TIMEOUT_MS),
    client.call('turns.start', { threadId, prompt: 'Warm-up exchange' }),
  ]);
  assert(finished.id === accepted.id && finished.status === 'done' && idle.sessionId !== null, 'warm-up did not establish a session');
  const count = core.journal.db.query<{ n: number }, [string]>('SELECT COUNT(*) AS n FROM messages WHERE thread_id = ?').get(threadId);
  assert.equal(count?.n, entries, 'wrong number of entries before send');
  if (provider === 'scripted' && state === 'cold') {
    releaseThread(threadId);
    await waitFor(() => core.procs.liveCount(threadId) === 0, TIMEOUT_MS);
  }
  assert.equal(core.procs.liveCount(threadId), provider === 'scripted' && state === 'warm' ? 1 : 0, `unexpected retained process in ${state} fixture`);
  return idle;
}

async function streamingLoad({ core, client, creation, provider }: Fixture, concurrency: number) {
  const frames = new Map<string, number>();
  const off = core.bus.onAny((name, value) => {
    if (name !== 'message.delta') return;
    const { threadId } = value as RpcEvents['message.delta'];
    const count = frames.get(threadId);
    if (count !== undefined) frames.set(threadId, count + 1);
  });
  const threads = await Promise.all(Array.from({ length: concurrency - 1 }, () => client.call('threads.create', creation)));
  const prompt = provider === 'echo' ? 'background load '.repeat(8_192) : '[latency-stream]';
  for (const { id } of threads) frames.set(id, 0);
  await Promise.all(threads.map(({ id }) => client.call('turns.start', { threadId: id, prompt })));
  const ready = (): boolean => [...frames].every(([threadId, count]) => count > 0 && core.threads.runner.handles.has(threadId));
  await waitFor(ready, TIMEOUT_MS);
  return {
    ids: frames,
    count: () => [...frames.values()].reduce((sum, count) => sum + count, 0),
    assertActive: () => assert(ready(), `expected ${concurrency - 1} background threads still streaming`),
    async stop() {
      off();
      await Promise.all(threads.map(({ id }) => client.call('turns.stop', { threadId: id })));
    },
  };
}

function observeText(client: CoreClient, threadId: string) {
  const messages = new Set<string>();
  const parts = new Map<string, Set<number>>();
  const offStart = client.on('message.started', row => {
    if (row.threadId === threadId && row.role === 'assistant') messages.add(row.id);
  });
  const offPart = client.on('message.part', row => {
    if (row.threadId !== threadId || !messages.has(row.messageId) || row.part.type !== 'text') return;
    const indexes = parts.get(row.messageId) ?? new Set<number>();
    indexes.add(row.partIndex);
    parts.set(row.messageId, indexes);
  });
  return {
    next: (predicate: (text: string) => boolean) => client.next('message.delta', row =>
      row.threadId === threadId && parts.get(row.messageId)?.has(row.partIndex) === true && predicate(row.text), TIMEOUT_MS).then(() => performance.now()),
    close: () => { offStart(); offPart(); },
  };
}

async function sample(fixture: Fixture, state: ThreadState, entries: number, load: Awaited<ReturnType<typeof streamingLoad>>) {
  const { client, creation, core, provider } = fixture;
  const existing = state === 'new' ? null : await existingThread(fixture, entries, state);
  const warmPid = existing ? core.procs.liveOf(existing.id)[0]?.pid : undefined;
  const prompt = provider === 'echo' ? 'First streamed text. [sleep:24]'.repeat(160) : '[latency-stream]';
  load.assertActive();
  const trafficBefore = load.count();
  const send = performance.now();
  const thread = existing ?? await client.call('threads.create', { ...creation, subscribe: true, clientRequestId: crypto.randomUUID() });
  const createdAt = existing ? null : performance.now();
  const threadId = thread.id;
  const text = observeText(client, threadId);
  try {
    const [firstTextAt, startedAt, { id: turnId, at: acceptedAt }] = await Promise.all([
      text.next(value => value.length > 0),
      client.next('turn.started', row => row.threadId === threadId, TIMEOUT_MS).then(() => performance.now()),
      client.call('turns.start', { threadId, prompt, clientRequestId: crypto.randomUUID(), expectedSelectionVersion: thread.selectionVersion ?? 0 })
        .then(turn => ({ id: turn.id, at: performance.now() })),
    ]);
    const processes = core.procs.liveOf(threadId);
    assert.equal(processes.length, provider === 'scripted' ? 1 : 0, 'incorrect agent process count at first text');
    const agent = processes[0];
    if (warmPid !== undefined) assert.equal(agent?.pid, warmPid, 'the warm turn replaced its agent process');
    const steer = performance.now();
    const [{ accepted, at: steerAck }, action] = await Promise.all([
      client.call('turns.steer', { threadId, turnId, prompt: STEER, clientRequestId: crypto.randomUUID(), expectedSelectionVersion: thread.selectionVersion ?? 0 })
        .then(value => ({ ...value, at: performance.now() })),
      text.next(value => value.includes(STEER)),
    ]);
    assert(accepted, 'the driver did not acknowledge the steer');
    const stop = performance.now();
    const [{ finished, at: finishedAt }, idleAt, exitedAt, { stopped, at: stopAck }] = await Promise.all([
      client.next('turn.finished', row => row.id === turnId, TIMEOUT_MS).then(finished => ({ finished, at: performance.now() })),
      client.next('thread.updated', row => row.id === threadId && row.status === 'idle', TIMEOUT_MS).then(() => performance.now()),
      agent ? client.next('process.exited', row => row.threadId === threadId && row.pid === agent.pid, TIMEOUT_MS).then(() => performance.now()) : null,
      client.call('turns.stop', { threadId }).then(value => ({ ...value, at: performance.now() })),
    ]);
    assert(stopped && finished.status === 'stopped', `unexpected stop result: ${JSON.stringify(finished.error)}`);
    load.assertActive();
    return {
      createMs: createdAt === null ? null : createdAt - send, acceptMs: acceptedAt - send, startedMs: startedAt - send, firstTextMs: firstTextAt - send,
      steerAckMs: steerAck - steer, steerActionMs: action - steer,
      stopAckMs: stopAck - stop, stoppedMs: finishedAt - stop, idleMs: idleAt - stop,
      processExitMs: exitedAt === null ? null : exitedAt - stop, stoppedAndIdleMs: Math.max(finishedAt, idleAt, exitedAt ?? 0) - stop,
      backgroundDeltas: load.count() - trafficBefore,
    };
  } finally {
    text.close();
    releaseThread(threadId);
    await client.call('threads.unsubscribe', { threadId });
    await waitFor(() => core.procs.liveCount(threadId) === 0, TIMEOUT_MS);
  }
}

type Sample = Awaited<ReturnType<typeof sample>>;
const METRICS = ['createMs', 'acceptMs', 'startedMs', 'firstTextMs', 'steerAckMs', 'steerActionMs', 'stopAckMs', 'stoppedMs', 'idleMs',
  'processExitMs', 'stoppedAndIdleMs', 'backgroundDeltas'] as const;

async function runGroup(provider: Provider, concurrency: number, options: Options) {
  const loadBefore = loadavg();
  const harness = await startTestCore({ settings: { warmProcessMinutes: 5, promptSuggestions: false } });
  try {
    const context = await fixture(harness, provider);
    const load = await streamingLoad(context, concurrency);
    let leaked = 0;
    const unlisten = context.client.on('message.delta', row => { if (load.ids.has(row.threadId)) leaked++; });
    const rows = [];
    try {
      for (const entries of options.entries) {
        const states = entries === 0 ? ['new'] as const : ['cold', 'warm'] as const;
        const samples = new Map<ThreadState, Sample[]>();
        for (const state of states) if (options.state === undefined || state === options.state) samples.set(state, []);
        for (let i = 0; i < options.runs; i++) {
          const ordered = i % 2 ? [...samples].reverse() : samples;
          for (const [state, values] of ordered) values.push(await sample(context, state, entries, load));
        }
        for (const [state, values] of samples) {
          const stats = METRICS.map(metric => {
            const measured = values.map(value => value[metric]).filter((value): value is number => value !== null);
            return [metric, measured.length === 0 ? null : { p50: median(measured), p95: percentile(measured, 0.95) }];
          });
          rows.push({ state, entries, stats: Object.fromEntries(stats), samples: values });
        }
      }
      assert.equal(leaked, 0, 'the foreground client received an unsubscribed background delta');
      return { provider, concurrency, loadBefore, loadAfter: loadavg(), backgroundDeltas: load.count(), backgroundDeltasOnClient: leaked, rows };
    } finally {
      unlisten();
      await load.stop();
    }
  } finally {
    await harness.stop();
    assert.equal(harness.core.procs.liveThreads().length, 0, 'the fixture left a tracked process running');
  }
}

const options = readOptions();
assert(!Object.entries(process.env).some(([name, value]) => value === '1' && /^(BOITE_E2E_|BOITE_BENCH_CLAUDE$|BOITE_BENCH_HOST_AGENTS$)/.test(name)), 'clear the live-agent opt-ins before running the offline bench');
for (const name of Object.keys(process.env)) if (name.startsWith('CODEX_FAKE_')) delete process.env[name];
process.env.CODEX_FAKE_SLOW_START = String(SCRIPTED_OPEN_MS);
const driver = createCodexDriver();
driver.title = undefined; // A separate title turn would add another native agent to the load.
const restore = setDriver('codex-appserver', driver);
const date = new Date().toISOString();
try {
  const groups = [];
  for (const provider of options.providers) {
    for (const concurrency of options.concurrency) {
      console.error(`Measuring ${provider} at ${concurrency} active thread(s)`);
      groups.push(await runGroup(provider, concurrency, options));
    }
  }
  console.log(JSON.stringify({ date, host: { platform: platform(), arch: arch(), cpus: availableParallelism(), bun: Bun.version },
    runs: options.runs, scriptedOpenMs: SCRIPTED_OPEN_MS, groups }, null, 2));
} finally {
  restore();
}
