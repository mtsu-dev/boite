import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { AGENT_ENV, AGENT_METHODS, DEVICE_METHODS, RpcErrorCode, type ComposerValue } from '@boite/contracts';
import { runCli } from '../src/cli.ts';
import { connect, type CoreClient } from '../src/client.ts';
import { setDriver } from '../src/drivers/index.ts';
import type { TurnResult } from '../src/drivers/types.ts';
import { newId } from '../src/ids.ts';
import { echoThread, startTestCore, waitFor, type TestCore } from './harness.ts';

let h: TestCore;
let client: CoreClient;
let restore: (() => void) | undefined;
beforeEach(async () => {
  h = await startTestCore();
  client = await h.connect();
});
afterEach(async () => {
  restore?.();
  restore = undefined;
  await h.stop();
});

/** An echo agent answering `reply <prompt>`; a prompt with `[hold]` keeps its turn running until `release()`. */
function holdingEcho(): { release: () => void } {
  let release = (): void => {};
  restore = setDriver('echo', {
    protocol: 'echo',
    startTurn(ctx) {
      const id = ctx.emit.startMessage('assistant');
      ctx.emit.part(id, 0, { type: 'text', text: `reply ${ctx.prompt}` });
      ctx.emit.complete(id, 'complete');
      const result: TurnResult = { status: 'done', sessionId: null, usage: null };
      if (!ctx.prompt.includes('[hold]')) return { stop() {}, done: Promise.resolve(result) };
      const done = new Promise<TurnResult>(resolve => { release = () => resolve(result); });
      return { stop: () => release(), done };
    },
  });
  return { release: () => release() };
}

/** A turn held open until `release()`; answers its id. */
async function holdTurn(threadId: string): Promise<string> {
  const turn = await client.call('turns.start', { threadId, prompt: '[hold] answer the question' });
  await waitFor(() => h.core.threads.runner.handles.has(threadId));
  return turn.id;
}

/** The text of the thread's system lines, oldest first. */
function systemLines(threadId: string): string[] {
  return h.core.threads.get(threadId).messages.filter(message => message.role === 'system')
    .flatMap(message => message.parts.map(part => part.type === 'text' ? part.text : ''));
}

/** `boite <args>` as the agent of `threadId`, with the token the core put in its environment. */
async function boite(threadId: string, args: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const code = await runCli(args, {
    out: text => { out += text; },
    err: text => { err += text; },
    env: { [AGENT_ENV.threadId]: threadId, [AGENT_ENV.coreUrl]: h.url, [AGENT_ENV.token]: h.core.agents.tokenFor(threadId) },
    cwd: h.core.threads.require(threadId).cwd,
  });
  return { code, out, err };
}

async function refusal(call: Promise<unknown>): Promise<{ code: number; message: string; data: Record<string, unknown> }> {
  try {
    await call;
  } catch (error) {
    const failure = (error as { rpc: { code: number; message: string; data: Record<string, unknown> } }).rpc;
    return { code: failure.code, message: failure.message, data: failure.data };
  }
  throw new Error('the call was expected to be refused');
}

describe('agent.done', () => {
  test('is the agent\'s own and nobody else\'s', () => {
    expect(AGENT_METHODS.has('agent.done')).toBe(true);
    expect(DEVICE_METHODS.has('agent.done')).toBe(false);
  });

  test('during a turn it answers turn-end, and the thread goes to Done once that turn ends, with a line saying who put it there', async () => {
    const { release } = holdingEcho();
    const { threadId } = await echoThread(h, client);
    const turnId = await holdTurn(threadId);
    const agent = await connect(h.url, h.core.agents.tokenFor(threadId));
    try {
      expect(await agent.call('agent.done', { threadId })).toEqual({ threadId, when: 'turn-end' });
    } finally { agent.close(); }
    // Nothing is put away under the running turn.
    expect(h.core.threads.require(threadId)).toMatchObject({ archived: false });
    expect(h.core.threads.agentDone.pending(threadId)).toBe(true);

    release();
    await waitFor(() => h.core.journal.getTurn(turnId)?.finishedAt != null);
    await waitFor(() => h.core.threads.require(threadId).archived);
    const done = h.core.threads.require(threadId);
    expect(done.doneAt).toBeNumber();
    expect(done.doneAt!).toBeGreaterThanOrEqual(h.core.journal.getTurn(turnId)!.finishedAt!);
    expect(h.core.threads.agentDone.pending(threadId)).toBe(false);
    expect(systemLines(threadId).at(-1)).toBe('Put in Done by its agent.');
    // The agent's answer was written before the thread went.
    const answer = h.core.threads.get(threadId).messages.filter(message => message.role === 'assistant').at(-1)?.parts[0];
    expect(answer?.type === 'text' ? answer.text : '').toContain('answer the question');
  });

  test('on an idle thread it puts the thread in Done at once', async () => {
    holdingEcho();
    const { threadId } = await echoThread(h, client);
    const agent = await connect(h.url, h.core.agents.tokenFor(threadId));
    try {
      expect(await agent.call('agent.done', { threadId })).toEqual({ threadId, when: 'done' });
    } finally { agent.close(); }
    expect(h.core.threads.require(threadId)).toMatchObject({ archived: true, doneAt: expect.any(Number) });
    expect(systemLines(threadId).at(-1)).toBe('Put in Done by its agent.');
  });

  test('is refused for a sub-thread, which stays open', async () => {
    holdingEcho();
    const { threadId } = await echoThread(h, client);
    const parent = h.core.threads.require(threadId);
    const child = h.core.threads.create({ projectId: parent.projectId!, providerId: 'echo', accountId: parent.accountId, title: 'child', cwd: parent.cwd }, { id: newId('thr_'), branch: null, parentThreadId: threadId });
    const agent = await connect(h.url, h.core.agents.tokenFor(child.id));
    try {
      const refused = await refusal(agent.call('agent.done', { threadId: child.id }));
      expect(refused.code).toBe(RpcErrorCode.Refused);
      expect(refused.data).toMatchObject({ field: 'threadId', expected: 'a top-level thread' });
    } finally { agent.close(); }
    expect(h.core.threads.require(child.id).archived).toBe(false);
    expect(h.core.threads.agentDone.pending(child.id)).toBe(false);
  });

  test('a user message queued during the turn keeps the thread open, with a line saying why', async () => {
    const { release } = holdingEcho();
    const { threadId } = await echoThread(h, client);
    const turnId = await holdTurn(threadId);
    const agent = await connect(h.url, h.core.agents.tokenFor(threadId));
    try {
      expect(await agent.call('agent.done', { threadId })).toMatchObject({ when: 'turn-end' });
    } finally { agent.close(); }
    // The user writes again before the agent's turn ends.
    const value: ComposerValue = { input: { text: '', attachments: [], paused: false, queued: [{ id: 'after-done', text: 'One more thing', attachments: [] }] } };
    await client.call('composer.put', { section: 'inputs', id: threadId, expectedRevision: 0, value });
    release();
    await waitFor(() => h.core.journal.getTurn(turnId)?.finishedAt != null);
    await waitFor(() => systemLines(threadId).includes('The agent asked to put this thread in Done; it stays open: the user wrote a message that waits to be sent'));
    await waitFor(() => h.core.journal.listMessages(threadId).some(message => message.role === 'user' && message.parts.some(part => part.type === 'text' && part.text === 'One more thing')));
    await waitFor(() => h.core.threads.require(threadId).status === 'idle');
    expect(h.core.threads.require(threadId).archived).toBe(false);
    expect(h.core.threads.require(threadId).doneAt ?? null).toBeNull();
    expect(h.core.threads.agentDone.pending(threadId)).toBe(false);
  });
});

describe('boite thread done', () => {
  test('with no id, an agent puts its own thread in Done through agent.done', async () => {
    const { release } = holdingEcho();
    const { threadId } = await echoThread(h, client);
    const turnId = await holdTurn(threadId);
    const busy = await boite(threadId, ['thread', 'done']);
    expect(busy.err).toBe('');
    expect(busy.code).toBe(0);
    expect(busy.out.trim()).toBe('This thread goes to Done when this turn ends; the user can restore it.');
    expect(h.core.threads.agentDone.pending(threadId)).toBe(true);
    release();
    await waitFor(() => h.core.journal.getTurn(turnId)?.finishedAt != null);
    await waitFor(() => h.core.threads.require(threadId).archived);
    expect(systemLines(threadId).at(-1)).toBe('Put in Done by its agent.');

    const other = (await echoThread(h, client, 'idle thread')).threadId;
    const idle = await boite(other, ['thread', 'done', '--json']);
    expect(idle.code).toBe(0);
    expect(JSON.parse(idle.out)).toEqual({ threadId: other, when: 'done' });
    expect(h.core.threads.require(other)).toMatchObject({ archived: true, doneAt: expect.any(Number) });
  });
});
