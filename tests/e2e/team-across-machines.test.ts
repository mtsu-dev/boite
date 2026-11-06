import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ExperimentId, Team, TeamReading } from '../../packages/contracts/src/index.ts';
import { connect, type CoreClient } from '../../packages/core/src/client.ts';
import { quietAgent } from '../../packages/core/test/harness.ts';
import { BrowserPage, freePort } from './lib/cdp.ts';
import { startCore, type RunningCore } from './lib/core.ts';
import { startUi } from './lib/ui.ts';
import { openRailBot, openRailTeam, railAdd } from './lib/bots.ts';

/* A team across machines (`docs/teams.md`): two real core processes of one group, a bot on each, a machine cut off and back, and the app showing a member of the other machine. */

const ARTIFACTS = join(import.meta.dir, '.artifacts', 'team-across-machines');
const WIDE = { width: 816, height: 900, deviceScaleFactor: 1, mobile: false };
const NARROW = { width: 330, height: 720, deviceScaleFactor: 1, mobile: true };
const CORE = [process.execPath, 'run', join(import.meta.dir, 'lib', 'team-bot-core.ts')];
const EXPERIMENTS: ExperimentId[] = ['resident-agents', 'teams'];
const machine = (name: string, more: { dataDir?: string; port?: number } = {}) => ({ command: CORE, env: { BOITE_MACHINE_NAME: name }, ...more });
const until = async (check: () => Promise<boolean>, what: string, ms = 30_000) => {
  const deadline = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(100);
  }
};

let server: { close(): Promise<void> };
let page: BrowserPage;
let url: string;
const cores: RunningCore[] = [];
const clients: CoreClient[] = [];
const started = async (options: ReturnType<typeof machine>) => {
  const core = await startCore(options);
  cores.push(core);
  return core;
};
const owner = async (core: RunningCore) => {
  const client = await connect(core.url, core.token);
  clients.push(client);
  return client;
};

beforeAll(async () => {
  mkdirSync(ARTIFACTS, { recursive: true });
  const port = await freePort();
  server = await startUi(port);
  url = `http://127.0.0.1:${port}`;
  page = await BrowserPage.launch({ url: `${url}/?fake=1`, experiments: EXPERIMENTS });
}, 30_000);
afterAll(async () => {
  for (const client of clients) client.close();
  await page?.close();
  await server?.close();
  for (const core of cores) await core.stop();
}, 30_000);

test('a post, an @name and a private post reach the bot of the other machine, its answers come back, a machine cut off gets them once, and the app says which machine a member runs on', async () => {
  const skoll = await started(machine('Skoll'));
  const firebat = await started(machine('Firebat'));
  const a = await owner(skoll);
  const b = await owner(firebat);
  const preferences = { app: 'app-desktop-0001', language: 'en' as const, experiments: EXPERIMENTS, labels: {} };
  await Promise.all([a.call('settings.set', { browserOrigins: [url] }), b.call('settings.set', { browserOrigins: [url] }), a.call('client.preferences', preferences), b.call('client.preferences', preferences)]);
  await a.call('group.create', { name: 'Home' });
  await b.call('group.join', { invite: (await a.call('group.invite', {})).invite });
  const bot = async (client: CoreClient, name: string) => {
    const account = (await client.call('accounts.list', {})).find(entry => entry.providerId === 'echo')!;
    const agent = await quietAgent(client, await client.call('agents.profile.save', { value: {
      name, domain: '', instructions: '', avatar: '', status: 'active', projectIds: [],
      selection: { providerId: 'echo', accountId: account.id, model: 'echo', effort: null, permissionMode: 'default' }
    } }));
    const { threadId } = await client.call('agents.open', { agentId: agent.id });
    await until(async () => (await client.call('threads.get', { threadId })).status === 'idle', `${name}'s first turn`);
    return { ...agent, threadId };
  };
  const huginn = await bot(a, 'Huginn');
  const munin = await bot(b, 'Munin');

  // The machine by the name the group knows it by: the core id is the other way to write it.
  await until(async () => (await a.call('group.get', {}))?.cores.some(core => core.name === 'Firebat') === true, 'the name of the other machine');
  const team = await a.call('teams.create', { name: 'Maison', brief: 'One bot per machine.', members: [huginn.id, 'Firebat/Munin'] });
  const distant = team.members.find(member => member.botId === munin.id)!;
  expect(distant.machine).toBe('Firebat');
  const local = team.members.find(member => member.botId === huginn.id)!;
  expect(local.machine).toBeUndefined();

  const read = () => a.call('teams.read', { team: team.id, limit: 100 }) as Promise<TeamReading>;
  const by = async (author: string) => (await read()).posts.filter(post => post.author === author);
  const count = (author: string, wanted: number, what: string) => until(async () => (await by(author)).length === wanted, what);

  // A group post that wakes everyone, on both machines.
  await a.call('teams.post', { teamId: team.id, id: 'everyone', text: '@tous the disk is nearly full' });
  await count(distant.key, 1, 'the group answer of the other machine');
  await count(local.key, 1, 'the group answer of this machine');
  // `@name` wakes the other machine only, and its answer comes back in the group.
  await a.call('teams.post', { teamId: team.id, id: 'named', text: '@Munin look at the backups' });
  await count(distant.key, 2, 'the answer to @name');
  expect((await by(local.key)).length).toBe(1);
  // A private post wakes its recipient and comes back as private to the owner.
  await a.call('teams.post', { teamId: team.id, id: 'between-us', text: 'Between us: keep the old one.', audience: 'private', to: [munin.id] });
  await count(distant.key, 3, 'the answer to the private post');
  expect((await by(distant.key)).at(-1)).toMatchObject({ audience: 'private', to: ['owner'] });

  // Cut off: the post waits and says why; back on its port, it arrives once.
  await firebat.stop({ keepDataDir: true });
  cores.splice(cores.indexOf(firebat), 1);
  await a.call('teams.post', { teamId: team.id, id: 'while-away', text: '@Munin answer when you are back' });
  await until(async () => (await read()).deliveries.some(delivery => delivery.postId === 'while-away' && delivery.state === 'unreachable'), 'the post saying its machine is away');
  expect((await by(distant.key)).length).toBe(3);
  const back = await started(machine('Firebat', { dataDir: firebat.dataDir, port: firebat.port }));
  await count(distant.key, 4, 'the answer of the machine that came back');
  await Bun.sleep(2_000);
  expect((await by(distant.key)).length).toBe(4);
  const backOwner = await owner(back);

  // The app, on the machine holding the team.
  await page.navigate(`${url}/?core=${encodeURIComponent(skoll.url)}&token=${encodeURIComponent(skoll.token)}`);
  await page.waitFor(`document.querySelector('[data-testid="confirm-ok"]')`);
  await page.click('[data-testid="confirm-ok"]');
  await page.waitFor(`globalThis.__boiteTest.workspace.machines.filter(machine => machine.store.connection === 'ready').length === 2`, 30_000);
  await openRailTeam(page, team.id);
  await page.waitFor(`document.querySelectorAll('[data-testid=team-post]').length > 0`);

  const shot = async (name: string) => {
    await page.settleAnimations();
    await page.screenshot(join(ARTIFACTS, name));
  };
  const fits = `document.documentElement.scrollWidth <= innerWidth`;
  const inMenu = (menu: string, key: string) => page.text(`[data-testid=${menu}-menu] [data-value="${key}"]`);
  for (const [label, size] of [['816', WIDE], ['330', NARROW]] as const) {
    await page.send('Emulation.setDeviceMetricsOverride', size);
    await page.waitFor(`document.querySelector('[data-testid=team-chat]')?.getBoundingClientRect().width > 0`);
    expect(await page.evaluate(`[...document.querySelectorAll('[data-testid=team-member]')].map(row => row.querySelector('[data-testid=team-member-machine]')?.textContent ?? null)`)).toEqual([null, 'Firebat']);
    expect(await page.evaluate(`[...new Set([...document.querySelectorAll('[data-testid=team-post-machine]')].map(node => node.textContent))]`)).toEqual(['Firebat']);
    expect(await page.evaluate(fits)).toBe(true);
    await shot(`chat-${label}.png`);
    await page.click('[data-testid=team-mention]');
    await page.waitFor(`document.querySelector('[data-testid=team-mention-menu]')`);
    expect(await inMenu('team-mention', distant.key)).toContain('Firebat');
    expect(await inMenu('team-mention', local.key)).not.toContain('Firebat');
    await shot(`mention-${label}.png`);
    await page.click('[data-testid=team-mention]');
    await page.click('[data-testid=team-audience]');
    await page.waitFor(`document.querySelector('[data-testid=team-audience-menu]')`);
    expect(await inMenu('team-audience', distant.key)).toContain('Firebat');
    await shot(`audience-${label}.png`);
    await page.click('[data-testid=team-audience]');
  }

  // A bot's card names the machine of the bot it would bring.
  await a.call('teams.propose', { threadId: huginn.threadId, name: 'Backups', members: [huginn.id, 'Firebat/Munin'], brief: 'The backups of both machines.' });
  await page.send('Emulation.setDeviceMetricsOverride', WIDE);
  await openRailBot(page, huginn.id);
  const card = '.agents-main [data-testid=team-card][data-state=pending]';
  await page.waitFor(`document.querySelector('${card}')`);
  expect(await page.text(card)).toContain('Munin (Firebat)');
  await shot('card-816.png');
  await page.send('Emulation.setDeviceMetricsOverride', NARROW);
  await page.waitFor(`document.querySelector('${card}')?.getBoundingClientRect().width > 0`);
  expect(await page.evaluate(fits)).toBe(true);
  await shot('card-330.png');

  // A team written by hand takes that bot too, through the real core, and the dialog says where it runs.
  await page.send('Emulation.setDeviceMetricsOverride', WIDE);
  await railAdd(page, 'team');
  const far = `[data-testid=team-dialog-member][data-key="${distant.key}"]`;
  await page.waitFor(`document.querySelector('${far}')`);
  // Both cores run on this PC here, so the app may add its "(you)".
  expect(await page.text(`${far} [data-testid=team-dialog-machine]`)).toContain('Firebat');
  expect(await page.evaluate(`document.querySelector('${far}').getAttribute('aria-disabled')`)).not.toBe('true');
  expect(await page.evaluate(`document.querySelector('[data-testid=team-dialog-member][data-key="${huginn.id}"] [data-testid=team-dialog-machine]')`)).toBeNull();
  await page.click(far);
  await page.click(`[data-testid=team-dialog-member][data-key="${huginn.id}"]`);
  await shot('dialog-816.png');
  await page.send('Emulation.setDeviceMetricsOverride', NARROW);
  await page.waitFor(`document.querySelector('[data-testid=team-dialog]')?.getBoundingClientRect().width > 0`);
  expect(await page.evaluate(fits)).toBe(true);
  await shot('dialog-330.png');
  await page.type('[data-testid=team-dialog-name]', 'By hand');
  await page.click('[data-testid=team-dialog-submit]');
  const byHand = async () => ((await a.call('teams.list', {})).teams as readonly Team[]).find(entry => entry.name === 'By hand');
  await until(async () => (await byHand()) !== undefined, 'the team written in the dialog');
  expect((await byHand())!.members.map(member => member.key).sort()).toEqual([local.key, distant.key].sort());
  expect(page.errors()).toEqual([]);

  // No app spoke to the machine that came back, and its bot still finds the team the other machine holds.
  const byHandId = (await byHand())!.id;
  const mirrored = () => backOwner.call('teams.list', { threadId: munin.threadId }).then(({ teams }: { teams: readonly Team[] }) => teams.map(entry => entry.id).sort());
  await until(async () => (await mirrored()).includes(byHandId), 'the mirror of the team written in the dialog');
  expect(await mirrored()).toEqual([team.id, byHandId].sort());
}, 180_000);
