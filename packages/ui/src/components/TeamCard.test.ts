import { afterEach, expect, test, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import type { Message, QuestionRequest } from '@boite/contracts';
import { FakeClient } from '../lib/fake-client';
import { Store } from '../lib/store.svelte';
import AssistantMessage from './AssistantMessage.svelte';
import ThreadActivity from './ThreadActivity.svelte';

let mounted: ReturnType<typeof mount>[] = [];
const closers: (() => void)[] = [];

afterEach(async () => {
  for (const component of mounted.splice(0)) await unmount(component);
  for (const close of closers.splice(0)) close();
  document.body.innerHTML = '';
});

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) { await tick(); await Promise.resolve(); }
  flushSync();
}

function query<T extends Element>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`no ${selector}`);
  return node;
}

/**
 * Two bots named as an owner names them, with a parenthesis and a space, and
 * the first one's proposal drawn in the dock above its composer.
 */
async function proposed() {
  const client = new FakeClient({ delayMs: 0 });
  const store = new Store();
  store.attach(client);
  closers.push(() => { store.detach(); client.close(); });
  await store.connect();
  client.reportDesktopExperiments(['teams']);
  const bot = (name: string) => client.call('agents.profile.save', { value: { name, domain: '', instructions: '', avatar: '', status: 'active', projectIds: [],
    selection: { providerId: 'echo', accountId: 'a-echo', model: 'echo-1', effort: null, permissionMode: 'default' } } });
  const huginn = await bot('Huginn (Réseaux)');
  const jeux = await bot('Jeux (Producteur)');
  const { threadId } = await client.call('agents.open', { agentId: huginn.id });
  await store.open(threadId);
  // A card goes on a turn of the bot's conversation.
  await client.call('turns.start', { threadId, prompt: 'Who could work with you?', clientRequestId: 'team-turn' });
  await vi.waitFor(() => expect(store.openThread?.turns.some((turn) => turn.status === 'done')).toBe(true));
  const ask = (name: string) => client.call('teams.propose', { threadId, name, members: ['Huginn (Réseaux)', 'Jeux (Producteur)'], brief: 'Ship the site.' });
  const question = async (id: string): Promise<QuestionRequest> => {
    await vi.waitFor(() => expect(store.pendingQuestions.some((entry) => entry.id === id)).toBe(true));
    return store.pendingQuestions.find((entry) => entry.id === id)!;
  };
  mounted.push(mount(ThreadActivity, { target: document.body, props: { store } }));
  return { client, store, threadId, huginn, jeux, ask, question };
}

/** The thread's message holding a card, drawn as the timeline draws it. */
async function timeline(store: Store, questionId: string): Promise<void> {
  const host = store.openThread!.messages.find((message) => message.parts.some((part) => part.type === 'question' && part.questionId === questionId)) as Message;
  mounted.push(mount(AssistantMessage, { target: document.body, props: { store, threadId: host.threadId, message: host, signedOut: null, showModel: false } }));
  await vi.waitFor(() => expect(document.querySelector(`[data-testid=team-card][data-state=answered]`)).not.toBeNull());
}

test('a bot\'s team proposal offers Create the team, which creates it with the proposed bots and settles the card', async () => {
  const { client, store, huginn, jeux, ask, question } = await proposed();
  const { questionId } = await ask('Skollheim');
  const asked = await question(questionId);
  expect(asked.team).toMatchObject({ kind: 'create', name: 'Skollheim', members: [huginn.id, jeux.id] });
  await vi.waitFor(() => expect(document.querySelector('[data-testid=team-card][data-state=pending]')).not.toBeNull());

  // The dock draws the team card, not the plain question with the core's lone Refuse option.
  expect(document.querySelector('[data-testid=question-card]')).toBeNull();
  expect(query('[data-testid=team-card-text]').textContent).toBe('Huginn (Réseaux) proposes the team "Skollheim": Huginn (Réseaux), Jeux (Producteur). Ship the site.');
  expect(query('[data-testid=team-card-refuse]').textContent).toBe('Refuse');
  const apply = query<HTMLButtonElement>('[data-testid=team-card-apply]');
  expect(apply.textContent).toBe('Create the team');
  apply.click();

  await vi.waitFor(() => expect(store.pendingQuestions.some((entry) => entry.id === questionId)).toBe(false));
  const { teams } = await client.call('teams.list', {});
  expect(teams.map((team) => [team.name, team.brief, team.members.map((member) => member.name), team.createdBy])).toEqual([
    ['Skollheim', 'Ship the site.', ['Huginn (Réseaux)', 'Jeux (Producteur)'], `${teams[0]!.host}/${huginn.id}`]
  ]);
  expect(store.error).toBeFalsy();
  await settle();
  await timeline(store, questionId);
  const row = query('[data-testid=team-card][data-state=answered]');
  expect([row.getAttribute('data-outcome'), query('[data-testid=team-card-verdict]').textContent, query('[data-testid=team-card-subject]').textContent]).toEqual(['applied', 'Team created', 'Skollheim']);
});

test('Refuse on a team proposal creates nothing and reads refused', async () => {
  const { client, store, ask, question } = await proposed();
  const { questionId } = await ask('Skollheim');
  await question(questionId);
  await vi.waitFor(() => expect(document.querySelector('[data-testid=team-card-refuse]')).not.toBeNull());
  query<HTMLButtonElement>('[data-testid=team-card-refuse]').click();
  await vi.waitFor(() => expect(store.pendingQuestions.some((entry) => entry.id === questionId)).toBe(false));
  expect((await client.call('teams.list', {})).teams).toEqual([]);
  await settle();
  await timeline(store, questionId);
  expect([query('[data-testid=team-card]').getAttribute('data-outcome'), query('[data-testid=team-card-verdict]').textContent]).toEqual(['refused', 'Refused']);
});
