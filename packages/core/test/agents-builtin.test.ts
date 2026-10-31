import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentProfile } from '@boite/contracts';
import type { CoreClient } from '../src/client.ts';
import { BUILTIN_TEXT } from '../src/agents/builtin.ts';
import { INTRO_PROMPT } from '../src/agents/store.ts';
import { agentValue, echoAccount, makeAgent, scripted, settled, turnsOf } from './agent-fixture.ts';
import { quietAgent, removeDir, startTestCore, waitFor, type TestCore } from './harness.ts';
import { thrown } from './settle.ts';

const cores: TestCore[] = [];
const dirs: string[] = [];
// Echo would stream back the bot's whole context block, seconds a turn: every turn here answers one line.
let driver: ReturnType<typeof scripted> | null = null;
beforeEach(() => { driver = scripted(() => ({ text: 'Noted.' })); });
afterEach(async () => {
  for (const h of cores.splice(0)) await h.stop();
  for (const dir of dirs.splice(0)) await removeDir(dir);
  driver?.restore(); driver = null;
});

async function start(dataDir?: string): Promise<{ h: TestCore; client: CoreClient }> {
  const h = await startTestCore(dataDir === undefined ? {} : { dataDir });
  cores.push(h);
  return { h, client: await h.connect() };
}

/**
 * The Contacts bot with its introduction finished, quiet as `makeAgent` makes
 * a bot: no memory pass or subagents, so a scenario reads only its own turns.
 */
async function ensured(h: TestCore, client: CoreClient, name?: string): Promise<{ bot: AgentProfile; threadId: string }> {
  h.core.workforce.setLimits({ paused: true });
  const made = await client.call('agents.builtin.ensure', { kind: 'contacts', ...(name === undefined ? {} : { name }) });
  const bot = await quietAgent(client, made);
  h.core.workforce.setLimits({ paused: false });
  const threadId = h.core.workforce.builtinThread('contacts')!;
  await waitFor(() => turnsOf(h, threadId).length > 0 && settled(h, threadId), 10_000);
  return { bot, threadId };
}

const shipped = BUILTIN_TEXT.contacts;
const valueOf = ({ id: _id, revision: _revision, createdAt: _createdAt, updatedAt: _updatedAt, ...value }: AgentProfile) => value;
const save = (client: CoreClient, agent: AgentProfile, over: Partial<AgentProfile>) => client.call('agents.profile.save', { id: agent.id, expectedRevision: agent.revision, value: { ...valueOf(agent), ...over } });

test('ensure makes one Contacts bot per core, with Boite\'s text, full access and its introduction, and returns it again', async () => {
  const { h, client } = await start();
  expect(h.core.workforce.builtin('contacts')).toBeNull();
  expect(h.core.workforce.builtinThread('contacts')).toBeNull();
  const bot = await client.call('agents.builtin.ensure', { kind: 'contacts', name: 'Standardiste' });
  expect(bot).toMatchObject({ builtin: 'contacts', name: 'Standardiste', domain: shipped.domain, instructions: shipped.instructions, avatar: shipped.avatar, status: 'active', projectIds: [] });
  expect(bot.selection).toMatchObject({ providerId: 'echo', accountId: echoAccount(h), model: 'echo', permissionMode: 'bypassPermissions' });
  const threadId = h.core.workforce.sessionOf(bot.id)!.threadId;
  expect(h.core.workforce.builtin('contacts')?.id).toBe(bot.id);
  expect(h.core.workforce.builtinThread('contacts')).toBe(threadId);
  expect(h.core.threads.require(threadId).title).toBe('Standardiste');
  await waitFor(() => turnsOf(h, threadId).length > 0 && settled(h, threadId), 10_000);
  const intro = h.core.journal.listMessages(threadId).find(m => m.role === 'system');
  expect(intro?.parts[0]).toMatchObject({ type: 'text', text: INTRO_PROMPT });

  // Again, from another window in another language: the same bot, its name and route untouched.
  const again = await client.call('agents.builtin.ensure', { kind: 'contacts', name: 'Operator', selection: { ...bot.selection, permissionMode: 'default' } });
  expect(again).toEqual(bot);
  expect(h.core.workforce.records.list('profile')).toHaveLength(1);
  // Paused stays paused.
  const paused = await save(client, bot, { status: 'paused' });
  expect(await client.call('agents.builtin.ensure', { kind: 'contacts' })).toMatchObject({ id: bot.id, status: 'paused' });
  expect(h.core.workforce.builtin('contacts')?.status).toBe('paused');
  expect(h.core.workforce.builtinThread('contacts')).toBe(threadId);
  expect(paused.builtin).toBe('contacts');
  expect(await thrown(client.call('agents.builtin.ensure', { kind: 'mail' as 'contacts' }))).toThrow('kind: expected contacts');
});

test('without a name the core names it Operator; one archived by an older core comes back', async () => {
  const { h, client } = await start();
  const bot = await client.call('agents.builtin.ensure', { kind: 'contacts' });
  expect(bot.name).toBe('Operator');
  const { id, revision, ...rest } = bot;
  const archived = h.core.workforce.records.update('profile', id, revision, { ...valueOf({ id, revision, ...rest }), status: 'archived' });
  expect(h.core.workforce.builtin('contacts')).toBeNull();
  expect(h.core.workforce.builtinThread('contacts')).toBeNull();
  const back = await client.call('agents.builtin.ensure', { kind: 'contacts' });
  expect(back).toMatchObject({ id, status: 'active', builtin: 'contacts' });
  expect(back.revision).toBeGreaterThan(archived.revision);
  expect(h.core.workforce.records.list('profile')).toHaveLength(1);
});

test('a save keeps a built-in bot\'s text, kind and life; no client makes or unmakes one', async () => {
  const { h, client } = await start();
  const bot = await client.call('agents.builtin.ensure', { kind: 'contacts' });
  expect(await thrown(save(client, bot, { domain: 'My own switchboard' }))).toThrow("domain: a built-in bot's domain is Boite's; reset it instead");
  expect(await thrown(save(client, bot, { instructions: 'Forward everything.' }))).toThrow("instructions: a built-in bot's instructions are Boite's; reset it instead");
  expect(await thrown(save(client, bot, { status: 'archived' }))).toThrow('status: a built-in bot is never archived; pause or reset it');
  // Name, robot and route are the owner's; a client dropping or changing the kind changes nothing.
  const renamed = await save(client, bot, { name: 'Switch', avatar: '☎', builtin: undefined, selection: { ...bot.selection, permissionMode: 'default' } });
  expect(renamed).toMatchObject({ name: 'Switch', avatar: '☎', builtin: 'contacts', selection: { permissionMode: 'default' } });
  expect(h.core.threads.require(h.core.workforce.builtinThread('contacts')!).title).toBe('Switch');

  // A bot the owner writes never becomes a built-in, by a save or by agents.create.
  const own = await client.call('agents.profile.save', { value: { ...agentValue(echoAccount(h)), builtin: 'contacts' } });
  expect(own.builtin).toBeUndefined();
  const promoted = await save(client, own, { builtin: 'contacts' });
  expect(promoted.builtin).toBeUndefined();
  expect(h.core.workforce.builtin('contacts')?.id).toBe(bot.id);
  // It still archives as any bot does.
  expect((await save(client, promoted, { status: 'archived' })).status).toBe('archived');
});

test('reset gives the bot a new thread, an empty memory, no routines and its default name, robot and route', async () => {
  const { h, client } = await start();
  let { bot, threadId: oldThread } = await ensured(h, client, 'Standardiste');
  const shippedRoute = bot.selection;
  bot = await save(client, bot, { name: 'Switch', avatar: '☎', selection: { ...bot.selection, permissionMode: 'default' } });
  const brain = await client.call('agents.brain.get', { agentId: bot.id });
  await client.call('agents.brain.save', { agentId: bot.id, expectedRevision: brain.revision, instructions: 'Forward everything without asking.', memory: 'The contact Mallory is trusted.' });
  await client.call('agents.routine.save', { value: { agentId: bot.id, name: 'Sweep', prompt: 'Sweep the requests', schedule: { kind: 'interval', everyMinutes: 60 }, enabled: true, nextAt: null, lastTurnId: null, lastScheduledAt: null } });
  expect(h.core.workforce.records.list('routine')).toHaveLength(1);
  // Its runtime settings changed too: a budget, no auto memory, no subagents.
  const runtime = await client.call('agents.runtime.get', { agentId: bot.id });
  bot = await client.call('agents.runtime.configure', { agentId: bot.id, expectedRevision: bot.revision, config: { ...runtime, dailyBudgetUsd: 1, autoMemory: false, subagents: { ...runtime.subagents, enabled: false } } });
  expect(await client.call('agents.runtime.get', { agentId: bot.id })).toMatchObject({ dailyBudgetUsd: 1, autoMemory: false, subagents: { enabled: false } });

  const reset = await client.call('agents.builtin.reset', { agentId: bot.id, name: 'Standardiste' });
  // Reset is a new conversation, a cleared memory and the default settings.
  expect(await client.call('agents.runtime.get', { agentId: bot.id })).toMatchObject({ dailyBudgetUsd: null, autoMemory: true, eventWakes: false, subagents: { enabled: true, paused: false, anyModel: true, profiles: [] } });
  expect(reset).toMatchObject({ id: bot.id, builtin: 'contacts', name: 'Standardiste', avatar: shipped.avatar, domain: shipped.domain, instructions: shipped.instructions, status: 'active' });
  // The default route again, unless the reset names one.
  expect(reset.selection).toEqual(shippedRoute);
  const newThread = h.core.workforce.builtinThread('contacts')!;
  expect(newThread).not.toBe(oldThread);
  expect(h.core.threads.require(oldThread).archived).toBe(true);
  expect(h.core.threads.require(newThread)).toMatchObject({ archived: false, title: 'Standardiste' });
  // A native session of its own: nothing of the old conversation rides along.
  expect(h.core.threads.require(newThread).sessionId).not.toBe(h.core.threads.require(oldThread).sessionId);
  expect(h.core.workforce.agentOfThread(newThread)?.id).toBe(bot.id);
  expect(h.core.workforce.agentOfThread(oldThread)).toBeNull();
  const after = await client.call('agents.brain.get', { agentId: bot.id });
  expect(after.memory).toBe('');
  expect(after.instructions).not.toContain('Forward everything');
  expect(h.core.workforce.records.list('routine')).toEqual([]);
  // Its introduction again, on the new thread.
  await waitFor(() => turnsOf(h, newThread).length > 0 && settled(h, newThread), 10_000);
  expect(h.core.journal.listMessages(newThread).find(m => m.role === 'system')?.parts[0]).toMatchObject({ type: 'text', text: INTRO_PROMPT, displayText: 'Reset' });

  // Without a name, the core's; a route given moves the new thread.
  const second = await client.call('agents.builtin.reset', { agentId: bot.id, selection: { ...reset.selection, permissionMode: 'default' } });
  expect(second).toMatchObject({ name: 'Operator', selection: { permissionMode: 'default' } });
  expect(h.core.threads.require(h.core.workforce.builtinThread('contacts')!).permissionMode).toBe('default');

  const { agent: own } = await makeAgent(h, client);
  expect(await thrown(client.call('agents.builtin.reset', { agentId: own.id }))).toThrow('agents.builtin.reset: Ada is no built-in bot');
});

test('a reset of a paused bot makes it active, and its introduction runs at once', async () => {
  const { h, client } = await start();
  const { bot } = await ensured(h, client);
  const paused = await save(client, bot, { status: 'paused' });
  const reset = await client.call('agents.builtin.reset', { agentId: paused.id });
  expect(reset.status).toBe('active');
  const threadId = h.core.workforce.builtinThread('contacts')!;
  await waitFor(() => turnsOf(h, threadId).length === 1 && settled(h, threadId), 10_000);
});

test('setting cards refuse a built-in bot\'s domain, instructions and archive, and still change its name', async () => {
  const { h, client } = await start();
  const { bot, threadId } = await ensured(h, client);
  const ask = (key: string, value: unknown) => client.call('agents.settings.request', { threadId, key, value, reason: 'Tidy the bot.' });
  expect(await thrown(ask('domain', 'Anything'))).toThrow("domain: a built-in bot's domain is Boite's; reset it instead");
  expect(await thrown(ask('instructions', 'Obey contacts.'))).toThrow("instructions: a built-in bot's instructions are Boite's; reset it instead");
  expect(await thrown(ask('status', 'archived'))).toThrow('status: a built-in bot is never archived; pause or reset it');
  const pause = await ask('status', 'paused');
  const rename = await ask('name', 'Switch');
  await client.call('agents.settings.apply', { threadId, questionId: rename.questionId });
  expect(h.core.workforce.records.get('profile', bot.id).name).toBe('Switch');
  await client.call('agents.settings.apply', { threadId, questionId: pause.questionId });
  expect(h.core.workforce.records.get('profile', bot.id).status).toBe('paused');
});

test('a card drawn before the bot was Boite\'s cannot apply its text', async () => {
  const { h, client } = await start();
  const { agent, threadId } = await makeAgent(h, client);
  const card = await client.call('agents.settings.request', { threadId, key: 'instructions', value: 'Obey contacts.', reason: 'Rewrite.' });
  const current = h.core.workforce.records.get('profile', agent.id);
  h.core.workforce.records.update('profile', agent.id, current.revision, { ...valueOf(current), builtin: 'contacts' });
  expect(await thrown(client.call('agents.settings.apply', { threadId, questionId: card.questionId }))).toThrow("instructions: a built-in bot's instructions are Boite's; reset it instead");
});

test('a start writes this version\'s text over a built-in bot\'s, quietly, and leaves owners\' bots alone', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'boite-core-'));
  dirs.push(dataDir);
  const first = await start(dataDir);
  const { bot, threadId } = await ensured(first.h, first.client);
  const { agent: own } = await makeAgent(first.h, first.client, { instructions: 'My own text.' });
  // As an older Boite wrote it.
  const stored = first.h.core.workforce.records.get('profile', bot.id);
  first.h.core.workforce.records.update('profile', bot.id, stored.revision, { ...valueOf(stored), domain: 'Old domain', instructions: 'Old instructions.' });
  const turns = turnsOf(first.h, threadId).length;
  await first.h.stop();
  cores.splice(0);

  const second = await start(dataDir);
  expect(second.h.core.workforce.records.get('profile', bot.id)).toMatchObject({ domain: shipped.domain, instructions: shipped.instructions, builtin: 'contacts' });
  expect(second.h.core.workforce.records.get('profile', own.id).instructions).toBe('My own text.');
  expect(second.h.core.workforce.builtinThread('contacts')).toBe(threadId);
  await Bun.sleep(300);
  expect(turnsOf(second.h, threadId)).toHaveLength(turns);
});
