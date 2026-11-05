import { afterEach, beforeEach, expect, test } from 'bun:test';
import type { MessagePart } from '@boite/contracts';
import { connect } from '../src/client.ts';
import type { CoreClient } from '../src/client.ts';
import { INTRO_PROMPT } from '../src/agents/store.ts';
import { setDriver } from '../src/drivers/index.ts';
import { echoDriver } from '../src/drivers/echo.ts';
import { ModelProbes } from '../src/drivers/model-probes.ts';
import { forgetSavedCatalog } from '../src/providers/saved-catalogs.ts';
import { agentValue, echoAccount, makeAgent, settled, turnsOf } from './agent-fixture.ts';
import { echoThread, startTestCore, testProject, waitFor, type TestCore } from './harness.ts';
import { thrown } from './settle.ts';

let h: TestCore;
let client: CoreClient;
beforeEach(async () => { h = await startTestCore(); client = await h.connect(); });
afterEach(async () => { await h.stop(); });

const opening = (threadId: string, turnId: string) => h.core.journal.listMessages(threadId).find(m => m.turnId === turnId && m.role !== 'assistant');
const text = (part: MessagePart | undefined) => part?.type === 'text' ? part : null;

test('creating an agent creates its thread and starts its introduction there', async () => {
  const agent = await client.call('agents.profile.save', { value: agentValue(echoAccount(h)) });
  const { threadId } = await client.call('agents.open', { agentId: agent.id });
  const thread = h.core.threads.require(threadId);
  expect(thread).toMatchObject({ projectId: null, title: 'Ada', agentSessionId: h.core.workforce.sessionOf(agent.id)!.id });
  // The introduction starts at once, as an event turn opened by Boite.
  const [intro] = turnsOf(h, threadId);
  expect(intro?.execution?.operation).toBe('event');
  const line = opening(threadId, intro!.id)!;
  expect(line.role).toBe('system');
  expect(text(line.parts[0])).toMatchObject({ text: INTRO_PROMPT, displayText: 'Just created' });
  await waitFor(() => settled(h, threadId), 10_000);
  const snapshot = await client.call('agents.snapshot', {});
  expect(snapshot.sessions).toEqual([expect.objectContaining({ agentId: agent.id, threadId })]);
  expect(snapshot.status[0]).toMatchObject({ agentId: agent.id, threadId, state: 'idle', problem: null, today: { turns: expect.any(Number), wakes: 1 } });
  expect(snapshot.status[0]!.last?.text.length).toBeGreaterThan(0);
  expect(snapshot.watches).toEqual([]);
});

test('a restart that has not read an agent\'s models yet does not report the bot\'s model as gone', async () => {
  // A provider whose models only its agent lists, as Codex's are.
  const descriptor = h.core.providers.require('echo');
  descriptor.protocol = 'acp';
  let listed = [{ id: 'discovered', name: 'Discovered' }];
  const cache = new ModelProbes(async () => listed);
  const reset = setDriver('acp', { ...echoDriver, protocol: 'acp', probe: ctx => cache.probe(ctx), probedModels: (p, a) => cache.models(p, a), forgetProbes: f => cache.forget(f) });
  try {
    const accountId = echoAccount(h);
    await client.call('providers.probe', { providerId: 'echo', accountId });
    const agent = await client.call('agents.profile.save', { value: agentValue(accountId, { selection: { providerId: 'echo', accountId, model: 'discovered', effort: null, permissionMode: 'default' } }) });
    const problem = async () => (await client.call('agents.snapshot', {})).status.find(s => s.agentId === agent.id)!.problem;
    expect(await problem()).toBeNull();
    // A restart: the driver read nothing yet, the saved list stands for the account.
    cache.forget({});
    expect(await problem()).toBeNull();
    // Nothing saved either: the list is unknown, not missing the model.
    forgetSavedCatalog(h.core, accountId);
    expect(await problem()).toBeNull();
    // A read that really drops it names the model.
    listed = [{ id: 'other', name: 'Other' }];
    await client.call('providers.probe', { providerId: 'echo', accountId, refresh: true });
    expect(await problem()).toBe('Echo no longer lists discovered; choose another model for Ada in its settings.');
  } finally { reset(); descriptor.protocol = 'echo'; }
});

test('an Antigravity bot saved on a pre-1.4 model id is not reported as gone', async () => {
  // Antigravity 1.4 lists `gemini-3.8-flash` and takes the level apart, yet
  // still runs the `gemini-3.8-flash-low` a bot made before it holds.
  const descriptor = h.core.providers.require('echo');
  descriptor.protocol = 'acp';
  descriptor.quirks = ['antigravity'];
  const cache = new ModelProbes(async () => [{ id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash' }]);
  const reset = setDriver('acp', { ...echoDriver, protocol: 'acp', probe: ctx => cache.probe(ctx), probedModels: (p, a) => cache.models(p, a), forgetProbes: f => cache.forget(f) });
  try {
    const accountId = echoAccount(h);
    await client.call('providers.probe', { providerId: 'echo', accountId });
    const save = (model: string) => client.call('agents.profile.save', { value: agentValue(accountId, { selection: { providerId: 'echo', accountId, model, effort: null, permissionMode: 'default' } }) });
    const problem = async (id: string) => (await client.call('agents.snapshot', {})).status.find(s => s.agentId === id)!.problem;
    expect(await problem((await save('gemini-3.8-flash-low')).id)).toBeNull();
    // A family the agent does not list is still refused, level or not.
    expect(await thrown(save('gemini-3.7-flash-low'))).toThrow('the provider does not offer this model');
  } finally { reset(); descriptor.protocol = 'echo'; delete descriptor.quirks; }
});

test('a pinned bot stays pinned through a save that predates the field, until it is unpinned', async () => {
  const value = agentValue(echoAccount(h));
  const agent = await client.call('agents.profile.save', { value });
  expect(agent.pinned).toBeUndefined();
  const pinned = await client.call('agents.profile.save', { id: agent.id, expectedRevision: agent.revision, value: { ...value, pinned: true } });
  expect(pinned.pinned).toBe(true);
  // A client that predates the pin saves without it: the bot stays pinned.
  const edited = await client.call('agents.profile.save', { id: agent.id, expectedRevision: pinned.revision, value: { ...value, domain: 'Design' } });
  expect(edited.pinned).toBe(true);
  expect(await thrown(client.call('agents.profile.save', { id: agent.id, expectedRevision: edited.revision, value: { ...value, pinned: 'yes' as never } }))).toThrow('pinned: expected a boolean');
  await client.call('agents.profile.save', { id: agent.id, expectedRevision: edited.revision, value: { ...value, pinned: false } });
  expect((await client.call('agents.snapshot', {})).profiles.find(p => p.id === agent.id)).not.toHaveProperty('pinned');
});

test('an agent created while wakes are paused introduces itself once they resume', async () => {
  await client.call('agents.limits.set', { paused: true });
  const agent = await client.call('agents.profile.save', { value: agentValue(echoAccount(h)) });
  const { threadId } = await client.call('agents.open', { agentId: agent.id });
  await Bun.sleep(700);
  expect(turnsOf(h, threadId)).toEqual([]);
  expect((await client.call('agents.snapshot', {})).status[0]!.state).toBe('paused');
  await client.call('agents.limits.set', { paused: false });
  await waitFor(() => turnsOf(h, threadId).length === 1 && settled(h, threadId), 10_000);
  expect(turnsOf(h, threadId)[0]!.execution?.operation).toBe('event');
});

test('a user message on an agent thread is an ordinary turn: queued, steered, stopped', async () => {
  const { threadId } = await makeAgent(h, client);
  const before = turnsOf(h, threadId).length;
  const turn = await client.call('turns.start', { threadId, prompt: 'Look at this [sleep:60000]' });
  expect(turn.execution?.operation).toBeUndefined();
  expect(['queued', 'running']).toContain(turn.status);
  expect(opening(threadId, turn.id)?.role).toBe('user');
  await waitFor(() => h.core.threads.require(threadId).status === 'running');
  // A second message while it works is the thread's own business: steered into the running turn.
  const steered = await client.call('turns.steer', { threadId, turnId: turn.id, prompt: 'and this', clientRequestId: 'steer-agent-001' });
  expect(steered.accepted).toBe(true);
  expect(await thrown(client.call('turns.start', { threadId, prompt: 'again' }))).toThrow('in-flight');
  expect((await client.call('turns.stop', { threadId })).stopped).toBe(true);
  await waitFor(() => settled(h, threadId));
  expect(turnsOf(h, threadId).slice(before).map(t => t.status)).toEqual(['stopped']);
  const capabilities = await client.call('threads.capabilities', { threadId });
  expect(capabilities.steering.reason).not.toBe('agent-session');
  expect(capabilities.fork.seeded.available).toBe(false);
});

test('an agent thread is never deleted; archiving the agent archives it and the agent comes back with it', async () => {
  const { agent, threadId } = await makeAgent(h, client);
  expect(await thrown(client.call('threads.remove', { threadId }))).toThrow("a bot's thread goes when the bot is archived");
  const archived = await client.call('agents.profile.save', { id: agent.id, expectedRevision: agent.revision, value: { ...agent, status: 'archived' } });
  expect(h.core.threads.require(threadId).archived).toBe(true);
  expect((await client.call('agents.snapshot', {})).status[0]!.state).toBe('archived');
  await client.call('agents.profile.save', { id: agent.id, expectedRevision: archived.revision, value: { ...archived, status: 'active' } });
  expect(h.core.threads.require(threadId).archived).toBe(false);
});

test('a bot thread removed with its project tells the clients, so no snapshot keeps naming it', async () => {
  const { threadId } = await makeAgent(h, client);
  // A bot carried over from an older core may keep its thread in a project.
  const project = await testProject(h, client);
  h.core.journal.putThread({ ...h.core.threads.require(threadId), projectId: project.id });
  // Each event's dispatch notes whether it invalidated the snapshot: the archive that comes first may go out
  // before the removal, and then nothing else would tell the clients the thread is gone.
  const store = h.core.workforce as unknown as { changed: () => void };
  const changed = store.changed.bind(store);
  let invalidated = false;
  store.changed = () => { invalidated = true; changed(); };
  const told: Record<string, boolean> = {};
  const off = h.core.bus.onAny((name, payload) => {
    if ((payload as { threadId?: string; id?: string } | null)?.threadId === threadId || (payload as { id?: string } | null)?.id === threadId) told[name] = invalidated;
    invalidated = false;
  });
  try { await client.call('projects.remove', { projectId: project.id }); } finally { off(); }
  expect(h.core.journal.getThread(threadId)).toBeNull();
  expect(told).toMatchObject({ 'thread.updated': true, 'thread.removed': true });
});

test('renaming a bot keeps the route its thread was moved to; a new route on the bot moves it', async () => {
  const { agent, threadId } = await makeAgent(h, client);
  // The user moved the conversation itself to another mode.
  await client.call('threads.update', { threadId, permissionMode: 'plan' });
  const renamed = await client.call('agents.profile.save', { id: agent.id, expectedRevision: agent.revision, value: { ...agent, name: 'Ada Two' } });
  expect(h.core.threads.require(threadId)).toMatchObject({ title: 'Ada Two', permissionMode: 'plan' });
  await client.call('agents.profile.save', { id: agent.id, expectedRevision: renamed.revision, value: { ...renamed, selection: { ...renamed.selection, permissionMode: 'acceptEdits' } } });
  expect(h.core.threads.require(threadId).permissionMode).toBe('acceptEdits');
});

test('agents.open makes the thread again when it was lost', async () => {
  const { agent, threadId } = await makeAgent(h, client);
  h.core.journal.deleteThreads([threadId]);
  const { threadId: again } = await client.call('agents.open', { agentId: agent.id });
  expect(again).not.toBe(threadId);
  expect(h.core.threads.require(again).agentSessionId).toBe(h.core.workforce.sessionOf(agent.id)!.id);
  expect(h.core.workforce.records.list('session')).toHaveLength(1);
});

test('an agent thread reads its own snapshot and nothing of another agent; an ordinary thread reads none', async () => {
  const { agent, threadId } = await makeAgent(h, client);
  const other = await makeAgent(h, client, { name: 'Bea' });
  await client.call('agents.accounts.set', { grants: [{ accountId: echoAccount(h), agentIds: null }] });
  const own = await connect(h.url, h.core.agents.tokenFor(threadId));
  try {
    const snapshot = await own.call('agents.snapshot', { threadId });
    expect(snapshot.profiles.map(p => p.id)).toEqual([agent.id]);
    expect(snapshot.sessions.map(s => s.threadId)).toEqual([threadId]);
    expect(snapshot.accountGrants).toEqual([]);
    expect(await thrown(own.call('agents.snapshot', { threadId: other.threadId }))).toThrow('is for thread');
    expect(await thrown(own.call('agents.runtime.configure', { threadId, agentId: agent.id, expectedRevision: agent.revision, config: h.core.workforce.resident.config(agent.id) } as never))).toThrow("not one of the agent's methods");
  } finally { own.close(); }
  const { threadId: ordinary } = await echoThread(h, client);
  const plain = await connect(h.url, h.core.agents.tokenFor(ordinary));
  try { expect(await thrown(plain.call('agents.snapshot', { threadId: ordinary }))).toThrow("no bot's thread"); }
  finally { plain.close(); }
});

test('an unused provider account still belongs to its persistent profile', async () => {
  await makeAgent(h, client);
  expect(await thrown(client.call('accounts.remove', { accountId: echoAccount(h) }))).toThrow('this account is used by a bot');
});

test('a paired phone lists agents, opens one and talks to it with turns.start', async () => {
  const { agent, threadId } = await makeAgent(h, client);
  const { grant } = await client.call('pairing.grant', {});
  const phone = await connect(h.url, '', { grant, client: { name: 'Phone', version: 'test' } });
  try {
    expect((await phone.call('agents.snapshot', {})).profiles.map(p => p.id)).toEqual([agent.id]);
    expect(await phone.call('agents.open', { agentId: agent.id })).toEqual({ threadId });
    await phone.call('turns.start', { threadId, prompt: 'From the phone' });
    await waitFor(() => settled(h, threadId) && h.core.journal.listMessages(threadId).some(m => m.role === 'user'));
    expect(await thrown(phone.call('agents.profile.save', { id: agent.id, expectedRevision: agent.revision, value: agent }))).toThrow('owner');
  } finally { phone.close(); }
});

test('an agent created paused introduces itself once it is made active', async () => {
  const agent = await client.call('agents.profile.save', { value: agentValue(echoAccount(h), { status: 'paused' }) });
  const { threadId } = await client.call('agents.open', { agentId: agent.id });
  await Bun.sleep(700);
  expect(turnsOf(h, threadId)).toEqual([]);
  const current = h.core.workforce.records.get('profile', agent.id);
  await client.call('agents.profile.save', { id: agent.id, expectedRevision: current.revision, value: { ...current, status: 'active' } });
  await waitFor(() => turnsOf(h, threadId).length === 1 && settled(h, threadId), 10_000);
  expect(text(opening(threadId, turnsOf(h, threadId)[0]!.id)!.parts[0])).toMatchObject({ displayText: 'Just created' });
});
