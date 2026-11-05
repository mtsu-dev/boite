import { afterEach, expect, test, vi } from 'vitest';
import type { AgentProfile, Team } from '@boite/contracts';
import type { AgentsView } from './agents.svelte';
import { FakeClient } from './fake-client';
import { Store } from './store.svelte';
import { draftKey, draftProblem, saveTeam, teamChoices } from './team-draft';
import type { Machine } from './workspace.svelte';

const cleanups: (() => void)[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function machine() {
  const client = new FakeClient({ delayMs: 0 });
  const store = new Store();
  store.attach(client);
  await store.connect();
  cleanups.push(() => { store.detach(); client.close(); });
  client.reportDesktopExperiments(['teams']);
  const bots: string[] = [];
  for (const name of ['Alpha', 'Beta', 'Gamma']) {
    const profile = await client.call('agents.profile.save', { value: { name, domain: '', instructions: '', avatar: '', status: 'active', projectIds: [], selection: { providerId: 'echo', accountId: 'a-echo', model: 'echo-1', effort: null, permissionMode: 'default' } } });
    bots.push(profile.id);
  }
  return { client, view: { store } as unknown as AgentsView, bots };
}

test('an archived team whose members all left can be emptied, then restored', async () => {
  const { client, view, bots } = await machine();
  const team = await client.call('teams.create', { name: 'Crew', members: [bots[0]!] });
  const archived = await client.call('teams.archive', { teamId: team.id, archived: true });
  const draft = { name: 'Crew', brief: '', members: [] };
  expect(draftProblem(draft, [archived], team.id)).toBeNull();
  // A new team still needs a bot.
  expect(draftProblem(draft, [], null)?.field).toBe('members');
  const emptied = await saveTeam(view, archived, draft);
  expect(emptied.members).toEqual([]);
  expect((await client.call('teams.archive', { teamId: team.id, archived: false })).archived).toBe(false);
});

test('a member whose machine left the group is one row the owner can take out, while its other bots stay greyed', () => {
  const profile = (id: string, name: string) => ({ id, name, avatar: '', status: 'active' }) as AgentProfile;
  const store = { machineId: 'srv', coreId: 'firebat', group: null };
  const away = { store, snapshot: { profiles: [profile('munin', 'Munin'), profile('odin', 'Odin')] } } as unknown as AgentsView;
  const machine = { id: 'srv', label: 'Firebat', coreId: 'firebat', store } as unknown as Machine;
  const view = { store: { machineId: 'local', group: { cores: [{ coreId: 'desk', name: 'Desk' }] } }, snapshot: { profiles: [] } } as unknown as AgentsView;
  const member = { key: 'firebat/munin', coreId: 'firebat', botId: 'munin', name: 'Munin', machine: 'Firebat', joinedSeq: 1 };
  const choices = teamChoices(view, [{ machine, view: away }], { members: [member] } as unknown as Team);
  expect(choices.filter(choice => choice.botId === 'munin').map(choice => [choice.key, choice.reason])).toEqual([[draftKey(member), null]]);
  expect(choices.filter(choice => choice.botId === 'odin').map(choice => choice.reason)).toEqual([expect.stringContaining('Firebat')]);
});

test('a retry after a refused add sends only what is still missing', async () => {
  const { client, view, bots } = await machine();
  const team = await client.call('teams.create', { name: 'Crew', members: [bots[0]!, bots[1]!] });
  const call = client.call.bind(client);
  let refuse = true;
  vi.spyOn(client, 'call').mockImplementation(((method: string, params: unknown) => {
    if (method === 'teams.members.add' && refuse) { refuse = false; return Promise.reject(new Error('connection lost')); }
    return call(method as never, params as never);
  }) as typeof client.call);
  // The dialog keeps the team as it opened: Beta is out by the first try, Gamma still missing.
  const draft = { name: 'Crew 2', brief: '', members: [bots[0]!, bots[2]!] };
  await expect(saveTeam(view, team, draft)).rejects.toThrow('connection lost');
  const saved = await saveTeam(view, team, draft);
  expect(saved.name).toBe('Crew 2');
  expect(saved.members.map(member => member.botId)).toEqual([bots[0], bots[2]]);
});
