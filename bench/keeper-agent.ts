/** Agent output through the keeper against the core's own pipes.
 * Run: BOITE_KEEPER=1 bun bench/keeper-agent.ts [floodMiB=64] [samples=20]
 * One core with the keeper on. `procs.spawnChild` starts the echo driver's
 * child (`drivers/echo-agent.ts`) with `keep`, which goes to the keeper, and
 * without, which stays on the core's pipes. Measured for each:
 * - first byte: from `spawnChild` to the first stdout byte of a request
 *   written at once, the median of `samples` fresh processes;
 * - throughput: `floodMiB` of text read from one process, MiB/s, the median of
 *   three runs; through the keeper it needs the journal's commits to ack it;
 * - turn: an echo turn `[flood:N]` of 8 MiB, under the 16 MiB a message may
 *   hold, from `turns.start` to idle in a fresh thread, the median of three,
 *   with the keeper's spawner on and then off.
 * Prints JSON.
 */
import assert from 'node:assert/strict';
import type { ThreadId } from '../packages/contracts/src/index.ts';
import { echoAgentCommand } from '../packages/core/src/drivers/echo-process.ts';
import type { SpawnedChild } from '../packages/core/src/process-spawn-types.ts';
import { echoThread, startTestCore, waitFor } from '../packages/core/test/harness.ts';

assert(process.env.BOITE_KEEPER === '1', 'run with BOITE_KEEPER=1');
process.env.BOITE_KEEPER_IDLE_MS = '1000';
const numbers = process.argv.slice(2).filter(value => /^\d+$/.test(value)).map(Number);
const floodMiB = numbers[0] ?? 64;
const samples = numbers[1] ?? 20;
assert(floodMiB >= 1 && floodMiB <= 1024 && samples >= 3 && samples <= 200);

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
};
const round = (value: number, digits = 2): number => Number(value.toFixed(digits));

const h = await startTestCore({ onShutdown: () => undefined });
const client = await h.connect();
const keeper = h.core.terminals.keeper!;
await waitFor(() => keeper.connected, 10_000);
const keeperPid = keeper.keeperPid;
const { threadId } = await echoThread(h, client);
const thread = threadId as ThreadId;
const { cmd, args } = echoAgentCommand();
const DONE = `${JSON.stringify({ done: true })}\n`;
const TURN_CHARS = 8 * 1024 * 1024;

function start(kept: boolean): SpawnedChild {
  return h.core.procs.spawnChild(thread, cmd, args, { cwd: h.dataDir, env: process.env, ...(kept ? { keep: { turnId: null, driver: 'echo' } } : {}) });
}

async function finish(child: SpawnedChild): Promise<void> {
  const closed = new Promise<void>(resolve => child.once('close', () => resolve()));
  child.stdin.end();
  await closed;
}

async function firstByte(kept: boolean): Promise<number> {
  const at = performance.now();
  const child = start(kept);
  const first = new Promise<number>(resolve => child.stdout.once('data', () => resolve(performance.now() - at)));
  child.stdin.write(`${JSON.stringify({ text: 'x' })}\n`);
  const ms = await first;
  child.stdout.resume();
  await finish(child);
  return ms;
}

async function throughput(kept: boolean): Promise<number> {
  const child = start(kept);
  const chars = floodMiB * 1024 * 1024;
  let bytes = 0;
  let tail = '';
  const at = performance.now();
  const done = new Promise<number>(resolve => {
    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      tail = (tail + chunk.toString('latin1')).slice(-DONE.length);
      if (tail === DONE) resolve(performance.now() - at);
    });
  });
  child.stdin.write(`${JSON.stringify({ flood: chars })}\n`);
  const ms = await done;
  await finish(child);
  return bytes / (1024 * 1024) / (ms / 1000);
}

async function turn(kept: boolean): Promise<number> {
  const spawner = h.core.procs.keptSpawn;
  if (!kept) h.core.procs.keptSpawn = null;
  try {
    const fresh = (await echoThread(h, client, 'flood')).threadId;
    const at = performance.now();
    await client.call('turns.start', { threadId: fresh, prompt: `[flood:${TURN_CHARS}]` });
    await waitFor(() => h.core.journal.getThread(fresh)?.status === 'idle', 120_000);
    return performance.now() - at;
  } finally { h.core.procs.keptSpawn = spawner; }
}

const result: Record<string, unknown> = { date: new Date().toISOString(), bun: Bun.version, floodMiB, samples };
try {
  for (const kept of [false, true]) {
    const name = kept ? 'keeper' : 'direct';
    const first: number[] = [];
    for (let n = 0; n < samples; n++) first.push(await firstByte(kept));
    const rates: number[] = [];
    for (let n = 0; n < 3; n++) rates.push(await throughput(kept));
    const turns: number[] = [];
    for (let n = 0; n < 3; n++) turns.push(await turn(kept));
    result[name] = {
      firstByteMs: { median: round(median(first)), min: round(Math.min(...first)), max: round(Math.max(...first)) },
      throughputMiBs: { median: round(median(rates), 1), runs: rates.map(rate => round(rate, 1)) },
      turn8MiBMs: { median: Math.round(median(turns)), runs: turns.map(Math.round) },
    };
  }
  await waitFor(() => (h.core.keptAgents?.size ?? 0) === 0, 10_000);
} finally {
  client.close();
  await h.stop();
  // Only the keeper this bench's core started, once it had a second to go by itself.
  if (keeperPid !== null) {
    await waitFor(() => { try { process.kill(keeperPid, 0); return false; } catch { return true; } }, 5_000).catch(() => process.kill(keeperPid, 'SIGKILL'));
  }
}
console.log(JSON.stringify(result, null, 2));
