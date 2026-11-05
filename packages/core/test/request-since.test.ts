import { afterEach, expect, test } from 'bun:test';
import { queueOrder, requestStarts, type Turn } from '@boite/contracts';
import { setDriver } from '../src/drivers/index.ts';
import type { TurnContext, TurnResult } from '../src/drivers/types.ts';
import { Journal } from '../src/journal.ts';
import type { TurnOrigin } from '../src/threads/turn-origin.ts';
import { echoThread, startTestCore, waitFor, type TestCore } from './harness.ts';

const threadId = 'thread-request';

type Execution = NonNullable<Turn['execution']>;

/** `legacy`: saved before execution snapshots. `started: false`: still queued. */
function turn(id: string, at: number, options: { execution?: Partial<Execution>; legacy?: boolean; started?: boolean; thread?: string } = {}): Turn {
  const started = options.started ?? true;
  return {
    id, threadId: options.thread ?? threadId, status: started ? 'done' : 'queued', queuedAt: at,
    startedAt: started ? at + 1 : null, finishedAt: started ? at + 5 : null, usage: null, error: null,
    ...(options.legacy ? {} : { execution: {
      providerId: 'echo', accountId: 'echo', model: null, effort: null, speed: null, permissionMode: 'default',
      sessionId: null, sessionGeneration: 0, selectionVersion: 0, ...options.execution,
    } }),
  };
}

const wake = (id: string, at: number) => turn(id, at, { execution: { operation: 'background' } });

/**
 * The core's query and the clients' helper read the same start for the latest
 * turn that started, in `queueOrder`, whatever order the list holds.
 */
function agreement(journal: Journal, turns: Turn[]): number | null {
  const starts = requestStarts([...turns].reverse());
  const latest = turns.filter(entry => entry.startedAt !== null && entry.threadId === threadId).sort(queueOrder).at(-1);
  const expected = latest ? starts.get(latest.id) ?? null : null;
  expect(journal.requestSince(threadId)).toBe(expected);
  return expected;
}

test('a request counts from the user turn through the turns Boite opened to carry it on', () => {
  const journal = new Journal(':memory:');
  const turns: Turn[] = [];
  const add = (next: Turn): number | null => {
    turns.push(next);
    journal.putTurn(next);
    agreement(journal, turns);
    return requestStarts([...turns].reverse()).get(next.id) ?? null;
  };
  try {
    expect(journal.requestSince(threadId)).toBeNull();
    // A prompt queued but never run has no start and leaves nothing to count from.
    expect(add(turn('queued-0', 10, { started: false }))).toBeNull();
    // Only continuations so far: the earliest stands in for the unseen user turn.
    expect(add(wake('wake-0', 50))).toBe(51);
    expect(add(turn('user-1', 100, { legacy: true }))).toBe(101);
    expect(add(wake('wake-1', 200))).toBe(101);
    expect(add(turn('compact-1', 300, { execution: { operation: 'compact', automatic: true } }))).toBe(101);
    expect(add(turn('mail-1', 400, { execution: { operation: 'delegation' } }))).toBe(101);
    expect(add(turn('letter-1', 450, { execution: { operation: 'coordination' } }))).toBe(101);
    expect(add(turn('resume-1', 500, { execution: { operation: 'resume' } }))).toBe(101);
    // Another thread's later turn changes nothing here.
    expect(add(turn('other-1', 550, { thread: 'thread-other' }))).toBe(551);
    // The user's next message, or a compaction they asked for, starts over.
    expect(add(turn('user-2', 600))).toBe(601);
    expect(add(turn('compact-2', 700, { execution: { operation: 'compact' } }))).toBe(701);
    expect(add(wake('wake-2', 800))).toBe(701);
    // The user's next message waits behind a wake-up: the wake-up still carries the earlier request.
    expect(add(turn('user-3', 900, { started: false }))).toBeNull();
    expect(add(wake('wake-3', 950))).toBe(701);
    expect(add(turn('watch-1', 960, { execution: { operation: 'pull-request' } }))).toBe(701);
    // Another agent's message that found the thread at rest opens its own, and carries what follows.
    expect(add(turn('letter-rest', 1000, { execution: { operation: 'coordination', opensRequest: true } }))).toBe(1001);
    expect(add(turn('letter-busy', 1100, { execution: { operation: 'coordination' } }))).toBe(1001);
    expect(add(wake('wake-4', 1200))).toBe(1001);
    expect(add(turn('follow-up', 1300, { execution: { operation: 'delegation', opensRequest: true } }))).toBe(1301);
  } finally {
    journal.close();
  }
});

test('equal queue times and turns written out of queue order read the same start on both sides', () => {
  const journal = new Journal(':memory:');
  // Written in this order: a later wake-up first, then two turns queued in the same millisecond, the higher id first.
  const turns = [wake('wake', 300), { ...turn('user-b', 100), startedAt: 150 }, turn('user-a', 100)];
  try {
    for (const entry of turns) journal.putTurn(entry);
    // user-b sorts after user-a by id whatever the write order: it wins the tie, and the wake-up carries it on.
    expect(agreement(journal, turns)).toBe(150);
    expect(requestStarts(turns).get('wake')).toBe(150);
    expect(requestStarts([...turns].reverse()).get('wake')).toBe(150);
  } finally {
    journal.close();
  }
});

const DAY = 86_400_000;
const cores: TestCore[] = [];
const restores: (() => void)[] = [];
afterEach(async () => { for (const core of cores.splice(0)) await core.stop(); for (const restore of restores.splice(0)) restore(); });

/** A thread whose user turn ended a day ago, with nothing left running, and another agent that can write to it. */
async function threadAtRestSinceYesterday(onUserTurn?: (ctx: TurnContext) => void) {
  // Each turn stays open until the test finishes it, so its row can be read while it works.
  const running = new Map<string, () => void>();
  let turns = 0;
  restores.push(setDriver('echo', { protocol: 'echo', startTurn(ctx) {
    if (ctx.thread.id === id && ++turns === 1) onUserTurn?.(ctx);
    let finish!: () => void;
    const done = new Promise<TurnResult>(resolve => { finish = () => resolve({ status: 'done', sessionId: `session:${ctx.thread.id}`, usage: null }); });
    running.set(ctx.thread.id, finish);
    return { done, stop: finish };
  } }));
  const h = await startTestCore(); cores.push(h);
  const owner = await h.connect();
  const bot = (await echoThread(h, owner, 'Bot')).threadId;
  const id = (await echoThread(h, owner, 'Yesterday')).threadId;
  const summary = () => h.core.threads.list({}).find(thread => thread.id === id)!;
  const latest = () => h.core.journal.listTurns(id).sort(queueOrder).at(-1)!;
  const started = () => waitFor(() => running.has(id) && latest().status === 'running');
  const finish = async () => {
    running.get(id)!();
    running.delete(id);
    await waitFor(() => h.core.threads.require(id).status === 'idle' && latest().status === 'done');
  };
  const letter = (requestId: string) => h.core.coordination.send({ threadId: bot, to: h.core.coordination.get(id).self, text: 'One question', requestId });
  h.core.threads.startTurn(id, 'The request of yesterday');
  await started();
  await finish();
  const user = latest();
  const since = user.startedAt! - DAY;
  h.core.journal.putTurn({ ...user, queuedAt: user.queuedAt - DAY, startedAt: since, finishedAt: user.finishedAt! - DAY });
  return { h, id, since, summary, latest, started, finish, letter };
}

test('another agent writing to a thread at rest opens a new request: the row counts from that turn, not from yesterday', async () => {
  const { h, id, since, summary, latest, started, finish, letter } = await threadAtRestSinceYesterday();
  await letter('wake-at-rest');
  await started();
  const wake = latest();
  expect(wake.execution?.operation).toBe('coordination');
  expect(wake.startedAt).toBeGreaterThan(since);
  expect(summary().requestSince).toBe(wake.startedAt);
  expect(requestStarts(h.core.journal.listTurns(id)).get(wake.id)).toBe(wake.startedAt);
  await finish();

  // What Boite opens next carries this new request on, not yesterday's.
  h.core.threads.startTurn(id, 'A pull request moved', { kind: 'pull-request' });
  await started();
  expect(summary().requestSince).toBe(wake.startedAt);
  await finish();

  // The user's next message starts over, and a letter to that finished turn opens its own again.
  h.core.threads.startTurn(id, 'Something else');
  await started();
  const next = latest();
  expect(summary().requestSince).toBe(next.startedAt);
  await finish();
  await letter('wake-at-rest-again');
  await started();
  expect(summary().requestSince).toBe(latest().startedAt);
  expect(latest().id).not.toBe(next.id);
  await finish();
});

test('what Boite opens by itself on a thread at rest still carries on the user\'s request', async () => {
  const { h, id, since, summary, latest, started, finish } = await threadAtRestSinceYesterday();
  const origins: TurnOrigin[] = [
    { kind: 'background' },
    { kind: 'delegation' },
    { kind: 'pull-request' },
    { kind: 'resume', reason: 'handoff' },
    { kind: 'resume', reason: 'carry-on' },
    { kind: 'resume', reason: 'wake' },
    { kind: 'compact', automatic: true },
    { kind: 'keepalive' },
  ];
  for (const origin of origins) {
    h.core.threads.startTurn(id, 'Carry on', origin);
    await started();
    expect(latest().execution?.opensRequest).toBeUndefined();
    expect(summary().requestSince).toBe(since);
    await finish();
  }
});

test('another agent writing while background work still runs carries the request on', async () => {
  const { id, since, summary, latest, started, finish, letter } = await threadAtRestSinceYesterday(ctx => {
    ctx.background?.([{ id: 'monitor-1', kind: 'monitor', description: 'Watch CI', toolId: null, startedAt: Date.now() }]);
  });
  expect(summary().backgroundWork?.kinds).toEqual(['monitor']);
  expect(summary().id).toBe(id);
  await letter('wake-monitoring');
  await started();
  expect(latest().execution).toMatchObject({ operation: 'coordination' });
  expect(latest().execution?.opensRequest).toBeUndefined();
  expect(summary().requestSince).toBe(since);
  await finish();
});
