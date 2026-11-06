import { afterEach, expect, test } from 'vitest';
import { FakeClient } from '../fake-client';
import { fakeCore } from './coordination';

/* Two fake machines count alike, where the core's ids never meet: what a team keeps stays apart all the same. */

const clients: FakeClient[] = [];
afterEach(() => { for (const client of clients.splice(0)) client.close(); });

async function machine(id: string, name: string): Promise<FakeClient> {
  const client = new FakeClient({ delayMs: 0, coreId: id, coreName: name, publicUrl: `https://${id}.test` });
  clients.push(client);
  await client.connect();
  client.reportDesktopExperiments(['teams']);
  return client;
}

const bot = (client: FakeClient, name: string) => client.call('agents.profile.save', { value: { name, domain: '', instructions: '', avatar: '', status: 'active', projectIds: [],
  selection: { providerId: 'echo', accountId: 'a-echo', model: 'echo-1', effort: null, permissionMode: 'default' } } });

test('the bots, teams and automatic posts of two machines counting alike keep apart', async () => {
  const desk = await machine('desk', 'Desk'), pc = await machine('pc', 'Pc');
  await desk.call('group.create', { name: 'Home' });
  await pc.call('group.join', { invite: (await desk.call('group.invite', {})).invite });
  const ada = await bot(desk, 'Ada'), bob = await bot(pc, 'Bob');
  expect(bob.id).toBe(ada.id);
  const adaThread = (await desk.call('agents.open', { agentId: ada.id })).threadId;
  const bobThread = (await pc.call('agents.open', { agentId: bob.id })).threadId;

  // A bot of the other machine with the proposer's id is another bot, to propose and to add.
  await desk.call('turns.start', { threadId: adaThread, prompt: 'Who could work with you?', clientRequestId: 'team-turn' });
  const card = await desk.call('teams.propose', { threadId: adaThread, name: 'Crew', members: ['Pc/Bob'] });
  expect(card.questionId).toBeTruthy();
  const small = await desk.call('teams.create', { name: 'Small', members: [ada.id] });
  expect((await desk.call('teams.members.add', { teamId: small.id, botId: 'Pc/Bob' })).members.map(member => member.key)).toEqual([`desk/${ada.id}`, `pc/${bob.id}`]);
  await expect(desk.call('teams.members.add', { teamId: small.id, botId: 'Pc/Bob' })).rejects.toThrow('already a member');

  // A team each, counted alike, and a bot in both names the one it means.
  const here = fakeCore('desk')!, there = fakeCore('pc')!;
  here.seq = there.seq = Math.max(here.seq, there.seq);
  const held = await desk.call('teams.create', { name: 'Crew', members: [ada.id, 'Pc/Bob'] });
  const own = await pc.call('teams.create', { name: 'Own', members: [bob.id, 'Desk/Ada'] });
  expect(own.id).not.toBe(held.id);

  // Automatic post ids, counted alike, both landing on the machine holding the team.
  here.seq = there.seq = Math.max(here.seq, there.seq);
  const first = await desk.call('teams.say', { threadId: adaThread, team: held.id, text: 'From here.' });
  const second = await pc.call('teams.say', { threadId: bobThread, team: held.id, text: 'From there.' });
  expect(second.id).not.toBe(first.id);
  const read = await pc.call('teams.read', { threadId: bobThread, team: held.id });
  expect(read.team.host).toBe('desk');
  expect(read.posts.map(post => post.text)).toEqual(['From here.', 'From there.']);
});

test('a bot in a team of one name on each of two machines is told to name one by id', async () => {
  const desk = await machine('desk', 'Desk'), pc = await machine('pc', 'Pc');
  await desk.call('group.create', { name: 'Home' });
  await pc.call('group.join', { invite: (await desk.call('group.invite', {})).invite });
  const ada = await bot(desk, 'Ada'), bob = await bot(pc, 'Bob');
  const threadId = (await desk.call('agents.open', { agentId: ada.id })).threadId;
  const held = await desk.call('teams.create', { name: 'Crew', members: [ada.id, 'Pc/Bob'] });
  const away = await pc.call('teams.create', { name: 'crew', members: [bob.id, 'Desk/Ada'] });

  const ambiguous = { message: `team: 2 of your teams are named "CREW"; name one by id: ${held.id}, ${away.id}`, data: { field: 'team' } };
  await expect(desk.call('teams.read', { threadId, team: 'CREW' })).rejects.toMatchObject(ambiguous);
  await expect(desk.call('teams.say', { threadId, team: 'CREW', text: 'Which one?' })).rejects.toMatchObject(ambiguous);

  // The id the refusal offers settles it, and the owner names only the team held here.
  expect((await desk.call('teams.read', { threadId, team: away.id })).team.id).toBe(away.id);
  expect((await desk.call('teams.read', { team: 'CREW' })).team.id).toBe(held.id);
});
