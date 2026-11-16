import { afterEach, beforeEach, expect, test } from 'bun:test';
import { setDriver } from '../src/drivers/index.ts';
import { echoDriver } from '../src/drivers/echo.ts';
import { FOCUS_DWELL_MS } from '../src/threads/focus.ts';
import { echoThread, startTestCore, waitFor, type TestCore } from './harness.ts';

let harness: TestCore;
let prepared: string[];
let restore: () => void;
beforeEach(async () => {
  harness = await startTestCore();
  prepared = [];
  restore = setDriver('echo', { ...echoDriver, prepare: async ctx => { prepared.push(ctx.thread.id); } });
});
afterEach(async () => { restore(); await harness.stop(); });

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function threads(count: number): Promise<{ client: Awaited<ReturnType<TestCore['connect']>>; ids: string[] }> {
  const client = await harness.connect();
  const ids: string[] = [];
  for (let i = 0; i < count; i++) ids.push((await echoThread(harness, client, `browse ${i}`)).threadId);
  return { client, ids };
}

test('browsing through threads prepares only the one the user stays on', async () => {
  // Arrowing through ten threads launched ten agents that lived 30 s for nothing.
  const { client, ids } = await threads(5);
  const started = performance.now();
  for (const threadId of ids) await client.call('threads.focus', { threadId });
  expect(performance.now() - started).toBeLessThan(FOCUS_DWELL_MS);
  expect(prepared).toEqual([]);
  await waitFor(() => prepared.length > 0, FOCUS_DWELL_MS + 2000);
  await pause(200);
  expect(prepared).toEqual([ids.at(-1)!]);
});

test('a thread left within the dwell prepares nothing', async () => {
  const { client, ids } = await threads(1);
  const threadId = ids[0]!;
  await client.call('threads.focus', { threadId });
  await client.call('threads.focus', { threadId: null });
  await pause(FOCUS_DWELL_MS + 300);
  expect(prepared).toEqual([]);
  expect(harness.core.procs.liveCount(threadId)).toBe(0);
});

test('protected input prepares without waiting, also when typed during the dwell', async () => {
  const { client, ids: [drafted, typed] } = await threads(2);
  await client.call('threads.focus', { threadId: drafted!, protectedThreadIds: [drafted!] });
  await waitFor(() => prepared.length === 1, FOCUS_DWELL_MS / 2);
  expect(prepared).toEqual([drafted!]);
  await client.call('threads.focus', { threadId: typed!, protectedThreadIds: [] });
  await pause(50);
  expect(prepared).toEqual([drafted!]);
  // The composer reports its first keystroke by focusing again with the thread protected.
  await client.call('threads.focus', { threadId: typed!, protectedThreadIds: [typed!] });
  await waitFor(() => prepared.length === 2, FOCUS_DWELL_MS / 2);
  expect(prepared).toEqual([drafted!, typed!]);
});

test('a thread another client already shows prepares without waiting', async () => {
  const { client, ids } = await threads(1);
  const threadId = ids[0]!;
  const other = await harness.connect();
  await client.call('threads.focus', { threadId });
  await other.call('threads.focus', { threadId });
  await waitFor(() => prepared.length === 1, FOCUS_DWELL_MS / 2);
  expect(prepared).toEqual([threadId]);
});
