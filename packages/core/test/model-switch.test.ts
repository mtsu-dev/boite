import { afterEach, beforeEach, expect, test } from 'bun:test';
import type { TurnContext, TurnResult } from '../src/drivers/types.ts';
import { setDriver } from '../src/drivers/index.ts';
import { echoDriver } from '../src/drivers/echo.ts';
import { ModelProbes } from '../src/drivers/model-probes.ts';
import type { ModelInfo } from '@boite/contracts';
import { continuationInput } from '../src/continuation.ts';
import { sessionReferenced } from '../src/threads/native-sessions.ts';
import { Journal } from '../src/journal.ts';
import { join } from 'node:path';
import { holdAccountTurns, echoThread, startTestCore, waitFor, type TestCore } from './harness.ts';
import { thrown } from './settle.ts';

let h: TestCore;
let restore: (() => void) | undefined;
beforeEach(async () => { h = await startTestCore(); });
afterEach(async () => { restore?.(); restore = undefined; await h.stop(); });

async function setup() {
  const client = await h.connect();
  const { threadId, accountId } = await echoThread(h, client);
  h.core.journal.putAccount({ ...h.core.accounts.require(accountId), id: 'second-account', label: 'Second' });
  return { client, threadId, accountId };
}

test('account switching keeps the thread and a switch back resumes the session it left with only what it missed', async () => {
  const { client, threadId, accountId } = await setup();
  const seen: TurnContext[] = [];
  restore = setDriver('echo', {
    protocol: 'echo',
    startTurn(ctx) {
      seen.push(ctx);
      const id = ctx.emit.startMessage('assistant');
      ctx.emit.part(id, 0, { type: 'text', text: `remember turn ${seen.length}` });
      ctx.emit.complete(id, 'complete');
      const totals = { costUsd: 0.25 * seen.length, tokens: 100 * seen.length };
      return { stop() {}, done: Promise.resolve<TurnResult>({ status: 'done', sessionId: ctx.sessionId ?? `native-${seen.length}`, usage: null, agentTotals: totals }) };
    },
  });
  const run = async (prompt: string) => {
    const turn = await client.call('turns.start', { threadId, prompt });
    await waitFor(() => h.core.journal.getTurn(turn.id)?.finishedAt != null);
    expect(h.core.journal.getTurn(turn.id)?.error).toBeNull();
    expect(h.core.journal.getTurn(turn.id)?.status).toBe('done');
  };
  await run('the passwordless project uses blue widgets');
  const switched = await client.call('threads.update', { threadId, accountId: 'second-account', model: 'echo' });
  expect(switched.accountId).toBe('second-account');
  expect(switched.sessionId).toBeNull();
  await run('continue');
  expect(seen[1]?.prompt).toContain('blue widgets');
  expect(seen[1]?.sessionId).toBeNull();
  // The session left stays on disk for the switch back: transcript purge sees it referenced.
  expect(sessionReferenced(h.core.journal.db, 'native-1')).toBe(true);
  const back = await client.call('threads.update', { threadId, accountId, model: 'echo' });
  expect(back).toMatchObject({ sessionId: 'native-1', sessionGeneration: 2 });
  await run('back again');
  // The first account's session already holds the opening exchange: it gets only the second account's.
  expect(seen[2]?.sessionId).toBe('native-1');
  expect(seen[2]?.prompt).toContain('It then went on with another agent');
  expect(seen[2]?.prompt).toContain('continue');
  expect(seen[2]?.prompt).toContain('remember turn 2');
  expect(seen[2]?.prompt).not.toContain('blue widgets');
  expect(seen[2]?.prompt).not.toContain('remember turn 1');
  // Its running totals go on from where that session left them.
  expect(seen[2]?.sessionBefore).toEqual({ costUsd: 0.25, tokens: 100 });
  // Carried once: the next turn on it is the request alone.
  await run('and once more');
  expect(seen[3]?.sessionId).toBe('native-1');
  expect(seen[3]?.prompt).not.toContain('<recent-history>');
  // The second account's session waits for the next switch to it.
  expect(h.core.threads.accountSessions.saved(threadId, 'second-account')).toMatchObject({ sessionId: 'native-2', generations: [1] });
  expect(h.core.threads.list({})).toHaveLength(1);
  const messages = h.core.threads.get(threadId).messages.filter((m) => m.role === 'user');
  expect(messages[1]?.parts).toEqual([{ type: 'text', text: 'continue' }]);
});

test('a switch back starts fresh with the whole history when what came since is past the bound', async () => {
  const { client, threadId, accountId } = await setup();
  const seen: TurnContext[] = [];
  restore = setDriver('echo', {
    protocol: 'echo',
    startTurn(ctx) {
      seen.push(ctx);
      const id = ctx.emit.startMessage('assistant');
      ctx.emit.part(id, 0, { type: 'text', text: `long answer ${seen.length} `.padEnd(11_000, 'x') });
      ctx.emit.complete(id, 'complete');
      return { stop() {}, done: Promise.resolve<TurnResult>({ status: 'done', sessionId: ctx.sessionId ?? `native-${seen.length}`, usage: null }) };
    },
  });
  const run = async (prompt: string) => {
    const turn = await client.call('turns.start', { threadId, prompt });
    await waitFor(() => h.core.journal.getTurn(turn.id)?.status === 'done');
  };
  await run('opening request');
  await client.call('threads.update', { threadId, accountId: 'second-account', model: 'echo' });
  for (let index = 0; index < 7; index++) await run(`work ${index}`);
  expect(await client.call('threads.update', { threadId, accountId, model: 'echo' })).toMatchObject({ sessionId: null });
  await run('back');
  expect(seen.at(-1)?.sessionId).toBeNull();
  expect(seen.at(-1)?.prompt).toContain('Continue this existing conversation');
  expect(seen.at(-1)?.prompt).toContain('opening request');
});

for (const compacted of [false, true]) test(`a switch back carries a prompt stopped before the session saved it${compacted ? ', across a compaction' : ''}`, async () => {
  const { client, threadId, accountId } = await setup();
  const seen: TurnContext[] = [];
  restore = setDriver('echo', {
    protocol: 'echo',
    startTurn(ctx) {
      seen.push(ctx);
      if (seen.length === 2) {
        let finish!: (result: TurnResult) => void;
        return { done: new Promise<TurnResult>((resolve) => { finish = resolve; }), stop: () => finish({ status: 'stopped', sessionId: ctx.sessionId, usage: null }) };
      }
      const id = ctx.emit.startMessage('assistant');
      ctx.emit.part(id, 0, { type: 'text', text: `answer ${seen.length}` });
      ctx.emit.complete(id, 'complete');
      return { stop() {}, done: Promise.resolve<TurnResult>({ status: 'done', sessionId: ctx.sessionId ?? `native-${seen.length}`, usage: null }) };
    },
  });
  const first = await client.call('turns.start', { threadId, prompt: 'opening request' });
  await waitFor(() => h.core.journal.getTurn(first.id)?.status === 'done');
  const stopped = await client.call('turns.start', { threadId, prompt: 'cut short request' });
  await waitFor(() => seen.length === 2);
  await client.call('turns.stop', { threadId });
  await waitFor(() => h.core.journal.getTurn(stopped.id)?.status === 'stopped');
  // A compaction ends the session's history at its own turn, yet does not answer the stopped prompt.
  if (compacted) {
    const compact = await client.call('threads.compact', { threadId });
    await waitFor(() => h.core.journal.getTurn(compact.id)?.status === 'done');
  }
  await client.call('threads.update', { threadId, accountId: 'second-account', model: 'echo' });
  expect(await client.call('threads.update', { threadId, accountId, model: 'echo' })).toMatchObject({ sessionId: 'native-1' });
  const back = await client.call('turns.start', { threadId, prompt: 'continue' });
  await waitFor(() => h.core.journal.getTurn(back.id)?.status === 'done');
  expect(seen.at(-1)?.sessionId).toBe('native-1');
  expect(seen.at(-1)?.prompt).toContain('cut short request');
  expect(seen.at(-1)?.prompt).not.toContain('opening request');
});

test('a resume after the first turn back was cut carries what the session missed', async () => {
  const { client, threadId, accountId } = await setup();
  const seen: TurnContext[] = [];
  restore = setDriver('echo', {
    protocol: 'echo',
    startTurn(ctx) {
      seen.push(ctx);
      if (seen.length === 3) {
        let finish!: (result: TurnResult) => void;
        return { done: new Promise<TurnResult>((resolve) => { finish = resolve; }), stop: () => finish({ status: 'stopped', sessionId: ctx.sessionId, usage: null }) };
      }
      const id = ctx.emit.startMessage('assistant');
      ctx.emit.part(id, 0, { type: 'text', text: `answer ${seen.length}` });
      ctx.emit.complete(id, 'complete');
      return { stop() {}, done: Promise.resolve<TurnResult>({ status: 'done', sessionId: ctx.sessionId ?? `native-${seen.length}`, usage: null }) };
    },
  });
  const run = async (prompt: string) => {
    const turn = await client.call('turns.start', { threadId, prompt });
    await waitFor(() => h.core.journal.getTurn(turn.id)?.status === 'done');
  };
  await run('opening request');
  await client.call('threads.update', { threadId, accountId: 'second-account', model: 'echo' });
  await run('work on the second account');
  await client.call('threads.update', { threadId, accountId, model: 'echo' });
  const cut = await client.call('turns.start', { threadId, prompt: 'back request' });
  await waitFor(() => seen.length === 3);
  expect(seen[2]?.prompt).toContain('work on the second account');
  await client.call('turns.stop', { threadId });
  await waitFor(() => h.core.journal.getTurn(cut.id)?.status === 'stopped');
  const resumed = h.core.threads.startTurn(threadId, 'carry on', { kind: 'resume', reason: 'carry-on' });
  await waitFor(() => h.core.journal.getTurn(resumed.id)?.status === 'done');
  expect(seen[3]?.sessionId).toBe('native-1');
  expect(seen[3]?.prompt).toContain('work on the second account');
});

test('a switch back whose session the agent lost runs the same turn fresh with the whole history', async () => {
  const { client, threadId, accountId } = await setup();
  const seen: TurnContext[] = [];
  restore = setDriver('echo', {
    protocol: 'echo',
    startTurn(ctx) {
      seen.push(ctx);
      if (ctx.sessionId === 'native-1' && seen.length > 1) {
        return { stop() {}, done: Promise.resolve<TurnResult>({ status: 'error', sessionId: ctx.sessionId, usage: null, error: 'no conversation found', sessionLost: true }) };
      }
      const id = ctx.emit.startMessage('assistant');
      ctx.emit.part(id, 0, { type: 'text', text: `answer ${seen.length}` });
      ctx.emit.complete(id, 'complete');
      return { stop() {}, done: Promise.resolve<TurnResult>({ status: 'done', sessionId: ctx.sessionId ?? `native-${seen.length}`, usage: null }) };
    },
  });
  const run = async (prompt: string) => {
    const turn = await client.call('turns.start', { threadId, prompt });
    await waitFor(() => h.core.journal.getTurn(turn.id)?.finishedAt != null);
    return h.core.journal.getTurn(turn.id);
  };
  await run('opening request');
  await client.call('threads.update', { threadId, accountId: 'second-account', model: 'echo' });
  await run('work on the second account');
  await client.call('threads.update', { threadId, accountId, model: 'echo' });
  expect((await run('back'))?.status).toBe('done');
  expect(seen.map(ctx => ctx.sessionId)).toEqual([null, null, 'native-1', null]);
  expect(seen[3]?.prompt).toContain('Continue this existing conversation');
  expect(seen[3]?.prompt).toContain('opening request');
  expect(h.core.threads.require(threadId)).toMatchObject({ sessionId: 'native-4', sessionGeneration: 3 });
});

test('a switch back after an edit removed the turn its session ended on starts fresh', async () => {
  const { client, threadId, accountId } = await setup();
  const seen: TurnContext[] = [];
  restore = setDriver('echo', {
    protocol: 'echo',
    startTurn(ctx) {
      seen.push(ctx);
      const id = ctx.emit.startMessage('assistant');
      ctx.emit.part(id, 0, { type: 'text', text: `answer ${seen.length}` });
      ctx.emit.complete(id, 'complete');
      return { stop() {}, done: Promise.resolve<TurnResult>({ status: 'done', sessionId: ctx.sessionId ?? `native-${seen.length}`, usage: null }) };
    },
  });
  const run = async (prompt: string) => {
    const turn = await client.call('turns.start', { threadId, prompt });
    await waitFor(() => h.core.journal.getTurn(turn.id)?.status === 'done');
  };
  await run('kept request');
  await run('edited away');
  await client.call('threads.update', { threadId, accountId: 'second-account', model: 'echo' });
  await run('on the second account');
  const edited = h.core.threads.get(threadId).messages.filter((m) => m.role === 'user')[1]!;
  await client.call('threads.rewind', { threadId, messageId: edited.id });
  expect(await client.call('threads.update', { threadId, accountId, model: 'echo' })).toMatchObject({ sessionId: null });
  await run('back');
  expect(seen.at(-1)?.sessionId).toBeNull();
  expect(seen.at(-1)?.prompt).toContain('kept request');
  expect(seen.at(-1)?.prompt).not.toContain('edited away');
});

test('a queued turn keeps its original account and late completion cannot attach its session to the new selection', async () => {
  const { client, threadId, accountId } = await setup();
  const blocker = await client.call('threads.create', {
    projectId: h.core.projects.require(h.core.threads.require(threadId).projectId).id, providerId: 'echo', accountId,
  });
  const seen: TurnContext[] = [];
  let finish!: (value: TurnResult) => void;
  restore = setDriver('echo', {
    protocol: 'echo',
    startTurn(ctx) {
      seen.push(ctx);
      if (ctx.thread.id === blocker.id) {
        return { done: new Promise((resolve) => { finish = resolve; }), stop: () => finish({ status: 'stopped', sessionId: null, usage: null }) };
      }
      return { stop() {}, done: Promise.resolve({ status: 'done', sessionId: 'old-native', usage: null }) };
    },
  });
  await client.call('turns.start', { threadId: blocker.id, prompt: 'block' });
  const release = holdAccountTurns(h, accountId);
  const queued = await client.call('turns.start', { threadId, prompt: 'queued on first account' });
  await client.call('threads.update', { threadId, accountId: 'second-account', model: 'echo' });
  finish({ status: 'done', sessionId: null, usage: null });
  release();
  await waitFor(() => h.core.journal.getTurn(queued.id)?.status === 'done');
  expect(seen[1]?.account.id).toBe(accountId);
  expect(h.core.threads.require(threadId).accountId).toBe('second-account');
  expect(h.core.threads.require(threadId).sessionId).toBeNull();
  expect(h.core.journal.getTurn(queued.id)?.execution?.accountId).toBe(accountId);
  // The account it ran on keeps that session, ending with the late turn, for a switch back.
  expect(h.core.threads.accountSessions.saved(threadId, accountId)).toMatchObject({ sessionId: 'old-native', after: { turnId: queued.id, afterPart: null } });
});

test('a turn stopped while the agent refuses to resume its lost session is not run again on a fresh one', async () => {
  const { client, threadId } = await setup();
  const seen: TurnContext[] = [];
  const gate: { refuse: (() => void) | null } = { refuse: null };
  restore = setDriver('echo', {
    protocol: 'echo',
    startTurn(ctx) {
      seen.push(ctx);
      if (ctx.sessionId === null) {
        const id = ctx.emit.startMessage('assistant');
        ctx.emit.part(id, 0, { type: 'text', text: 'first answer' });
        ctx.emit.complete(id, 'complete');
        return { stop() {}, done: Promise.resolve<TurnResult>({ status: 'done', sessionId: 'native-1', usage: null }) };
      }
      // A driver that reports the refusal as it came, whatever Stop said meanwhile.
      const done = new Promise<TurnResult>((resolve) => {
        gate.refuse = () => resolve({ status: 'error', sessionId: ctx.sessionId, usage: null, error: 'no conversation found', sessionLost: true });
      });
      return { stop() {}, done };
    },
  });
  const first = await client.call('turns.start', { threadId, prompt: 'first' });
  await waitFor(() => h.core.journal.getTurn(first.id)?.status === 'done');
  const second = await client.call('turns.start', { threadId, prompt: 'second' });
  await waitFor(() => gate.refuse !== null);
  expect(await client.call('turns.stop', { threadId })).toEqual({ stopped: true });
  gate.refuse!();
  await waitFor(() => h.core.journal.getTurn(second.id)?.finishedAt != null);
  expect(h.core.journal.getTurn(second.id)).toMatchObject({ status: 'stopped', error: null });
  expect(seen).toHaveLength(2);
  // The lost id still goes: the next prompt starts fresh instead of failing on it again.
  expect(h.core.threads.require(threadId)).toMatchObject({ sessionId: null, sessionGeneration: 1, status: 'idle' });
});

test('a stale model selection is refused before a prompt is journalled', async () => {
  const { client, threadId } = await setup();
  await client.call('threads.update', { threadId, accountId: 'second-account', model: 'echo', expectedSelectionVersion: 0 });
  let error = '';
  try { await client.call('turns.start', { threadId, prompt: 'stale', expectedSelectionVersion: 0 }); }
  catch (e) { error = String(e); }
  expect(error).toContain('selection changed');
  expect(h.core.threads.get(threadId).messages).toHaveLength(0);
});

test('on-demand model discovery cannot overwrite another client selection while its metadata is pending', async () => {
  const { client, threadId } = await setup();
  const other = await h.connect();
  const descriptor = h.core.providers.require('echo');
  descriptor.protocol = 'acp';
  const gate = Promise.withResolvers<ModelInfo[]>();
  let reads = 0;
  const cache = new ModelProbes(() => { reads++; return gate.promise; });
  restore = setDriver('acp', {
    ...echoDriver, protocol: 'acp',
    probe: ctx => cache.probe(ctx),
    probedModels: (providerId, accountId) => cache.models(providerId, accountId),
    forgetProbes: filter => cache.forget(filter),
  });
  const pending = client.call('threads.update', { threadId, model: 'discovered', effort: 'high' });
  const observed = pending.then(() => null, error => error as Error);
  try {
    await waitFor(() => reads === 1);
    const chosen = await other.call('threads.update', { threadId, permissionMode: 'acceptEdits', expectedSelectionVersion: 0 });
    expect(chosen.selectionVersion).toBe(1);
    expect(await thrown(other.call('threads.update', { threadId, model: 'another', expectedSelectionVersion: 0 }))).toThrow('selection changed');
    expect(reads).toBe(1);
    gate.resolve([{ id: 'discovered', name: 'Discovered', effort: { levels: [{ id: 'high', label: 'High' }], default: 'high' } }]);
    expect(String(await observed)).toContain('selection changed');
    expect(h.core.threads.require(threadId)).toMatchObject({ model: 'echo', effort: null, permissionMode: 'acceptEdits', selectionVersion: 1 });
    expect(h.core.threads.get(threadId).messages).toHaveLength(0);
  } finally { gate.resolve([]); await observed; }
});

test('continuation reads beyond the UI page, bounds long history and excludes reasoning and old grants', async () => {
  const { threadId } = await setup();
  for (let i = 0; i < 160; i++) {
    h.core.journal.putMessage({
      id: `history-${i}`, threadId, turnId: 'historical', role: i % 2 ? 'assistant' : 'user', state: 'complete', createdAt: i,
      parts: [
        { type: 'text', text: `exchange-${i}: ${'abc '.repeat(300)}` },
        { type: 'thinking', text: 'private reasoning must not transfer' },
        { type: 'permission', requestId: 'old-approval', toolName: 'write', decision: 'allow' },
      ],
    });
  }
  const result = continuationInput(h.core.journal, threadId, 'next', { prompt: 'Current request', attachments: [] }, h.core.providers.require('echo'));
  expect(result.prompt).toContain('exchange-0:');
  expect(result.prompt).toContain('exchange-159:');
  expect(result.prompt).toContain('older messages omitted');
  expect(result.prompt).not.toContain('private reasoning must not transfer');
  expect(result.prompt).not.toContain('old-approval');
  expect(result.prompt.length).toBeLessThan(78_000);
  expect(result.prompt.endsWith('Current request')).toBe(true);
});

test('historical images travel before current attachments and unsupported image history is refused', async () => {
  const { threadId } = await setup();
  h.core.journal.putMessage({ id: 'image', threadId, turnId: 'old', role: 'user', state: 'complete', createdAt: 1,
    parts: [{ type: 'image', mimeType: 'image/png', data: 'aGlzdG9yeQ==', alt: 'diagram.png' }],
  });
  const provider = h.core.providers.require('echo');
  const input = { prompt: 'Compare', attachments: [{ kind: 'image' as const, mimeType: 'image/png' as const, data: 'bmV3', name: 'new.png' }] };
  const result = continuationInput(h.core.journal, threadId, 'new', input, provider);
  expect(result.attachments.map((image) => image.name)).toEqual(['diagram.png', 'new.png']);
  expect(() => continuationInput(h.core.journal, threadId, 'new', input, { ...provider, capabilities: { ...provider.capabilities, images: false } })).toThrow('historical images');
});

test('delegation migration preserves threads from the prompt-cache schema', async () => {
  const { threadId } = await setup();
  const path = join(h.dataDir, 'cache-schema.db');
  const legacy = new Journal(path);
  legacy.putThread({ ...h.core.threads.require(threadId), sessionId: 'cached-session' });
  legacy.db.exec('DROP TABLE delegated_agents; DROP TABLE delegation_messages; DROP INDEX threads_parent; ALTER TABLE threads DROP COLUMN parent_thread_id; PRAGMA user_version = 13;');
  legacy.close();
  const migrated = new Journal(path);
  try {
    const thread = migrated.getThread(threadId)!;
    expect(thread.sessionId).toBe('cached-session');
    expect(thread.parentThreadId).toBeUndefined();
    expect(thread.promptCache).toBeNull();
    migrated.putThread({ ...thread, parentThreadId: 'parent' });
    expect(migrated.getThread(threadId)?.parentThreadId).toBe('parent');
    expect(migrated.db.query('SELECT COUNT(*) AS count FROM delegated_agents').get()).toEqual({ count: 0 });
  } finally { migrated.close(); }
});

test('migration preserves legacy native sessions and persists new selections and turn execution', async () => {
  const { client, threadId } = await setup();
  const path = join(h.dataDir, 'migration.db');
  const legacy = new Journal(path);
  legacy.putThread({ ...h.core.threads.require(threadId), sessionId: 'legacy-session' });
  legacy.db.exec('DROP TABLE agent_entities; DROP TABLE agent_requests; ALTER TABLE threads DROP COLUMN agent_session_id;');
  legacy.db.exec('DROP TABLE delegated_agents; DROP TABLE delegation_messages; DROP INDEX threads_parent; ALTER TABLE threads DROP COLUMN parent_thread_id;');
  legacy.db.exec('DROP TABLE coordination_letters; DROP TABLE coordination_wakes; DROP TABLE turn_requests; ALTER TABLE threads DROP COLUMN prompt_cache; ALTER TABLE threads DROP COLUMN speed; ALTER TABLE threads DROP COLUMN session_generation; ALTER TABLE threads DROP COLUMN selection_version; ALTER TABLE turns DROP COLUMN execution; PRAGMA user_version = 8;');
  legacy.close();
  const migrated = new Journal(path);
  try {
    expect(migrated.getThread(threadId)?.sessionId).toBe('legacy-session');
    expect(migrated.getThread(threadId)?.sessionGeneration).toBe(0);
    expect(migrated.getThread(threadId)?.promptCache).toBeNull();
  } finally { migrated.close(); }
  await client.call('threads.update', { threadId, accountId: 'second-account', model: 'echo' });
  const turn = await client.call('turns.start', { threadId, prompt: 'persist' });
  await waitFor(() => h.core.journal.getTurn(turn.id)?.status === 'done');
  const reader = new Journal(join(h.dataDir, 'journal.db'));
  try {
    expect(reader.getThread(threadId)?.accountId).toBe('second-account');
    expect(reader.getThread(threadId)?.sessionGeneration).toBe(1);
    expect(reader.getTurn(turn.id)?.execution?.accountId).toBe('second-account');
  } finally { reader.close(); }
});
