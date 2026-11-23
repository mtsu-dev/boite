import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { effectiveSetting, type Message, type ThreadRetry } from '@boite/contracts';
import { Core } from '../src/core.ts';
import { setDriver } from '../src/drivers/index.ts';
import type { TurnContext } from '../src/drivers/types.ts';
import { CAPACITY_CONTINUE_PROMPT, CAPACITY_RETRY } from '../src/threads/turn-attempts.ts';
import { LIMIT_RESUME } from '../src/threads/limit-resume.ts';
import { RESUME_TEXT } from '../src/threads/resume-text.ts';
import { echoThread, removeDir, rolledBackArchive, scriptedClaude, startTestCore, waitFor, type TestCore } from './harness.ts';
import { thrown } from './settle.ts';

const delays = [...CAPACITY_RETRY.delaysMs];
const limits = { ...LIMIT_RESUME };
beforeEach(() => {
  CAPACITY_RETRY.delaysMs = [40, 40, 40];
  LIMIT_RESUME.marginMs = 0;
  LIMIT_RESUME.startDelayMs = 0;
});
afterEach(() => {
  CAPACITY_RETRY.delaysMs = delays;
  Object.assign(LIMIT_RESUME, limits);
});

function text(messages: Message[]): string {
  return messages.filter(message => message.role === 'assistant').flatMap(message => message.parts).map(part => part.type === 'text' ? part.text : '').join('');
}

function retryOf(h: TestCore, threadId: string): ThreadRetry | null {
  return h.core.threads.list({ includeArchived: true }).find(thread => thread.id === threadId)?.retry ?? null;
}

test.each(['explicit effort', 'legacy alias', 'overridden alias effort'])('a usage limit resumes on a model chosen by the owner with %s and reuses its receipt', async mode => {
  const h = await startTestCore({ settings: { autoResumeLimitedThreads: false } });
  const contexts: TurnContext[] = [];
  const resetsAt = Date.now() + 60_000;
  const restore = setDriver('echo', {
    protocol: 'echo',
    startTurn(ctx) {
      contexts.push(ctx);
      return { stop() {}, done: Promise.resolve(contexts.length === 1
        ? { status: 'error', sessionId: 'native', usage: null, error: 'usage limit', refusal: { kind: 'usage-limit', resetsAt } }
        : { status: 'done', sessionId: 'native', usage: null }) };
    },
  });
  try {
    const client = await h.connect();
    const { threadId, accountId } = await echoThread(h, client);
    const first = await client.call('turns.start', { threadId, prompt: 'Finish the report with all attachments' });
    await waitFor(() => h.core.journal.getTurn(first.id)?.status === 'error');
    const thread = await client.call('threads.get', { threadId });
    expect(thread.retry).toBeNull();
    expect(thread.recovery).toMatchObject({ kind: 'usage-limit', turnId: first.id, resetsAt });
    const selection = { threadId, turnId: first.id, expectedSelectionVersion: thread.selectionVersion ?? 0 };
    const model = 'echo-alternate';
    const alias = 'echo-alternate-high';
    h.core.providers.require('echo').models.push({
      id: model, name: 'Alternate Echo', aliases: [{ id: alias, effort: 'high' }],
      effort: { default: 'low', levels: [{ id: 'low', label: 'Low' }, { id: 'high', label: 'High' }] },
    });
    expect(await thrown(client.call('turns.resume', { ...selection, model: 'unavailable-model' }))).toThrow('the provider does not offer this model');
    const expectedEffort = mode === 'overridden alias effort' ? 'low' : 'high';
    const requested = mode === 'legacy alias' ? { model: alias } : { model: mode === 'explicit effort' ? model : alias, effort: expectedEffort };
    const resumed = await client.call('turns.resume', { ...selection, ...requested });
    expect(resumed.execution).toMatchObject({ model, effort: expectedEffort });
    expect((await client.call('turns.resume', { ...selection, ...requested })).id).toBe(resumed.id);
    if (mode === 'overridden alias effort') {
      expect(await thrown(client.call('turns.resume', { ...selection, model: alias }))).toThrow('already resumed with another reasoning effort');
    } else {
      expect((await client.call('turns.resume', { ...selection, model: alias })).id).toBe(resumed.id);
    }
    const otherEffort = expectedEffort === 'high' ? 'low' : 'high';
    expect(await thrown(client.call('turns.resume', { ...selection, model: alias, effort: otherEffort }))).toThrow('already resumed');
    const catalog = h.core.providers.require('echo').models;
    catalog.splice(catalog.findIndex(entry => entry.id === model), 1, {
      id: model, name: 'Alternate Echo',
      effort: { default: 'low', levels: [{ id: 'low', label: 'Low' }, { id: 'high', label: 'High' }] },
    });
    expect((await client.call('turns.resume', { ...selection, ...requested })).id).toBe(resumed.id);
    if (mode === 'overridden alias effort') {
      expect(await thrown(client.call('turns.resume', { ...selection, model: alias }))).toThrow('already resumed with another reasoning effort');
    }
    expect(await thrown(client.call('turns.resume', { ...selection, model: 'echo-alternate-low' }))).toThrow('already resumed');
    expect(await thrown(client.call('turns.resume', { ...selection, ...requested, effort: otherEffort }))).toThrow('already resumed');
    await waitFor(() => h.core.journal.getTurn(resumed.id)?.status === 'done');
    expect(contexts).toHaveLength(2);
    expect(contexts[1]!.thread).toMatchObject({ accountId, model, effort: expectedEffort, sessionId: 'native' });
    expect(contexts[1]!.prompt).toContain('Finish the report with all attachments');
    expect(await client.call('threads.get', { threadId })).toMatchObject({ recovery: null, model: thread.model });
  } finally { restore(); await h.stop(); }
});

test.each(['preparation', 'attempt', 'retry'] as const)('an account signed out during %s cannot prepare or start another attempt', async phase => {
  const h = await startTestCore();
  const workspace = mkdtempSync(join(tmpdir(), 'boite-account-attempt-'));
  const entered = Promise.withResolvers<void>(), ready = Promise.withResolvers<void>();
  const prepared: string[] = [], started: TurnContext[] = [];
  const restore = setDriver('echo', {
    protocol: 'echo',
    async prepare(ctx) { prepared.push(ctx.account.status); },
    startTurn(ctx) {
      started.push(ctx);
      return { stop() {}, done: Promise.resolve(phase === 'retry' && started.length === 1
        ? { status: 'error', sessionId: null, usage: null, error: 'at capacity', refusal: { kind: 'capacity' } }
        : { status: 'done', sessionId: null, usage: null }) };
    },
  });
  const execution = h.core.sharedAccess.execution, prepare = execution.prepare.bind(execution);
  const held = spyOn(execution, 'prepare');
  try {
    const client = await h.connect();
    const project = await client.call('projects.add', { path: workspace, name: 'Account attempt' });
    const account = h.core.accounts.list().find(account => account.providerId === 'echo')!;
    const thread = await client.call('threads.create', { projectId: project.id, providerId: 'echo', accountId: account.id });
    let calls = 0;
    held.mockImplementation(id => {
      if (id === thread.id && ++calls === ({ preparation: 1, attempt: 2, retry: 3 })[phase]) {
        entered.resolve();
        return ready.promise;
      }
      return prepare(id);
    });
    const finished = client.next('turn.finished', turn => turn.threadId === thread.id);
    await client.call('turns.start', { threadId: thread.id, prompt: 'do not run with a signed-out account' });
    await entered.promise;
    expect(h.core.accounts.require(account.id).status).toBe('ok');
    h.core.accounts.authenticationFailed(account.id);
    ready.resolve();
    expect(await finished).toMatchObject({ status: 'error', error: expect.stringContaining('not logged in') });
    expect(prepared).toEqual(phase === 'preparation' ? [] : ['ok']);
    expect(started).toHaveLength(phase === 'retry' ? 1 : 0);
    expect(retryOf(h, thread.id)?.kind).not.toBe('capacity');
  } finally {
    ready.resolve();
    held.mockRestore();
    await h.stop();
    restore();
    await removeDir(workspace);
  }
});

test.each([1, 2])('Stop during protection preparation %i frees the scheduler slot without starting the provider', async preparation => {
  const h = await startTestCore();
  const entered = Promise.withResolvers<void>(), ready = Promise.withResolvers<void>();
  const started: TurnContext[] = [];
  const restore = setDriver('echo', {
    protocol: 'echo',
    startTurn(ctx) {
      started.push(ctx);
      return { stop() {}, done: Promise.resolve({ status: 'done', sessionId: null, usage: null }) };
    },
  });
  let calls = 0;
  const held = spyOn(h.core.sharedAccess.execution, 'prepare').mockImplementation(() => {
    if (++calls === preparation) { entered.resolve(); return ready.promise; }
  });
  try {
    const client = await h.connect();
    const { threadId } = await echoThread(h, client);
    const turn = await client.call('turns.start', { threadId, prompt: 'Stop before native startup' });
    await entered.promise;
    expect(await client.call('turns.stop', { threadId })).toEqual({ stopped: true });
    await waitFor(() => h.core.scheduler.stopTarget(threadId) === undefined, 1200);
    expect(h.core.journal.getTurn(turn.id)?.status).toBe('stopped');
    expect(started).toHaveLength(0);
  } finally {
    ready.resolve();
    held.mockRestore();
    await h.stop();
    restore();
  }
});

test('Stop for a previous turn leaves its successor and the thread activity alone', async () => {
  const h = await startTestCore();
  const pause = spyOn(h.core.activity, 'pauseAll');
  const unwatch = spyOn(h.core.pullRequestWatches, 'endThread');
  try {
    const client = await h.connect();
    const { threadId } = await echoThread(h, client);
    const previous = await client.call('turns.start', { threadId, prompt: 'first' });
    await waitFor(() => h.core.journal.getTurn(previous.id)?.status === 'done');
    const active = await client.call('turns.start', { threadId, prompt: '[sleep:60000]' });
    await waitFor(() => h.core.threads.runner.handles.has(threadId));
    expect(await client.call('turns.stop', { threadId, expectedTurnId: previous.id })).toEqual({ stopped: false });
    expect(pause).not.toHaveBeenCalled();
    expect(unwatch).not.toHaveBeenCalled();
    expect(h.core.journal.getTurn(active.id)?.status).toBe('running');
    expect(await client.call('turns.stop', { threadId, expectedTurnId: active.id })).toEqual({ stopped: true });
    await waitFor(() => h.core.journal.getTurn(active.id)?.status === 'stopped');
  } finally { pause.mockRestore(); unwatch.mockRestore(); await h.stop(); }
});

test('a turn refused at capacity before writing anything tries again with the same input until it answers', async () => {
  const h = await startTestCore();
  try {
    const client = await h.connect();
    const { threadId } = await echoThread(h, client);
    const seen: ThreadRetry[] = [];
    client.on('thread.updated', thread => { if (thread.id === threadId && thread.retry) seen.push(thread.retry); });
    const turn = await client.call('turns.start', { threadId, prompt: '[capacity:2]hi there' });
    await waitFor(() => h.core.journal.getTurn(turn.id)?.status === 'done');
    const thread = await client.call('threads.get', { threadId });
    expect(thread.turns).toHaveLength(1);
    expect(text(thread.messages)).toContain('hi there');
    expect(text(thread.messages)).not.toContain(CAPACITY_CONTINUE_PROMPT);
    expect(seen.map(retry => [retry.kind, retry.attempt, retry.attempts])).toEqual([['capacity', 1, 3], ['capacity', 2, 3]]);
    expect(thread.retry).toBeNull();
  } finally { await h.stop(); }
});

test('a retry after a refusal that wrote nothing resumes from the totals the refused attempt left', async () => {
  const h = await startTestCore();
  const attempts: TurnContext[] = [];
  const restore = setDriver('echo', {
    protocol: 'echo',
    startTurn(ctx) {
      attempts.push(ctx);
      return { stop() {}, done: Promise.resolve(attempts.length === 1
        ? { status: 'error', sessionId: 'native-session', usage: null, error: 'at capacity', refusal: { kind: 'capacity' }, agentTotals: { costUsd: 0.1, tokens: 60 } }
        : { status: 'done', sessionId: 'native-session', usage: null }) };
    },
  });
  try {
    const client = await h.connect();
    const { threadId } = await echoThread(h, client);
    const turn = await client.call('turns.start', { threadId, prompt: 'hi' });
    await waitFor(() => h.core.journal.getTurn(turn.id)?.status === 'done');
    expect(attempts).toHaveLength(2);
    expect(attempts[1]!.sessionBefore).toEqual({ costUsd: 0.1, tokens: 60 });
    expect(h.core.journal.getTurn(turn.id)?.agentTotals).toEqual({ costUsd: 0.1, tokens: 60 });
  } finally { await h.stop(); restore(); }
});

test('a turn refused at capacity after writing continues with a short prompt instead of resending the request', async () => {
  const h = await startTestCore();
  try {
    const client = await h.connect();
    const { threadId } = await echoThread(h, client);
    const turn = await client.call('turns.start', { threadId, prompt: 'first half [capacity:1] second half' });
    await waitFor(() => h.core.journal.getTurn(turn.id)?.status === 'done');
    const answer = text((await client.call('threads.get', { threadId })).messages);
    // The echo agent writes back the prompt it gets: the second try got the continue prompt, not the request.
    expect(answer).toContain('first half');
    expect(answer).toContain(CAPACITY_CONTINUE_PROMPT);
    expect(answer).not.toContain('second half');
  } finally { await h.stop(); }
});

test('after three tries at capacity the turn fails with the refusal', async () => {
  const h = await startTestCore();
  try {
    const client = await h.connect();
    const { threadId } = await echoThread(h, client);
    const turn = await client.call('turns.start', { threadId, prompt: '[capacity:9]never' });
    await waitFor(() => h.core.journal.getTurn(turn.id)?.status === 'error');
    expect(h.core.journal.getTurn(turn.id)?.error).toContain('at capacity');
    expect(retryOf(h, threadId)).toBeNull();
    await h.core.logs.flush();
    const attempts = (await h.core.logs.query({ limit: 500 })).filter(record => record.threadId === threadId && record.event === 'turn.attempt.started');
    expect(attempts.length).toBe(4);
  } finally { await h.stop(); }
});

test('Stop ends a capacity wait at once and Cancel fails the turn with the refusal', async () => {
  const h = await startTestCore();
  try {
    CAPACITY_RETRY.delaysMs = [60_000, 60_000, 60_000];
    const client = await h.connect();
    const { threadId } = await echoThread(h, client);
    const stopped = await client.call('turns.start', { threadId, prompt: '[capacity:9]stop me' });
    await waitFor(() => retryOf(h, threadId)?.kind === 'capacity');
    expect(retryOf(h, threadId)?.at).toBeGreaterThan(Date.now() + 50_000);
    expect(h.core.journal.getThread(threadId)?.status).toBe('running');
    await client.call('turns.stop', { threadId });
    await waitFor(() => h.core.journal.getTurn(stopped.id)?.status === 'stopped');
    expect(retryOf(h, threadId)).toBeNull();

    const cancelled = await client.call('turns.start', { threadId, prompt: '[capacity:9]cancel me' });
    await waitFor(() => retryOf(h, threadId)?.turnId === cancelled.id);
    expect(await client.call('turns.cancelRetry', { threadId })).toEqual({ cancelled: true });
    await waitFor(() => h.core.journal.getTurn(cancelled.id)?.status === 'error');
    expect(h.core.journal.getTurn(cancelled.id)?.error).toContain('at capacity');
    expect(await client.call('turns.cancelRetry', { threadId })).toEqual({ cancelled: false });
  } finally { await h.stop(); }
});

test('a fresh core without autoResumeLimitedThreads set plans the resume by default', async () => {
  const h = await startTestCore();
  try {
    expect(h.core.settings.get().autoResumeLimitedThreads).toBeUndefined();
    expect(effectiveSetting(h.core.settings.get(), 'autoResumeLimitedThreads')).toBe(true);
    const client = await h.connect();
    const { threadId } = await echoThread(h, client);
    const turn = await client.call('turns.start', { threadId, prompt: '[usage-limit:400]' });
    await waitFor(() => retryOf(h, threadId)?.kind === 'usage-limit', 2000);
    expect(retryOf(h, threadId)?.turnId).toBe(turn.id);
    await waitFor(() => h.core.journal.listTurns(threadId).length === 2, 3000);
    expect(h.core.journal.listTurns(threadId)[1]!.execution?.operation).toBe('resume');
  } finally { await h.stop(); }
});

test('a usage limit failure plans nothing while automatic resume is explicitly off', async () => {
  const h = await startTestCore({ settings: { autoResumeLimitedThreads: false } });
  try {
    const client = await h.connect();
    const { threadId } = await echoThread(h, client);
    const turn = await client.call('turns.start', { threadId, prompt: '[usage-limit:60000]' });
    await waitFor(() => h.core.journal.getTurn(turn.id)?.status === 'error');
    await Bun.sleep(50);
    expect(retryOf(h, threadId)).toBeNull();
  } finally { await h.stop(); }
});

test('a thread stopped by a usage limit resumes once at the reset, never for a window already reset or twice for one window', async () => {
  const h = await startTestCore({ settings: { autoResumeLimitedThreads: true } });
  try {
    const client = await h.connect();
    const { threadId } = await echoThread(h, client);

    const expired = await client.call('turns.start', { threadId, prompt: '[usage-limit:-1000]' });
    await waitFor(() => h.core.journal.getTurn(expired.id)?.status === 'error');
    await Bun.sleep(50);
    expect(retryOf(h, threadId)).toBeNull();

    const limited = await client.call('turns.start', { threadId, prompt: '[usage-limit:400]' });
    await waitFor(() => retryOf(h, threadId)?.kind === 'usage-limit');
    const planned = retryOf(h, threadId)!;
    expect(planned.turnId).toBe(limited.id);
    expect(planned.resetsAt).toBeGreaterThan(Date.now());
    await waitFor(() => h.core.journal.listTurns(threadId).length === 3);
    const resumed = h.core.journal.listTurns(threadId)[2]!;
    expect(resumed.execution?.operation).toBe('resume');
    await waitFor(() => h.core.journal.getTurn(resumed.id)?.status === 'done');
    const opening = (await client.call('threads.get', { threadId })).messages.find(message => message.turnId === resumed.id && message.role === 'system');
    expect(opening?.parts[0]?.type === 'text' ? opening.parts[0].displayText : null).toBe(RESUME_TEXT.limit.label);

    // Within two minutes of the window it already resumed after: no second resume.
    const again = await client.call('turns.start', { threadId, prompt: '[usage-limit:600]' });
    await waitFor(() => h.core.journal.getTurn(again.id)?.status === 'error');
    await Bun.sleep(900);
    expect(retryOf(h, threadId)).toBeNull();
    expect(h.core.journal.listTurns(threadId)).toHaveLength(4);
  } finally { await h.stop(); }
});

test('a cache ping neither cancels a planned usage limit resume nor stands for the turn it resumes', async () => {
  const h = await startTestCore({ settings: { autoResumeLimitedThreads: true } });
  try {
    const client = await h.connect();
    const { threadId } = await echoThread(h, client);
    const limited = await client.call('turns.start', { threadId, prompt: '[usage-limit:500]' });
    await waitFor(() => retryOf(h, threadId)?.turnId === limited.id);
    const ping = h.core.threads.startTurn(threadId, 'ping', { kind: 'keepalive' });
    await waitFor(() => h.core.journal.getTurn(ping.id)?.status === 'done');
    expect(retryOf(h, threadId)).toMatchObject({ kind: 'usage-limit', turnId: limited.id });
    await waitFor(() => h.core.journal.listTurns(threadId).length === 3);
    expect(h.core.journal.listTurns(threadId)[2]!.execution?.operation).toBe('resume');
  } finally { await h.stop(); }
});

test('a planned resume is cancelled by a new message, by Stop and by Cancel', async () => {
  const h = await startTestCore({ settings: { autoResumeLimitedThreads: true } });
  try {
    const client = await h.connect();
    const { threadId } = await echoThread(h, client);
    const plan = async (prompt: string) => {
      const turn = await client.call('turns.start', { threadId, prompt });
      await waitFor(() => retryOf(h, threadId)?.turnId === turn.id);
    };

    await plan('[usage-limit:600000]');
    const answered = await client.call('turns.start', { threadId, prompt: 'never mind' });
    await waitFor(() => h.core.journal.getTurn(answered.id)?.status === 'done');
    expect(retryOf(h, threadId)).toBeNull();

    await plan('[usage-limit:700000]');
    expect(await client.call('turns.stop', { threadId })).toEqual({ stopped: true });
    expect(retryOf(h, threadId)).toBeNull();

    await plan('[usage-limit:800000]');
    expect(await client.call('turns.cancelRetry', { threadId })).toEqual({ cancelled: true });
    expect(retryOf(h, threadId)).toBeNull();
    expect(h.core.journal.listTurns(threadId)).toHaveLength(4);
  } finally { await h.stop(); }
});

test('a resume refuses a thread whose model changed since the limit', async () => {
  const h = await startTestCore({ settings: { autoResumeLimitedThreads: true } });
  try {
    const client = await h.connect();
    const { threadId } = await echoThread(h, client);
    const turn = await client.call('turns.start', { threadId, prompt: '[usage-limit:300]' });
    await waitFor(() => retryOf(h, threadId)?.turnId === turn.id);
    const thread = h.core.journal.getThread(threadId)!;
    h.core.journal.putThread({ ...thread, model: 'another-model' });
    await waitFor(() => retryOf(h, threadId) === null, 3000);
    await Bun.sleep(100);
    expect(h.core.journal.listTurns(threadId)).toHaveLength(1);
    await h.core.logs.flush();
    const cancelled = (await h.core.logs.query({ limit: 500 })).filter(record => record.threadId === threadId && record.event === 'limit-resume.cancelled');
    expect(cancelled[0]?.message).toContain('model changed');
  } finally { await h.stop(); }
});

test('an archive that rolls back keeps the planned resume, which still fires', async () => {
  const h = await startTestCore({ settings: { autoResumeLimitedThreads: true } });
  try {
    const client = await h.connect();
    const { threadId } = await echoThread(h, client);
    const turn = await client.call('turns.start', { threadId, prompt: '[usage-limit:800]' });
    await waitFor(() => retryOf(h, threadId)?.turnId === turn.id);
    rolledBackArchive(h, threadId);
    expect([h.core.threads.require(threadId).archived, retryOf(h, threadId)?.turnId]).toEqual([false, turn.id]);
    await waitFor(() => h.core.journal.listTurns(threadId)[1]?.execution?.operation === 'resume', 5000);
  } finally { await h.stop(); }
});

test('an archived thread keeps the usage window it resumed after across a restart', async () => {
  // The test owns the directory, so it outlives the first core's stop.
  const dataDir = mkdtempSync(join(tmpdir(), 'boite-resume-archived-'));
  let h: TestCore | undefined, next: Core | undefined;
  try {
    h = await startTestCore({ dataDir, settings: { autoResumeLimitedThreads: true } });
    const client = await h.connect();
    const { threadId } = await echoThread(h, client);
    await client.call('threads.archive', { threadId });
    // Unarchived later, a failure in the same window must not resume a second time.
    h.core.journal.setSetting('resumes', { [threadId]: { handled: 'trn_old', resumedWindow: 1_234 } });
    await h.stop();

    next = new Core({ dataDir, token: h.token });
    expect((next.journal.getSetting('resumes') as Record<string, unknown>)[threadId]).toEqual({ resumedWindow: 1_234 });
  } finally {
    await next?.close();
    await h?.stop();
    await removeDir(dataDir);
  }
});

test('a planned quota resume from an older core offers recovery and still fires', async () => {
  const h = await startTestCore({ settings: { autoResumeLimitedThreads: true } });
  const client = await h.connect();
  const { threadId } = await echoThread(h, client);
  const turn = await client.call('turns.start', { threadId, prompt: '[usage-limit:1500]' });
  await waitFor(() => retryOf(h, threadId)?.turnId === turn.id);
  const { recovery: _, ...oldEntry } = h.core.threads.resumes.entry(threadId)!;
  h.core.journal.setSetting('resumes', { [threadId]: oldEntry });
  client.close();
  await h.server.stop();
  await h.core.close();

  const next = new Core({ dataDir: h.dataDir, token: h.token });
  try {
    expect(next.threads.list({}).find(thread => thread.id === threadId)?.retry?.kind).toBe('usage-limit');
    expect(next.threads.get(threadId).recovery).toEqual({ kind: 'usage-limit', turnId: turn.id, resetsAt: oldEntry.plan!.resetsAt });
    await waitFor(() => next.journal.listTurns(threadId).length === 2, 5000);
    const resumed = next.journal.listTurns(threadId)[1]!;
    await waitFor(() => next.journal.getTurn(resumed.id)?.status === 'done');
    expect(resumed.execution?.operation).toBe('resume');
  } finally {
    await next.close();
    await removeDir(h.dataDir);
  }
});

test('a usage limit through Douane reads the gateway pool reset when the driver reports none', async () => {
  const resetsSoon = Date.now() + 2 * 3600 * 1000;
  const resetsLater = Date.now() + 5 * 3600 * 1000;
  const resetsDisabled = Date.now() + 10 * 60 * 1000;
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      if (new URL(req.url).pathname === '/v1/quotas') {
        return Response.json({
          updated_at: new Date().toISOString(),
          providers: [{
            provider: 'claude',
            name: 'Claude',
            display: 'accounts',
            entries: [
              { id: 'disabled-1', label: 'Disabled', status: 'disabled', accounts: 1, windows: [{ id: 'five_hour', label: '5h', used_percent: 100, reset_at: new Date(resetsDisabled).toISOString() }] },
              { id: 'acct-b', label: 'Account B', status: 'cooldown', accounts: 1, windows: [{ id: 'five_hour', label: '5h', used_percent: 100, reset_at: new Date(resetsLater).toISOString() }] },
              { id: 'acct-a', label: 'Account A', status: 'cooldown', accounts: 1, windows: [{ id: 'five_hour', label: '5h', used_percent: 100, reset_at: new Date(resetsSoon).toISOString() }] },
            ],
          }],
        });
      }
      return new Response('not found', { status: 404 });
    },
  });
  const restore = setDriver('claude-sdk', {
    protocol: 'claude-sdk',
    startTurn() {
      return { stop() {}, done: Promise.resolve({ status: 'error', sessionId: 's-douane', usage: null, error: 'usage limit', refusal: { kind: 'usage-limit', resetsAt: null } }) };
    },
  });
  const h = await startTestCore({ settings: { autoResumeLimitedThreads: true } });
  try {
    scriptedClaude(h);
    h.core.accounts.ensureDefaults();
    const client = await h.connect();
    await client.call('subscriptionProxy.configure', {
      subscriptionProxy: { enabled: true, kind: 'douane', baseUrl: `http://127.0.0.1:${server.port}/v1`, dashboardUrl: `http://127.0.0.1:${server.port}/admin/#quotas` },
      key: 'douane-test-key',
    });
    const project = await client.call('projects.add', { path: h.dataDir, name: 'Douane' });
    const account = h.core.accounts.list().find(entry => entry.providerId === 'claude')!;
    const thread = await client.call('threads.create', { projectId: project.id, providerId: 'claude', accountId: account.id });
    const turn = await client.call('turns.start', { threadId: thread.id, prompt: 'go' });
    await waitFor(() => h.core.journal.getTurn(turn.id)?.status === 'error');
    await waitFor(() => retryOf(h, thread.id)?.resetsAt === resetsSoon, 2000);
    expect(await client.call('turns.cancelRetry', { threadId: thread.id })).toEqual({ cancelled: true });
  } finally {
    restore();
    await h.stop();
    await server.stop(true);
  }
});

test('a usage limit bypasses the 10s fresh quota cache and ignores expired quota windows', async () => {
  const futureReset = Math.floor((Date.now() + 3 * 3600 * 1000) / 1000) * 1000;
  const expiredReset = Math.floor((Date.now() - 60_000) / 1000) * 1000;
  let driverResetsAt: number | null = null;
  let fetchCount = 0;
  const restore = setDriver('claude-sdk', {
    protocol: 'claude-sdk',
    startTurn() {
      return { stop() {}, done: Promise.resolve({ status: 'error', sessionId: 's-quota', usage: null, error: 'usage limit', refusal: { kind: 'usage-limit', resetsAt: driverResetsAt } }) };
    },
  });
  const h = await startTestCore({ settings: { autoResumeLimitedThreads: true } });
  const fetcher = spyOn(globalThis, 'fetch').mockImplementation((async () => {
    fetchCount += 1;
    // First read primes the 10s cache at 95%; later reads reflect the 100% five-hour window alongside an expired window.
    if (fetchCount === 1) {
      return Response.json({ five_hour: { utilization: 95, resets_at: new Date(futureReset).toISOString() } });
    }
    return Response.json({
      five_hour: { utilization: 100, resets_at: new Date(futureReset).toISOString() },
      seven_day: { utilization: 100, resets_at: new Date(expiredReset).toISOString() },
    });
  }) as unknown as typeof fetch);
  try {
    scriptedClaude(h);
    const account = h.core.accounts.add({ providerId: 'claude', label: 'QuotaFixture' });
    const dir = h.core.accounts.accountEnv(account, h.core.providers.require('claude'))['CLAUDE_CONFIG_DIR']!;
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'fixture-token' } }));
    // Linux requires .credentials.json in claude.json (Windows overrides session: []), so re-check after writing it.
    h.core.accounts.check(account.id);
    const client = await h.connect();
    const project = await client.call('projects.add', { path: h.dataDir, name: 'QuotaCache' });
    const thread = await client.call('threads.create', { projectId: project.id, providerId: 'claude', accountId: account.id });

    // Prime the 10s ready cache with 95%.
    const primed = await h.core.quotas.readAccount(account.id);
    expect(primed?.status).toBe('ready');
    expect(primed?.windows[0]?.usedPercent).toBe(95);
    expect(fetchCount).toBe(1);

    // 1) Immediately hit a usage limit with resetsAt: null -> must bypass the 10s ready cache and plan at futureReset.
    driverResetsAt = null;
    const t1 = await client.call('turns.start', { threadId: thread.id, prompt: 'first' });
    await waitFor(() => h.core.journal.getTurn(t1.id)?.status === 'error');
    await waitFor(() => retryOf(h, thread.id)?.resetsAt === futureReset, 2000);
    expect(fetchCount).toBeGreaterThanOrEqual(2);
    expect(await client.call('turns.cancelRetry', { threadId: thread.id })).toEqual({ cancelled: true });

    // 2) Driver reports an already-expired reset -> must fall back to quotas and plan at futureReset instead of skipping.
    driverResetsAt = expiredReset;
    const t2 = await client.call('turns.start', { threadId: thread.id, prompt: 'second' });
    await waitFor(() => h.core.journal.getTurn(t2.id)?.status === 'error');
    await waitFor(() => retryOf(h, thread.id)?.resetsAt === futureReset, 2000);
    expect(await client.call('turns.cancelRetry', { threadId: thread.id })).toEqual({ cancelled: true });
  } finally {
    fetcher.mockRestore();
    restore();
    await h.stop();
  }
});

test('a planned usage limit resume fires promptly after a wall-clock jump (OS sleep / hibernation)', async () => {
  const h = await startTestCore({ settings: { autoResumeLimitedThreads: true } });
  const realNow = Date.now;
  let offset = 0;
  try {
    (LIMIT_RESUME as { maxStepMs?: number }).maxStepMs = 40;
    const client = await h.connect();
    const { threadId } = await echoThread(h, client);
    const turn = await client.call('turns.start', { threadId, prompt: '[usage-limit:15000]' });
    await waitFor(() => retryOf(h, threadId)?.turnId === turn.id);
    // Simulate PC sleeping 20s past the reset while monotonic timers paused.
    Date.now = () => realNow() + offset;
    offset = 20_000;
    await waitFor(() => h.core.journal.listTurns(threadId).length === 2, 1500);
    expect(h.core.journal.listTurns(threadId)[1]!.execution?.operation).toBe('resume');
  } finally {
    Date.now = realNow;
    await h.stop();
  }
});

