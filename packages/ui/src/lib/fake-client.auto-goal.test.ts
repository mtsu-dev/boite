import { expect } from 'vitest';
import { test } from '../test/fake-client';
import type { FakeClient } from './fake-client';
import { FakeContext } from './fake-client/context';
import { startsAutoGoal } from './fake-client/activity';

const prompt = (length: number) => `Fix the login page.\n${'x'.repeat(length - 20)}`;

/** Automatic goals are off on a fresh machine: the owner turns them on, as these tests are about them. */
async function goalsOn(client: FakeClient) {
  await client.call('settings.set', { autoGoals: true });
  return client;
}

async function freshThread(client: FakeClient) {
  const source = await client.call('threads.get', { threadId: 't-parser' });
  return client.call('threads.create', { projectId: source.projectId!, providerId: source.providerId, accountId: source.accountId, model: source.model ?? undefined });
}

test('a fresh fake starts no automatic goal and refuses goal track, as the core does', async ({ createClient }) => {
  const client = await createClient({ delayMs: 0 });
  expect((await client.call('settings.get', {})).autoGoals).toBeUndefined();
  const thread = await freshThread(client);
  await client.call('turns.start', { threadId: thread.id, prompt: prompt(5000) });
  await client.settled();
  expect((await client.call('threads.get', { threadId: thread.id })).activity?.goal ?? null).toBeNull();
  await expect(client.call('threads.goal.track', { threadId: thread.id })).rejects.toThrow('automatic goals, which are off on this machine');
  expect((await client.call('todos.list', { threadId: thread.id })).some(card => card.goalThreadId === thread.id)).toBe(false);
});

test('a fake Release starts no automatic goal from a setting a Nightly stored, as the core holds it', () => {
  const release = new FakeContext({ delayMs: 0, version: '2.0.0' });
  release.settings = { ...release.settings, autoGoals: true };
  expect(release.settingsInForce().autoGoals).not.toBe(true);
  expect(startsAutoGoal(release, prompt(5000))).toBe(false);
  const nightly = new FakeContext({ delayMs: 0, version: '2.0.0-nightly.20261127.1' });
  nightly.settings = { ...nightly.settings, autoGoals: true };
  expect(startsAutoGoal(nightly, prompt(5000))).toBe(true);
});

test('the fake starts an automatic goal and its card on a long prompt, as the core does', async ({ createClient }) => {
  const client = await goalsOn(await createClient({ delayMs: 0 }));
  const short = await freshThread(client);
  await client.call('turns.start', { threadId: short.id, prompt: prompt(1499) });
  expect((await client.call('threads.get', { threadId: short.id })).activity?.goal ?? null).toBeNull();

  const thread = await freshThread(client);
  await client.call('turns.start', { threadId: thread.id, prompt: prompt(1500) });
  expect((await client.call('threads.get', { threadId: thread.id })).activity?.goal).toMatchObject({ objective: prompt(1500), auto: true, review: expect.any(Object) });
  const cards = await client.call('todos.list', { threadId: thread.id });
  expect(cards.find(card => card.goalThreadId === thread.id)).toMatchObject({ text: 'Fix the login page.', status: 'open' });

  // Removing the goal leaves the card in To do, linked to nothing.
  await client.call('threads.activity.control', { threadId: thread.id, kind: 'goal', action: 'remove' });
  const after = await client.call('todos.list', { threadId: thread.id });
  expect(after.find(card => card.text === 'Fix the login page.')).toMatchObject({ status: 'open', goalThreadId: null });
  await expect(client.call('threads.goal.track', { threadId: thread.id })).rejects.toThrow("the user's last prompt already started a goal");
});

test('the fake goal track takes the last prompt once and refuses with automatic goals off on the machine', async ({ createClient }) => {
  const client = await createClient({ delayMs: 0 });
  const thread = await freshThread(client);
  await client.call('turns.start', { threadId: thread.id, prompt: 'Fix the login and the signup' });
  await expect(client.call('threads.goal.track', { threadId: thread.id })).rejects.toThrow('automatic goals, which are off on this machine');
  await client.call('settings.set', { autoGoals: false });
  await expect(client.call('threads.goal.track', { threadId: thread.id })).rejects.toThrow('automatic goals, which are off on this machine');
  await client.call('settings.set', { autoGoals: true });
  expect((await client.call('threads.goal.track', { threadId: thread.id })).goal).toMatchObject({ objective: 'Fix the login and the signup', auto: true });
  await expect(client.call('threads.goal.track', { threadId: thread.id })).rejects.toThrow('already has a goal or a loop');
});

test('the fake takes the prompt\'s own turn as the goal\'s first and keeps the objective verbatim', async ({ createClient }) => {
  const client = await goalsOn(await createClient({ delayMs: 0 }));
  const thread = await freshThread(client);
  const text = `  ${prompt(1500)}\n`;
  await client.call('turns.start', { threadId: thread.id, prompt: text });
  await expect.poll(async () => (await client.call('threads.get', { threadId: thread.id })).activity?.goal?.status, { timeout: 5000 }).toBe('complete');
  const done = await client.call('threads.get', { threadId: thread.id });
  expect(done.activity?.goal).toMatchObject({ objective: text });
  // Every turn of the thread is one of the goal's: the user's own prompt counted as its first.
  expect(done.turns).toHaveLength(done.activity!.goal!.iterations);
});

test('the fake goal track takes a steer as the last prompt', async ({ createClient }) => {
  const client = await goalsOn(await createClient({ delayMs: 300 }));
  const thread = await freshThread(client);
  const turn = await client.call('turns.start', { threadId: thread.id, prompt: 'Start' });
  await client.call('turns.steer', { threadId: thread.id, turnId: turn.id, prompt: 'Fix the login and the signup', clientRequestId: 'steer_track_01', expectedSelectionVersion: 0 });
  await expect.poll(async () => (await client.call('threads.get', { threadId: thread.id })).status, { timeout: 5000 }).not.toBe('running');
  expect((await client.call('threads.goal.track', { threadId: thread.id })).goal).toMatchObject({ objective: 'Fix the login and the signup' });
});

test('the fake unlinks a claimed card when another goal replaces the automatic one', async ({ createClient }) => {
  const client = await goalsOn(await createClient({ delayMs: 0 }));
  const thread = await freshThread(client);
  await client.call('turns.start', { threadId: thread.id, prompt: prompt(1500) });
  const card = async () => (await client.call('todos.list', { threadId: thread.id })).find(todo => todo.text === 'Fix the login page.');
  await expect.poll(async () => (await card())?.status, { timeout: 5000 }).toBe('claimed');
  await client.call('threads.activity.set', { threadId: thread.id, goal: { objective: 'Something else' } });
  expect(await card()).toMatchObject({ status: 'claimed', goalThreadId: null });
});
