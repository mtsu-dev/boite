import { afterEach, expect, test, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import { setExperiment } from '../../lib/experiments';
import { FakeClient } from '../../lib/fake-client';
import { Store } from '../../lib/store.svelte';
import { workspace } from '../../lib/workspace.svelte';
import AgentsPage from '../agents/AgentsPage.svelte';
import MobileNavigation from '../MobileNavigation.svelte';
import ConfirmDialog from '../ConfirmDialog.svelte';
import type { AgentsView } from '../../lib/agents.svelte';
import { strings } from '../../lib/strings';
import TeamDialog from './TeamDialog.svelte';

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
const text = (selector: string) => document.querySelector(selector)?.textContent?.trim() ?? null;

async function machine(names: string[], at: { coreId?: string; coreName?: string; publicUrl?: string } = {}) {
  const client = new FakeClient({ delayMs: 0, ...at });
  const store = new Store();
  store.attach(client);
  closers.push(() => { store.detach(); client.close(); });
  await store.connect();
  client.reportDesktopExperiments(['teams']);
  const bots = [];
  for (const name of names) bots.push(await client.call('agents.profile.save', { value: { name, domain: '', instructions: '', avatar: '', status: 'active', projectIds: [],
    selection: { providerId: 'echo', accountId: 'a-echo', model: 'echo-1', effort: null, permissionMode: 'default' } } }));
  return { client, store, bots };
}

/** This computer with three bots and no team yet, the Teams experiment on in the app and on the core. */
async function computer() {
  setExperiment('teams', true);
  setExperiment('resident-agents', true);
  const local = await machine(['Huginn', 'Jeux', 'Muninn']);
  workspace.machines = [{ id: 'local', label: 'Local', store: local.store }]; workspace.active = local.store;
  return local;
}

function phone() {
  vi.spyOn(window, 'matchMedia').mockImplementation(media => Object.assign(new EventTarget(), {
    media, matches: media.includes('max-width'), onchange: null, addListener() {}, removeListener() {}
  }));
}
/** The Bots page as a phone draws it, under the header that holds its "+": a desktop's bots and teams are in the window's rail, the page's column is the open one's. */
function page(store: Store) {
  phone();
  store.showAgents();
  mounted.push(mount(MobileNavigation, { target: document.body, props: { store, screen: 'threads' } }));
  mounted.push(mount(AgentsPage, { target: document.body, props: { store } }));
  mounted.push(mount(ConfirmDialog, { target: document.body }));
  flushSync();
}
function type(selector: string, value: string) {
  const field = query<HTMLInputElement | HTMLTextAreaElement>(selector);
  field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}
const member = (botId: string) => query<HTMLButtonElement>(`[data-testid=team-dialog-member][data-bot-id="${botId}"]`);
/** New team: in the one "+" menu the owner's phone page lends the header, or the greyed button a paired phone keeps under Teams. */
async function newTeam(): Promise<HTMLElement> {
  const plus = document.querySelector<HTMLButtonElement>('[data-testid=agents-create]');
  if (plus && !document.querySelector('[data-testid=agents-new-team]')) { plus.click(); await settle(); }
  return query('[data-testid=agents-new-team]');
}
async function openDialog() {
  (await newTeam()).click();
  await settle();
  return query('[data-testid=team-dialog]');
}

test('with no team yet the Bots list shows the Teams heading with New team and one line', async () => {
  const { store, bots } = await computer();
  page(store);
  await vi.waitFor(() => query(`[data-testid="agent-entry-${bots[0]!.id}"]`));
  await settle();
  expect(all('.agents-rail .section-label').map(heading => heading.textContent)).toEqual(['Teams', 'Bots']);
  expect((await newTeam()).textContent?.trim()).toBe('New team');
  expect(text('[data-testid=agents-teams-empty]')).toBe('No team yet: put a few bots in one chat.');
  expect(document.querySelector('[data-testid=agents-teams]')).toBeNull();
});

test('the dialog asks for a name and a bot, then creates the team on this machine and opens its chat', async () => {
  const { client, store, bots } = await computer();
  const [huginn, jeux, muninn] = bots as [typeof bots[0], typeof bots[0], typeof bots[0]];
  page(store);
  await vi.waitFor(() => query(`[data-testid="agent-entry-${huginn.id}"]`));
  const dialog = await openDialog();
  expect(document.activeElement).toBe(query('[data-testid=team-dialog-name]'));
  expect(all('[data-testid=team-dialog-member]').map(row => row.textContent?.trim())).toEqual(['Huginn', 'Jeux', 'Muninn']);

  // Nothing goes without a name, then without a bot.
  query<HTMLButtonElement>('[data-testid=team-dialog-submit]').click(); await settle();
  expect(text('[data-testid=team-dialog-problem]')).toBe('Give the team a name.');
  type('[data-testid=team-dialog-name]', '  Launch   crew ');
  expect(text('[data-testid=team-dialog-problem]')).toBe('Pick at least one bot.');
  member(huginn.id).click(); member(muninn.id).click(); flushSync();
  expect([member(huginn.id).getAttribute('aria-pressed'), member(jeux.id).getAttribute('aria-pressed'), member(muninn.id).getAttribute('aria-pressed')]).toEqual(['true', 'false', 'true']);
  expect(text('[data-testid=team-dialog-count]')).toBe('2 of 12');
  expect(document.querySelector('[data-testid=team-dialog-problem]')).toBeNull();
  type('[data-testid=team-dialog-brief]', 'Ship the launch post.');

  // Enter in the name sends it, as Create does.
  query('[data-testid=team-dialog-name]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await vi.waitFor(async () => expect((await client.call('teams.list', {})).teams).toHaveLength(1));
  const [team] = (await client.call('teams.list', {})).teams;
  expect([team!.name, team!.brief, team!.createdBy, team!.members.map(entry => entry.botId)]).toEqual(['Launch crew', 'Ship the launch post.', 'owner', [huginn.id, muninn.id]]);
  await vi.waitFor(() => expect(store.openThread?.id).toBe(team!.threadId));
  await vi.waitFor(() => expect(text('[data-testid=team-title]')).toBe('Launch crew'));
  await vi.waitFor(() => query(`[data-testid="agent-team-${team!.id}"]`));
  expect(document.querySelector('[data-testid=agents-teams-empty]')).toBeNull();
  // The dialog plays its exit, then leaves.
  dialog.dispatchEvent(new Event('animationend', { bubbles: true }));
  await vi.waitFor(() => expect(document.querySelector('[data-testid=team-dialog]')).toBeNull());
});

test('a taken name says so as it is typed, and Escape closes the dialog without creating anything', async () => {
  const { client, store, bots } = await computer();
  await client.call('teams.create', { name: 'Skollheim', members: [bots[0]!.id] });
  page(store);
  await vi.waitFor(() => query('[data-testid=agents-teams]'));
  const dialog = await openDialog();
  type('[data-testid=team-dialog-name]', 'skollheim');
  expect(text('[data-testid=team-dialog-problem]')).toBe('A team is already named skollheim.');
  expect(query('[data-testid=team-dialog-name]').getAttribute('aria-invalid')).toBe('true');
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  flushSync();
  expect(dialog.classList.contains('closing')).toBe(true);
  expect((await client.call('teams.list', {})).teams).toHaveLength(1);
});

test("the bots of a machine outside the group are listed greyed with why, and cannot be picked", async () => {
  const local = await computer();
  const remote = await machine(['Tour']);
  workspace.machines = [{ id: 'local', label: 'Local', store: local.store }, { id: 'srv', label: 'Server', store: remote.store }];
  page(local.store);
  await vi.waitFor(() => query(`[data-testid="agent-entry-${remote.bots[0]!.id}"]`));
  await openDialog();
  const away = query<HTMLButtonElement>(`[data-testid=team-dialog-member][data-key='${JSON.stringify(['srv', remote.bots[0]!.id])}']`);
  expect(away.getAttribute('aria-disabled')).toBe('true');
  expect(away.title).toBe("On Server: a team takes the bots of this machine's group.");
  expect(away.closest('li')?.querySelector('[data-testid=team-dialog-why]')).not.toBeNull();
  away.click(); flushSync();
  expect(away.getAttribute('aria-pressed')).toBe('false');
  // A tap says why on a screen with no hover.
  expect(text('[data-testid=team-dialog-told]')).toBe("On Server: a team takes the bots of this machine's group.");
});

test("a bot of another machine of the group joins from the dialog under its machine's name, and an edit keeps it one row until it is taken out", async () => {
  setExperiment('teams', true);
  setExperiment('resident-agents', true);
  const local = await machine(['Huginn'], { coreId: 'desk', coreName: 'Desk', publicUrl: 'https://desk.test' });
  // Its second bot: no bot of this machine has that id, so nothing here can pass for it.
  const remote = await machine(['Ratatosk', 'Munin'], { coreId: 'firebat', coreName: 'Firebat', publicUrl: 'https://firebat.test' });
  await local.client.call('group.create', { name: 'Home' });
  await remote.client.call('group.join', { invite: (await local.client.call('group.invite', {})).invite });
  await vi.waitFor(() => { expect(local.store.group?.cores).toHaveLength(2); expect(remote.store.group?.self).toBe('firebat'); });
  const here = { id: 'local', label: 'Desk', store: local.store };
  workspace.machines = [here, { id: 'srv', label: 'Firebat', store: remote.store }]; workspace.active = local.store;
  const huginn = local.bots[0]!, munin = remote.bots[1]!;
  const key = `firebat/${munin.id}`;
  const far = () => query<HTMLButtonElement>(`[data-testid=team-dialog-member][data-key="${key}"]`);
  const place = (row: HTMLElement) => row.querySelector('[data-testid=team-dialog-machine]')?.textContent ?? null;
  const keys = async () => (await local.client.call('teams.list', { archived: true })).teams[0]!.members.map(entry => entry.key);
  const submit = () => query<HTMLButtonElement>('[data-testid=team-dialog-submit]');
  page(local.store);
  await vi.waitFor(() => query(`[data-testid="agent-entry-${huginn.id}"]`));
  const dialog = await openDialog();
  await vi.waitFor(() => far());
  expect(far().getAttribute('aria-disabled')).not.toBe('true');
  expect(place(far())).toBe('Firebat');
  expect(place(member(huginn.id))).toBeNull();

  // The team stays on this machine, which needs a bot of its own in it.
  type('[data-testid=team-dialog-name]', 'Maison');
  far().click(); flushSync();
  expect(far().getAttribute('aria-pressed')).toBe('true');
  submit().click(); await settle();
  expect(text('[data-testid=team-dialog-problem]')).toBe('Pick a bot of this machine too: it holds the team.');
  expect((await local.client.call('teams.list', {})).teams).toEqual([]);
  member(huginn.id).click(); flushSync();
  expect(document.querySelector('[data-testid=team-dialog-problem]')).toBeNull();
  submit().click();
  await vi.waitFor(async () => expect(await keys()).toEqual([key, `desk/${huginn.id}`]));
  await vi.waitFor(() => query('[data-testid=team-menu]'));
  dialog.dispatchEvent(new Event('animationend', { bubbles: true }));
  await vi.waitFor(() => expect(document.querySelector('[data-testid=team-dialog]')).toBeNull());

  // A member of another machine does not hold back a restore.
  const [team] = (await local.client.call('teams.list', {})).teams;
  await local.client.call('teams.archive', { teamId: team!.id, archived: true });
  expect((await local.client.call('teams.archive', { teamId: team!.id, archived: false })).members).toHaveLength(2);

  // Edited, it is the same bot and still a member: not gone, not listed a second time.
  query<HTMLButtonElement>('[data-testid=team-menu]').click(); await settle();
  query<HTMLButtonElement>('[data-testid=team-menu-menu] [data-value="edit"]').click(); await settle();
  expect(far().getAttribute('aria-pressed')).toBe('true');
  expect(far().closest('li')?.querySelector('[data-testid=team-dialog-why]')).toBeNull();
  expect(all(`[data-testid=team-dialog-member][data-key="${key}"]`)).toHaveLength(1);

  // A machine this app no longer reaches keeps its member, under the name the team knows.
  workspace.machines = [here];
  await settle();
  expect(far().getAttribute('aria-pressed')).toBe('true');
  expect(place(far())).toBe('Firebat');

  far().click(); flushSync();
  submit().click();
  await vi.waitFor(async () => expect(await keys()).toEqual([`desk/${huginn.id}`]));
  expect(local.store.error).toBeFalsy();
});

test('the team header menu edits the name, brief and members, pauses and resumes, and archives after a confirm', async () => {
  const { client, store, bots } = await computer();
  const [huginn, jeux, muninn] = bots as [typeof bots[0], typeof bots[0], typeof bots[0]];
  const team = await client.call('teams.create', { name: 'Skollheim', brief: 'Ship the site.', members: [huginn.id, jeux.id] });
  page(store);
  await vi.waitFor(() => query(`[data-testid="agent-team-${team.id}"]`));
  query<HTMLButtonElement>(`[data-testid="agent-team-${team.id}"]`).click();
  await vi.waitFor(() => query('[data-testid=team-menu]'));
  const choose = async (id: string) => {
    query<HTMLButtonElement>('[data-testid=team-menu]').click(); await settle();
    query<HTMLButtonElement>(`[data-testid=team-menu-menu] [data-value="${id}"]`).click(); await settle();
  };
  const read = async () => (await client.call('teams.list', { archived: true })).teams[0]!;

  await choose('edit');
  expect(text('#' + CSS.escape(query('[data-testid=team-dialog]').getAttribute('aria-labelledby')!))).toBe('Edit Skollheim');
  expect(query<HTMLInputElement>('[data-testid=team-dialog-name]').value).toBe('Skollheim');
  type('[data-testid=team-dialog-name]', 'Skollheim crew');
  type('[data-testid=team-dialog-brief]', 'Ship the site and the trailer.');
  member(jeux.id).click(); member(muninn.id).click(); flushSync();
  query<HTMLButtonElement>('[data-testid=team-dialog-submit]').click();
  // Name and brief, then the member out, then the one in: the dialog closes once all three are done.
  await vi.waitFor(() => expect(document.querySelector('[data-testid=team-dialog]:not(.closing)')).toBeNull());
  const edited = await read();
  expect([edited.name, edited.brief, edited.members.map(entry => entry.botId)]).toEqual(['Skollheim crew', 'Ship the site and the trailer.', [huginn.id, muninn.id]]);
  await vi.waitFor(() => expect(text('[data-testid=team-title]')).toBe('Skollheim crew'));

  await choose('pause');
  await vi.waitFor(async () => expect((await read()).paused).toBe(true));
  await vi.waitFor(() => expect(text('[data-testid=team-room]')).toBe('Paused'));
  await choose('resume');
  await vi.waitFor(async () => expect((await read()).paused).toBe(false));

  await choose('archive');
  await vi.waitFor(() => query('[data-testid=confirm-cancel]'));
  expect(document.body.textContent).toContain('Archive Skollheim crew?');
  query<HTMLButtonElement>('[data-testid=confirm-cancel]').click(); await settle();
  expect((await read()).archived).toBe(false);
  await choose('archive');
  await vi.waitFor(() => query('[data-confirm]'));
  query<HTMLButtonElement>('[data-confirm]').click();
  await vi.waitFor(async () => expect((await read()).archived).toBe(true));
  await vi.waitFor(() => expect(text('[data-testid=team-room]')).toBe('Archived'));
  await choose('restore');
  await vi.waitFor(async () => expect((await read()).archived).toBe(false));
  expect(store.error).toBeFalsy();
});

test('a paired phone keeps New team and the team menu greyed, and says that changing teams stays on the computer', async () => {
  const { client, store, bots } = await computer();
  const team = await client.call('teams.create', { name: 'Skollheim', members: [bots[0]!.id] });
  vi.spyOn(store, 'owner', 'get').mockReturnValue(false);
  phone();
  page(store);
  await vi.waitFor(() => query(`[data-testid="agent-team-${team.id}"]`));
  const button = query<HTMLButtonElement>('[data-testid=agents-new-team]');
  expect(button.getAttribute('aria-disabled')).toBe('true');
  button.click(); await settle();
  expect(document.querySelector('[data-testid=team-dialog]')).toBeNull();
  expect(text('[data-testid=agents-teams-guest]')).toBe('Only the computer running Boite can create or change teams.');

  query<HTMLButtonElement>(`[data-testid="agent-team-${team.id}"]`).click();
  await vi.waitFor(() => query('[data-testid=team-menu]'));
  query<HTMLButtonElement>('[data-testid=team-menu]').click(); await settle();
  const rows = all('[data-testid=team-menu-menu] [data-row]');
  expect(rows.map(row => [row.getAttribute('data-value'), (row as HTMLButtonElement).disabled])).toEqual([['edit', true], ['pause', true], ['archive', true]]);
  expect(query('[data-testid=team-menu-menu]').textContent).toContain('Only the computer running Boite can create or change teams.');
});

test('a machine whose only bot is moving lists it greyed, without saying there is no bot', async () => {
  const { store, bots } = await computer();
  const bot = bots[0]!;
  const view = { store, snapshot: { revision: 1, profiles: [bot], status: [{ agentId: bot.id, leaving: { agentId: bot.id, machine: 'srv', requestId: 'r1', at: 0 } }] } } as unknown as AgentsView;
  mounted.push(mount(TeamDialog, { target: document.body, props: { view, onclose() {}, ondone() {} } }));
  await settle();
  expect(member(bot.id).getAttribute('aria-disabled')).toBe('true');
  expect(member(bot.id).title).toBe('Moving to another machine: it joins no team until it has arrived.');
  expect(document.querySelector('[data-testid=team-dialog-nobots]')).toBeNull();
});

test('a member that left the machine shows why while picked, and once unpicked that it leaves on save', async () => {
  const { client, store, bots } = await computer();
  const [huginn, jeux] = bots as [typeof bots[0], typeof bots[0]];
  const team = await client.call('teams.create', { name: 'Skollheim', members: [huginn.id, jeux.id] });
  const { id, revision, createdAt, updatedAt, ...value } = jeux;
  void createdAt; void updatedAt;
  await client.call('agents.profile.save', { id, expectedRevision: revision, value: { ...value, status: 'archived' } });
  page(store);
  await vi.waitFor(() => query(`[data-testid="agent-team-${team.id}"]`));
  query<HTMLButtonElement>(`[data-testid="agent-team-${team.id}"]`).click();
  await vi.waitFor(() => query('[data-testid=team-menu]'));
  query<HTMLButtonElement>('[data-testid=team-menu]').click(); await settle();
  query<HTMLButtonElement>('[data-testid=team-menu-menu] [data-value="edit"]').click(); await settle();
  const gone = member(jeux.id);
  expect(gone.getAttribute('aria-pressed')).toBe('true');
  expect(gone.closest('li')?.querySelector('[data-testid=team-dialog-why]')).not.toBeNull();
  expect(member(huginn.id).closest('li')?.querySelector('[data-testid=team-dialog-why]')).toBeNull();
  gone.click(); flushSync();
  expect(gone.getAttribute('aria-pressed')).toBe('false');
  expect(gone.title).toBe('No longer a bot of this machine: it leaves the team when you save.');
});

test('pause from the team menu says the connection is gone instead of doing nothing', async () => {
  const { client, store, bots } = await computer();
  const team = await client.call('teams.create', { name: 'Skollheim', members: [bots[0]!.id] });
  page(store);
  await vi.waitFor(() => query(`[data-testid="agent-team-${team.id}"]`));
  query<HTMLButtonElement>(`[data-testid="agent-team-${team.id}"]`).click();
  await vi.waitFor(() => query('[data-testid=team-menu]'));
  vi.spyOn(store, 'client', 'get').mockReturnValue(null);
  const report = vi.spyOn(store, 'reportError');
  query<HTMLButtonElement>('[data-testid=team-menu]').click(); await settle();
  query<HTMLButtonElement>('[data-testid=team-menu-menu] [data-value="pause"]').click(); await settle();
  expect(report).toHaveBeenCalledWith(new Error(strings.connection.unavailable), 'minor');
});
