import { afterEach, expect, test } from 'bun:test';
import { setDriver } from '../src/drivers/index.ts';
import type { TurnContext, TurnResult } from '../src/drivers/types.ts';
import { CAPACITY_RETRY } from '../src/threads/turn-attempts.ts';
import { echoThread, startTestCore, waitFor, type TestCore } from './harness.ts';

let h: TestCore;
let restore: (() => void) | undefined;
afterEach(async () => { await h?.stop(); restore?.(); restore = undefined; });

test.each([true, false])('Send now interrupts a running tool and starts the queued message (steering supported: %s)', async steering => {
  h = await startTestCore();
  const owner = await h.connect();
  const { threadId } = await echoThread(h, owner);
  const started: TurnContext[] = [];
  let stopped = 0, steered = 0;
  restore = setDriver('echo', { protocol: 'echo', startTurn(ctx) {
    started.push(ctx);
    if (started.length > 1) return { done: Promise.resolve({ status: 'done', sessionId: null, usage: null }), stop() {} };
    ctx.emit.part(ctx.emit.startMessage('assistant'), 0, { type: 'tool', toolId: 'slow-command', name: 'Bash', input: { command: 'long-running-command' }, status: 'running' });
    const done = Promise.withResolvers<TurnResult>();
    return { done: done.promise, stop() { stopped++; done.resolve({ status: 'stopped', sessionId: null, usage: null }); },
      ...(steering ? { async steer() { steered++; return true; } } : {}) };
  } });
  const original = await owner.call('turns.start', { threadId, prompt: 'Run the slow command' });
  await waitFor(() => started.length === 1);
  const input = { text: 'still typing', attachments: [], paused: false, queued: [{ id: 'urgent-followup', text: 'Handle this message now', attachments: [] }] };
  const saved = await owner.call('composer.put', { section: 'inputs', id: threadId, expectedRevision: 0, value: { input } });
  await owner.call('composer.put', { section: 'inputs', id: threadId, expectedRevision: saved.record.revision, value: { input }, sendNow: true });
  await waitFor(() => stopped === 1);
  expect(stopped).toBe(1);
  await waitFor(() => started.length === 2);
  expect(steered).toBe(0);
  expect(h.core.journal.getTurn(original.id)?.status).toBe('stopped');
  expect(started[1]?.prompt).toContain('Handle this message now');
  await waitFor(() => h.core.composer.storage.get('inputs', threadId).value?.input.queued.length === 0);
  expect(h.core.composer.storage.get('inputs', threadId).value?.input.text).toBe('still typing');
});

test('Send now interrupts a capacity retry without a native handle', async () => {
  const delays = CAPACITY_RETRY.delaysMs;
  CAPACITY_RETRY.delaysMs = [60_000];
  h = await startTestCore();
  try {
    const owner = await h.connect();
    const { threadId } = await echoThread(h, owner);
    const original = await owner.call('turns.start', { threadId, prompt: '[capacity:9] original work' });
    await waitFor(() => h.core.threads.runner.retryOf(threadId) !== null);
    expect(h.core.threads.runner.handles.has(threadId)).toBe(false);
    await owner.call('composer.put', { section: 'inputs', id: threadId, expectedRevision: 0, sendNow: true,
      value: { input: { text: '', attachments: [], paused: false, queued: [{ id: 'urgent-during-retry', text: 'Handle this request instead', attachments: [] }] } } });
    await waitFor(() => h.core.journal.getTurn(original.id)?.status === 'stopped', 1000);
    await waitFor(() => h.core.composer.storage.get('inputs', threadId).value?.input.queued.length === 0);
    expect(h.core.journal.listTurns(threadId)).toHaveLength(2);
    expect(h.core.journal.listMessages(threadId).filter(message => message.role === 'user').at(-1)?.parts[0]).toMatchObject({ text: 'Handle this request instead' });
  } finally { CAPACITY_RETRY.delaysMs = delays; }
});
