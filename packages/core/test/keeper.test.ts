import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { RpcEvents } from '@boite/contracts';
import { connect, type CoreClient } from '../src/client.ts';
import { Core } from '../src/core.ts';
import { ByteRing } from '../src/keeper/server.ts';
import { keeperEnabled } from '../src/keeper/client.ts';
import { startServer, type RunningServer } from '../src/server.ts';
import { threadTerminalId } from '../src/terminals.ts';
import { echoThread, removeDir, startTestCore, waitFor, type TestCore } from './harness.ts';

/** A shell with the user's profile can take a few seconds to draw its first prompt. */
const SHELL_MS = 20_000;

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function watch(client: CoreClient, id: string): { text: () => string; exited: () => boolean } {
  let text = '';
  let exited = false;
  client.on('terminal.output', (event: RpcEvents['terminal.output']) => { if (event.id === id) text += event.data; });
  client.on('terminal.exited', (event: RpcEvents['terminal.exited']) => { if (event.id === id) exited = true; });
  return { text: () => text, exited: () => exited };
}

/** What `main` does on a restart: drain, stop serving, close. */
async function restart(h: TestCore): Promise<void> {
  await h.core.drain();
  await h.server.stop();
  await h.core.close();
}

interface Next { core: Core; server: RunningServer; client: CoreClient }

async function startNext(h: TestCore): Promise<Next> {
  const core = new Core({ dataDir: h.dataDir, token: h.token, onShutdown: () => undefined });
  const server = startServer({ core, host: '127.0.0.1', port: 0 });
  const client = await connect(server.url, h.token);
  return { core, server, client };
}

const saved = { keeper: process.env.BOITE_KEEPER, idle: process.env.BOITE_KEEPER_IDLE_MS };
let keeperPids: number[] = [];
let shellPids: number[] = [];
let sockets: string[] = [];

beforeEach(() => {
  process.env.BOITE_KEEPER = '1';
  // The keeper this test starts goes away a second after its last shell.
  process.env.BOITE_KEEPER_IDLE_MS = '1000';
  keeperPids = [];
  shellPids = [];
  sockets = [];
});

afterEach(async () => {
  for (const [name, value] of [['BOITE_KEEPER', saved.keeper], ['BOITE_KEEPER_IDLE_MS', saved.idle]] as const) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
  // Only the pids this test captured: the shells first, then their keeper.
  for (const pid of shellPids) if (alive(pid)) process.kill(pid, 'SIGKILL');
  for (const pid of keeperPids) {
    await waitFor(() => !alive(pid), 5_000).catch(() => { if (alive(pid)) process.kill(pid, 'SIGKILL'); });
  }
  // A stopped keeper leaves its lock file: the next keeper of that directory takes it again.
  for (const socket of sockets) rmSync(`${socket}.lock`, { force: true });
}, 15_000);

describe.skipIf(!keeperEnabled({ BOITE_KEEPER: '1' }))('keeper', () => {
  test('a thread shell survives a core restart with what it printed meanwhile', async () => {
    const h = await startTestCore({ onShutdown: () => undefined });
    let next: Next | null = null;
    try {
      const client = await h.connect();
      const { threadId } = await echoThread(h, client);
      const id = threadTerminalId(threadId);
      const first = watch(client, id);
      await client.call('terminals.open', { threadId, cols: 80, rows: 24 });
      const pidFile = join(h.dataDir, 'shell.pid');
      // Arithmetic, so the typed command itself never matches what the test waits for.
      h.core.terminals.write(id, `echo $$ > ${pidFile}; echo before-$((40+2))\r`);
      await waitFor(() => first.text().includes('before-42'), SHELL_MS);
      const pid = Number(readFileSync(pidFile, 'utf8').trim());
      shellPids.push(pid);
      keeperPids.push(h.core.terminals.keeper!.keeperPid!);
      sockets.push(h.core.terminals.keeper!.socketPath);
      // Printed while no core is attached: only the keeper sees it.
      h.core.terminals.write(id, `(sleep 1; echo during-$((50+5))) &\r`);
      await Bun.sleep(100);

      await restart(h);
      expect(alive(pid)).toBe(true);
      await Bun.sleep(1_500);

      next = await startNext(h);
      const listed = await next.client.call('terminals.list', { threadId });
      expect(listed.map((terminal) => terminal.id)).toEqual([id]);
      const second = watch(next.client, id);
      const state = await next.client.call('terminals.open', { threadId, cols: 100, rows: 30 });
      expect(state.output).toContain('before-42');
      await waitFor(() => (state.output + second.text()).includes('during-55'), 5_000);
      // The same shell answers the next core's input.
      next.core.terminals.write(id, `echo $$-after-$((60+6))\r`);
      await waitFor(() => second.text().includes(`${pid}-after-66`), 5_000);

      await next.client.call('terminals.close', { id });
      await waitFor(() => !alive(pid), 5_000);
      expect(second.exited() || !next.core.terminals.has(id)).toBe(true);
    } finally {
      if (next !== null) {
        next.client.close();
        await next.server.stop();
        await next.core.close();
      }
      delete process.env.BOITE_DATA_DIR;
      await removeDir(h.dataDir);
    }
  }, 60_000);

  test('an explicit stop ends the shells the keeper holds', async () => {
    const h = await startTestCore({ onShutdown: () => undefined });
    try {
      const client = await h.connect();
      const { threadId } = await echoThread(h, client);
      const id = threadTerminalId(threadId);
      const out = watch(client, id);
      await client.call('terminals.open', { threadId, cols: 80, rows: 24 });
      const pidFile = join(h.dataDir, 'shell.pid');
      h.core.terminals.write(id, `echo $$ > ${pidFile}; echo up-$((1+1))\r`);
      await waitFor(() => out.text().includes('up-2') && existsSync(pidFile), SHELL_MS);
      const pid = Number(readFileSync(pidFile, 'utf8').trim());
      shellPids.push(pid);
      keeperPids.push(h.core.terminals.keeper!.keeperPid!);
      sockets.push(h.core.terminals.keeper!.socketPath);

      expect(h.core.requestShutdown(true)).toBe(true);
      await restart(h);
      await waitFor(() => !alive(pid), 5_000);
    } finally {
      delete process.env.BOITE_DATA_DIR;
      await removeDir(h.dataDir);
    }
  }, 60_000);
});

test('the keeper keeps the last bytes of a shell, whatever the chunks', () => {
  const ring = new ByteRing(8);
  ring.push(new TextEncoder().encode('abc'));
  ring.push(new TextEncoder().encode('defgh'));
  ring.push(new TextEncoder().encode('ijklmnopqrst'));
  expect(new TextDecoder().decode(ring.bytes())).toBe('mnopqrst');
  ring.push(new TextEncoder().encode('uv'));
  expect(new TextDecoder().decode(ring.bytes())).toBe('opqrstuv');
});
