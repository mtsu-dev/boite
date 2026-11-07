import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ThreadId } from '@boite/contracts';
import { KeeperClient, keeperEnabled } from '../src/keeper/client.ts';
import { KEEPER_OUT_WINDOW_BYTES } from '../src/keeper/protocol.ts';
import { insertKeptProcess, keptProcesses } from '../src/journal/kept-processes.ts';
import { echoThread, removeDir, startTestCore, waitFor, type TestCore } from './harness.ts';

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/** The parent of `pid`, from `/proc`; null where there is none. */
function parentOf(pid: number): number | null {
  const file = `/proc/${pid}/stat`;
  if (!existsSync(file)) return null;
  // The command name in parentheses may hold spaces: the fields after it are fixed.
  const stat = readFileSync(file, 'utf8');
  return Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
}

/** The stdout `echo-agent.ts` writes for `text`: a `{"d"}` line per 16 characters, then `{"done"}`. */
function streamedBytes(text: string): number {
  let bytes = 0;
  for (let at = 0; at < text.length; at += 16) bytes += Buffer.byteLength(`${JSON.stringify({ d: text.slice(at, at + 16) })}\n`);
  return bytes + Buffer.byteLength(`${JSON.stringify({ done: true })}\n`);
}

/** Every committed text of the thread's messages, rows and streamed parts alike. */
function committedText(h: TestCore, threadId: string): string {
  const rows = h.core.journal.db.query(`SELECT parts AS json FROM messages WHERE thread_id = ?1
    UNION ALL SELECT json FROM streaming_parts WHERE thread_id = ?1`).all(threadId) as { json: string }[];
  return rows.map((row) => row.json).join('\n');
}

const saved = { keeper: process.env.BOITE_KEEPER, idle: process.env.BOITE_KEEPER_IDLE_MS };
let keeperPids: number[] = [];
let agentPids: number[] = [];
let sockets: string[] = [];
let harness: TestCore | null = null;

beforeEach(() => {
  process.env.BOITE_KEEPER = '1';
  // The keeper this test starts goes away a second after its core detached.
  process.env.BOITE_KEEPER_IDLE_MS = '1000';
  keeperPids = [];
  agentPids = [];
  sockets = [];
});

afterEach(async () => {
  await harness?.stop();
  harness = null;
  for (const [name, value] of [['BOITE_KEEPER', saved.keeper], ['BOITE_KEEPER_IDLE_MS', saved.idle]] as const) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
  // Only the pids this test captured: the agents first, then their keeper.
  for (const pid of agentPids) if (alive(pid)) process.kill(pid, 'SIGKILL');
  for (const pid of keeperPids) {
    await waitFor(() => !alive(pid), 5_000).catch(() => { if (alive(pid)) process.kill(pid, 'SIGKILL'); });
  }
  for (const socket of sockets) rmSync(`${socket}.lock`, { force: true });
}, 15_000);

/** A core with the keeper on, attached to it once its startup connect is done. */
async function keptCore(dataDir?: string): Promise<TestCore> {
  const h = await startTestCore({ onShutdown: () => undefined, ...(dataDir === undefined ? {} : { dataDir }) });
  harness = h;
  const keeper = h.core.terminals.keeper!;
  await waitFor(() => keeper.connected, 10_000);
  keeperPids.push(keeper.keeperPid!);
  sockets.push(keeper.socketPath);
  return h;
}

describe.skipIf(!keeperEnabled({ BOITE_KEEPER: '1' }))('agents on the keeper', () => {
  test('an echo turn runs through the keeper, its row and acks at what it streamed', async () => {
    const h = await keptCore();
    const client = await h.connect();
    const { threadId } = await echoThread(h, client);
    const keeper = h.core.terminals.keeper!;
    const before = 'hello from the kept agent';
    const after = ' and after';
    await client.call('turns.start', { threadId, prompt: `[process]${before}[sleep:2000]${after}` });

    // In the sleep: the first text is streamed and committed, the agent waits for the next.
    await waitFor(() => keptProcesses(h.core.journal.db)[0]?.offset === streamedBytes(before), 5_000);
    const [row] = keptProcesses(h.core.journal.db);
    agentPids.push(row!.pid);
    const turn = h.core.threads.get(threadId as ThreadId).turns.at(-1)!;
    expect(row).toMatchObject({ threadId, turnId: turn.id, kind: 'agent', driver: 'echo', keeperPid: keeper.keeperPid! });
    expect(alive(row!.pid)).toBe(true);
    const parent = parentOf(row!.pid);
    if (parent !== null) expect(parent).toBe(keeper.keeperPid!);
    expect(h.core.procs.liveOf(threadId as ThreadId).map((record) => record.pid)).toContain(row!.pid);
    const held = (await keeper.list()).find((info) => info.id === row!.procId);
    // Everything it printed was read, committed, and let go of by the keeper.
    expect(held?.out).toEqual({ acked: row!.offset, end: row!.offset });
    expect(committedText(h, threadId)).toContain(before);

    // The turn ends: the agent exits, its last offset is committed, and the keeper forgets it.
    await waitFor(() => h.core.threads.get(threadId as ThreadId).status === 'idle', 10_000);
    await waitFor(() => keptProcesses(h.core.journal.db).length === 0 && h.core.keptAgents!.size === 0, 5_000);
    expect((await keeper.list()).some((info) => info.id === row!.procId)).toBe(false);
    await waitFor(() => !alive(row!.pid), 5_000);
    expect(committedText(h, threadId)).toContain(`${before}${after}`);
    client.close();
  }, 30_000);

  test('stdout past the keeper\'s window goes on as its commits ack it', async () => {
    const h = await keptCore();
    const client = await h.connect();
    const { threadId } = await echoThread(h, client);
    // Half again the window: the agent blocks on its pipe unless commits ack what it read.
    const chars = Math.ceil(KEEPER_OUT_WINDOW_BYTES * 1.5);
    let sawRow = false;
    const seen = setInterval(() => {
      const [row] = keptProcesses(h.core.journal.db);
      if (row === undefined) return;
      sawRow = true;
      if (!agentPids.includes(row.pid)) agentPids.push(row.pid);
    }, 20);
    try {
      await client.call('turns.start', { threadId, prompt: `[flood:${chars}]` });
      await waitFor(() => h.core.threads.get(threadId as ThreadId).status === 'idle', 30_000);
    } finally { clearInterval(seen); }
    expect(sawRow).toBe(true);
    const text = h.core.journal.listMessages(threadId).filter((message) => message.role === 'assistant')
      .flatMap((message) => message.parts.flatMap((part) => part.type === 'text' ? [part.text] : [])).join('');
    expect(text.length).toBe(chars);
    await waitFor(() => keptProcesses(h.core.journal.db).length === 0, 5_000);
    client.close();
  }, 60_000);

  test('a keeper it cannot reach leaves the agent on the core\'s own pipes', async () => {
    const h = await keptCore();
    const client = await h.connect();
    const { threadId } = await echoThread(h, client);
    // Closed, the client reaches no keeper and starts none.
    h.core.terminals.keeper!.close();
    await client.call('turns.start', { threadId, prompt: '[process]on direct pipes' });
    await waitFor(() => h.core.threads.get(threadId as ThreadId).status === 'idle', 10_000);
    expect(keptProcesses(h.core.journal.db)).toEqual([]);
    expect(h.core.journal.listMessages(threadId).some((message) => message.parts.some((part) => part.type === 'text' && part.text === 'on direct pipes'))).toBe(true);
    const warned = await h.core.logs.query({ source: 'keeper', threadId, minLevel: 'warn' });
    expect(warned.some((log) => log.event === 'keeper.agent-direct')).toBe(true);
    client.close();
  }, 30_000);

  test('the next core ends what an earlier one left in the keeper and clears its rows', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'boite-kept-agents-'));
    try {
      const first = await keptCore(dataDir);
      insertKeptProcess(first.core.journal.db, { procId: 'p-left', keeperPid: 1, pid: 1, threadId: 'thr_gone', turnId: null, kind: 'agent', driver: 'echo', startedAt: Date.now() });
      await first.stop();
      harness = null;
      // What a core that stopped mid-turn leaves: an agent the keeper still runs.
      const earlier = new KeeperClient({ dataDir, log: () => undefined });
      const child = earlier.spawnPipe({ kind: 'agent', threadId: 'thr_gone' }, 'sleep', ['30'], { cwd: dataDir, env: process.env });
      expect(await child.ready).toBe(true);
      agentPids.push(child.pid!);
      earlier.close();
      expect(alive(child.pid!)).toBe(true);

      const next = await keptCore(dataDir);
      await next.core.terminals.ready;
      expect(keptProcesses(next.core.journal.db)).toEqual([]);
      await waitFor(() => !alive(child.pid!), 5_000);
    } finally {
      await harness?.stop();
      harness = null;
      await removeDir(dataDir);
    }
  }, 30_000);
});
