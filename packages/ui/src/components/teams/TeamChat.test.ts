import { afterEach, expect, test, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import { setExperiment } from '../../lib/experiments';
import { FakeClient } from '../../lib/fake-client';
import { Store } from '../../lib/store.svelte';
import { workspace } from '../../lib/workspace.svelte';
import MobileNavigation from '../MobileNavigation.svelte';
import TeamChat from './TeamChat.svelte';

const mounted: ReturnType<typeof mount>[] = [];
const closers: (() => void)[] = [];
const previousActive = workspace.active;

afterEach(async () => {
  for (const component of mounted.splice(0)) await unmount(component);
  for (const close of closers.splice(0)) close();
  workspace.machines = []; workspace.active = previousActive;
  setExperiment('teams', false);
  vi.restoreAllMocks(); document.body.innerHTML = ''; localStorage.clear();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 12; i++) { await tick(); await Promise.resolve(); }
  flushSync();
}

function query<T extends Element>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`no ${selector}`);
  return node;
}

const all = (selector: string) => [...document.querySelectorAll<HTMLElement>(selector)];

/** Chris's Skollheim: two bots named as an owner names them, the Teams experiment on in the app and on the core. */
async function skollheim() {
  setExperiment('teams', true);
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
  const team = await client.call('teams.create', { name: 'Skollheim', brief: 'Ship the site.', members: [huginn.id, jeux.id] });
  const conversation = async (botId: string) => (await client.call('agents.open', { agentId: botId })).threadId;
  const say = async (botId: string, text: string) => client.call('teams.say', { threadId: await conversation(botId), team: 'Skollheim', text });
  const dm = async (botId: string, to: string, text: string) => client.call('teams.dm', { threadId: await conversation(botId), team: 'Skollheim', to, text });
  workspace.machines = [{ id: 'local', label: 'Local', store }]; workspace.active = store;
  const key = (botId: string) => team.members.find(member => member.botId === botId)!.key;
  return { client, store, team, huginn, jeux, say, dm, key };
}

function type(text: string) {
  const field = query<HTMLTextAreaElement>('[data-testid=team-composer-input]');
  field.value = text;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

test("the phone's Teams section lists the team with its unread chat, keeps the chat out of the thread rows, and opens it", async () => {
  vi.spyOn(window, 'matchMedia').mockImplementation(media => Object.assign(new EventTarget(), {
    media, matches: true, onchange: null, addListener() {}, removeListener() {}
  }));
  const { store, team, huginn, say } = await skollheim();
  await say(huginn.id, 'The draft is up. @tous have a look.');
  mounted.push(mount(MobileNavigation, { target: document.body, props: { store, screen: 'threads' } }));

  await vi.waitFor(() => expect(document.querySelector(`[data-testid=sidebar-team][data-team-id="${team.id}"]`)?.getAttribute('data-unread')).toBe('true'));
  const row = query<HTMLButtonElement>('[data-testid=sidebar-team]');
  expect(row.textContent).toContain('Skollheim');
  expect(row.textContent).toContain('Huginn (Réseaux) and Jeux (Producteur)');
  // The chat refuses an agent's composer: it is no thread row of the list.
  expect(store.threads.some(thread => thread.id === team.threadId)).toBe(true);
  expect(document.querySelector(`[data-thread-id="${team.threadId}"]`)).toBeNull();

  // Folded, the section's head still says a chat waits unread.
  query<HTMLButtonElement>('[data-testid=sidebar-teams-toggle]').click(); await settle();
  expect(query('[data-testid=sidebar-teams-unread]').textContent).toBe('1');
  query<HTMLButtonElement>('[data-testid=sidebar-teams-toggle]').click(); await settle();

  query<HTMLButtonElement>('[data-testid=sidebar-team]').click();
  await vi.waitFor(() => expect(store.openThread?.id).toBe(team.threadId));
  await settle();
  expect(document.querySelector('.mobile-list')).toBeNull();
  await vi.waitFor(() => expect(store.threads.find(thread => thread.id === team.threadId)?.unread).toBe(false));
});

test('the team chat draws each post with its author, a private post with its recipient, and who each post woke', async () => {
  const { client, store, team, huginn, jeux, say, dm } = await skollheim();
  await client.call('teams.post', { teamId: team.id, id: 'owner-ask', text: '@Huginn (Réseaux) can you draft the launch post?' });
  await say(huginn.id, 'The draft is up. @tous have a look.');
  await dm(jeux.id, 'owner', 'Between us: the budget is tight.');
  await client.call('teams.post', { teamId: team.id, id: 'owner-thanks', text: 'Thanks' });
  await store.open(team.threadId);
  mounted.push(mount(TeamChat, { target: document.body, props: { store, thread: store.openThread! } }));

  await vi.waitFor(() => expect(all('[data-testid=team-post]')).toHaveLength(4));
  await settle();
  const posts = all('[data-testid=team-post]');
  const field = (post: HTMLElement, id: string) => post.querySelector(`[data-testid=${id}]`)?.textContent ?? null;
  expect(posts.map(post => [field(post, 'team-post-author'), post.getAttribute('data-audience'), field(post, 'team-post-private'), field(post, 'team-post-woke')])).toEqual([
    ['You', 'team', null, 'Woke Huginn (Réseaux)'],
    ['Huginn (Réseaux)', 'team', null, 'Woke everyone'],
    ['Jeux (Producteur)', 'private', 'Private to you', null],
    ['You', 'team', null, 'Nobody was pinged: name a bot with @name, or everyone with @everyone.'],
  ]);
  expect(posts[1]!.textContent).toContain('The draft is up.');
  expect(all('[data-testid=team-member]').map(member => [member.textContent?.trim(), member.getAttribute('data-bot-id')])).toEqual([
    ['Huginn (Réseaux)', huginn.id], ['Jeux (Producteur)', jeux.id],
  ]);
  expect(query('[data-testid=team-members]').textContent).toContain('Ship the site.');
});

test("the owner's composer says who a post wakes before it goes, and posts a mention, a reply and a private post", async () => {
  const { store, team, huginn, jeux, say, key } = await skollheim();
  const draft = await say(huginn.id, 'The draft is up.');
  await store.open(team.threadId);
  mounted.push(mount(TeamChat, { target: document.body, props: { store, thread: store.openThread! } }));
  await vi.waitFor(() => expect(all('[data-testid=team-post]')).toHaveLength(1));
  // The composer comes with the team, read once the chat opens.
  await vi.waitFor(() => query('[data-testid=team-composer-input]'));
  const wakes = () => query('[data-testid=team-wakes]').textContent;
  const send = async (count: number) => {
    query<HTMLButtonElement>('[data-testid=team-send]').click();
    await vi.waitFor(() => expect(all('[data-testid=team-post]')).toHaveLength(count));
    await settle();
    return all('[data-testid=team-post]').at(-1)!;
  };

  type('Looks fine');
  expect(wakes()).toBe('Wakes nobody: name a bot with @name, or everyone with @everyone.');
  // The mention menu writes the member's name where the caret is.
  query<HTMLButtonElement>('[data-testid=team-mention]').click(); await settle();
  query<HTMLButtonElement>(`[data-testid=team-mention-menu] [data-value="${key(jeux.id)}"]`).click(); await settle();
  expect(query<HTMLTextAreaElement>('[data-testid=team-composer-input]').value).toBe('Looks fine @Jeux (Producteur) ');
  expect(wakes()).toBe('Wakes Jeux (Producteur)');
  const mentioned = await send(2);
  expect([mentioned.getAttribute('data-author'), mentioned.querySelector('[data-testid=team-post-woke]')?.textContent]).toEqual(['owner', 'Woke Jeux (Producteur)']);
  expect(query<HTMLTextAreaElement>('[data-testid=team-composer-input]').value).toBe('');

  // A reply wakes the post's author.
  query<HTMLButtonElement>(`[data-post-id="${draft.id}"] [data-testid=team-post-reply]`).click(); await settle();
  expect(query('[data-testid=team-replying]').textContent).toContain('Replying to Huginn (Réseaux)');
  type('Ship it');
  expect(wakes()).toBe('Wakes Huginn (Réseaux), whose post this answers');
  const answer = await send(3);
  expect(answer.querySelector('[data-testid=team-post-quote]')?.textContent).toContain('In reply to Huginn (Réseaux)');
  expect(document.querySelector('[data-testid=team-replying]')).toBeNull();

  // Only Jeux reads a private post, and no mention menu offers to wake anyone else.
  query<HTMLButtonElement>('[data-testid=team-audience]').click(); await settle();
  query<HTMLButtonElement>(`[data-testid=team-audience-menu] [data-value="${key(jeux.id)}"]`).click(); await settle();
  expect(document.querySelector('[data-testid=team-mention]')).toBeNull();
  type('What did the client say?');
  expect(wakes()).toBe('Only Jeux (Producteur) reads it and is woken.');
  const secret = await send(4);
  expect([secret.getAttribute('data-audience'), secret.querySelector('[data-testid=team-post-private]')?.textContent]).toEqual(['private', 'Private to Jeux (Producteur)']);
  expect(store.error).toBeFalsy();
});

test('an archived team keeps its chat readable and takes no post', async () => {
  const { client, store, team, huginn, say } = await skollheim();
  await say(huginn.id, 'Last word.');
  await client.call('teams.archive', { teamId: team.id, archived: true });
  await store.open(team.threadId);
  mounted.push(mount(TeamChat, { target: document.body, props: { store, thread: store.openThread! } }));
  await vi.waitFor(() => expect(query('[data-testid=team-closed]').textContent).toBe('This team is archived and takes no more posts.'));
  expect(all('[data-testid=team-post]')).toHaveLength(1);
  expect(document.querySelector('[data-testid=team-composer]')).toBeNull();
  expect(document.querySelector('[data-testid=team-post-reply]')).toBeNull();
});
