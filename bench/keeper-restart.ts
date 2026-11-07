/** A thread shell across core restarts, with and without the keeper.
 * Run: bun bench/keeper-restart.ts [restarts=3]            (keeper off: what a restart did before)
 *      BOITE_KEEPER=1 bun bench/keeper-restart.ts [restarts=3]
 * Each round prints a marker, prints 64 KiB while no core is attached, then
 * restarts the core on the same data directory and opens the shell again.
 * Prints JSON: whether the shell's pid survived, the bytes of its output the
 * next core had, the time from the new core to `terminals.open` answering,
 * and the keeper's RSS while it holds the shell.
 */
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { connect } from '../packages/core/src/client.ts';
import { Core } from '../packages/core/src/core.ts';
import { startServer } from '../packages/core/src/server.ts';
import { threadTerminalId } from '../packages/core/src/terminals.ts';
import { echoThread, removeDir, startTestCore, waitFor } from '../packages/core/test/harness.ts';

const argument = process.argv.slice(2).find(value => /^\d+$/.test(value));
const restarts = Number(argument ?? 3);
assert(Number.isInteger(restarts) && restarts >= 1 && restarts <= 20);
const keeper = process.env.BOITE_KEEPER === '1';
process.env.BOITE_KEEPER_IDLE_MS = '1000';

const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };
const rssKiB = (pid: number): number | null => {
  try { return Number(/^VmRSS:\s+(\d+)/m.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))?.[1] ?? NaN); } catch { return null; }
};

const h = await startTestCore({ onShutdown: () => undefined });
let core = h.core;
let server = h.server;
let client = await h.connect();
const { threadId } = await echoThread(h, client);
const id = threadTerminalId(threadId);
const pidFile = join(h.dataDir, 'shell.pid');
let output = '';
const listen = () => client.on('terminal.output', (event) => { if (event.id === id) output += event.data; });
listen();
await client.call('terminals.open', { threadId, cols: 80, rows: 24 });
core.terminals.write(id, `echo $$ > ${pidFile}; echo ready-$((1+1))\r`);
await waitFor(() => output.includes('ready-2'), 20_000);
const pid = Number(readFileSync(pidFile, 'utf8').trim());
const keeperPid = core.terminals.keeper?.keeperPid ?? null;
const socketPath = core.terminals.keeper?.socketPath ?? null;
const shellPids = new Set([pid]);
const rounds: unknown[] = [];
try {
  for (let round = 0; round < restarts; round++) {
    const marker = `round-${round}`;
    // 64 KiB from a background job that starts after this core is gone.
    core.terminals.write(id, `(sleep 0.5; head -c 49152 /dev/zero | base64 -w 0; echo; echo ${marker}-$((7*6))) &\r`);
    await Bun.sleep(100);
    const stopAt = performance.now();
    await core.drain();
    await server.stop();
    await core.close();
    const stopMs = performance.now() - stopAt;
    const survived = alive(pid);
    await Bun.sleep(1_500);
    const keeperRss = keeperPid === null ? null : rssKiB(keeperPid);
    const startAt = performance.now();
    core = new Core({ dataDir: h.dataDir, token: h.token, onShutdown: () => undefined });
    server = startServer({ core, host: '127.0.0.1', port: 0 });
    client = await connect(server.url, h.token);
    output = '';
    listen();
    const listed = await client.call('terminals.list', { threadId });
    const state = await client.call('terminals.open', { threadId, cols: 80, rows: 24 });
    const reopenMs = performance.now() - startAt;
    core.terminals.write(id, `echo $$ > ${pidFile}\r`);
    await waitFor(() => readFileSync(pidFile, 'utf8').trim() !== '', 20_000);
    await Bun.sleep(200);
    shellPids.add(Number(readFileSync(pidFile, 'utf8').trim()));
    rounds.push({
      round, survived, listedBefore: listed.length, stopMs: Math.round(stopMs), reopenMs: Math.round(reopenMs),
      historyBytes: Buffer.byteLength(state.output), gapOutputKept: state.output.includes(`${marker}-42`), keeperRssKiB: keeperRss,
    });
  }
} finally {
  await client.call('terminals.close', { id }).catch(() => undefined);
  client.close();
  await server.stop();
  await core.close();
  for (const shell of shellPids) if (alive(shell)) process.kill(shell, 'SIGKILL');
  if (keeperPid !== null) await waitFor(() => !alive(keeperPid), 10_000).catch(() => { if (alive(keeperPid)) process.kill(keeperPid, 'SIGKILL'); });
  // A stopped keeper leaves its lock file behind.
  if (socketPath !== null) rmSync(`${socketPath}.lock`, { force: true });
  delete process.env.BOITE_DATA_DIR;
  await removeDir(h.dataDir);
}
console.log(JSON.stringify({ scenario: 'keeper-restart', keeper, restarts, shellPids: shellPids.size, rounds, platform: process.platform, bun: Bun.version }, null, 1));
