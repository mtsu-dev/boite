import { afterEach, beforeEach, expect, test } from 'bun:test';
import type { Turn, TurnSwitch } from '@boite/contracts';
import type { LiveTurnSettings, TurnContext, TurnResult } from '../src/drivers/types.ts';
import { setDriver } from '../src/drivers/index.ts';
import { echoThread, startTestCore, waitFor, type TestCore } from './harness.ts';

let h: TestCore;
let restore: (() => void) | undefined;
beforeEach(async () => { h = await startTestCore(); });
afterEach(async () => { restore?.(); restore = undefined; await h.stop(); });

/** A thread on an echo agent that answers `answer(n)` and records every context it is given. */
async function setup(answer: (turn: number) => string = n => `answer ${n}`) {
  const client = await h.connect();
  const { threadId, accountId } = await echoThread(h, client);
  h.core.journal.putAccount({ ...h.core.accounts.require(accountId), id: 'second-account', label: 'Second' });
  const seen: TurnContext[] = [];
  restore = setDriver('echo', {
    protocol: 'echo',
    startTurn(ctx) {
      seen.push(ctx);
      const id = ctx.emit.startMessage('assistant');
      ctx.emit.part(id, 0, { type: 'text', text: answer(seen.length) });
      ctx.emit.complete(id, 'complete');
      return { stop() {}, done: Promise.resolve<TurnResult>({ status: 'done', sessionId: ctx.sessionId ?? `native-${seen.length}`, usage: null }) };
    },
  });
  const run = async (prompt: string): Promise<Turn> => {
    const turn = await client.call('turns.start', { threadId, prompt });
    await waitFor(() => h.core.journal.getTurn(turn.id)?.finishedAt != null);
    const stored = h.core.journal.getTurn(turn.id)!;
    expect(stored.error).toBeNull();
    return stored;
  };
  return { client, threadId, accountId, seen, run };
}

test('a turn that starts on another effort carries the change, with no message and nothing for the agent', async () => {
  const { client, threadId, accountId, seen, run } = await setup();
  await client.call('threads.update', { threadId, model: 'echo', effort: 'low' });
  expect((await run('first')).switched).toBeUndefined();
  // Changed and changed back before sending: the transcript never stated the one in between.
  await client.call('threads.update', { threadId, effort: 'high' });
  await client.call('threads.update', { threadId, effort: 'low' });
  expect((await run('second')).switched).toBeUndefined();

  await client.call('threads.update', { threadId, effort: 'high' });
  const events: unknown[] = [];
  client.on('turn.started', turn => events.push(turn.switched));
  const third = await run('third');
  const side = { providerId: 'echo', accountId, model: 'echo', speed: null, account: h.core.accounts.require(accountId).label };
  const expected: TurnSwitch = { from: { ...side, effort: 'low' }, to: { ...side, effort: 'high' } };
  // Same account, same session: the change alone, nothing handed over.
  expect(third.switched).toEqual(expected);
  expect(events).toEqual([expected]);
  expect((await run('fourth')).switched).toBeUndefined();

  // Every client reads it with the thread's turns, and it is no message.
  const page = await client.call('threads.get', { threadId });
  expect(page.turns.find(turn => turn.id === third.id)?.switched).toEqual(expected);
  expect(page.messages.map(message => message.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user', 'assistant', 'user', 'assistant']);
  expect(page.messages.flatMap(message => message.parts).every(part => part.type === 'text')).toBe(true);
  expect(seen[2]?.prompt).toBe(seen[1]!.prompt.replace('second', 'third'));
});

test('a turn on another account says what its new session was handed, and a switch back what the old one missed', async () => {
  const { client, threadId, accountId, seen, run } = await setup(n => n === 2 ? 'long '.padEnd(13_000, 'x') : `answer ${n}`);
  await run('one');
  await run('two');
  await client.call('threads.update', { threadId, accountId: 'second-account', model: 'echo' });
  const heard: TurnSwitch[] = [];
  client.on('turn.switched', event => heard.push(event.switched));
  const moved = await run('three');
  // Four messages went: three whole, the 13,000-character answer with its middle cut.
  expect(moved.switched).toMatchObject({ from: { accountId }, to: { accountId: 'second-account', account: 'Second' }, handover: { session: 'fresh', full: 3, cut: 1, omitted: 0 } });
  expect(moved.switched?.handover?.chars).toBe(seen[2]!.prompt.indexOf('Current user request:\nthree') + 'Current user request:\n'.length - seen[2]!.prompt.indexOf('Continue this existing conversation'));
  expect(heard.at(-1)).toEqual(moved.switched!);
  // The divider never becomes part of the history the next agent reads.
  expect(seen[2]!.prompt).not.toContain('switched');
  expect(seen[2]!.prompt).not.toContain('Second');

  await client.call('threads.update', { threadId, accountId, model: 'echo' });
  const back = await run('four');
  expect(back.switched).toMatchObject({ from: { accountId: 'second-account' }, to: { accountId }, handover: { session: 'resumed', full: 2, cut: 0, omitted: 0 } });
  // Both stay on the turns' own rows.
  expect(h.core.journal.listTurnsFor(threadId, [moved.id, back.id]).map(turn => turn.switched?.handover?.session)).toEqual(['fresh', 'resumed']);
});

test('a thread the core moved off a signed-out account says why', async () => {
  const { accountId, run } = await setup();
  await run('one');
  h.core.journal.putAccount({ ...h.core.accounts.require(accountId), status: 'unauthenticated' });
  const moved = await run('two');
  expect(moved.switched).toMatchObject({ from: { accountId }, to: { accountId: 'second-account' }, reason: 'signed-out', handover: { session: 'fresh', full: 2, cut: 0 } });
  expect((await run('three')).switched).toBeUndefined();
});

test('an effort that reached a running turn still shows on the next turn, from what the transcript stated', async () => {
  const client = await h.connect();
  const { threadId } = await echoThread(h, client);
  const done: ReturnType<typeof Promise.withResolvers<TurnResult>>[] = [];
  restore = setDriver('echo', {
    protocol: 'echo',
    startTurn(ctx) {
      const result = Promise.withResolvers<TurnResult>();
      done.push(result);
      return {
        stop() {}, done: result.promise,
        applySettings: (change: LiveTurnSettings) => Promise.resolve('effort' in change ? { effort: change.effort } : {}),
      };
    },
  });
  await client.call('threads.update', { threadId, model: 'echo', effort: 'low' });
  const first = await client.call('turns.start', { threadId, prompt: 'first' });
  await waitFor(() => done.length === 1);
  await client.call('threads.update', { threadId, effort: 'high' });
  await waitFor(() => h.core.journal.getTurn(first.id)?.execution?.effort === 'high');
  expect(h.core.journal.getTurn(first.id)?.execution?.startedOn).toEqual({ effort: 'low', speed: null });
  done[0]!.resolve({ status: 'done', sessionId: 'native', usage: null });
  await waitFor(() => h.core.journal.getTurn(first.id)?.finishedAt != null);
  const second = await client.call('turns.start', { threadId, prompt: 'second' });
  await waitFor(() => done.length === 2);
  expect(h.core.journal.getTurn(second.id)?.switched).toMatchObject({ from: { effort: 'low' }, to: { effort: 'high' } });
  done[1]!.resolve({ status: 'done', sessionId: 'native', usage: null });
  await waitFor(() => h.core.journal.getTurn(second.id)?.finishedAt != null);
});
