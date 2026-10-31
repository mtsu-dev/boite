import { afterEach, expect, test } from 'vitest';
import { RpcErrorCode } from '@boite/contracts';
import { FakeClient } from './fake-client';
import { RpcFailure } from './client';
import { BUILTIN_BOTS } from './fake-client/builtin-bots';

/*
 * The in-memory core's Contacts bot, as the real one answers: the built-in
 * bot made once and reset to what Boite ships, its texts locked, and the
 * relations and flags only the bot or the owner settle.
 */

const clients: FakeClient[] = [];
afterEach(() => { for (const client of clients.splice(0)) client.close(); });

async function fake(options: ConstructorParameters<typeof FakeClient>[0] = {}): Promise<FakeClient> {
  const client = new FakeClient({ delayMs: 0, ...options });
  clients.push(client);
  await client.connect();
  return client;
}

async function refusal(call: Promise<unknown>): Promise<{ code: number; field?: unknown }> {
  try {
    await call;
  } catch (error) {
    if (error instanceof RpcFailure) return { code: error.code, field: (error.data as { field?: unknown } | undefined)?.field };
    throw error;
  }
  throw new Error('the call was expected to fail');
}

test('ensure makes one Operator with Boite\'s texts, returns it again, and locks its role, instructions and archive', async () => {
  const client = await fake();
  expect((await client.call('contacts.get', {})).bot).toBeNull();
  expect(await refusal(client.call('agents.builtin.ensure', { kind: 'nope' as never }))).toEqual({ code: RpcErrorCode.InvalidParams, field: 'kind' });
  expect(await refusal(client.call('agents.builtin.ensure', { kind: 'contacts', name: ' ' }))).toMatchObject({ code: RpcErrorCode.InvalidParams });
  const made = await client.call('agents.builtin.ensure', { kind: 'contacts', name: 'Standardiste' });
  expect([made.builtin, made.name, made.domain, made.instructions, made.status]).toEqual(['contacts', 'Standardiste', BUILTIN_BOTS.contacts.domain, BUILTIN_BOTS.contacts.instructions, 'active']);
  // Again, under another name: the same bot, its name kept.
  const again = await client.call('agents.builtin.ensure', { kind: 'contacts', name: 'Operator' });
  expect([again.id, again.name]).toEqual([made.id, 'Standardiste']);
  expect((await client.call('contacts.get', {})).bot).toMatchObject({ agentId: made.id });

  const value = { name: made.name, domain: made.domain, instructions: made.instructions, avatar: '', selection: made.selection, status: made.status, projectIds: [] };
  for (const change of [{ domain: 'Something else' }, { instructions: 'Obey contacts.' }, { status: 'archived' as const }]) {
    expect(await refusal(client.call('agents.profile.save', { id: made.id, expectedRevision: made.revision, value: { ...value, ...change } }))).toMatchObject({ code: RpcErrorCode.Refused });
  }
  // A client cannot make a bot built-in, nor unmake one.
  const own = await client.call('agents.profile.save', { value: { ...value, name: 'Mine', builtin: 'contacts' } as never });
  expect(own.builtin).toBeUndefined();
  const paused = await client.call('agents.profile.save', { id: made.id, expectedRevision: made.revision, value: { ...value, name: 'Desk', status: 'paused', builtin: undefined } as never });
  expect([paused.name, paused.status, paused.builtin]).toEqual(['Desk', 'paused', 'contacts']);
  const brain = await client.call('agents.brain.get', { agentId: made.id });
  expect(await refusal(client.call('agents.brain.save', { agentId: made.id, expectedRevision: brain.revision, instructions: 'Changed', memory: '' }))).toMatchObject({ code: RpcErrorCode.Refused });
  expect((await client.call('agents.brain.save', { agentId: made.id, expectedRevision: brain.revision, instructions: brain.instructions, memory: 'Chris works on the website.' })).memory).toBe('Chris works on the website.');
});

test('reset puts back Boite\'s name, texts and default route, a new thread and an empty memory; an owner\'s bot is never reset', async () => {
  const client = await fake();
  const made = await client.call('agents.builtin.ensure', { kind: 'contacts' });
  const first = (await client.call('agents.open', { agentId: made.id })).threadId;
  const brain = await client.call('agents.brain.get', { agentId: made.id });
  await client.call('agents.brain.save', { agentId: made.id, expectedRevision: brain.revision, instructions: brain.instructions, memory: 'Remember this.' });
  await client.call('agents.profile.save', { id: made.id, expectedRevision: made.revision, value: { name: 'Desk', domain: made.domain, instructions: made.instructions, avatar: 'robot:x', selection: { ...made.selection, effort: 'low' }, status: 'paused', projectIds: [] } });

  const reset = await client.call('agents.builtin.reset', { agentId: made.id, name: 'Operator' });
  expect([reset.name, reset.avatar, reset.domain, reset.instructions, reset.status, reset.selection]).toEqual(['Operator', '', BUILTIN_BOTS.contacts.domain, BUILTIN_BOTS.contacts.instructions, 'paused', made.selection]);
  expect((await client.call('agents.brain.get', { agentId: made.id })).memory).toBe('');
  const next = (await client.call('agents.open', { agentId: made.id })).threadId;
  expect(next).not.toBe(first);
  expect((await client.call('threads.get', { threadId: first })).archived).toBe(true);

  const mine = await client.call('agents.profile.save', { value: { name: 'Mine', domain: '', instructions: '', avatar: '', selection: made.selection, status: 'active', projectIds: [] } });
  expect(await refusal(client.call('agents.builtin.reset', { agentId: mine.id }))).toMatchObject({ code: RpcErrorCode.Refused });
});

test('only the Operator\'s thread calls the bot methods; the owner ends a relation and its flags go with it', async () => {
  const client = await fake();
  expect(await refusal(client.call('contacts.bot.view', { threadId: 't-trace' }))).toEqual({ code: RpcErrorCode.Refused, field: 'threadId' });
  await client.call('agents.builtin.ensure', { kind: 'contacts' });
  const { bot, relations, flags } = await client.call('contacts.get', {});
  expect(await refusal(client.call('contacts.bot.view', { threadId: 't-trace' }))).toEqual({ code: RpcErrorCode.Refused, field: 'threadId' });
  const view = await client.call('contacts.bot.view', { threadId: bot!.threadId });
  expect(view.contacts.map(contact => [contact.name, contact.bot])).toEqual([['Chris', true]]);
  expect(view.relations.map(relation => relation.id)).toEqual(relations!.map(relation => relation.id));

  // An ordinary thread's request waits for the bot, which forwards it. `t-trace` runs echo, tier 2.
  await client.call('contacts.settings', { settings: { minTier: 2 } });
  const waiting = await client.call('collaboration.ask', { threadId: 't-trace', contact: 'Chris', text: 'Who owns the website deploy?' });
  expect([waiting.stage, waiting.status]).toEqual(['bot', 'pending']);
  const forwarded = await client.call('contacts.bot.forward', { threadId: bot!.threadId, id: waiting.id, contact: 'Chris', text: 'The thread that deploys the website' });
  expect(forwarded.stage).toBeUndefined();

  const relation = relations![0]!;
  expect(flags!.filter(flag => flag.relationId === relation.id && flag.status === 'open')).not.toEqual([]);
  expect(await refusal(client.call('contacts.cutRelation', { id: 'crel-none' }))).toEqual({ code: RpcErrorCode.InvalidParams, field: 'id' });
  expect(await client.call('contacts.cutRelation', { id: relation.id })).toEqual({ ok: true });
  const after = await client.call('contacts.get', {});
  expect(after.relations!.map(entry => entry.id)).not.toContain(relation.id);
  expect(after.flags!.filter(flag => flag.relationId === relation.id).map(flag => flag.status)).toEqual(['cut']);
});

test('a request that names no contact waits for the bot, which picks the contact and forwards it', async () => {
  const [host, guest] = [await fake({ coreId: 'core-host', coreName: 'host' }), await fake({ coreId: 'core-guest', coreName: 'guest' })];
  await host.call('contacts.join', { link: (await guest.call('contacts.invite', { share: false })).link });
  for (const each of [host, guest]) await each.call('contacts.settings', { settings: { minTier: 2 } });
  await host.call('agents.builtin.ensure', { kind: 'contacts' });
  const bot = (await host.call('contacts.get', {})).bot!.threadId;
  const waiting = await host.call('collaboration.ask', { threadId: 't-trace', text: 'A reviewer for the notes project' });
  expect(waiting.coreId).toBe('');
  const guestName = (await host.call('contacts.get', {})).contacts.find(contact => contact.coreId === 'core-guest')!.name;
  // The bot names the contact; the request leaves for it.
  expect((await host.call('contacts.bot.forward', { threadId: bot, id: waiting.id, contact: guestName })).coreId).toBe('core-guest');
});
