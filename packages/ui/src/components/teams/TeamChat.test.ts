import { afterEach, expect, test, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import { setExperiment } from '../../lib/experiments';
import { FakeClient } from '../../lib/fake-client';
import { Store } from '../../lib/store.svelte';
import { workspace } from '../../lib/workspace.svelte';
import MobileNavigation from '../MobileNavigation.svelte';
import AgentsPage from '../agents/AgentsPage.svelte';
import TeamChat from './TeamChat.svelte';

const mounted: ReturnType<typeof mount>[] = [];
const closers: (() => void)[] = [];
const previousActive = workspace.active;

afterEach(async () => {
  for (const component of mounted.splice(0)) await unmount(component);
  for (const close of closers.splice(0)) close();
  workspace.machines = []; workspace.active = previousActive;
  setExperiment('teams', false);
  setExperiment('resident-agents', false);
  vi.restoreAllMocks(); document.body.innerHTML = ''; localStorage.clear();
  document.documentElement.classList.remove('agents-detail-open');
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

/** A phone's width: every `max-width` query matches. */
function phone() {
  vi.spyOn(window, 'matchMedia').mockImplementation(media => Object.assign(new EventTarget(), {
    media, matches: media.includes('max-width'), onchange: null, addListener() {}, removeListener() {}
  }));
}

/** The Bots page with Bots on, where the teams are listed while Teams is on; a phone's under its header, which holds the page's search. */
function botsPage(store: Store, narrow: boolean) {
  if (narrow) phone();
  setExperiment('resident-agents', true);
  store.showAgents();
  if (narrow) mounted.push(mount(MobileNavigation, { target: document.body, props: { store, screen: 'threads' } }));
  mounted.push(mount(AgentsPage, { target: document.body, props: { store } }));
  flushSync();
}

function search(text: string) {
  const field = query<HTMLInputElement>('[data-testid=mobile-search]');
  field.value = text;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

test("a phone's Bots list holds the teams above the bots, opens a team's chat, and its search finds teams by name", async () => {
  const { store, team, huginn, say } = await skollheim();
  await say(huginn.id, 'The draft is up. @tous have a look.');
  botsPage(store, true);

  const row = `[data-testid="agent-team-${team.id}"]`;
  const bot = `[data-testid="agent-entry-${huginn.id}"]`;
  await vi.waitFor(() => expect(document.querySelector(row)?.getAttribute('data-unread')).toBe('true'));
  await vi.waitFor(() => query(bot));
  expect(all('.agents-rail .section-label').map(heading => heading.textContent)).toEqual(['Teams', 'Bots']);
  expect(query(row).textContent).toContain('Skollheim');
  expect(query(row).textContent).toContain('Huginn (Réseaux) and Jeux (Producteur)');

  query<HTMLButtonElement>(row).click();
  await vi.waitFor(() => expect(store.openThread?.id).toBe(team.threadId));
  expect(store.page).toBe('agents');
  await vi.waitFor(() => query('[data-testid=team-chat]'));
  expect([query('[data-testid=team-title]').textContent, query('[data-testid=team-room]').textContent]).toEqual(['Skollheim', 'Team chat · 2 bots and you']);
  expect(query(row).getAttribute('aria-current')).toBe('page');
  await vi.waitFor(() => expect(document.querySelector(row)?.hasAttribute('data-unread')).toBe(false));

  query<HTMLButtonElement>('[data-testid=agents-search-toggle]').click(); flushSync();
  search('skoll');
  expect([!!document.querySelector(row), !!document.querySelector(bot)]).toEqual([true, false]);
  search('huginn');
  expect([!!document.querySelector(row), !!document.querySelector(bot)]).toEqual([false, true]);
  // One card left: no headings over it.
  expect(all('.agents-rail .section-label')).toHaveLength(0);
});

test("a desktop's column shows the open team: its picture, its name, who is in it, its chat, and its members open their bot", async () => {
  const { store, team, huginn } = await skollheim();
  botsPage(store, false);
  // The desktop's default bot is open first; the rail then opens the team.
  await vi.waitFor(() => expect(store.openThread?.agentSessionId).toBeTruthy());
  await store.open(team.threadId);
  store.showAgents();
  await vi.waitFor(() => query('[data-testid=team-chat]'));
  await settle();
  expect(query('[data-testid=bot-column-head]').textContent).toContain('Skollheim');
  expect(query('[data-testid=bot-column-head]').textContent).toContain('Huginn (Réseaux) and Jeux (Producteur)');
  expect(query('[data-testid=bot-conversation]').getAttribute('aria-current')).toBe('page');
  expect(all('[data-testid=bot-member]').map(row => row.querySelector('strong')?.textContent)).toEqual(['Huginn (Réseaux)', 'Jeux (Producteur)']);
  // No list of bots or teams on a desktop's page, and no way back to one.
  expect(document.querySelector(`[data-testid="agent-team-${team.id}"]`)).toBeNull();
  expect(document.querySelector('[data-testid=agent-back]')).toBeNull();
  all('[data-testid=bot-member]')[0]!.click();
  await vi.waitFor(() => expect(store.openThread?.agentSessionId).toBeTruthy());
  await vi.waitFor(() => expect(query('[data-testid=bot-column-head]').textContent).toContain(huginn.name));
});

test("a phone's Bots list holds the teams, a team's chat opens full screen over it and goes back to it, and no thread row lists the chat", async () => {
  const { store, team } = await skollheim();
  phone();
  const threads = mount(MobileNavigation, { target: document.body, props: { store, screen: 'threads' } });
  await settle();
  // The chat refuses an agent's composer: it is no thread row of the list.
  expect(store.threads.some(thread => thread.id === team.threadId)).toBe(true);
  expect(document.querySelector(`[data-thread-id="${team.threadId}"]`)).toBeNull();
  await unmount(threads);

  botsPage(store, true);
  const row = `[data-testid="agent-team-${team.id}"]`;
  await vi.waitFor(() => query(row));
  const covered = () => document.documentElement.classList.contains('agents-detail-open');
  expect(covered()).toBe(false);
  query<HTMLButtonElement>(row).click();
  await vi.waitFor(() => expect(store.openThread?.id).toBe(team.threadId));
  await vi.waitFor(() => query('[data-testid=team-chat]'));
  expect(covered()).toBe(true);
  query<HTMLButtonElement>('[data-testid=agent-back]').click(); flushSync();
  expect(covered()).toBe(false);
  // The chat stays open behind the list.
  expect(store.openThread?.id).toBe(team.threadId);
});

test('with Teams off the Bots page lists the bots alone, and a team chat opens in the chat', async () => {
  const { store, team, huginn } = await skollheim();
  setExperiment('teams', false);
  botsPage(store, true);
  await vi.waitFor(() => query(`[data-testid="agent-entry-${huginn.id}"]`));
  await settle();
  expect(document.querySelector('[data-testid=agents-teams]')).toBeNull();
  expect(all('.agents-rail .section-label')).toHaveLength(0);
  await store.open(team.threadId);
  expect(store.page).toBe('chat');
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

test('a member of another machine of the group carries that machine in the member row, on its posts and in the @ and audience menus; one of this machine says nothing', async () => {
  const { client, store, huginn } = await skollheim();
  const firebat = new FakeClient({ delayMs: 0, coreId: 'firebat', coreName: 'Firebat', publicUrl: 'https://firebat.test' });
  closers.push(() => firebat.close());
  await firebat.connect();
  await client.call('group.create', { name: 'Home' });
  await firebat.call('group.join', { invite: (await client.call('group.invite', {})).invite });
  const distant = await firebat.call('agents.profile.save', { value: { name: 'Munin', domain: '', instructions: '', avatar: '', status: 'active', projectIds: [],
    selection: { providerId: 'echo', accountId: 'a-echo', model: 'echo-1', effort: null, permissionMode: 'default' } } });

  // The other machine's own switch keeps its bot out, with its name in the refusal.
  await expect(client.call('teams.create', { name: 'Across', members: [huginn.id, 'Firebat/Munin'] })).rejects.toThrow('Firebat: teams need the Teams experiment');
  firebat.reportDesktopExperiments(['teams']);
  const team = await client.call('teams.create', { name: 'Across', members: [huginn.id, 'Firebat/Munin'] });
  expect(team.members[1]).toMatchObject({ key: `firebat/${distant.id}`, coreId: 'firebat', botId: distant.id, machine: 'Firebat' });
  await client.call('teams.post', { teamId: team.id, id: 'to-munin', text: '@Munin hello' });
  // Its bot speaks from its own machine, and the post lands where the team is held.
  const conversation = (await firebat.call('agents.open', { agentId: distant.id })).threadId;
  await firebat.call('teams.say', { threadId: conversation, team: 'Across', text: 'On it.', id: 'from-munin' });

  await store.open(team.threadId);
  mounted.push(mount(TeamChat, { target: document.body, props: { store, thread: store.openThread! } }));
  await vi.waitFor(() => query('[data-testid=team-composer-input]'));
  await vi.waitFor(() => expect(all('[data-testid=team-post]')).toHaveLength(2));
  await settle();
  const rows = all('[data-testid=team-member]');
  expect(rows.map(row => row.querySelector('[data-testid=team-member-machine]')?.textContent ?? null)).toEqual([null, 'Firebat']);
  expect(rows[1]!.title).toBe('Munin (Firebat)');
  expect(rows[0]!.title).toBe(huginn.name);
  expect(all('[data-testid=team-post]').map(post => [post.querySelector('[data-testid=team-post-author]')?.textContent, post.querySelector('[data-testid=team-post-machine]')?.textContent ?? null])).toEqual([
    ['You', null], ['Munin', 'Firebat'],
  ]);

  query<HTMLButtonElement>('[data-testid=team-mention]').click(); await settle();
  expect(query(`[data-testid=team-mention-menu] [data-value="firebat/${distant.id}"]`).textContent).toContain('Firebat');
  expect(query(`[data-testid=team-mention-menu] [data-value="${team.members[0]!.key}"]`).textContent).not.toContain('Firebat');
  query<HTMLButtonElement>('[data-testid=team-mention]').click(); await settle();
  query<HTMLButtonElement>('[data-testid=team-audience]').click(); await settle();
  expect(query(`[data-testid=team-audience-menu] [data-value="firebat/${distant.id}"]`).textContent).toContain('Firebat');
  expect(query(`[data-testid=team-audience-menu] [data-value="${team.members[0]!.key}"]`).textContent).not.toContain('Firebat');
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
