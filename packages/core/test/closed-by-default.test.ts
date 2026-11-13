import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { settingAnswerText, type AgentCreateAsked, type AgentCreated, type MessagePart, type Settings } from '@boite/contracts';
import { runCli } from '../src/cli.ts';
import { echoThread, removeDir, startTestCore, waitFor, type TestCore } from './harness.ts';

const cores: TestCore[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const core of cores.splice(0)) await core.stop();
  for (const dir of dirs.splice(0)) await removeDir(dir);
});

/** The message a call was refused with. */
async function thrown(promise: PromiseLike<unknown>): Promise<{ message: string }> {
  try { await promise; } catch (error) { return { message: error instanceof Error ? error.message : String(error) }; }
  return { message: '' };
}

/** A core as an install starts it: the harness leaves the two agent settings as the core stored them. */
async function boot(dataDir?: string): Promise<TestCore> {
  const core = await startTestCore({ agentDefaults: 'boot', ...(dataDir === undefined ? {} : { dataDir }) });
  cores.push(core);
  return core;
}

async function twoProjects(h: TestCore) {
  const owner = await h.connect();
  const { threadId: here, accountId } = await echoThread(h, owner, 'Here');
  const sibling = await owner.call('threads.create', { projectId: h.core.threads.require(here).projectId!, providerId: 'echo', accountId, title: 'Sibling' });
  const path = join(h.dataDir, 'elsewhere'); mkdirSync(path, { recursive: true });
  const project = await owner.call('projects.add', { path, name: 'Elsewhere' });
  const far = await owner.call('threads.create', { projectId: project.id, providerId: 'echo', accountId, title: 'Far' });
  // A card is drawn under a turn.
  await owner.call('turns.start', { threadId: here, prompt: 'Start.' });
  await waitFor(() => h.core.threads.require(here).status === 'idle' && h.core.journal.listMessages(here).length > 0);
  const address = (threadId: string) => ({ coreId: h.core.coordination.identity().coreId, threadId });
  return { owner, here, sibling: sibling.id, far: far.id, address };
}

test('a new data directory starts closed: bots are asked for on a card and threads reach their own project', async () => {
  const h = await boot();
  const stored = h.core.journal.getSetting('settings') as Settings;
  expect([stored.agentBotCreation, stored.coordinationReach]).toEqual(['ask', 'project']);
  const { owner, here, sibling, far, address } = await twoProjects(h);
  const coordination = h.core.coordination;

  // Listing, searching, reading and writing stop at the project.
  expect((await coordination.directory(here)).agents.map(agent => agent.threadId)).toEqual([sibling]);
  expect((await coordination.search(here, 'Far')).matches).toEqual([]);
  const read = await thrown(coordination.read(here, address(far)));
  expect(read.message).toContain('coordinationReach is "project"');
  expect(read.message).toContain('boite settings request coordinationReach machine --why');
  const send = await thrown(coordination.send({ threadId: here, to: address(far), text: 'hello', requestId: 'r1' }));
  expect(send.message).toContain('boite settings request coordinationReach machine --why');
  expect((await coordination.send({ threadId: here, to: address(sibling), text: 'hello', requestId: 'r2' })).status).not.toBe('rejected');

  // The key is one an agent may ask about, and the owner's change opens the machine.
  const card = await owner.call('settings.request', { threadId: here, key: 'coordinationReach', value: 'machine', reason: 'Read the release thread' });
  expect(card.setting).toMatchObject({ kind: 'change', key: 'coordinationReach', value: 'machine', previous: 'project', sensitive: false });
  await owner.call('settings.set', { coordinationReach: 'machine' });
  expect((await coordination.directory(here)).agents.map(agent => agent.threadId).sort()).toEqual([sibling, far].sort());
  expect((await coordination.read(here, address(far))).contact.threadId).toBe(far);
  expect((await coordination.send({ threadId: here, to: address(far), text: 'hello', requestId: 'r3' })).to.threadId).toBe(far);
  // A thread's own setting still narrows inside the reach.
  coordination.configure(here, { ...coordination.config(here), remote: false });
  expect((await coordination.directory(here)).agents.map(agent => agent.threadId)).toEqual([sibling]);
  expect((await thrown(coordination.send({ threadId: here, to: address(far), text: 'again', requestId: 'r4' }))).message).toBe('both threads must enable coordination across projects');
});

test('reach machine keeps a thread from trusted machines and names the setting; group lets it through', async () => {
  const h = await boot();
  const { owner, here } = await twoProjects(h);
  await owner.call('settings.set', { coordinationReach: 'machine' });
  const remote = { coreId: 'f'.repeat(64), threadId: 'thr_remote' };
  const refusal = await thrown(h.core.coordination.send({ threadId: here, to: remote, text: 'hello', requestId: 'm1' }));
  expect(refusal.message).toContain('coordinationReach is "machine"');
  expect(refusal.message).toContain('boite settings request coordinationReach group --why');
  expect((await thrown(h.core.coordination.read(here, remote))).message).toContain('boite settings request coordinationReach group --why');
  await owner.call('settings.set', { coordinationReach: 'group' });
  // Past the reach, the existing rule answers: that machine is not trusted.
  expect((await thrown(h.core.coordination.send({ threadId: here, to: remote, text: 'hello', requestId: 'm2' }))).message).toBe('destination machine is not trusted for coordination');
});

test('with ask, agents.create draws a card and creates nothing until the owner approves; declining creates nothing', async () => {
  const h = await boot();
  const { owner, here } = await twoProjects(h);
  const bots = () => h.core.workforce.records.list('profile').map(agent => agent.name);
  const before = bots();
  const part = (questionId: string) => h.core.journal.listMessages(here).flatMap(m => m.parts)
    .find((p): p is Extract<MessagePart, { type: 'question' }> => p.type === 'question' && p.questionId === questionId)!;

  let out = '';
  const code = await runCli(['settings', 'bot', 'create', 'Herald', '--domain', 'News'], { out: s => { out += s; }, err: s => { out += s; }, env: { BOITE_THREAD_ID: here, BOITE_CORE_URL: h.url, BOITE_AGENT_TOKEN: h.core.agents.tokenFor(here) }, cwd: h.dataDir });
  expect(code).toBe(0);
  expect(out).toContain('boite settings request agentBotCreation free --why');
  expect(bots()).toEqual(before);
  const [card] = h.core.threads.listQuestions(here).filter(question => question.setting?.kind === 'bot');
  expect(card!.setting).toMatchObject({ kind: 'bot', bot: { name: 'Herald', domain: 'News', selection: { permissionMode: 'bypassPermissions' } } });
  // The same bot is not asked for twice.
  expect((await thrown(owner.call('agents.create', { threadId: here, name: 'herald' }))).message).toContain('already open');

  const made = await owner.call('agents.create.approve', { threadId: here, questionId: card!.id });
  expect(made.agent.name).toBe('Herald');
  expect(made.agent.selection.permissionMode).toBe('bypassPermissions');
  expect(bots()).toEqual([...before, 'Herald']);
  expect(h.core.threads.listQuestions(here).filter(question => question.setting?.kind === 'bot')).toEqual([]);
  const answer = part(card!.id).answer!;
  expect(settingAnswerText(card!.setting!, answer)).toContain(`approved: the bot "Herald" exists (${made.agent.id})`);

  const second = await owner.call('agents.create', { threadId: here, name: 'Scout' }) as AgentCreateAsked;
  await owner.call('questions.answer', { threadId: here, questionId: second.questionId, optionIds: ['refuse'] });
  expect(bots()).toEqual([...before, 'Herald']);
  expect(settingAnswerText(second.setting, part(second.questionId).answer!)).toBe('declined: the user did not create the bot "Scout"; nothing was created');
  expect((await thrown(owner.call('agents.create.approve', { threadId: here, questionId: second.questionId }))).message).toContain('no open bot card');

  // Free: the bot exists at once, as before the setting.
  await owner.call('settings.set', { agentBotCreation: 'free' });
  expect((await owner.call('agents.create', { threadId: here, name: 'Scout' }) as AgentCreated).agent.name).toBe('Scout');
});

test('a data directory older than the two settings is opened once, and stays as the owner sets it', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'boite-older-')); dirs.push(dataDir);
  // An install of an earlier version: a journal whose settings hold neither key.
  const first = await boot(dataDir);
  first.core.journal.setSetting('settings', { warmProcessMinutes: 5 });
  await first.stop();

  const upgraded = await boot(dataDir);
  expect(upgraded.core.journal.getSetting('settings')).toMatchObject({ warmProcessMinutes: 5, agentBotCreation: 'free', coordinationReach: 'group' });
  const { owner, here, far, address } = await twoProjects(upgraded);
  expect((await upgraded.core.coordination.read(here, address(far))).contact.threadId).toBe(far);
  expect('agent' in await owner.call('agents.create', { threadId: here, name: 'Herald' })).toBe(true);
  await upgraded.stop();

  const again = await boot(dataDir);
  expect(again.core.settings.get()).toMatchObject({ agentBotCreation: 'free', coordinationReach: 'group' });
  again.core.settings.set({ agentBotCreation: 'ask' });
  await again.stop();
  const kept = await boot(dataDir);
  expect(kept.core.settings.get()).toMatchObject({ agentBotCreation: 'ask', coordinationReach: 'group' });
});

test('a new data directory stays closed after a restart', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'boite-new-')); dirs.push(dataDir);
  await (await boot(dataDir)).stop();
  const second = await boot(dataDir);
  expect(second.core.settings.get()).toMatchObject({ agentBotCreation: 'ask', coordinationReach: 'project' });
});
