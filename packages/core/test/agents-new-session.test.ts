import { afterEach, beforeEach, expect, test } from 'bun:test';
import type { Message } from '@boite/contracts';
import type { CoreClient } from '../src/client.ts';
import type { Connection } from '../src/router.ts';
import { botCommand } from '../src/agents/cli.ts';
import { MOCHI_NEW_SESSION_GAP_MS } from '../src/agents/new-session.ts';
import { makeAgent, scripted, settled } from './agent-fixture.ts';
import { startTestCore, waitFor, type TestCore } from './harness.ts';

let h: TestCore;
let client: CoreClient;
let restore: (() => void) | undefined;
beforeEach(async () => { h = await startTestCore(); client = await h.connect(); });
afterEach(async () => { restore?.(); restore = undefined; await h.stop(); });

const BLOCK = 'Boite: who you are, as a mochi.';
const NEW = 'Boite: this is a new conversation';

/** What a synchronous call threw. */
function thrown(call: () => unknown): Error {
  try { call(); } catch (error) { return error as Error; }
  throw new Error('expected a refusal');
}

/** The connection a mochi's own `boite` CLI holds: an agent token for its thread. */
function mochiConnection(threadId: string): Connection {
  return { id: 'agent-test', subscriptions: new Set(), identity: { principal: 'agent', sessionId: null, threadId } } as unknown as Connection;
}
const markers = (threadId: string) => h.core.journal.listMessages(threadId)
  .flatMap((m: Message) => m.role === 'system' ? m.parts.flatMap(p => p.type === 'text' && p.newConversation ? [p.newConversation] : []) : []);

/** A driver that records each turn's prompt and the provider session it resumed (null: a fresh one). */
function recording(onTurn: (prompt: string) => { hold?: boolean } = () => ({})) {
  const resumed: (string | null)[] = [];
  const driver = scripted(ctx => { resumed.push(ctx.sessionId ?? null); return { text: 'Noted.', ...onTurn(ctx.prompt) }; });
  restore = driver.restore;
  return { ...driver, resumed };
}

async function ask(driver: ReturnType<typeof recording>, threadId: string, prompt: string): Promise<{ prompt: string; resumed: string | null }> {
  const count = driver.prompts.get(threadId)?.length ?? 0;
  await client.call('turns.start', { threadId, prompt });
  await waitFor(() => (driver.prompts.get(threadId)?.length ?? 0) === count + 1 && settled(h, threadId));
  return { prompt: driver.prompts.get(threadId)!.at(-1)!, resumed: driver.resumed.at(-1)! };
}

test('a new conversation starts the next turn on a fresh session without the earlier messages, keeps memory, routines and settings, and carries its note once', async () => {
  const driver = recording();
  const { agent, threadId } = await makeAgent(h, client, { instructions: 'Answer about releases.' });
  await client.call('agents.memory.note', { agentId: agent.id, text: 'The release is on Friday.' });
  await client.call('agents.routine.save', { value: {
    agentId: agent.id, name: 'Check the PRs', prompt: 'Look at the open pull requests', schedule: { kind: 'interval', everyMinutes: 60 }, enabled: true,
    nextAt: null, lastTurnId: null, lastScheduledAt: null,
  } });
  const first = await ask(driver, threadId, 'First question about the old plan?');
  expect(first.resumed).toBe(`session:${threadId}`);
  const before = { brain: await client.call('agents.brain.get', { agentId: agent.id }), snapshot: await client.call('agents.snapshot', {}), thread: h.core.threads.require(threadId) };

  // From a terminal, as the owner: the thread is idle, so it applies at once.
  const started = await botCommand(client, threadId, ['new-session', '--note', 'Pick up the release checklist.']) as { newConversation: string; handoffNote: string };
  expect(started.newConversation).toStartWith('started');
  const reset = h.core.threads.require(threadId);
  expect(reset.sessionId).toBeNull();
  expect(reset.sessionGeneration).toBe((before.thread.sessionGeneration ?? 0) + 1);
  expect(markers(threadId)).toEqual([{ by: 'user', note: 'Pick up the release checklist.' }]);

  // The next turn: a fresh session, the whole block and the note, none of the earlier messages.
  const fresh = await ask(driver, threadId, 'What now?');
  expect(fresh.resumed).toBeNull();
  expect(fresh.prompt).toContain(BLOCK);
  expect(fresh.prompt).toContain(`${NEW} (the user asked for it)`);
  expect(fresh.prompt.split('Pick up the release checklist.').length - 1).toBe(1);
  // Its own paragraph, before the user's message.
  expect(fresh.prompt).toContain('sent once: "Pick up the release checklist."\n\n');
  expect(fresh.prompt).not.toContain('First question about the old plan?');
  expect(fresh.prompt).not.toContain('<conversation-history>');
  expect(fresh.prompt).toContain('What now?');

  // The turn after resumes that new session, and the note is spent.
  const next = await ask(driver, threadId, 'And then?');
  expect(next.resumed).toBe(`session:${threadId}`);
  expect(next.prompt).not.toContain('Pick up the release checklist.');
  expect(next.prompt).not.toContain(NEW);

  // Memory, routines, desk and the thread's settings are as before; the history the user sees is whole.
  const after = { brain: await client.call('agents.brain.get', { agentId: agent.id }), snapshot: await client.call('agents.snapshot', {}), thread: h.core.threads.require(threadId) };
  expect(after.brain.memory).toBe(before.brain.memory);
  expect(after.snapshot.routines).toEqual(before.snapshot.routines);
  expect(after.snapshot.watches).toEqual(before.snapshot.watches);
  expect(after.snapshot.profiles).toEqual(before.snapshot.profiles);
  expect({ ...after.thread, sessionId: null, sessionGeneration: 0, updatedAt: 0, context: null, promptCache: null, status: 'idle', unread: false, lastActivityAt: 0 })
    .toMatchObject({ providerId: before.thread.providerId, accountId: before.thread.accountId, model: before.thread.model, permissionMode: before.thread.permissionMode, title: before.thread.title });
  expect(h.core.journal.listMessages(threadId).some(m => m.parts.some(p => p.type === 'text' && p.text.includes('First question about the old plan?')))).toBe(true);

  // A later fresh session (a lost one, an account switch) carries the new conversation only.
  const thread = h.core.threads.require(threadId);
  h.core.journal.putThread({ ...thread, sessionId: null, sessionGeneration: (thread.sessionGeneration ?? 0) + 1 });
  const lost = await ask(driver, threadId, 'Still there?');
  expect(lost.resumed).toBeNull();
  expect(lost.prompt).toContain('<conversation-history>');
  expect(lost.prompt).toContain('What now?');
  expect(lost.prompt).not.toContain('First question about the old plan?');
  expect(lost.prompt).not.toContain('Pick up the release checklist.');
});

test('asked by the mochi during its own turn, it applies once that turn ends; it may not ask again so soon, the user may', async () => {
  let asked: { when: string } | undefined;
  const driver = recording(prompt => {
    if (prompt.includes('Wrap up')) {
      asked = h.core.workforce.newSession({ threadId: current, note: 'Release done; next: the changelog.' }, mochiConnection(current));
      return { hold: true };
    }
    return {};
  });
  const { agent, threadId } = await makeAgent(h, client);
  const current = threadId;
  await ask(driver, threadId, 'Warm up');
  const generation = h.core.threads.require(threadId).sessionGeneration ?? 0;

  await client.call('turns.start', { threadId, prompt: 'Wrap up and start fresh' });
  await waitFor(() => asked !== undefined);
  expect(asked!.when).toBe('turn-end');
  // While the turn runs nothing moves: same session, no marker.
  expect(h.core.workforce.newSessions.pending(threadId)).toBe(true);
  expect(h.core.threads.require(threadId).sessionGeneration ?? 0).toBe(generation);
  expect(h.core.threads.require(threadId).sessionId).toBe(`session:${threadId}`);
  expect(markers(threadId)).toEqual([]);

  driver.release();
  await waitFor(() => settled(h, threadId) && markers(threadId).length === 1);
  expect(h.core.workforce.newSessions.pending(threadId)).toBe(false);
  expect(markers(threadId)).toEqual([{ by: 'mochi', note: 'Release done; next: the changelog.' }]);
  const reset = h.core.threads.require(threadId);
  expect(reset.sessionId).toBeNull();
  expect(reset.sessionGeneration).toBe(generation + 1);
  // The marker closes the turn that asked: it sits after that turn's answer.
  const messages = h.core.journal.listMessages(threadId);
  expect(messages.at(-1)!.parts[0]).toMatchObject({ type: 'text', newConversation: { by: 'mochi' } });

  const fresh = await ask(driver, threadId, 'Go on');
  expect(fresh.resumed).toBeNull();
  expect(fresh.prompt).toContain(`${NEW} (you asked for it)`);
  expect(fresh.prompt).toContain('Handoff note you wrote for it, sent once: "Release done; next: the changelog."');
  expect(fresh.prompt).not.toContain('Warm up');

  // A mochi asking on every wake would never keep a session: refused until the gap passes, the user is not.
  const again = thrown(() => h.core.workforce.newSession({ threadId }, mochiConnection(threadId)));
  expect(again.message).toContain(`${MOCHI_NEW_SESSION_GAP_MS / 60_000} minutes`);
  expect(markers(threadId)).toHaveLength(1);
  expect(await client.call('agents.session.new', { agentId: agent.id })).toEqual({ agentId: agent.id, threadId, when: 'done' });
  expect(markers(threadId)).toEqual([{ by: 'mochi', note: 'Release done; next: the changelog.' }, { by: 'user' }]);
  // An agent acts for its own thread only.
  expect(thrown(() => h.core.workforce.newSession({ threadId: 'thr_other', agentId: agent.id }, mochiConnection('thr_other'))).message).toContain('no mochi');
});

test('a handoff note is bounded, and a turn that failed leaves it for the next', async () => {
  let fail = false;
  const driver = scripted(() => ({ text: 'Noted.', ...(fail ? { status: 'error' as const } : {}) })); restore = driver.restore;
  const { agent, threadId } = await makeAgent(h, client);
  const tooLong = await client.call('agents.session.new', { agentId: agent.id, note: 'x'.repeat(4001) }).catch((error: Error) => error);
  expect((tooLong as Error).message).toContain('note: expected 0 to 4000 characters');
  await client.call('agents.session.new', { agentId: agent.id, note: 'Keep the draft.' });
  const run = async (prompt: string) => {
    const count = driver.prompts.get(threadId)?.length ?? 0;
    await client.call('turns.start', { threadId, prompt });
    await waitFor(() => (driver.prompts.get(threadId)?.length ?? 0) === count + 1 && settled(h, threadId));
    return driver.prompts.get(threadId)!.at(-1)!;
  };
  fail = true;
  expect(await run('First try')).toContain('Keep the draft.');
  fail = false;
  expect(await run('Second try')).toContain('Keep the draft.');
  expect(await run('Third try')).not.toContain('Keep the draft.');
});
