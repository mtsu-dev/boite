/** Synthetic owner requests, unchanged handlers and admission limits, no socket or provider. */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FrameQueue } from '../packages/core/src/server/frame-queue.ts';

const dir = mkdtempSync(join(tmpdir(), 'boite-frame-queue-bench-'));
const source = readFileSync(new URL('../packages/core/src/server/frame-queue.ts', import.meta.url), 'utf8');
const iteration = `let available: [ServerConnection, Pending] | undefined;
      for (const entry of this.#pending) {
        const connection = entry[0];
        if ((this.#activeByConnection.get(connection) ?? 0) < MAX_ACTIVE_PER_CONNECTION
          && (!fromAgent(connection) || this.#activeAgents < MAX_AGENT_ACTIVE)) { available = entry; break; }
      }`;
const copied = `const available = [...this.#pending].find(([connection]) => (this.#activeByConnection.get(connection) ?? 0) < MAX_ACTIVE_PER_CONNECTION
        && (!fromAgent(connection) || this.#activeAgents < MAX_AGENT_ACTIVE));`;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

async function run(Queue: typeof FrameQueue, connections: number) {
  const order: string[] = [];
  const queue = new Queue(async (connection, raw) => { order.push(connection.id + ':' + raw); });
  const clients = Array.from({ length: connections }, (_, id) => ({
    id: String(id), authenticated: true, identity: { principal: 'owner' },
    close() { throw new Error('unexpected refused request'); },
  }));
  const cpu = process.cpuUsage(), started = performance.now();
  await Promise.all(Array.from({ length: 4096 }, (_, i) => queue.enqueue(clients[i % connections] as never, String(i))));
  const wallMs = performance.now() - started, used = process.cpuUsage(cpu);
  assert.equal(order.length, 4096);
  assert.equal(new Set(order).size, 4096);
  assert.deepEqual(queue.counts, { active: 0, activeAgents: 0, detached: 0, detachedAgents: 0 });
  queue.close();
  return { wallMs, cpuMs: (used.user + used.system) / 1000, order };
}

try {
  // Use the same implementation except for the former Map-copy selection.
  assert.equal(source.split(iteration).length, 2, 'update the baseline splice after changing #pump');
  writeFileSync(join(dir, 'before.ts'), source.replace(iteration, copied));
  const { FrameQueue: Before } = await import(join(dir, 'before.ts')) as { FrameQueue: typeof FrameQueue };
  console.log(JSON.stringify({ date: new Date().toISOString(), bun: Bun.version, platform: process.platform }));
  for (const connections of [32, 256, 1024]) {
    const before: Awaited<ReturnType<typeof run>>[] = [], after: typeof before = [];
    for (let i = -1; i < 5; i++) {
      const first = await run(i % 2 === 0 ? Before : FrameQueue, connections);
      const second = await run(i % 2 === 0 ? FrameQueue : Before, connections);
      const a = i % 2 === 0 ? first : second, b = i % 2 === 0 ? second : first;
      assert.deepEqual(a.order, b.order);
      if (i >= 0) { before.push(a); after.push(b); }
    }
    console.log(JSON.stringify({ connections, requests: 4096, samples: 5,
      beforeWallMs: median(before.map(x => x.wallMs)), afterWallMs: median(after.map(x => x.wallMs)),
      beforeCpuMs: median(before.map(x => x.cpuMs)), afterCpuMs: median(after.map(x => x.cpuMs)),
      allRequestsAndOrderVerified: true }));
  }
} finally { rmSync(dir, { recursive: true, force: true }); }
