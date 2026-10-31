import { afterEach, beforeEach, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentProfile, CoordinationPeer } from '@boite/contracts';
import type { CoreClient } from '../src/client.ts';
import { MEMORY_ARCHIVE } from '../src/agents/context.ts';
import { makeAgent, scripted, settled, turnsOf } from './agent-fixture.ts';
import { quietAgent, startTestCore, waitFor, type TestCore } from './harness.ts';
import { thrown } from './settle.ts';

/* A bot moves from one machine of a group to another: `agents.move` on the one it leaves, `bot.move` on the one it reaches. */

const cores: TestCore[] = [];
let driver: ReturnType<typeof scripted> | null = null;
beforeEach(() => { driver = scripted(() => ({ text: 'Noted.' })); });
afterEach(async () => {
  driver?.release();
  for (const h of cores.splice(0)) await h.stop();
  driver?.restore(); driver = null;
});

/** Two machines of one group: `desk`, where the bot lives, and `pc`, where it goes, each with a project. */
async function group() {
  const desk = await startTestCore();
  const pc = await startTestCore();
  cores.push(desk, pc);
  const owner = await desk.connect();
  const pcOwner = await pc.connect();
  await desk.core.group.create('Home');
  await pc.core.group.join((await desk.core.group.invite()).invite);
  const deskId = desk.core.coordination.card().coreId;
  const pcId = pc.core.coordination.card().coreId;
  await waitFor(() => desk.core.group.peers().some(peer => peer.coreId === pcId) && pc.core.group.peers().some(peer => peer.coreId === deskId));
  const pcPeer = desk.core.group.peers().find(peer => peer.coreId === pcId)!;
  const project = async (h: TestCore, client: CoreClient, name: string) => {
    const path = join(h.dataDir, name.toLowerCase());
    mkdirSync(path, { recursive: true });
    return client.call('projects.add', { path, name });
  };
  const deskProject = await project(desk, owner, 'Garden');
  const pcProject = await project(pc, pcOwner, 'Ledger');
  return { desk, pc, owner, pcOwner, deskId, pcId, pcPeer, deskProject, pcProject };
}

/** What the source must still hold after a refused move: the profile, its routines and a live thread. */
function held(h: TestCore, agent: AgentProfile) {
  const profile = h.core.workforce.records.find('profile', agent.id);
  const session = h.core.workforce.sessionOf(agent.id);
  return {
    profile, routines: h.core.workforce.records.list('routine').filter(r => r.agentId === agent.id).length,
    archived: session === null ? null : h.core.journal.getThread(session.threadId)?.archived,
  };
}

const lastText = (h: TestCore, threadId: string) => h.core.journal.listMessages(threadId).at(-1)?.parts[0];

test('a move carries the bot, its memory, routines, projects and the end of its conversation; the next prompt there says so once', async () => {
  const { desk, pc, owner, pcOwner, deskId, pcId, pcPeer, deskProject, pcProject } = await group();
  const { agent: made, threadId } = await makeAgent(desk, owner, {
    name: 'Ada', domain: 'Gardens', instructions: 'Water the plants.', avatar: 'bot:c.1.2.3.4.1.1.0', projectIds: [deskProject.id, `${pcId}/${pcProject.id}`],
  });
  // A turn the user and the bot had: its end goes with the bot.
  await owner.call('turns.start', { threadId, prompt: 'The door is blue.' });
  await waitFor(() => settled(desk, threadId) && turnsOf(desk, threadId).length >= 2, 10_000);
  const brain = await owner.call('agents.brain.get', { agentId: made.id });
  await owner.call('agents.brain.save', { agentId: made.id, expectedRevision: brain.revision, instructions: '# Ada\n\nPrune on Mondays.\n', memory: 'The door is blue.\n' });
  writeFileSync(join(brain.path, MEMORY_ARCHIVE), 'An old memory.\n');
  await owner.call('agents.routine.save', { value: { agentId: made.id, name: 'Morning round', prompt: 'Check the plants.', schedule: { kind: 'interval', everyMinutes: 60 }, enabled: true, nextAt: null, lastTurnId: null, lastScheduledAt: null } });
  await owner.call('agents.routine.save', { value: { agentId: made.id, name: 'Sunday', prompt: 'Plan the week.', schedule: { kind: 'daily', time: '09:00', timezone: 'UTC', days: [0] }, enabled: false, nextAt: null, lastTurnId: null, lastScheduledAt: null } });
  desk.core.workforce.fact(made.id, { key: 'letter', text: 'A letter about the roses came.', urgent: false });
  const agent = desk.core.workforce.records.get('profile', made.id);
  const ours = desk.core.workforce.brainOf({ agentId: agent.id });

  const moved = await owner.call('agents.move', { agentId: agent.id, machine: pcId, requestId: 'move-1' });
  expect(moved).toMatchObject({ agentId: agent.id, machine: pcId, projectIds: [`${deskId}/${deskProject.id}`, pcProject.id], groupProjects: [`${deskId}/${deskProject.id}`] });

  // There: the same bot, on that machine's echo account.
  const there = pc.core.workforce.records.get('profile', agent.id);
  const pcEcho = pc.core.accounts.list().find(a => a.providerId === 'echo')!.id;
  expect(there).toMatchObject({ name: 'Ada', domain: 'Gardens', instructions: 'Water the plants.', avatar: 'bot:c.1.2.3.4.1.1.0', status: 'active', projectIds: moved.projectIds });
  expect(there.selection).toEqual({ ...agent.selection, accountId: pcEcho });
  expect(pc.core.workforce.sessionOf(agent.id)?.threadId).toBe(moved.threadId);
  const theirs = pc.core.workforce.brainOf({ agentId: agent.id });
  expect(theirs.instructions).toBe(ours.instructions);
  expect(theirs.memory).toBe(ours.memory);
  expect(ours.instructions).toContain('Prune on Mondays.');
  expect(ours.memory).toContain('The door is blue.');
  expect(readFileSync(join(theirs.path, MEMORY_ARCHIVE), 'utf8')).toBe('An old memory.\n');
  const routines = pc.core.workforce.records.list('routine').filter(r => r.agentId === agent.id);
  expect(routines.map(r => [r.name, r.prompt, r.enabled])).toEqual([['Morning round', 'Check the plants.', true], ['Sunday', 'Plan the week.', false]]);
  expect(routines[0]!.nextAt).toBeGreaterThan(Date.now());
  expect(routines[1]!.nextAt).toBeNull();
  expect(pc.core.agentRuntime.facts(agent.id).map(f => [f.key, f.text])).toEqual([['letter', 'A letter about the roses came.']]);
  expect(pc.core.journal.listMessages(moved.threadId).some(m => m.role === 'user' && m.parts.some(p => p.type === 'text' && p.text === 'The door is blue.'))).toBe(true);
  // No wake ran on arrival.
  expect(turnsOf(pc, moved.threadId).every(turn => turn.status === 'done' && turn.usage === null)).toBe(true);

  // Here: nothing of the bot but its archived thread, which says where it went.
  expect(desk.core.workforce.records.find('profile', agent.id)).toBeNull();
  expect(desk.core.workforce.records.list('routine').filter(r => r.agentId === agent.id)).toHaveLength(0);
  expect(desk.core.workforce.sessionOf(agent.id)).toBeNull();
  expect(desk.core.journal.getThread(threadId)?.archived).toBe(true);
  expect(lastText(desk, threadId)).toMatchObject({ type: 'text', text: `Moved to ${pcPeer.name}` });
  expect(desk.core.agentRuntime.facts(agent.id)).toHaveLength(0);
  expect(existsSync(brain.path)).toBe(false);

  // The first prompt there carries the move note and the carried conversation; the second does not.
  await pcOwner.call('turns.start', { threadId: moved.threadId, prompt: 'Hello there' });
  await waitFor(() => settled(pc, moved.threadId) && (driver!.prompts.get(moved.threadId)?.length ?? 0) === 1, 10_000);
  await pcOwner.call('turns.start', { threadId: moved.threadId, prompt: 'And now?' });
  await waitFor(() => settled(pc, moved.threadId) && (driver!.prompts.get(moved.threadId)?.length ?? 0) === 2, 10_000);
  const [first, second] = driver!.prompts.get(moved.threadId)!;
  const deskName = desk.core.group.view('owner')!.cores.find(c => c.coreId === deskId)!.name;
  expect(first!.split(`You moved from ${deskName} to ${pcPeer.name} on `)).toHaveLength(2);
  expect(first).toContain('the end of your conversation came with you');
  expect(first).toContain('The door is blue.');
  expect(first).toContain('Hello there');
  expect(second).not.toContain('You moved from');
  expect(second).toContain('And now?');
}, 60_000);

test('the same request reaching the target twice makes one bot, and the same requestId answers the first move again', async () => {
  const { desk, pc, owner, pcId } = await group();
  const { agent } = await makeAgent(desk, owner);
  // Every address of a member may be asked: the target hears the same request twice.
  const answers: unknown[] = [];
  let sent: Record<string, unknown> = {};
  const request = desk.core.coordination.request.bind(desk.core.coordination);
  desk.core.coordination.request = async (peer: CoordinationPeer, operation, payload) => {
    if (operation !== 'bot.move') return request(peer, operation, payload);
    sent = payload as Record<string, unknown>;
    answers.push(await request(peer, operation, payload));
    answers.push(await request(peer, operation, payload));
    return answers.at(-1);
  };
  const moved = await owner.call('agents.move', { agentId: agent.id, machine: pcId, requestId: 'twice' });
  expect(answers[0]).toEqual(answers[1]);
  expect((answers[0] as { threadId: string }).threadId).toBe(moved.threadId);
  expect(pc.core.workforce.records.list('profile').filter(p => p.id === agent.id)).toHaveLength(1);
  expect(pc.core.journal.listThreads().filter(t => t.agentSessionId !== undefined && t.title === agent.name)).toHaveLength(1);
  expect(await owner.call('agents.move', { agentId: agent.id, machine: pcId, requestId: 'twice' })).toEqual(moved);
  expect(answers).toHaveLength(2);
  // Another request for a bot the target already holds is refused there.
  desk.core.coordination.request = request;
  const pcPeer = desk.core.group.peers().find(p => p.coreId === pcId)!;
  expect(await thrown(request(pcPeer, 'bot.move', { ...sent, requestId: 'another' }))).toThrow(`already holds a bot ${agent.id}`);
}, 60_000);

test('a move is refused, with nothing changed here, for this machine, an unknown one, a turn in flight, a target without an account or with its own built-in', async () => {
  const { desk, pc, owner, pcOwner, deskId, pcId, pcProject } = await group();
  const { agent, threadId } = await makeAgent(desk, owner, { projectIds: [`${pcId}/${pcProject.id}`] });
  await owner.call('agents.routine.save', { value: { agentId: agent.id, name: 'Round', prompt: 'Look around.', schedule: { kind: 'interval', everyMinutes: 30 }, enabled: true, nextAt: null, lastTurnId: null, lastScheduledAt: null } });
  const before = held(desk, agent);
  const unchanged = () => expect(held(desk, agent)).toEqual(before);

  expect(await thrown(owner.call('agents.move', { agentId: agent.id, machine: deskId }))).toThrow('is this machine');
  unchanged();
  expect(await thrown(owner.call('agents.move', { agentId: agent.id, machine: 'nowhere' }))).toThrow('no machine nowhere in this group');
  unchanged();

  // A turn in flight: refused with its reason.
  driver!.restore();
  driver = scripted(() => ({ text: 'Working.', hold: true }));
  await owner.call('turns.start', { threadId, prompt: 'Keep going.' });
  await waitFor(() => desk.core.threads.isBusy(threadId));
  const busy = await owner.call('agents.move', { agentId: agent.id, machine: pcId }).catch(error => error as { message: string; rpc: { data: Record<string, unknown> } });
  expect((busy as { message: string }).message).toContain('has a turn running or queued');
  expect((busy as { rpc: { data: Record<string, unknown> } }).rpc.data).toMatchObject({ reason: 'turn-in-flight', threadId, busyThreadId: threadId });
  driver.release();
  await waitFor(() => settled(desk, threadId), 10_000);
  unchanged();

  // A target with its own live Contacts bot refuses another.
  pc.core.workforce.setLimits({ paused: true });
  desk.core.workforce.setLimits({ paused: true });
  await pcOwner.call('agents.builtin.ensure', { kind: 'contacts' });
  const operator = await quietAgent(owner, await owner.call('agents.builtin.ensure', { kind: 'contacts' }));
  const operatorBefore = held(desk, operator);
  expect(await thrown(owner.call('agents.move', { agentId: operator.id, machine: pcId }))).toThrow('already has its own contacts bot');
  expect(held(desk, operator)).toEqual(operatorBefore);
  expect(desk.core.workforce.builtinThread('contacts')).not.toBeNull();

  // A target where nothing is signed in.
  const echo = pc.core.accounts.list().find(a => a.providerId === 'echo')!;
  for (const account of pc.core.accounts.list()) pc.core.journal.putAccount({ ...account, status: 'unauthenticated' });
  expect(await thrown(owner.call('agents.move', { agentId: agent.id, machine: pcId }))).toThrow(`has no signed-in account to run ${agent.name}; sign in there first`);
  unchanged();
  expect(pc.core.workforce.records.find('profile', agent.id)).toBeNull();
  expect(echo).toBeDefined();
}, 60_000);

test('the Contacts bot moves: the target answers for it and this machine no longer does', async () => {
  const { desk, pc, owner, pcId } = await group();
  desk.core.workforce.setLimits({ paused: true });
  const operator = await quietAgent(owner, await owner.call('agents.builtin.ensure', { kind: 'contacts' }));
  await owner.call('agents.profile.save', { id: operator.id, expectedRevision: operator.revision, value: { ...(({ id: _i, revision: _r, createdAt: _c, updatedAt: _u, ...rest }) => rest)(operator), status: 'paused' } });
  expect(desk.core.workforce.builtinThread('contacts')).not.toBeNull();
  const moved = await owner.call('agents.move', { agentId: operator.id, machine: pcId });
  expect(pc.core.workforce.builtinThread('contacts')).toBe(moved.threadId);
  expect(pc.core.workforce.builtin('contacts')).toMatchObject({ id: operator.id, builtin: 'contacts', status: 'paused' });
  expect(desk.core.workforce.builtinThread('contacts')).toBeNull();
  expect(desk.core.workforce.builtin('contacts')).toBeNull();
}, 60_000);
