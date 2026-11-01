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

test('a bot wearing an imported picture takes it along: the target stores the bytes and serves the same avatar', async () => {
  const { desk, owner, pcOwner, pcId } = await group();
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  const { avatar } = await owner.call('agents.picture.put', { dataUrl: png });
  const { agent } = await makeAgent(desk, owner, { avatar });
  await owner.call('agents.move', { agentId: agent.id, machine: pcId, requestId: 'move-picture' });
  expect((await pcOwner.call('agents.snapshot', {})).profiles.find(p => p.id === agent.id)?.avatar).toBe(avatar);
  expect(await pcOwner.call('agents.picture.get', { avatar })).toEqual({ dataUrl: png });
}, 60_000);

test('a bot on its way to another machine joins no team meanwhile, and its archived team stays archived', async () => {
  const { desk, owner, pcId } = await group();
  const { agent } = await makeAgent(desk, owner);
  await owner.call('client.preferences', { app: 'app-desktop-0001', language: 'en', experiments: ['teams'], labels: {} });
  const old = desk.core.teams.create({ name: 'Old crew', members: [agent.id] });
  desk.core.teams.archive({ teamId: old.id, archived: true });
  const request = desk.core.coordination.request.bind(desk.core.coordination);
  let joined: unknown = null, restored: unknown = null;
  desk.core.coordination.request = async (peer: CoordinationPeer, operation, payload) => {
    if (operation === 'bot.move') {
      joined = await thrown(Promise.resolve().then(() => desk.core.teams.create({ name: 'Crew', members: [agent.id] })));
      restored = await thrown(Promise.resolve().then(() => desk.core.teams.archive({ teamId: old.id, archived: false })));
    }
    return request(peer, operation, payload);
  };
  await owner.call('agents.move', { agentId: agent.id, machine: pcId });
  expect(joined).toThrow(`${agent.name} is moving to another machine; a team holds bots of one machine`);
  expect(restored).toThrow(`Old crew has members on or going to another machine: ${agent.name}; remove them before restoring it`);
  // Once it left, the team comes back only without it.
  expect(await thrown(Promise.resolve().then(() => desk.core.teams.archive({ teamId: old.id, archived: false })))).toThrow('remove them before restoring it');
  desk.core.teams.removeMember({ teamId: old.id, botId: agent.id });
  expect(desk.core.teams.archive({ teamId: old.id, archived: false })).toMatchObject({ archived: false, members: [] });
  expect(desk.core.teams.list().map(team => team.name)).toEqual(['Old crew']);
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

test('a move is refused, with nothing changed here, for this machine, an unknown one, a team member, a turn in flight, a target without an account or with its own built-in', async () => {
  const { desk, pc, owner, pcOwner, deskId, pcId, pcProject } = await group();
  const { agent, threadId } = await makeAgent(desk, owner, { projectIds: [`${pcId}/${pcProject.id}`] });
  await owner.call('agents.routine.save', { value: { agentId: agent.id, name: 'Round', prompt: 'Look around.', schedule: { kind: 'interval', everyMinutes: 30 }, enabled: true, nextAt: null, lastTurnId: null, lastScheduledAt: null } });
  const before = held(desk, agent);
  const unchanged = () => expect(held(desk, agent)).toEqual(before);

  expect(await thrown(owner.call('agents.move', { agentId: agent.id, machine: deskId }))).toThrow('is this machine');
  unchanged();
  expect(await thrown(owner.call('agents.move', { agentId: agent.id, machine: 'nowhere' }))).toThrow('no machine nowhere in this group');
  unchanged();

  // A team member stays, even once the Teams experiment is off; an archived team lets it go.
  await owner.call('client.preferences', { app: 'app-desktop-0001', language: 'en', experiments: ['teams'], labels: {} });
  const crew = desk.core.teams.create({ name: 'Crew', members: [agent.id] });
  await owner.call('client.preferences', { app: 'app-desktop-0001', language: 'en', experiments: [], labels: {} });
  const teamed = await owner.call('agents.move', { agentId: agent.id, machine: pcId }).catch(error => error as { message: string; rpc: { data: Record<string, unknown> } });
  expect((teamed as { message: string }).message).toContain('belongs to the team "Crew"; remove it from it first');
  expect((teamed as { rpc: { data: Record<string, unknown> } }).rpc.data).toMatchObject({ reason: 'team', teams: ['Crew'] });
  unchanged();
  await owner.call('client.preferences', { app: 'app-desktop-0001', language: 'en', experiments: ['teams'], labels: {} });
  desk.core.teams.archive({ teamId: crew.id, archived: true });
  expect(desk.core.teams.namesOf(agent.id)).toEqual([]);

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

test('an answer lost on the way back: the same requestId finishes the move here instead of a second bot there', async () => {
  const { desk, pc, owner, pcId } = await group();
  const { agent, threadId } = await makeAgent(desk, owner);
  // Subagents on before the move, so turning them off later shows on the thread there.
  const first = await owner.call('agents.runtime.get', { agentId: agent.id });
  await owner.call('agents.runtime.configure', { agentId: agent.id, expectedRevision: desk.core.workforce.records.get('profile', agent.id).revision, config: { ...first, subagents: { ...first.subagents, enabled: true } } });
  const request = desk.core.coordination.request.bind(desk.core.coordination);
  let lose = true;
  desk.core.coordination.request = async (peer: CoordinationPeer, operation, payload) => {
    const answer = await request(peer, operation, payload);
    if (operation === 'bot.move' && lose) { lose = false; throw new Error('the connection dropped'); }
    return answer;
  };
  // The target made the bot, this machine never heard it: both hold it, and this one says to try again.
  expect(await thrown(owner.call('agents.move', { agentId: agent.id, machine: pcId, requestId: 'lost' }))).toThrow('the same requestId tries again');
  expect(desk.core.workforce.records.find('profile', agent.id)).not.toBeNull();
  expect(pc.core.workforce.records.find('profile', agent.id)).not.toBeNull();
  expect(pc.core.delegation.config(pc.core.workforce.sessionOf(agent.id)!.threadId).enabled).toBe(true);
  // Meanwhile the bot lives on in both places. Here: a fact, its memory, a routine and a new name; there: its instructions.
  desk.core.workforce.fact(agent.id, { key: 'after', text: 'Filed after the lost answer.', urgent: false });
  const ours = await owner.call('agents.brain.get', { agentId: agent.id });
  mkdirSync(ours.path, { recursive: true });
  writeFileSync(join(ours.path, 'MEMORY.md'), 'Written after the lost answer.\n');
  await owner.call('agents.routine.save', { value: { agentId: agent.id, name: 'Evening round', prompt: 'Close the shed.', schedule: { kind: 'interval', everyMinutes: 120 }, enabled: true, nextAt: null, lastTurnId: null, lastScheduledAt: null } });
  const profile = desk.core.workforce.records.get('profile', agent.id);
  await owner.call('agents.profile.save', { id: agent.id, expectedRevision: profile.revision, value: { ...(({ id: _i, revision: _r, createdAt: _c, updatedAt: _u, ...rest }) => rest)(profile), name: 'Ada the Second' } });
  // A new model and subagents turned off here: the policy and the thread there follow, not only the profile.
  for (const side of [desk, pc]) side.core.providers.require('echo').models!.push({ id: 'echo-alt', name: 'Echo alt' });
  const runtime = await owner.call('agents.runtime.get', { agentId: agent.id });
  const renamed = desk.core.workforce.records.get('profile', agent.id);
  const alt = { ...renamed.selection, model: 'echo-alt' };
  await owner.call('agents.runtime.configure', { agentId: agent.id, expectedRevision: renamed.revision, config: { ...runtime, defaultRoute: alt, allowedRoutes: [{ ...alt, model: 'echo-alt', id: 'default', name: 'Default' }], subagents: { ...runtime.subagents, enabled: false } } });
  const theirs = pc.core.workforce.brainOf({ agentId: agent.id });
  writeFileSync(join(theirs.path, 'AGENTS.md'), 'Written there after it arrived.\n');
  const moved = await owner.call('agents.move', { agentId: agent.id, machine: pcId, requestId: 'lost' });
  expect(moved.threadId).toBe(pc.core.workforce.sessionOf(agent.id)!.threadId);
  expect(pc.core.workforce.records.list('profile').filter(p => p.id === agent.id)).toHaveLength(1);
  expect(pc.core.agentRuntime.facts(agent.id).map(f => f.key)).toEqual(['after']);
  // What changed here since the first try went with the retry; what it did not change keeps what the target wrote.
  expect(pc.core.workforce.brainOf({ agentId: agent.id })).toMatchObject({ memory: 'Written after the lost answer.\n', instructions: 'Written there after it arrived.\n' });
  expect(pc.core.workforce.records.list('routine').filter(r => r.agentId === agent.id).map(r => r.name)).toEqual(['Evening round']);
  expect(pc.core.workforce.records.get('profile', agent.id).name).toBe('Ada the Second');
  const there = pc.core.workforce.records.get('profile', agent.id).selection;
  expect(there.model).toBe('echo-alt');
  expect(pc.core.workforce.resident.config(agent.id).allowedRoutes.map(route => route.model)).toEqual(['echo-alt']);
  expect(pc.core.journal.getThread(moved.threadId)?.model).toBe('echo-alt');
  expect(pc.core.workforce.resident.config(agent.id).subagents.enabled).toBe(false);
  expect(pc.core.delegation.config(moved.threadId).enabled).toBe(false);
  expect(desk.core.workforce.records.find('profile', agent.id)).toBeNull();
  expect(desk.core.journal.getThread(threadId)?.archived).toBe(true);
  expect(desk.core.agentRuntime.facts(agent.id)).toHaveLength(0);
}, 60_000);

test('facts filed while the bot travels go after it, nothing wakes it here meanwhile, and a lost second leg keeps them here', async () => {
  const { desk, pc, owner, pcId } = await group();
  const { agent } = await makeAgent(desk, owner);
  desk.core.workforce.fact(agent.id, { key: 'before', text: 'Filed before the move.', urgent: false });
  const request = desk.core.coordination.request.bind(desk.core.coordination);
  const sent: string[][] = [];
  let probe: unknown;
  desk.core.coordination.request = async (peer: CoordinationPeer, operation, payload) => {
    if (operation !== 'bot.move') return request(peer, operation, payload);
    sent.push((payload as { facts: { key: string }[] }).facts.map(f => f.key));
    if (sent.length === 1) {
      // During the network wait: a fact arrives, and a wake asked now is held.
      desk.core.workforce.fact(agent.id, { key: 'during', text: 'Filed during the move.', urgent: true });
      probe = desk.core.agentRuntime.attempt(desk.core.workforce.records.get('profile', agent.id), { kind: 'event', label: 'Probe', prompt: 'Wake up.', requestId: 'probe' });
    }
    if (sent.length === 2) throw new Error('the network went down');
    return request(peer, operation, payload);
  };
  expect(await thrown(owner.call('agents.move', { agentId: agent.id, machine: pcId, requestId: 'late' }))).toThrow('did not answer');
  expect(probe).toEqual({ held: 'busy' });
  expect(sent).toEqual([['before'], ['before', 'during']]);
  // The second leg never arrived: the late fact and the bot stay here.
  expect(desk.core.workforce.records.find('profile', agent.id)).not.toBeNull();
  expect(desk.core.agentRuntime.facts(agent.id).map(f => f.key)).toEqual(['before', 'during']);
  expect(pc.core.agentRuntime.facts(agent.id).map(f => f.key)).toEqual(['before']);
  // Wakes run here again once the move gave up.
  expect(desk.core.workforce.moves.moving(agent.id)).toBe(false);

  await owner.call('agents.move', { agentId: agent.id, machine: pcId, requestId: 'late' });
  expect(sent).toHaveLength(3);
  expect(pc.core.agentRuntime.facts(agent.id).map(f => [f.key, f.text])).toEqual([['before', 'Filed before the move.'], ['during', 'Filed during the move.']]);
  expect(desk.core.workforce.records.find('profile', agent.id)).toBeNull();
  expect(desk.core.agentRuntime.facts(agent.id)).toHaveLength(0);
}, 60_000);

test('a rename, a memory and a routine the owner saves while the bot travels go after it; more facts than a move carries refuse it', async () => {
  const { desk, pc, owner, pcId } = await group();
  const { agent } = await makeAgent(desk, owner);
  const request = desk.core.coordination.request.bind(desk.core.coordination);
  let legs = 0;
  desk.core.coordination.request = async (peer: CoordinationPeer, operation, payload) => {
    if (operation !== 'bot.move') return request(peer, operation, payload);
    legs += 1;
    const answer = await request(peer, operation, payload);
    if (legs === 1) {
      const current = desk.core.workforce.records.get('profile', agent.id);
      const { id: _id, revision: _revision, createdAt: _createdAt, updatedAt: _updatedAt, ...value } = current;
      await owner.call('agents.profile.save', { id: agent.id, expectedRevision: current.revision, value: { ...value, name: 'Renamed on the way' } });
      const brain = await owner.call('agents.brain.get', { agentId: agent.id });
      await owner.call('agents.brain.save', { agentId: agent.id, expectedRevision: brain.revision, instructions: brain.instructions, memory: 'Saved on the way.\n' });
      await owner.call('agents.routine.save', { value: { agentId: agent.id, name: 'Late', prompt: 'Saved on the way.', schedule: { kind: 'interval', everyMinutes: 60 }, enabled: true, nextAt: null, lastTurnId: null, lastScheduledAt: null } });
    }
    return answer;
  };
  await owner.call('agents.move', { agentId: agent.id, machine: pcId, requestId: 'edits' });
  expect(legs).toBe(2);
  expect(pc.core.workforce.records.get('profile', agent.id).name).toBe('Renamed on the way');
  expect((await (await pc.connect()).call('agents.brain.get', { agentId: agent.id })).memory).toContain('Saved on the way.');
  expect(pc.core.workforce.records.list('routine').filter(r => r.agentId === agent.id).map(r => r.name)).toEqual(['Late']);
  desk.core.coordination.request = request;

  const { agent: busy } = await makeAgent(desk, owner, { name: 'Busy' });
  for (let index = 0; index <= 100; index += 1) desk.core.workforce.fact(busy.id, { key: `k${index}`, text: 'A fact.', urgent: false });
  expect(await thrown(owner.call('agents.move', { agentId: busy.id, machine: pcId }))).toThrow('101 facts wait for the bot');
  expect(desk.core.agentRuntime.facts(busy.id)).toHaveLength(101);
}, 60_000);

test('a turn the owner starts while the bot travels keeps it here; the refusal names the generated requestId, which finishes the move once the turn ends', async () => {
  const { desk, pc, owner, pcId } = await group();
  const { agent, threadId } = await makeAgent(desk, owner);
  const request = desk.core.coordination.request.bind(desk.core.coordination);
  desk.core.coordination.request = async (peer: CoordinationPeer, operation, payload) => {
    const answer = await request(peer, operation, payload);
    if (operation === 'bot.move' && !desk.core.threads.isBusy(threadId)) {
      driver!.restore();
      driver = scripted(() => ({ text: 'Working.', hold: true }));
      await owner.call('turns.start', { threadId, prompt: 'One more thing.' });
      await waitFor(() => desk.core.threads.isBusy(threadId));
    }
    return answer;
  };
  const refusal = await owner.call('agents.move', { agentId: agent.id, machine: pcId }).catch(error => error as { message: string; rpc: { data: Record<string, unknown> } });
  const data = (refusal as { rpc: { data: Record<string, unknown> } }).rpc.data;
  const requestId = String(data.requestId);
  expect(requestId).toStartWith('mov_');
  expect(data.reason).toBe('turn-in-flight');
  expect((refusal as { message: string }).message).toContain(`the same requestId (${requestId})`);
  expect(desk.core.workforce.records.find('profile', agent.id)).not.toBeNull();
  desk.core.coordination.request = request;
  driver!.release();
  await waitFor(() => settled(desk, threadId), 10_000);
  await owner.call('agents.move', { agentId: agent.id, machine: pcId, requestId });
  expect(pc.core.workforce.records.list('profile').filter(p => p.id === agent.id)).toHaveLength(1);
  expect(desk.core.workforce.records.find('profile', agent.id)).toBeNull();
}, 60_000);

test('a fact set to another text and back while the bot travels ends there with its latest text', async () => {
  const { desk, pc, owner, pcId } = await group();
  const { agent } = await makeAgent(desk, owner);
  const set = (text: string) => desk.core.agentRuntime.fact(agent.id, { key: 'door', text, urgent: false, replace: true });
  set('The door is open.');
  const request = desk.core.coordination.request.bind(desk.core.coordination);
  const legs: string[] = [];
  desk.core.coordination.request = async (peer: CoordinationPeer, operation, payload) => {
    if (operation !== 'bot.move') return request(peer, operation, payload);
    legs.push((payload as { facts: { text: string }[] }).facts.map(f => f.text).join(' '));
    const answer = await request(peer, operation, payload);
    // While each leg travels, the fact changes: shut, then open again.
    if (legs.length === 1) set('The door is shut.');
    if (legs.length === 2) set('The door is open.');
    return answer;
  };
  await owner.call('agents.move', { agentId: agent.id, machine: pcId, requestId: 'door' });
  expect(legs).toEqual(['The door is open.', 'The door is shut.', 'The door is open.']);
  expect(pc.core.agentRuntime.facts(agent.id).map(f => [f.key, f.text])).toEqual([['door', 'The door is open.']]);
  expect(desk.core.workforce.records.find('profile', agent.id)).toBeNull();
}, 60_000);
