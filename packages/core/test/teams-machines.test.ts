import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
import { teamMemberKey, type AgentLetter, type CoordinationPeer, type Team, type TeamPost } from '@boite/contracts';
import { AGENT_ENV } from '@boite/contracts';
import { runCli } from '../src/cli.ts';
import type { CoreClient } from '../src/client.ts';
import { PeerRefusal } from '../src/coordination-wire.ts';
import { answerPostId } from '../src/teams/snapshots.ts';
import { makeAgent, scripted, settled, turnsOf, type Answer } from './agent-fixture.ts';
import { removeDir, startTestCore, waitFor, type TestCore } from './harness.ts';
import { thrown } from './settle.ts';

/* A team across machines (`docs/internals/teams.md`): `host` holds it, `away` runs a member. Every scenario speaks over the real transport between two cores of a test group. */

const cores: TestCore[] = [];
const dirs: string[] = [];
let driver: ReturnType<typeof scripted> | null = null;
afterEach(async () => {
  driver?.release();
  driver?.restore();
  driver = null;
  for (const core of cores.splice(0)) await core.stop();
  for (const dir of dirs.splice(0)) await removeDir(dir);
});

const DESKTOP = 'app-desktop-0001';
const experiment = (client: CoreClient, on = true) => client.call('client.preferences', { app: DESKTOP, language: 'en', experiments: on ? ['teams'] : [], labels: {} });
const speak = (answer: (prompt: string, threadId: string) => Answer = () => ({ text: '[quiet]' })) => { driver = scripted(ctx => answer(ctx.prompt, ctx.thread.id)); return driver; };

async function join(h: TestCore, first: TestCore) {
  await h.core.group.join((await first.core.group.invite()).invite);
  const id = h.core.coordination.card().coreId;
  const firstId = first.core.coordination.card().coreId;
  await waitFor(() => first.core.group.peers().some(peer => peer.coreId === id) && h.core.group.peers().some(peer => peer.coreId === firstId));
}

/** Two machines of a test group, each with the experiment on and one bot: Ada on `host`, Bob on `away`. */
async function machines() {
  // Kept for the restart a scenario wants: the harness removes only a directory it made.
  const directory = () => { const dir = mkdtempSync(joinPath(tmpdir(), 'boite-teams-')); dirs.push(dir); return dir; };
  const host = await startTestCore({ dataDir: directory() });
  const away = await startTestCore({ dataDir: directory() });
  cores.push(host, away);
  const hostOwner = await host.connect();
  const awayOwner = await away.connect();
  await experiment(hostOwner);
  await experiment(awayOwner);
  await host.core.group.create('Test group');
  await join(away, host);
  const hostId = host.core.coordination.card().coreId;
  const awayId = away.core.coordination.card().coreId;
  const ada = await makeAgent(host, hostOwner, { name: 'Ada' });
  const bob = await makeAgent(away, awayOwner, { name: 'Bob' });
  return { host, away, hostOwner, awayOwner, hostId, awayId, ada, bob, adaKey: teamMemberKey(hostId, ada.agent.id), bobKey: teamMemberKey(awayId, bob.agent.id) };
}

/** Two machines and their team, once the machine of the member has it. */
async function crew() {
  const m = await machines();
  const team = await m.hostOwner.call('teams.create', { name: 'Crew', members: [m.ada.agent.id, `${m.awayId}/Bob`] });
  await waitFor(() => m.away.core.teams.get(team.id) !== null);
  return { ...m, team };
}

async function boiteAs(h: TestCore, threadId: string, args: string[]) {
  let out = '';
  let err = '';
  const env = { [AGENT_ENV.threadId]: threadId, [AGENT_ENV.coreUrl]: h.url, [AGENT_ENV.token]: h.core.agents.tokenFor(threadId) };
  const code = await runCli(args, { out: text => { out += text; }, err: text => { err += text; }, env, cwd: process.cwd() });
  return { code, out, err };
}

const peerOf = (h: TestCore, coreId: string): CoordinationPeer => h.core.group.peers().find(peer => peer.coreId === coreId)!;
const posts = (h: TestCore, team: Pick<Team, 'id'>): TeamPost[] => h.core.teams.page(h.core.teams.get(team.id)!, 'owner', { limit: 100 }).posts;
const stored = (h: TestCore, team: Pick<Team, 'id'>) => (h.core.journal.db.query('SELECT id, seq, text FROM team_posts WHERE team_id = ? ORDER BY seq').all(team.id) as { id: string; seq: number; text: string }[]);
const delivery = (h: TestCore, postId: string, member: string) => (h.core.journal.db.query('SELECT state, reason FROM team_deliveries WHERE post_id = ? AND member = ?').get(postId, member) as { state: string; reason: string | null } | null);
const teamLetters = (h: TestCore, threadId: string) => (h.core.journal.db.query("SELECT data FROM coordination_letters WHERE thread_id = ? AND direction = 'in' AND json_extract(data, '$.team') IS NOT NULL ORDER BY created_at").all(threadId) as { data: string }[])
  .map(row => JSON.parse(row.data) as AgentLetter);
const wakes = (h: TestCore, threadId: string) => turnsOf(h, threadId).filter(turn => turn.execution?.operation === 'coordination');
const prompts = (threadId: string) => driver?.prompts.get(threadId) ?? [];
const restart = async (h: TestCore): Promise<TestCore> => {
  const next = await startTestCore({ dataDir: h.dataDir, port: Number(new URL(h.url).port) });
  cores.push(next);
  return next;
};

test('a group post, a distant @name, a private post and a final answer each reach the right machine, and a private post no other', async () => {
  const { host, away, hostOwner, awayOwner, hostId, awayId, ada, bob, adaKey, bobKey } = await machines();
  speak((prompt, threadId) => (threadId === bob.threadId && prompt.includes('ping') ? { text: 'pong from Bob' } : { text: '[quiet]' }));
  // Each test core takes the name of this computer; a machine whose name another shares is still that other's, for the one who names it.
  const awayName = peerOf(host, awayId).name;
  const hostName = peerOf(away, hostId).name;

  // A bot proposes the team with the machine's name; the owner applies the card where it was drawn.
  const proposed = await boiteAs(host, ada.threadId, ['team', 'propose', '--name', 'Crew', '--members', `${awayName}/Bob`, '--brief', 'Across machines']);
  expect(proposed.out).toContain(`card: create Crew with ${awayName}/Bob`);
  const [card] = host.core.threads.listQuestions(ada.threadId);
  expect(card?.team).toEqual({ kind: 'create', by: ada.agent.id, name: 'Crew', brief: 'Across machines', members: [ada.agent.id, `${awayId}/${bob.agent.id}`] });
  expect(card?.text).toContain(`Bob (${awayName})`);
  const team = await hostOwner.call('teams.create', { name: 'Crew', brief: 'Across machines', members: (card!.team as { members: string[] }).members, card: card!.id });
  expect(team).toMatchObject({ host: hostId, members: [{ key: adaKey, coreId: hostId }, { key: bobKey, coreId: awayId, machine: awayName, name: 'Bob' }] });
  expect(team.members[0]!.machine).toBeUndefined();
  await waitFor(() => away.core.teams.get(team.id) !== null);

  // The mirror is the bot's: this machine's owner does not see it, and it shows the other machine's member by name.
  expect((await awayOwner.call('teams.list', {})).teams).toEqual([]);
  expect((await boiteAs(away, bob.threadId, ['team', 'list'])).out).toContain(`Crew: Ada (${hostName}), Bob`);

  // A group post wakes both, each on its own machine.
  const everyone = host.core.teams.ownerPost({ teamId: team.id, id: 'all', text: '@tous hello' });
  expect(everyone.to.sort()).toEqual([adaKey, bobKey].sort());
  await waitFor(() => prompts(bob.threadId).some(prompt => prompt.includes('@tous hello')) && prompts(ada.threadId).some(prompt => prompt.includes('@tous hello')));
  await waitFor(() => delivery(host, 'all', bobKey)?.state === 'delivered');

  // A distant @name wakes that bot alone, and its final answer becomes a post, ordered on the machine holding the team.
  await waitFor(() => settled(away, bob.threadId) && settled(host, ada.threadId));
  const adaWakes = wakes(host, ada.threadId).length;
  const said = await boiteAs(host, ada.threadId, ['team', 'say', 'Crew', '@Bob', 'ping', '--request-id', 'ask-1']);
  expect(said.out).toContain(`wakes: ${bobKey}`);
  await waitFor(() => wakes(away, bob.threadId).some(turn => turn.status === 'done' && prompts(bob.threadId).at(-1)!.includes('ping')));
  const turn = wakes(away, bob.threadId).at(-1)!;
  await waitFor(() => posts(host, team).some(post => post.id === answerPostId(turn.id)));
  const answer = posts(host, team).find(post => post.id === answerPostId(turn.id))!;
  expect(answer).toMatchObject({ author: bobKey, text: 'pong from Bob', audience: 'team', inReplyTo: 'ask-1', to: [adaKey] });
  await waitFor(() => prompts(ada.threadId).some(prompt => prompt.includes('pong from Bob')));
  expect(adaWakes).toBeGreaterThan(0);
  await waitFor(() => stored(away, team).some(post => post.id === answer.id));
  await waitFor(() => (away.core.journal.db.query('SELECT COUNT(*) AS n FROM team_outbox').get() as { n: number }).n === 0);

  // A post from the distant bot's own thread, and the same id again: one post.
  const first = await boiteAs(away, bob.threadId, ['team', 'say', 'Crew', '@Ada', 'report', '--request-id', 'bob-1']);
  expect(first.out).toContain('in Crew (bob-1)');
  const again = await boiteAs(away, bob.threadId, ['team', 'say', 'Crew', '@Ada', 'report', '--request-id', 'bob-1']);
  expect(again.out).toContain('in Crew (bob-1)');
  expect(posts(host, team).filter(post => post.id === 'bob-1')).toHaveLength(1);
  expect(posts(host, team).find(post => post.id === 'bob-1')).toMatchObject({ author: bobKey, to: [adaKey] });
  await waitFor(() => prompts(ada.threadId).some(prompt => prompt.includes('report')));

  // A private post to the distant bot reaches it; one between others never leaves the machine.
  const sent: string[] = [];
  const request = host.core.coordination.request.bind(host.core.coordination);
  host.core.coordination.request = async (peer: CoordinationPeer, operation, payload) => {
    if (operation === 'team.sync') sent.push(JSON.stringify(payload));
    return request(peer, operation, payload);
  };
  await boiteAs(host, ada.threadId, ['team', 'dm', 'Crew', 'owner', 'between us', '--request-id', 'secret']);
  await boiteAs(host, ada.threadId, ['team', 'dm', 'Crew', 'Bob', 'for Bob only', '--request-id', 'to-bob']);
  await waitFor(() => prompts(bob.threadId).some(prompt => prompt.includes('for Bob only')));
  expect(sent.join('\n')).not.toContain('between us');
  expect(stored(away, team).map(post => post.id)).not.toContain('secret');
  expect(stored(away, team).map(post => post.id)).toContain('to-bob');
  await waitFor(() => delivery(host, 'to-bob', bobKey)?.state === 'delivered');

  // The distant bot's own private post stays with the holder and its recipient, and it still reads it, through the holder.
  await boiteAs(away, bob.threadId, ['team', 'dm', 'Crew', 'owner', 'mine alone', '--request-id', 'bob-dm']);
  expect(posts(host, team).find(post => post.id === 'bob-dm')).toMatchObject({ author: bobKey, to: ['owner'], audience: 'private' });
  expect(stored(away, team).map(post => post.id)).not.toContain('bob-dm');
  const read = await boiteAs(away, bob.threadId, ['team', 'read', 'Crew', '--limit', '100']);
  expect(read.out).toContain('mine alone');
  expect(read.out).toContain('for Bob only');
  expect(read.out).not.toContain('between us');
  expect(read.out).toContain('Ada privately to Bob');
}, 120_000);

test('the machine holding a team takes a member\'s word only from the machine that hosts that mochi', async () => {
  const { host, away, hostId, awayId, ada, bob, bobKey, team } = await crew();
  speak();
  const third = await startTestCore();
  cores.push(third);
  await join(third, host);
  await waitFor(() => peerOf(third, hostId) !== undefined && peerOf(host, third.core.coordination.card().coreId) !== undefined);
  const fromAway = (operation: Parameters<typeof away.core.coordination.request>[1], payload: unknown) => thrown(away.core.coordination.request(peerOf(away, hostId), operation, payload));
  const fromThird = (operation: Parameters<typeof third.core.coordination.request>[1], payload: unknown) => thrown(third.core.coordination.request(peerOf(third, hostId), operation, payload));
  const forged = { teamId: team.id, id: 'forged', text: 'I am someone else', audience: 'team' };

  // Another machine naming a member, and a member's machine naming the holder's own bot: refused, and nothing stands.
  expect(await fromThird('team.post', { ...forged, botId: bob.agent.id })).toThrow('is no member of Crew on');
  expect(await fromAway('team.post', { ...forged, botId: ada.agent.id })).toThrow('is no member of Crew on');
  expect(await fromThird('team.read', { teamId: team.id, botId: bob.agent.id })).toThrow('is no member of Crew on');
  expect(await fromAway('team.read', { teamId: team.id, botId: ada.agent.id })).toThrow('is no member of Crew on');
  expect(posts(host, team).map(post => post.id)).not.toContain('forged');

  // What the payload says of its author decides nothing.
  const posted = await away.core.coordination.request(peerOf(away, hostId), 'team.post', { ...forged, id: 'mine', botId: bob.agent.id, author: 'owner', key: 'owner' }) as TeamPost;
  expect(posted.author).toBe(bobKey);

  // Nobody else speaks for the holder, of its team or of one held here.
  const copy = host.core.teams.get(team.id)!;
  const held = await thrown(third.core.coordination.request(peerOf(third, awayId), 'team.sync', { team: { ...copy, host: third.core.coordination.card().coreId }, posts: [], upTo: 0 }));
  expect(held).toThrow('does not hold the team Crew');
  expect(await thrown(third.core.coordination.request(peerOf(third, awayId), 'team.sync', { team: copy, posts: [], upTo: 0 }))).toThrow('does not hold the team Crew');
  expect(await fromAway('team.sync', { team: { ...copy, host: awayId, name: 'Taken' }, posts: [], upTo: 0 })).toThrow('does not hold the team Crew');
  expect(host.core.teams.get(team.id)).toMatchObject({ host: hostId, name: 'Crew' });

  // Nor does a machine say where another machine's bot went, or take it out of the team.
  expect(await fromThird('team.moved', { teamId: team.id, botId: bob.agent.id, to: third.core.coordination.card().coreId })).toThrow('runs on another machine');
  expect(await fromAway('team.owner', { teamId: team.id, action: 'remove', botId: ada.agent.id })).toThrow('runs on another machine');
  expect(await fromThird('team.owner', { teamId: team.id, action: 'remove', botId: bob.agent.id })).toThrow('has no mochi in Crew');
  expect(host.core.teams.get(team.id)!.members.map(member => member.coreId)).toEqual([hostId, awayId]);
}, 90_000);

test('letters for a machine that is away wait and go once it is back, once; a batch sent again wakes nobody twice', async () => {
  const { host, away, ada, bob, bobKey, team } = await crew();
  speak();
  const awayUrl = away.url;
  const threadId = bob.threadId;
  await away.stop();
  cores.splice(cores.indexOf(away), 1);

  const first = host.core.teams.ownerPost({ teamId: team.id, id: 'first', text: '@Bob one' });
  const second = host.core.teams.ownerPost({ teamId: team.id, id: 'second', text: '@Bob two' });
  // A bot's group post that names nobody wakes nobody: Bob reads it without a trigger.
  host.core.teams.say({ threadId: ada.threadId, team: 'Crew', id: 'third', text: 'for the group, waking nobody' });
  expect(first.to).toEqual([bobKey]);
  await waitFor(() => delivery(host, 'first', bobKey)?.state === 'unreachable' && delivery(host, 'second', bobKey)?.state === 'unreachable', 15_000);
  expect(delivery(host, 'first', bobKey)?.reason).toContain('unreachable');

  const back = await restart(away);
  expect(back.url).toBe(awayUrl);
  await waitFor(() => stored(back, team).length === 3, 30_000);
  await waitFor(() => teamLetters(back, threadId).length > 0 && settled(back, threadId), 15_000);
  await waitFor(() => delivery(host, 'first', bobKey)?.state === 'delivered' && delivery(host, 'second', bobKey)?.state === 'delivered', 15_000);
  const letters = teamLetters(back, threadId);
  expect(letters.flatMap(letter => letter.team!.triggers).sort()).toEqual([first.seq, second.seq]);
  const turns = wakes(back, threadId).length;
  expect(prompts(threadId).join('\n')).toContain('@Bob one');
  expect(prompts(threadId).join('\n')).toContain('@Bob two');

  // The same batch again, as a lost acknowledgement would send it: the same ids, and no second wake.
  host.core.journal.db.query('UPDATE team_machines SET sent_seq = 0, sent_version = 0 WHERE team_id = ?').run(team.id);
  host.core.teams.peers.kick(team.id);
  await waitFor(() => (host.core.journal.db.query('SELECT sent_seq FROM team_machines WHERE team_id = ?').get(team.id) as { sent_seq: number }).sent_seq === 3);
  await Bun.sleep(200);
  expect(stored(back, team).map(post => post.id)).toEqual(['first', 'second', 'third']);
  expect(teamLetters(back, threadId)).toHaveLength(letters.length);
  expect(wakes(back, threadId)).toHaveLength(turns);
}, 120_000);

test('when the machine holding the team is away a command says so and loses nothing, and a final answer waits for it', async () => {
  const { host, away, bob, bobKey, team } = await crew();
  const held = speak((_prompt, threadId) => (threadId === bob.threadId ? { text: 'my answer', hold: true } : { text: '[quiet]' }));
  host.core.teams.ownerPost({ teamId: team.id, id: 'go', text: '@Bob go' });
  await waitFor(() => held.held.length === 1);
  await host.stop();
  cores.splice(cores.indexOf(host), 1);

  const said = await boiteAs(away, bob.threadId, ['team', 'say', 'Crew', 'while', 'away', '--request-id', 'kept']);
  expect(said.code).not.toBe(0);
  expect(said.err).toContain('did not answer');
  expect(said.err).toContain('--request-id kept');
  const read = await boiteAs(away, bob.threadId, ['team', 'read', 'Crew']);
  expect(read.err).toContain('did not answer');

  // The turn the letter started ends with its holder away: its answer waits.
  const turn = wakes(away, bob.threadId).at(-1)!;
  held.release();
  await waitFor(() => settled(away, bob.threadId));
  expect((away.core.journal.db.query("SELECT COUNT(*) AS n FROM team_outbox WHERE operation = 'team.post'").get() as { n: number }).n).toBe(1);

  const back = await restart(host);
  await experiment(await back.connect());
  await waitFor(() => posts(back, team).some(post => post.id === answerPostId(turn.id)), 30_000);
  expect(posts(back, team).find(post => post.id === answerPostId(turn.id))).toMatchObject({ author: bobKey, text: 'my answer' });
  await waitFor(() => (away.core.journal.db.query('SELECT COUNT(*) AS n FROM team_outbox').get() as { n: number }).n === 0, 15_000);

  // The command sent again posts once.
  expect((await boiteAs(away, bob.threadId, ['team', 'say', 'Crew', 'while', 'away', '--request-id', 'kept'])).out).toContain('in Crew (kept)');
  expect((await boiteAs(away, bob.threadId, ['team', 'say', 'Crew', 'while', 'away', '--request-id', 'kept'])).out).toContain('in Crew (kept)');
  expect(posts(back, team).filter(post => post.id === 'kept')).toHaveLength(1);
}, 120_000);

test('the experiment: a machine with it off lets no mochi of its own join, and the holder\'s switch decides what its team takes', async () => {
  const { host, away, hostOwner, awayOwner, awayId, ada, bob, adaKey, bobKey } = await machines();
  speak((prompt, threadId) => (threadId === bob.threadId && prompt.includes('answer me') ? { text: 'answered' } : { text: '[quiet]' }));

  await experiment(awayOwner, false);
  const refused = await boiteAs(host, ada.threadId, ['team', 'propose', '--name', 'Crew', '--members', `${awayId}/Bob`]);
  expect(refused.code).not.toBe(0);
  expect(refused.err).toContain('Teams experiment');
  expect(await thrown(hostOwner.call('teams.create', { name: 'Crew', members: [ada.agent.id, `${awayId}/Bob`] }))).toThrow('Teams experiment');

  await experiment(awayOwner);
  const team = await hostOwner.call('teams.create', { name: 'Crew', members: [ada.agent.id, `${awayId}/Bob`] });
  await waitFor(() => away.core.teams.get(team.id) !== null);

  // Off on the member's machine, once in: letters arrive and its commands go to the holder, whose switch it is.
  await experiment(awayOwner, false);
  host.core.teams.ownerPost({ teamId: team.id, id: 'one', text: '@Bob one' });
  await waitFor(() => prompts(bob.threadId).some(prompt => prompt.includes('@Bob one')));
  expect((await boiteAs(away, bob.threadId, ['team', 'list'])).out).toContain('Crew');
  expect((await boiteAs(away, bob.threadId, ['team', 'say', 'Crew', 'still', 'here', '--request-id', 'off-here'])).out).toContain('in Crew (off-here)');
  await experiment(awayOwner);

  // Off on the holder: commands say why; a letter already on its way ends in its answer.
  host.core.teams.ownerPost({ teamId: team.id, id: 'two', text: '@Bob answer me' });
  await waitFor(() => prompts(bob.threadId).some(prompt => prompt.includes('answer me')));
  await experiment(hostOwner, false);
  const off = await boiteAs(away, bob.threadId, ['team', 'say', 'Crew', 'not', 'now']);
  expect(off.code).not.toBe(0);
  expect(off.err).toContain('Teams experiment');
  await waitFor(() => (host.core.journal.db.query("SELECT COUNT(*) AS n FROM team_posts WHERE author = ? AND text = 'answered'").get(bobKey) as { n: number }).n === 1);
  await experiment(hostOwner);
  expect(host.core.teams.get(team.id)!.members.map(member => member.key)).toEqual([adaKey, bobKey]);
}, 120_000);

test('a machine too old for teams across machines is named and not asked again each time it speaks; one that has no mochi of that name says so; a team needs a mochi of the machine holding it', async () => {
  const { host, ada, hostOwner, awayId } = await machines();
  speak();
  expect(await thrown(hostOwner.call('teams.create', { name: 'Crew', members: [ada.agent.id, `${awayId}/Nobody`] }))).toThrow('no mochi "Nobody"');
  expect(await thrown(hostOwner.call('teams.create', { name: 'Crew', members: [`${awayId}/Bob`] }))).toThrow('name a mochi of this machine');
  const request = host.core.coordination.request.bind(host.core.coordination);
  host.core.coordination.request = async (peer: CoordinationPeer, operation, payload) => {
    if (operation === 'team.bot') throw new PeerRefusal('operation: expected coordination.ask, not team.bot');
    return request(peer, operation, payload);
  };
  const old = await thrown(hostOwner.call('teams.create', { name: 'Crew', members: [ada.agent.id, `${awayId}/Bob`] }));
  expect(old).toThrow('is too old for teams across machines');
  expect(await thrown(hostOwner.call('teams.create', { name: 'Crew', members: [ada.agent.id, 'nowhere/Bob'] }))).toThrow('no machine nowhere');
  host.core.coordination.request = request;

  // Away first, then back and refusing: the retry that was running does not make each word it says a new try.
  const team = await hostOwner.call('teams.create', { name: 'Crew', members: [ada.agent.id, `${awayId}/Bob`] });
  let failures = 0, refusals = 0, refusing = false;
  host.core.coordination.request = async (peer: CoordinationPeer, operation, payload) => {
    if (operation !== 'team.sync') return request(peer, operation, payload);
    if (!refusing) { failures++; throw new Error('connection refused'); }
    refusals++;
    throw new PeerRefusal('operation: expected coordination.ask, not team.sync');
  };
  host.core.teams.ownerPost({ teamId: team.id, id: 'to-old', text: 'hello' });
  await waitFor(() => failures >= 1);
  refusing = true;
  host.core.teams.peers.heard(awayId);
  await waitFor(() => refusals >= 1);
  const asked = refusals;
  host.core.teams.peers.heard(awayId);
  await Bun.sleep(200);
  expect(refusals).toBe(asked);
  host.core.coordination.request = request;
}, 60_000);

test('a card answered on a member\'s machine changes the team where it is held; a member that leaves takes the team off its machine', async () => {
  const { host, away, awayOwner, hostId, ada, bob, bobKey, team } = await crew();
  speak();
  const cy = await makeAgent(away, awayOwner, { name: 'Cy' });

  // Nothing but a card changes a team from this machine.
  expect(await thrown(awayOwner.call('teams.members.remove', { teamId: team.id, botId: bob.agent.id }))).toThrow('is held by');
  expect(await thrown(awayOwner.call('teams.update', { teamId: team.id, name: 'Mine' }))).toThrow('no team');

  // A bot of this machine, invited from here; the same card on the holder's side too.
  expect((await boiteAs(away, bob.threadId, ['team', 'invite', 'Crew', 'Cy'])).out).toContain('card: add Cy to Crew');
  const invite = away.core.threads.listQuestions(bob.threadId).find(request => request.team?.kind === 'invite')!;
  await awayOwner.call('teams.members.add', { teamId: team.id, botId: cy.agent.id, card: invite.id });
  expect(host.core.teams.get(team.id)!.members.map(member => member.botId)).toEqual([ada.agent.id, bob.agent.id, cy.agent.id]);
  await waitFor(() => away.core.teams.get(team.id)!.members.length === 3);
  expect(away.core.threads.listQuestions(bob.threadId).filter(request => request.team?.kind === 'invite')).toEqual([]);

  // Bob leaves; Cy stays, so the mirror does too.
  expect((await boiteAs(away, bob.threadId, ['team', 'leave', 'Crew'])).out).toContain('card: leave Crew');
  const leave = away.core.threads.listQuestions(bob.threadId).find(request => request.team?.kind === 'leave')!;
  await awayOwner.call('teams.members.remove', { teamId: team.id, botId: bob.agent.id, card: leave.id });
  expect(host.core.teams.get(team.id)!.members.map(member => member.key)).not.toContain(bobKey);
  await waitFor(() => away.core.teams.get(team.id)!.members.length === 2);
  expect((await boiteAs(away, bob.threadId, ['team', 'list'])).out).not.toContain('Crew');

  // The owner removes the last member there: nothing of the team stays on that machine.
  host.core.teams.ownerPost({ teamId: team.id, id: 'before', text: '@Cy read this' });
  await waitFor(() => stored(away, team).some(post => post.id === 'before'));
  host.core.teams.removeMember({ teamId: team.id, botId: cy.agent.id });
  await waitFor(() => away.core.teams.get(team.id) === null);
  expect(stored(away, team)).toEqual([]);
  await waitFor(() => host.core.journal.db.query('SELECT 1 FROM team_machines WHERE team_id = ?').get(team.id) === null);
  expect(host.core.teams.get(team.id)).toMatchObject({ host: hostId });
}, 120_000);

test('a member moves with its team: its key stays, what waited for it waits on its new machine, and it speaks from there', async () => {
  const { host, away, hostOwner, awayOwner, hostId, awayId, ada, adaKey, bob, bobKey, team } = await crew();
  speak();

  // Ada, on the machine holding the team, goes to the other one: a post waiting for her follows.
  const dan = await makeAgent(host, hostOwner, { name: 'Dan' });
  await hostOwner.call('teams.members.add', { teamId: team.id, botId: dan.agent.id });
  await hostOwner.call('agents.move', { agentId: ada.agent.id, machine: awayId });
  expect(host.core.teams.get(team.id)!.members.find(member => member.botId === ada.agent.id)).toMatchObject({ key: adaKey, coreId: awayId, name: 'Ada' });
  await waitFor(() => away.core.teams.get(team.id)?.members.find(member => member.botId === ada.agent.id)?.coreId === awayId);
  const adaThere = away.core.workforce.sessionOf(ada.agent.id)!.threadId;
  const called = host.core.teams.ownerPost({ teamId: team.id, id: 'ada-there', text: '@Ada are you there' });
  expect(called.to).toEqual([adaKey]);
  await waitFor(() => prompts(adaThere).some(prompt => prompt.includes('are you there')));
  expect((await boiteAs(away, adaThere, ['team', 'say', 'Crew', 'yes', 'I', 'am', '--request-id', 'ada-yes'])).out).toContain('in Crew (ada-yes)');
  expect(posts(host, team).find(post => post.id === 'ada-yes')).toMatchObject({ author: adaKey });

  // Bob, on a member's machine, goes to the machine holding the team, which then has no need of that machine any more once Ada leaves too.
  await awayOwner.call('agents.move', { agentId: bob.agent.id, machine: hostId });
  await waitFor(() => host.core.teams.get(team.id)!.members.find(member => member.botId === bob.agent.id)?.coreId === hostId, 15_000);
  const bobHere = host.core.workforce.sessionOf(bob.agent.id)!.threadId;
  expect(host.core.teams.ownerPost({ teamId: team.id, id: 'bob-here', text: '@Bob back here' }).to).toEqual([bobKey]);
  await waitFor(() => prompts(bobHere).some(prompt => prompt.includes('back here')));
  await awayOwner.call('agents.move', { agentId: ada.agent.id, machine: hostId });
  await waitFor(() => away.core.teams.get(team.id) === null, 15_000);
  expect(stored(away, team)).toEqual([]);
  expect(host.core.teams.get(team.id)!.members.every(member => member.coreId === hostId)).toBe(true);
}, 180_000);
