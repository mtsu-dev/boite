/**
 * What one agent turn costs a phone on the wire, for each recorded agent
 * (docs/internals/ci.md#thread-transfer). Each fixture of `fixtures/` replays
 * through the real driver: Claude's SDK messages through a scripted query,
 * Codex and OpenCode's output through the fake app-server and the fake ACP
 * agent. A phone, a client the core serves as remote, opens the thread through
 * a relay that counts bytes, watches the turn, then a second phone reopens
 * the finished thread.
 *
 *   bun bench/transfer/measure.ts [--runs 5] [--out report.json]
 *
 * Bytes, never times. Ids come from a seeded generator and the clock stands
 * still. The pacing timers that join deltas are held (`HeldClock`): text
 * joins until the next event, as from an agent faster than any pacing window,
 * however the agent's output was split on its way in. What still belongs to the machine (the data folder's path, process
 * ids, memory) is taken out of each frame before it is counted, and each
 * frame's size on the wire is computed the way the core's socket compresses
 * it (`wireBytes`), a computation checked against the relay's count of every
 * phase. `--runs` measures that many times and fails when two runs differ.
 */
import { writeFileSync } from 'node:fs';
import { constants, deflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { FOLDED_CHANNELS, HELLO_ACCEPTED, INITIAL_MESSAGE_PAGE, INITIAL_PAGE_BYTES, lightPageFlags, type RpcMethods, type ThreadId } from '../../packages/contracts/src/index.ts';
import { connect, type CoreClient } from '../../packages/core/src/client.ts';
import { setPacingClock, type PacingClock } from '../../packages/core/src/pacing.ts';
import { scripted, type FakeQuery } from '../../packages/core/test/fixtures/claude-query.ts';
import { claudeReplay } from '../../packages/core/test/fixtures/replay.ts';
import { scriptedClaude, startTestCore, type TestCore } from '../../packages/core/test/harness.ts';
import { startWire, type Wire } from '../lib/wire.ts';
import { PROVIDERS, fixturePath, readFixture, type ProviderName } from './fixture.ts';

/** One provider's numbers. Bytes are what reached the phone, compressed on the wire unless `Decoded`. */
export interface TransferMetrics {
  /** Opening the empty thread, the live turn and reopening the finished thread. */
  total: number;
  /** Reopening the finished thread from a phone that never saw it. */
  snapshot: number;
  /** The live turn, from the prompt to the quiet after its end. */
  liveWire: number;
  /** The same frames as text, before compression. */
  liveDecoded: number;
  /** WebSocket messages of the live turn. */
  liveMessages: number;
}

const CODEX_SERVER = fileURLToPath(new URL('../../packages/core/test/fixtures/codex-server.ts', import.meta.url));
const ACP_AGENT = fileURLToPath(new URL('../../packages/core/test/fixtures/acp-agent.ts', import.meta.url));
/** A phone: the core paces and compresses for a Host that is not its loopback. */
const PHONE = { headers: { host: 'phone.transfer.test' }, client: { name: 'bench' as const, version: 'transfer' }, accepts: [...HELLO_ACCEPTED], timeoutMs: 20_000 };
/** No frame for this long, and no pacing timer left: the phase has sent everything. */
const QUIET_MS = 600;
const TURN_MS = 60_000;
/** Where the frozen clock stands: any fixed instant gives fixed digits. */
const CLOCK = Date.UTC(2026, 0, 1);
/**
 * Events about the machine rather than the thread: a log line whose moment
 * depends on when an agent's session closes, the processes it started, with
 * their ids and paths, and the load samples taken on a timer while they run.
 * Their bytes are the runner's, not the code's.
 */
const MACHINE_EVENTS = /^\{"jsonrpc":"2\.0","method":"(?:core\.log|process\.[A-Za-z]+|thread\.load)"/;
/**
 * Bytes one text frame from the core takes on the wire, header included. Bun
 * deflates each frame alone with zlib and a sync flush, whose 4-byte tail
 * permessage-deflate leaves off (RFC 7692). Frames from the core are never
 * masked.
 */
export function wireBytes(frame: string): number {
  const payload = deflateRawSync(Buffer.from(frame), { finishFlush: constants.Z_SYNC_FLUSH }).byteLength - 4;
  return payload + 2 + (payload >= 65_536 ? 8 : payload >= 126 ? 2 : 0);
}

/**
 * `frame` as the same core would send it on any machine, or null for a
 * machine event. The data folder, where the thread's project lives, becomes
 * `/data`; the memory and CPU an agent process used become 0.
 */
export function machineless(frame: string, dataDir: string): string | null {
  if (MACHINE_EVENTS.test(frame)) return null;
  const escaped = JSON.stringify(dataDir).slice(1, -1);
  return frame
    .replaceAll(escaped, '/data')
    .replace(/"memoryBytes":\d+/g, '"memoryBytes":0')
    .replace(/"cpuPercent":[\d.]+/g, '"cpuPercent":0');
}

/** The same ids every run: `newId` and `randomUUID` draw from here. */
function seedRandom(seed: number): () => void {
  const real = { getRandomValues: crypto.getRandomValues, randomUUID: crypto.randomUUID };
  let state = seed >>> 0;
  const byte = () => {
    // xorshift32
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    return state & 0xff;
  };
  crypto.getRandomValues = (<T extends ArrayBufferView | null>(array: T): T => {
    if (array) {
      const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
      for (let index = 0; index < bytes.length; index++) bytes[index] = byte();
    }
    return array;
  }) as typeof crypto.getRandomValues;
  crypto.randomUUID = () => {
    const hex = Array.from({ length: 16 }, byte).map((value) => value.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}` as ReturnType<typeof crypto.randomUUID>;
  };
  return () => Object.assign(crypto, real);
}

/** The real Codex or OpenCode descriptor, started as the fake agent that replays the fixture. */
function replayAgent(harness: TestCore, provider: 'codex' | 'opencode'): void {
  const descriptor = harness.core.providers.require(provider);
  descriptor.auth = { kind: 'none' };
  for (const profile of Object.values(descriptor.profiles)) {
    if (!profile) continue;
    profile.executable = [{ kind: 'file', value: process.execPath }];
    profile.launch = { args: [provider === 'codex' ? CODEX_SERVER : ACP_AGENT] };
    delete profile.update;
    delete profile.install;
    delete profile.close;
  }
  process.env[provider === 'codex' ? 'CODEX_FAKE_REPLAY' : 'ACP_FAKE_REPLAY'] = fixturePath(provider);
}

async function thread(harness: TestCore, owner: CoreClient, provider: ProviderName): Promise<ThreadId> {
  const project = await owner.call('projects.add', { path: harness.dataDir, name: 'transfer' });
  const account = await owner.call('accounts.add', { providerId: provider, label: 'transfer' });
  if (provider === 'claude') {
    if (account.isolationDir === null) throw new Error('claude: the replay account must be isolated');
    writeFileSync(`${account.isolationDir}/.credentials.json`, '{}');
  }
  const checked = await owner.call('accounts.check', { accountId: account.id });
  if (checked.status !== 'ok') throw new Error(`${provider}: the replay account reads as ${checked.status}`);
  const created = await owner.call('threads.create', { projectId: project.id, providerId: provider, accountId: account.id, title: 'transfer', permissionMode: 'bypassPermissions' });
  // A title the user typed: the finished turn asks the agent for none, so the only turn replayed is the fixture's.
  await owner.call('threads.update', { threadId: created.id, title: 'transfer' });
  return created.id;
}

/**
 * How the app opens a thread on a phone (`thread-preload.ts`): the first page
 * stripped like the app's (`lightPageFlags`), its subscription narrowed to the
 * folded channels, and the read mark, in one call.
 */
function openParams(phone: CoreClient, threadId: ThreadId): RpcMethods['threads.get']['params'] {
  const features = phone.core.features;
  return {
    threadId,
    limit: INITIAL_MESSAGE_PAGE,
    maxBytes: INITIAL_PAGE_BYTES,
    ...lightPageFlags(features),
    ...(features?.threadSnapshots ? { sync: true, open: { markRead: true } } : {}),
    ...(features?.streamChannels ? { channels: [...FOLDED_CHANNELS] } : {}),
  } as RpcMethods['threads.get']['params'];
}

/**
 * Pacing timers (`pacing.ts`) that fire only on `release`, oldest first:
 * deltas join until the next event or the end of a phase, so the frames a
 * phone gets follow the order of the agent's output, never the runner's speed.
 */
class HeldClock implements PacingClock {
  readonly #timers = new Map<number, () => void>();
  #next = 0;
  set(fire: () => void): number {
    this.#timers.set(++this.#next, fire);
    return this.#next;
  }
  clear(handle: unknown): void {
    this.#timers.delete(handle as number);
  }
  get pending(): number {
    return this.#timers.size;
  }
  /** Fires every pending timer, and any they set, oldest first. */
  release(): void {
    for (const [id, fire] of this.#timers) {
      this.#timers.delete(id);
      fire();
    }
  }
}

/** The frames phones received since the relay last counted, and what the relay counted. */
class Phase {
  frames: string[] = [];
  constructor(private readonly relay: Wire, private readonly harness: TestCore, readonly name: string) { relay.reset(); }

  /** The frames as any machine would carry them, after checking `wireBytes` against the relay. */
  close(): string[] {
    const counted = this.relay.read().down;
    const computed = this.frames.reduce((sum, frame) => sum + wireBytes(frame), 0);
    if (computed !== counted) throw new Error(`${this.name}: the relay counted ${counted} bytes, wireBytes computes ${computed}: the core's socket no longer compresses the way wireBytes says`);
    return this.frames.map((frame) => machineless(frame, this.harness.dataDir)).filter((frame) => frame !== null);
  }
}

const sum = (frames: string[], size: (frame: string) => number): number => frames.reduce((total, frame) => total + size(frame), 0);

/** One measurement of `provider` on a fresh core, with the generator seeded the same way each time. */
export async function measureProvider(provider: ProviderName): Promise<TransferMetrics> {
  const unseed = seedRandom(0x5eed);
  const realNow = Date.now;
  Date.now = () => CLOCK;
  const pacing = new HeldClock();
  setPacingClock(pacing);
  // A load sample comes on a timer and cuts the stream it lands in.
  const harness = await startTestCore({ loadSampling: false });
  const relay = startWire(harness.server.port);
  const clients: CoreClient[] = [];
  let phase: Phase | null = null;
  const phone = async (): Promise<CoreClient> => {
    const client = await connect(relay.url, harness.token, { ...PHONE, onFrame: (raw) => phase?.frames.push(raw) });
    clients.push(client);
    return client;
  };
  const quiet = async (): Promise<void> => {
    for (let seen = -1; seen !== phase!.frames.length || pacing.pending > 0;) {
      pacing.release();
      seen = phase!.frames.length;
      await Bun.sleep(QUIET_MS);
    }
  };
  try {
    if (provider === 'claude') {
      scriptedClaude(harness);
      const messages = claudeReplay(fixturePath('claude'));
      scripted(() => {}, (fake: FakeQuery) => { for (const message of messages) fake.emit(message as never); });
    } else {
      replayAgent(harness, provider);
    }
    const owner = await harness.connect();
    clients.push(owner);
    const threadId = await thread(harness, owner, provider);

    const watcher = await phone();
    phase = new Phase(relay, harness, `${provider} open`);
    await watcher.call('threads.get', openParams(watcher, threadId));
    await quiet();
    const opened = phase.close();

    phase = new Phase(relay, harness, `${provider} turn`);
    const finished = watcher.next('turn.finished', (turn) => turn.threadId === threadId, TURN_MS);
    await watcher.call('turns.start', { threadId, prompt: readFixture(provider).header.prompt });
    const done = await finished;
    if (done.status !== 'done') throw new Error(`${provider}: the replayed turn ended ${done.status}: ${JSON.stringify(done.error)}`);
    await quiet();
    const live = phase.close();

    phase = null;
    const reader = await phone();
    phase = new Phase(relay, harness, `${provider} reopen`);
    const reopened = await reader.call('threads.get', openParams(reader, threadId));
    if (!reopened.messages.some((message) => message.role === 'assistant')) throw new Error(`${provider}: the reopened thread holds no answer`);
    await quiet();
    const snapshot = phase.close();

    const liveWire = sum(live, wireBytes);
    return {
      total: sum(opened, wireBytes) + liveWire + sum(snapshot, wireBytes),
      snapshot: sum(snapshot, wireBytes),
      liveWire,
      liveDecoded: sum(live, (frame) => Buffer.byteLength(frame)),
      liveMessages: live.length,
    };
  } finally {
    phase = null;
    for (const client of clients) client.close();
    relay.stop();
    await harness.stop();
    setPacingClock(null);
    Date.now = realNow;
    unseed();
  }
}

/** Every provider once, in the order of `PROVIDERS`. */
export async function measureAll(): Promise<Record<ProviderName, TransferMetrics>> {
  const out = {} as Record<ProviderName, TransferMetrics>;
  for (const provider of PROVIDERS) out[provider] = await measureProvider(provider);
  return out;
}

if (import.meta.main) {
  const option = (name: string): string | undefined => {
    const at = process.argv.indexOf(`--${name}`);
    return at < 0 ? undefined : process.argv[at + 1];
  };
  const runs = Number(option('runs') ?? '1');
  if (!Number.isSafeInteger(runs) || runs < 1) throw new Error(`--runs: ${option('runs')}, expected a positive integer`);
  const results: Record<ProviderName, TransferMetrics>[] = [];
  for (let run = 0; run < runs; run++) results.push(await measureAll());
  const first = JSON.stringify(results[0]);
  const differing = results.findIndex((result) => JSON.stringify(result) !== first);
  const out = option('out');
  if (out) writeFileSync(out, `${JSON.stringify(results[0], null, 2)}\n`);
  console.log(JSON.stringify({ runs, identical: differing < 0, metrics: results[0] }, null, 2));
  if (differing >= 0) {
    console.error(`run ${differing + 1} differs from run 1:\n${JSON.stringify(results[differing])}\n${first}`);
    process.exit(1);
  }
}
