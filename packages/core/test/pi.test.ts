import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { TOOL_FREE_CONTEXT } from '@boite/contracts';
import type { FileAttachment, ImageAttachment, MessagePart, ModelInfo, RpcEvents, RpcParams, Settings } from '@boite/contracts';
import type { CoreClient } from '../src/client.ts';
import type { SharedAccess } from '../src/contacts/access-policy.ts';
import { forgetProbes, getDriver, probedModelsOf } from '../src/drivers/index.ts';
import { setPiReadDeadlineForTests, setPiStopDeadlineForTests } from '../src/drivers/pi/session.ts';
import { piProfileArgs, piProfilePins } from '../src/drivers/pi/models.ts';
import { folderExtends, folderStartModel, piLaunchChoices } from '../src/drivers/pi/start-model.ts';
import { forgetSavedCatalog, readSavedCatalog } from '../src/providers/saved-catalogs.ts';
import { BACKGROUND_COMPACT } from '../src/threads/background-compact.ts';
import * as selection from '../src/threads/selection.ts';
import { USER_ORIGIN } from '../src/threads/turn-origin.ts';
import { startTestCore, startTurn, waitFor } from './harness.ts';
import type { TestCore } from './harness.ts';
import { rejection, thrown } from './settle.ts';
import { countLogLines, countProcesses, readScriptedLog, writeScriptedProvider } from './scripted-provider.ts';

/** The fake pi in RPC mode: a real JSON-lines process over stdio, run by bun. */
const FAKE_AGENT = fileURLToPath(new URL('./fixtures/pi-agent.ts', import.meta.url));

test('pi subagent extension calls reach the native team through the real protocol', async () => {
  const { client, threadId } = await startThread();
  const { finished } = await startTurn(client, threadId, '[agents]');
  expect((await finished).status).toBe('done');
  expect((await client.call('delegation.get', { threadId })).nativeAgents).toEqual([
    expect.objectContaining({ toolId: 'native-pi', name: 'reviewer', task: 'Review parser boundaries', status: 'done', result: 'Parser checked' }),
  ]);
  const { finished: second } = await startTurn(client, threadId, '[agents]');
  expect((await second).status).toBe('done');
  const agents = (await client.call('delegation.get', { threadId })).nativeAgents;
  expect(agents).toHaveLength(2);
  expect(new Set(agents.map(agent => agent.id)).size).toBe(2);
  expect(agents.every(agent => agent.toolId === 'native-pi' && agent.status === 'done')).toBe(true);
});

test('coordination steers a running pi turn over its RPC connection', async () => {
  const { client, threadId } = await startThread(undefined, 'fake-a/smart');
  await client.call('turns.start', { threadId, prompt: '[slow] Deploy' });
  await waitFor(() => fakeLog().includes('waiting for abort'));
  await waitFor(() => harness!.core.journal.listMessages(threadId).some(m => m.role === 'assistant'));
  expect(await harness!.core.threads.steer(threadId, 'Boite agent coordination. Wait for the VM.')).toBe(true);
  expect(fakeLog()).toContain('steering Boite agent coordination');
  const turn = harness!.core.journal.listTurns(threadId)[0]!;
  const correction: RpcParams<'turns.steer'> = { threadId, turnId: turn.id, prompt: 'User correction [steer-delta]',
    attachments: [{ kind: 'image', mimeType: 'image/png', data: 'aGVsbG8=', name: 'sample.png' }], clientRequestId: 'pi_steer_01' };
  expect(await client.call('turns.steer', correction)).toEqual({ accepted: true });
  expect(fakeLog()).toContain('steering User correction');
  expect(fakeLog()).toContain('steer-image image/png 8');
  expect(harness!.core.journal.listTurns(threadId)).toHaveLength(1);
  const replied = () => harness!.core.journal.listMessages(threadId).findIndex(m => m.parts.some(part => part.type === 'text' && part.text.includes('Steer answered')));
  await waitFor(() => replied() >= 0);
  expect(replied()).toBeGreaterThan(harness!.core.journal.listMessages(threadId).findLastIndex(m => m.role === 'user'));
  await client.call('turns.stop', { threadId });
  await waitFor(() => fakeLog().includes('clear_queue\nabort'));
  expect(fakeLog()).toContain('clear_queue\nabort');
  await waitFor(() => harness!.core.journal.getTurn(turn.id)?.status === 'stopped');
  await client.call('threads.update', { threadId, model: 'fake-b/plain' });
  expect(await client.call('turns.steer', correction)).toEqual({ accepted: true });
  // Nor once the thread moved to a provider that takes no images and the turn's was removed.
  const descriptorFile = join(harness!.dataDir, 'providers', 'pi-fake.json');
  const descriptor = JSON.parse(readFileSync(descriptorFile, 'utf8')) as object;
  writeFileSync(join(harness!.dataDir, 'providers', 'pi-other.json'), JSON.stringify({ ...descriptor, id: 'pi-other', name: 'Other pi', shortName: 'PiOther',
    capabilities: { ...(descriptor as { capabilities: object }).capabilities, images: false } }));
  expect((await client.call('providers.reload', {})).rejected).toEqual([]);
  const other = await client.call('accounts.add', { providerId: 'pi-other', label: 'Other', useDefaultLocation: true });
  await client.call('threads.update', { threadId, accountId: other.id });
  rmSync(descriptorFile);
  expect((await client.call('providers.reload', {})).loaded.some(provider => provider.id === 'pi-fake')).toBe(false);
  expect(await client.call('turns.steer', correction)).toEqual({ accepted: true });
});

test('pi default refuses images while pi itself runs a text-only model', async () => {
  process.env['PI_FAKE_CURRENT'] = 'plain';
  const { client, threadId } = await startThread();
  const { accountId, model } = harness!.core.threads.require(threadId);
  expect(model).toBe('default');
  await client.call('providers.probe', { providerId: 'pi-fake', accountId });
  const image: ImageAttachment = { kind: 'image', name: 'sample.png', mimeType: 'image/png', data: 'aGVsbG8=' };
  expect((await rejection(client.call('turns.start', { threadId, prompt: 'Read this', attachments: [image] }))).reason)
    .toMatchObject({ rpc: { message: 'pi default takes no images: send the prompt without them' } });
  // pi reads the folder's own settings over the account's only once it trusts the folder, which RPC mode never asks.
  const { cwd, projectId } = harness!.core.threads.require(threadId);
  const agentDir = join(harness!.dataDir, 'pi-agent');
  process.env['PI_CODING_AGENT_DIR'] = agentDir;
  mkdirSync(join(cwd, '.pi'), { recursive: true });
  mkdirSync(agentDir, { recursive: true });
  const folder = (settings: object, bom = '') => writeFileSync(join(cwd, '.pi', 'settings.json'), bom + JSON.stringify(settings));
  const images = async () => (await client.call('threads.capabilities', { threadId })).images.supported;
  const draft = async () => (await client.call('drafts.images', { projectId: projectId!, providerId: 'pi-fake', accountId, model: null })).supported;
  folder({ defaultProvider: 'fake-a', defaultModel: 'smart' });
  expect(await images()).toBe(false);
  writeFileSync(join(agentDir, 'trust.json'), JSON.stringify({ [realpathSync(join(cwd, '..'))]: true }));
  expect([await images(), await draft()]).toEqual([true, true]);
  // As pi does, a BOM and a scope of the folder's own count, and a pattern only pi resolves leaves the images to it.
  folder({ defaultProvider: 'fake-a', defaultModel: 'smart' }, '\uFEFF');
  expect(await images()).toBe(true);
  writeFileSync(join(agentDir, 'settings.json'), JSON.stringify({ enabledModels: ['fake-b/plain'] }));
  expect(await images()).toBe(false);
  folder({ enabledModels: [], defaultProvider: 'fake-a', defaultModel: 'smart' });
  expect(await images()).toBe(true);
  // An empty scope over none changes nothing: the account's own model answers.
  rmSync(join(agentDir, 'settings.json'));
  folder({ enabledModels: [] });
  expect(await images()).toBe(false);
  writeFileSync(join(agentDir, 'settings.json'), JSON.stringify({ enabledModels: ['fake-b/plain'] }));
  folder({ enabledModels: ['fake-b/plain:high'] });
  expect(await images()).toBe(false);
  // Within a scope, pi starts on the saved default when the scope holds it.
  folder({ enabledModels: ['fake-b/plain', 'fake-a/smart'], defaultProvider: 'fake-a', defaultModel: 'smart' });
  expect(await images()).toBe(true);
  folder({ enabledModels: ['fake-*'] });
  expect(await images()).toBe(true);
  // A folder that picks a text-only model refuses what the account's model would read.
  rmSync(join(agentDir, 'settings.json'));
  delete process.env['PI_FAKE_CURRENT'];
  await client.call('providers.probe', { providerId: 'pi-fake', accountId, refresh: true });
  folder({ defaultProvider: 'fake-b', defaultModel: 'plain' });
  expect((await rejection(client.call('turns.start', { threadId, prompt: 'Read this', attachments: [image] }))).reason)
    .toMatchObject({ rpc: { message: 'Fake-b / Fake Plain takes no images: send the prompt without them' } });
  expect(await draft()).toBe(false);
  // A goal sent on another account of the same pi starts in the same folder.
  const other = await client.call('accounts.add', { providerId: 'pi-fake', label: 'Other', useDefaultLocation: true });
  await client.call('providers.probe', { providerId: 'pi-fake', accountId: other.id });
  expect(() => harness!.core.activity.set({ threadId, goal: { objective: 'Read this' }, attachments: [image] }, undefined,
    { providerId: 'pi-fake', accountId: other.id, permissionMode: 'default', model: 'default', effort: null })).toThrow('Fake-b / Fake Plain takes no images');
  // The account's trust stays its own.
  rmSync(join(agentDir, 'trust.json'));
  expect(await images()).toBe(true);
});

test('a worktree draft reads pi settings in the worktree its preparation reserved, not the project folder', async () => {
  const client = await startCore();
  const { dataDir, accountId } = await piAccount(client);
  await client.call('providers.probe', { providerId: 'pi-fake', accountId });
  const repo = join(dataDir, 'repo');
  mkdirSync(join(repo, '.pi'), { recursive: true });
  const env = { ...process.env, GIT_AUTHOR_NAME: 'boite test', GIT_AUTHOR_EMAIL: 'test@boite.invalid', GIT_COMMITTER_NAME: 'boite test', GIT_COMMITTER_EMAIL: 'test@boite.invalid' };
  for (const args of [['init', '-q'], ['commit', '-q', '--allow-empty', '-m', 'fixture']]) expect(Bun.spawnSync({ cmd: ['git', ...args], cwd: repo, env }).success).toBe(true);
  // Untracked, so the project folder starts pi on a text-only model and a new worktree of it on the account's.
  const textOnly = JSON.stringify({ defaultProvider: 'fake-b', defaultModel: 'plain' });
  writeFileSync(join(repo, '.pi', 'settings.json'), textOnly);
  const agentDir = join(dataDir, 'pi-agent');
  process.env['PI_CODING_AGENT_DIR'] = agentDir;
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(join(agentDir, 'trust.json'), JSON.stringify({ [realpathSync(repo)]: true }));
  const project = await client.call('projects.add', { path: repo, name: 'repo' });
  const choice = { projectId: project.id, providerId: 'pi-fake', accountId };
  const images = async (worktree?: boolean) => (await client.call('drafts.images', { ...choice, model: null, ...(worktree ? { worktree } : {}) })).supported;
  expect(await images()).toBe(false);
  // Before the worktree exists only the first turn's admission there can tell.
  expect(await images(true)).toBe(true);
  const { threadId } = await client.call('drafts.prepare', { ...choice, worktree: {}, preparationId: 'draft_pi_worktree' });
  const reserved = harness!.core.drafts.threads().find(thread => thread.id === threadId)!.cwd;
  expect(reserved.startsWith(repo)).toBe(true);
  expect(existsSync(join(reserved, '.pi', 'settings.json'))).toBe(false);
  expect(await images(true)).toBe(true);
  mkdirSync(join(reserved, '.pi'), { recursive: true });
  writeFileSync(join(reserved, '.pi', 'settings.json'), textOnly);
  expect(await images(true)).toBe(false);
  await client.call('drafts.release', { preparationId: 'draft_pi_worktree' });
  expect(await images(true)).toBe(true);
});

test('a draft of the drafts reads pi settings in the folder its preparation made, ordinary or incognito, not the drafts root', async () => {
  const client = await startCore();
  const { dataDir, accountId } = await piAccount(client);
  await client.call('providers.probe', { providerId: 'pi-fake', accountId });
  const drafts = await client.call('projects.drafts', {});
  // The drafts root's own settings start pi on a text-only model; a new folder under it starts on the account's.
  const textOnly = JSON.stringify({ defaultProvider: 'fake-b', defaultModel: 'plain' });
  mkdirSync(join(drafts.path, '.pi'), { recursive: true });
  writeFileSync(join(drafts.path, '.pi', 'settings.json'), textOnly);
  const agentDir = join(dataDir, 'pi-agent');
  process.env['PI_CODING_AGENT_DIR'] = agentDir;
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(join(agentDir, 'trust.json'), JSON.stringify({ [realpathSync(drafts.path)]: true, [realpathSync(dataDir)]: true }));
  const choice = { projectId: drafts.id, providerId: 'pi-fake', accountId };
  const images = async (incognito?: boolean) => (await client.call('drafts.images', { ...choice, model: null, ...(incognito ? { incognito } : {}) })).supported;
  expect(await images()).toBe(true);
  const { threadId } = await client.call('drafts.prepare', { ...choice, preparationId: 'draft_pi_drafts' });
  const reserved = harness!.core.drafts.threads().find(thread => thread.id === threadId)!.cwd;
  expect(reserved).not.toBe(drafts.path);
  mkdirSync(join(reserved, '.pi'), { recursive: true });
  writeFileSync(join(reserved, '.pi', 'settings.json'), textOnly);
  expect(await images()).toBe(false);
  // An incognito draft starts in a folder of its own, which the ordinary reservation is not.
  expect(await images(true)).toBe(true);
  const private_ = await client.call('drafts.prepare', { ...choice, incognito: true, preparationId: 'draft_pi_incognito' });
  const hidden = harness!.core.drafts.threads().find(thread => thread.id === private_.threadId)!.cwd;
  mkdirSync(join(hidden, '.pi'), { recursive: true });
  writeFileSync(join(hidden, '.pi', 'settings.json'), textOnly);
  expect(await images(true)).toBe(false);
  expect(await images()).toBe(true);
  await client.call('drafts.release', { preparationId: 'draft_pi_incognito' });
  expect(await images(true)).toBe(true);
  // Incognito belongs to the drafts, as on creation.
  const other = await client.call('projects.add', { path: dataDir, name: 'data' });
  expect(await thrown(client.call('drafts.images', { ...choice, projectId: other.id, model: null, incognito: true }))).toThrow('drafts.images.incognito: ');
});

test('pi leaves the start model to pi where the folder\'s extensions or an extension\'s trust decide it, and images wherever an extension loads', () => {
  const root = join(tmpdir(), `pi-folder-extensions-${process.pid}-${Date.now()}`);
  const agentDir = join(root, 'agent'), cwd = join(root, 'project');
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(join(cwd, '.pi', 'extensions'), { recursive: true });
  try {
    const catalog = [{ id: 'fake-b/plain', name: 'Fake-b / Plain' }];
    // No settings of its own and an empty extensions folder: the account's probe saw the same start.
    expect(folderStartModel(agentDir, cwd, catalog, { scope: null, trust: true })).toBe('account');
    // A local extension may register the model the account's settings name, which the probe, run elsewhere, lacked.
    writeFileSync(join(cwd, '.pi', 'extensions', 'vision.ts'), 'export default () => {};');
    expect(folderStartModel(agentDir, cwd, catalog, { scope: null, trust: true })).toBeNull();
    // An untrusted folder loads none of them.
    expect(folderStartModel(agentDir, cwd, catalog, { scope: null, trust: false })).toBe('account');
    // Nor do packages or extensions its settings list leave the start to the probe.
    rmSync(join(cwd, '.pi', 'extensions'), { recursive: true });
    writeFileSync(join(cwd, '.pi', 'settings.json'), JSON.stringify({ packages: ['npm:pi-vision-provider'] }));
    expect(folderStartModel(agentDir, cwd, catalog, { scope: null, trust: true })).toBeNull();
    writeFileSync(join(cwd, '.pi', 'settings.json'), JSON.stringify({ packages: [] }));
    expect(folderStartModel(agentDir, cwd, catalog, { scope: null, trust: true })).toBe('account');
    // An extension the account or the profile loads may trust a folder with settings of its own, whatever
    // `trust.json` says, unless the launch decides.
    writeFileSync(join(cwd, '.pi', 'settings.json'), JSON.stringify({ defaultProvider: 'fake-b', defaultModel: 'plain' }));
    expect(folderStartModel(agentDir, cwd, catalog)).toBe('account');
    expect(folderStartModel(agentDir, cwd, catalog, piLaunchChoices(['-e', './trust.ts']))).toBeNull();
    mkdirSync(join(agentDir, 'extensions'));
    writeFileSync(join(agentDir, 'extensions', 'trust.ts'), 'export default () => {};');
    expect(folderStartModel(agentDir, cwd, catalog)).toBeNull();
    expect(folderStartModel(agentDir, cwd, catalog, { scope: null, trust: false })).toBe('account');
    expect(folderStartModel(agentDir, cwd, catalog, { scope: null, trust: true })).toBe('fake-b/plain');
    // Images: an extension the account or the profile loads may register a pair by the folder it runs in, which the
    // probe ran outside, so only pi tells, even for a folder with nothing of its own.
    const bare = join(root, 'bare');
    mkdirSync(bare);
    expect(folderExtends(agentDir, bare)).toBe(true);
    rmSync(join(agentDir, 'extensions'), { recursive: true });
    expect(folderExtends(agentDir, bare)).toBe(false);
    expect(folderExtends(agentDir, bare, piLaunchChoices(['-e', './vision.ts']))).toBe(true);
    writeFileSync(join(agentDir, 'settings.json'), JSON.stringify({ packages: ['npm:pi-vision-provider'] }));
    expect(folderExtends(agentDir, bare)).toBe(true);
    // `--no-extensions` loads only the `-e` ones: none it would discover, the folder's own included.
    expect(folderExtends(agentDir, bare, piLaunchChoices(['--no-extensions']))).toBe(false);
    expect(folderExtends(agentDir, bare, piLaunchChoices(['-ne', '-e', './vision.ts']))).toBe(true);
    mkdirSync(join(cwd, '.pi', 'extensions'), { recursive: true });
    writeFileSync(join(cwd, '.pi', 'extensions', 'vision.ts'), 'export default () => {};');
    expect(folderExtends(agentDir, cwd, { ...piLaunchChoices(['-ne']), trust: true })).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('pi default reads the folder as the launch decides: its approval flags, its scope and its configuration folder', async () => {
  process.env['PI_FAKE_CURRENT'] = 'plain';
  process.env['PI_FAKE_LITERAL'] = '1';
  const { client, threadId } = await startThread();
  const { accountId, cwd, projectId } = harness!.core.threads.require(threadId);
  // The profile, not the core's own environment, names where this pi keeps its settings.
  process.env['PI_CODING_AGENT_DIR'] = join(harness!.dataDir, 'not-this-pi');
  const agentDir = join(harness!.dataDir, 'profile-pi');
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(join(cwd, '.pi'), { recursive: true });
  writeFileSync(join(agentDir, 'trust.json'), JSON.stringify({ [realpathSync(cwd)]: true }));
  writeFileSync(join(cwd, '.pi', 'settings.json'), JSON.stringify({ defaultProvider: 'fake-a', defaultModel: 'smart' }));
  const descriptorFile = join(harness!.dataDir, 'providers', 'pi-fake.json');
  type Profile = { env?: Record<string, string>; unsetEnv?: string[]; launch: { args: string[] } };
  const original = JSON.parse(readFileSync(descriptorFile, 'utf8')) as { profiles: Record<string, Profile> };
  const launch = async (args: string[], own: (profile: Profile) => void = profile => { profile.env = { ...profile.env, PI_CODING_AGENT_DIR: agentDir }; }) => {
    const descriptor = structuredClone(original);
    for (const profile of Object.values(descriptor.profiles)) {
      own(profile);
      profile.launch.args.push(...args);
    }
    writeFileSync(descriptorFile, JSON.stringify(descriptor));
    expect((await client.call('providers.reload', {})).rejected).toEqual([]);
    await client.call('providers.probe', { providerId: 'pi-fake', accountId, refresh: true });
    return (await client.call('threads.capabilities', { threadId })).images.supported;
  };
  expect(await launch([])).toBe(true);
  // `--no-approve` keeps the folder's settings out whatever `trust.json` says; the last flag wins.
  expect(await launch(['--no-approve'])).toBe(false);
  expect(await launch(['-na', '--approve'])).toBe(true);
  // pi reads a value after an option that takes one as that value, whatever it looks like.
  expect(await launch(['--approve', '--name', '--no-approve'])).toBe(true);
  // The driver starts pi from the core's environment and the profile's variables, `unsetEnv` aside.
  process.env['PI_CODING_AGENT_DIR'] = agentDir;
  expect(await launch([], profile => { profile.unsetEnv = ['PI_CODING_AGENT_DIR']; })).toBe(true);
  process.env['PI_CODING_AGENT_DIR'] = join(harness!.dataDir, 'not-this-pi');
  // A relative folder is another one in each folder pi starts in: the probe's model says nothing of this one.
  const relative = (profile: Profile) => { profile.env = { ...profile.env, PI_CODING_AGENT_DIR: 'relative-pi' }; };
  expect(await launch([], relative)).toBe(true);
  // Nor does its catalog, even for a model the folder names.
  mkdirSync(join(cwd, 'relative-pi'));
  writeFileSync(join(cwd, 'relative-pi', 'trust.json'), JSON.stringify({ [realpathSync(cwd)]: true }));
  writeFileSync(join(cwd, '.pi', 'settings.json'), JSON.stringify({ defaultProvider: 'fake-b', defaultModel: 'plain' }));
  expect(await launch([], relative)).toBe(true);
  rmSync(join(cwd, 'relative-pi'), { recursive: true });
  writeFileSync(join(cwd, '.pi', 'settings.json'), JSON.stringify({ defaultProvider: 'fake-a', defaultModel: 'smart' }));
  // A `--models` with no pattern left (descriptors refuse an empty argument) clears the saved scope rather than falling back to it.
  writeFileSync(join(agentDir, 'settings.json'), JSON.stringify({ enabledModels: ['fake-b/plain'] }));
  expect(await launch(['--models', ' , '])).toBe(true);
  expect(await launch([])).toBe(false);
  rmSync(join(agentDir, 'settings.json'));
  // A literal id that ends like a thinking level is that model, and Boite's `default` entry is none of pi's.
  writeFileSync(join(cwd, '.pi', 'settings.json'), JSON.stringify({ enabledModels: ['fake-a/smart:high'] }));
  expect(await launch([])).toBe(false);
  writeFileSync(join(cwd, '.pi', 'settings.json'), JSON.stringify({ enabledModels: ['default'] }));
  expect(await launch([])).toBe(true);
  // A bare id is matched whole too, and a whole text that also matches part of another id is pi's pick.
  writeFileSync(join(cwd, '.pi', 'settings.json'), JSON.stringify({ enabledModels: ['SMART:high'] }));
  expect(await launch([])).toBe(false);
  writeFileSync(join(cwd, '.pi', 'settings.json'), JSON.stringify({ enabledModels: ['fake-b/plain:low'] }));
  expect(await launch([])).toBe(true);
  // The longest provider a pattern starts with names it, as in pi: `base` on `fake-a/team`, not `team/base` on `fake-a`.
  writeFileSync(join(cwd, '.pi', 'settings.json'), JSON.stringify({ enabledModels: ['fake-a/team/base'] }));
  expect(await launch([])).toBe(false);
  // A bare `team/base` is the dropped `fake-a` pair's id as much as `fake-b`'s: pi picks, and answers for images.
  process.env['PI_FAKE_SHADOW'] = '1';
  writeFileSync(join(cwd, '.pi', 'settings.json'), JSON.stringify({ enabledModels: ['team/base'] }));
  expect(await launch([])).toBe(true);
  delete process.env['PI_FAKE_SHADOW'];
  // Nor does the catalog hold that dropped pair's name, which pi may match in part before it drops a `:suffix`:
  // `vision:high` is `other/vision` only if no name holds that text.
  const named = [{ id: 'gateway/team/base', name: 'Gateway/team / Base' }, { id: 'other/vision', name: 'Other / Vision' }];
  writeFileSync(join(cwd, '.pi', 'settings.json'), JSON.stringify({ enabledModels: ['vision:high'] }));
  expect(folderStartModel(agentDir, cwd, named, { scope: null, trust: true })).toBeNull();
  expect(folderStartModel(agentDir, cwd, named.slice(1), { scope: null, trust: true })).toBe('other/vision');
  // A protected run starts pi on settings of its own, so pi decides there.
  writeFileSync(join(cwd, '.pi', 'settings.json'), JSON.stringify({ defaultProvider: 'fake-b', defaultModel: 'plain' }));
  expect(await launch([])).toBe(false);
  const bound = spyOn(harness!.core.sharedAccess, 'bound').mockImplementation(id => id === threadId ? {} as ReturnType<SharedAccess['bound']> : null);
  expect((await client.call('threads.capabilities', { threadId })).images.supported).toBe(true);
  bound.mockRestore();
  // A draft names an account of the provider it drafts on.
  writeFileSync(join(harness!.dataDir, 'providers', 'pi-other.json'), JSON.stringify({ ...original, id: 'pi-other', name: 'Other pi', shortName: 'PiOther' }));
  expect((await client.call('providers.reload', {})).rejected).toEqual([]);
  const other = await client.call('accounts.add', { providerId: 'pi-other', label: 'Other', useDefaultLocation: true });
  expect((await rejection(client.call('drafts.images', { projectId: projectId!, providerId: 'pi-fake', accountId: other.id, model: null }))).reason)
    .toMatchObject({ rpc: { message: `drafts.images.accountId: ${other.id} is an account of pi-other, not pi-fake` } });
});

test('pi default follows the model a resumed session restores, not the one pi starts on', async () => {
  const { client, threadId } = await startThread(undefined, 'fake-b/plain');
  expect((await (await startTurn(client, threadId, 'Remember this')).finished).status).toBe('done');
  await client.call('providers.probe', { providerId: 'pi-fake', accountId: harness!.core.threads.require(threadId).accountId });
  const image: ImageAttachment = { kind: 'image', name: 'sample.png', mimeType: 'image/png', data: 'aGVsbG8=' };
  // pi starts new sessions on Fake Smart, which reads images; this one resumes on Fake Plain.
  for (const model of ['default', null]) {
    await client.call('threads.update', { threadId, model });
    expect((await rejection(client.call('turns.start', { threadId, prompt: 'Read this', attachments: [image] }))).reason)
      .toMatchObject({ rpc: { message: 'Fake-b / Fake Plain takes no images: send the prompt without them' } });
    expect((await client.call('threads.capabilities', { threadId })).images).toMatchObject({ available: false, reason: 'unsupported' });
  }
  // A protected run starts a new session of its own, whatever this one was on.
  const bound = spyOn(harness!.core.sharedAccess, 'bound').mockImplementation(id => id === threadId ? {} as ReturnType<SharedAccess['bound']> : null);
  expect((await client.call('threads.capabilities', { threadId })).images).toMatchObject({ supported: true });
  bound.mockRestore();
  // A trusted folder's own extension may register Fake Plain again with images: only pi knows the pair it resumes.
  const { cwd } = harness!.core.threads.require(threadId);
  const agentDir = join(harness!.dataDir, 'pi-agent');
  process.env['PI_CODING_AGENT_DIR'] = agentDir;
  mkdirSync(join(cwd, '.pi', 'extensions'), { recursive: true });
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(join(cwd, '.pi', 'extensions', 'vision.ts'), 'export default () => {};');
  const resumes = async () => (await client.call('threads.capabilities', { threadId })).images.supported;
  expect(await resumes()).toBe(false);
  writeFileSync(join(agentDir, 'trust.json'), JSON.stringify({ [realpathSync(cwd)]: true }));
  expect(await resumes()).toBe(true);
  // So may it register a named model the catalog lists text-only.
  const { projectId, accountId } = harness!.core.threads.require(threadId);
  const draft = async () => (await client.call('drafts.images', { projectId: projectId!, providerId: 'pi-fake', accountId, model: 'fake-b/plain' })).supported;
  await client.call('threads.update', { threadId, model: 'fake-b/plain' });
  expect([await resumes(), await draft()]).toEqual([true, true]);
  rmSync(join(cwd, '.pi', 'extensions', 'vision.ts'));
  expect([await resumes(), await draft()]).toEqual([false, false]);
  writeFileSync(join(cwd, '.pi', 'extensions', 'vision.ts'), 'export default () => {};');
  await client.call('threads.update', { threadId, model: null });
  // An extension of the account's own may trust the folder before pi reads `trust.json`.
  writeFileSync(join(agentDir, 'trust.json'), JSON.stringify({ [realpathSync(cwd)]: false }));
  expect(await resumes()).toBe(false);
  mkdirSync(join(agentDir, 'extensions'));
  writeFileSync(join(agentDir, 'extensions', 'trust.ts'), 'export default () => {};');
  expect(await resumes()).toBe(true);
  rmSync(join(cwd, '.pi'), { recursive: true });
  rmSync(agentDir, { recursive: true });
  delete process.env['PI_CODING_AGENT_DIR'];
  // A relative configuration folder: the catalog the probe read elsewhere says nothing of the model this folder resumes.
  const descriptorFile = join(harness!.dataDir, 'providers', 'pi-fake.json');
  const descriptor = readFileSync(descriptorFile, 'utf8');
  const relative = JSON.parse(descriptor) as { profiles: Record<string, { env?: Record<string, string> }> };
  for (const profile of Object.values(relative.profiles)) profile.env = { ...profile.env, PI_CODING_AGENT_DIR: 'relative-pi' };
  writeFileSync(descriptorFile, JSON.stringify(relative));
  expect((await client.call('providers.reload', {})).rejected).toEqual([]);
  const elsewhere = (await client.call('providers.probe', { providerId: 'pi-fake', accountId: harness!.core.threads.require(threadId).accountId, refresh: true })).models;
  expect(elsewhere.find(model => model.id === 'fake-b/plain')).toMatchObject({ id: 'fake-b/plain' });
  expect((await client.call('threads.capabilities', { threadId })).images).toMatchObject({ supported: true });
  // Nor of a named model's images: this folder's own `models.json` may give it some, so the catalog marks none text-only.
  expect(elsewhere.filter(model => model.images === false)).toEqual([]);
  await client.call('threads.update', { threadId, model: 'fake-b/plain' });
  expect((await client.call('threads.capabilities', { threadId })).images).toMatchObject({ supported: true });
  await client.call('threads.update', { threadId, model: null });
  writeFileSync(descriptorFile, descriptor);
  expect((await client.call('providers.reload', {})).rejected).toEqual([]);
  // A model gone from the catalog resumes on pi's saved default, which only pi reads, even where pi starts on a text-only one.
  process.env['PI_FAKE_CURRENT'] = 'plain';
  process.env['PI_FAKE_LITERAL'] = '1';
  await client.call('providers.probe', { providerId: 'pi-fake', accountId: harness!.core.threads.require(threadId).accountId, refresh: true });
  const file = piSessionFile(threadId);
  const session = readFileSync(file, 'utf8');
  writeFileSync(file, session.replaceAll('"plain"', '"gone"'));
  expect((await client.call('threads.capabilities', { threadId })).images).toMatchObject({ supported: true });
  // pi restores the session's own pair: `fake-a` + `team/base` reads images, while the catalog's `fake-a/team/base` is
  // the text-only `fake-a/team` + `base`.
  expect(session).toContain('"provider":"fake-b"');
  writeFileSync(file, session.replaceAll('"fake-b"', '"fake-a"').replaceAll('"plain"', '"team/base"'));
  expect((await client.call('threads.capabilities', { threadId })).images).toMatchObject({ supported: true });
  writeFileSync(file, session);
  delete process.env['PI_FAKE_CURRENT'];
  delete process.env['PI_FAKE_LITERAL'];
  await client.call('providers.probe', { providerId: 'pi-fake', accountId: harness!.core.threads.require(threadId).accountId, refresh: true });
  // A copy of the session under another name: pi opens one of them and still restores Fake Plain.
  writeFileSync(join(file, '..', `2020-01-01T00-00-00-000Z_${harness!.core.threads.require(threadId).sessionId}.jsonl`), readFileSync(file, 'utf8'));
  expect((await client.call('threads.capabilities', { threadId })).images).toMatchObject({ supported: false });
  // pi skips a session whose header names another folder.
  for (const name of readdirSync(join(file, '..'))) {
    const path = join(file, '..', name);
    const [header, ...rest] = readFileSync(path, 'utf8').split('\n');
    writeFileSync(path, [JSON.stringify({ ...JSON.parse(header!) as object, cwd: join(harness!.dataDir, 'elsewhere') }), ...rest].join('\n'));
  }
  expect((await client.call('threads.capabilities', { threadId })).images).toMatchObject({ supported: true });
});

test('pi in a folder reached through a link reads the session pi resumes and forks into one pi reopens', async () => {
  const client = await startCore();
  const { accountId } = await piAccount(client);
  const real = join(harness!.dataDir, 'real-project');
  const linked = join(harness!.dataDir, 'linked-project');
  mkdirSync(real);
  symlinkSync(real, linked, process.platform === 'win32' ? 'junction' : 'dir');
  const project = await client.call('projects.add', { path: linked, name: 'linked' });
  const { id: threadId } = await client.call('threads.create', { projectId: project.id, providerId: 'pi-fake', accountId, model: 'fake-b/plain' });
  await client.call('threads.subscribe', { threadId });
  expect((await (await startTurn(client, threadId, 'Remember this')).finished).status).toBe('done');
  expect(harness!.core.threads.require(threadId).cwd).toBe(linked);
  // pi writes and matches the folder as its process sees it.
  const seen = process.platform === 'win32' ? linked : realpathSync(linked);
  const headerCwd = (id: string) => (JSON.parse(readFileSync(piSessionFile(id), 'utf8').split('\n', 1)[0]!) as { cwd: string }).cwd;
  expect(headerCwd(threadId)).toBe(seen);
  await client.call('providers.probe', { providerId: 'pi-fake', accountId });
  await client.call('threads.update', { threadId, model: 'default' });
  expect((await client.call('threads.capabilities', { threadId })).images).toMatchObject({ supported: false });
  const reply = (await client.call('threads.get', { threadId })).messages.at(-1)!;
  const fork = await client.call('threads.fork', { threadId, messageId: reply.id });
  expect(headerCwd(fork.id)).toBe(seen);
});

test('pi default on a session holds a registered router over the models it answered through, and yields to a profile --model', async () => {
  process.env['PI_FAKE_VIRTUAL'] = '1';
  const { client, threadId } = await startThread(undefined, 'fake-b/plain');
  expect((await (await startTurn(client, threadId, 'Remember this')).finished).status).toBe('done');
  const accountId = harness!.core.threads.require(threadId).accountId;
  await client.call('providers.probe', { providerId: 'pi-fake', accountId });
  await client.call('threads.update', { threadId, model: 'default' });
  const images = async () => (await client.call('threads.capabilities', { threadId })).images.supported;
  // As pi writes a routed turn: the router's model_change, then an answer that names the physical model.
  const file = piSessionFile(threadId);
  const leaf = (JSON.parse(readFileSync(file, 'utf8').trim().split('\n').at(-1)!) as { id: string }).id;
  const routed = (router: string, id: string, parentId: string) => [
    { type: 'model_change', id: `${id}c`, parentId, timestamp: '2026-11-26T00:00:00.000Z', provider: 'fake-a', modelId: router },
    { type: 'message', id: `${id}a`, parentId: `${id}c`, timestamp: '2026-11-26T00:00:01.000Z', message: { role: 'assistant', api: 'fake', provider: 'fake-b', model: 'plain', content: [] } },
  ].map(entry => JSON.stringify(entry) + '\n').join('');
  writeFileSync(file, readFileSync(file, 'utf8') + routed('router', 'r', leaf));
  expect(await images()).toBe(true);
  // A physical model_change does not hold: pi resumes on the model that answered.
  writeFileSync(file, readFileSync(file, 'utf8') + routed('smart', 's', 'ra'));
  expect(await images()).toBe(false);
  // A router the catalog does not hold may be one this folder's own extension registers: pi alone can tell.
  writeFileSync(file, readFileSync(file, 'utf8') + routed('project-router', 'p', 'sa'));
  expect(await images()).toBe(true);
  const descriptorFile = join(harness!.dataDir, 'providers', 'pi-fake.json');
  const descriptor = JSON.parse(readFileSync(descriptorFile, 'utf8')) as { profiles: Record<string, { launch: { args: string[] } }> };
  for (const profile of Object.values(descriptor.profiles)) profile.launch.args.push('--model', 'fake-a/smart');
  writeFileSync(descriptorFile, JSON.stringify(descriptor));
  expect((await client.call('providers.reload', {})).rejected).toEqual([]);
  await client.call('providers.probe', { providerId: 'pi-fake', accountId });
  expect(await images()).toBe(true);
});

test('a text-only pi model refuses images on start and steer and still accepts files', async () => {
  const { client, threadId } = await startThread(undefined, 'fake-b/plain');
  const prompt = '[slow] Read this';
  const image: ImageAttachment = { kind: 'image', name: 'sample.png', mimeType: 'image/png', data: 'aGVsbG8=' };
  const file: FileAttachment = { kind: 'file', name: 'notes.txt', mimeType: 'text/plain', data: 'aGVsbG8=' };
  const refusal = { rpc: { message: 'Fake-b / Fake Plain takes no images: send the prompt without them' } };
  expect((await rejection(client.call('turns.start', { threadId, prompt, attachments: [image] }))).reason).toMatchObject(refusal);
  // A direct client can send after a core restart without opening a picker first.
  forgetProbes({ providerId: 'pi-fake', accountId: harness!.core.threads.require(threadId).accountId });
  expect((await rejection(client.call('turns.start', { threadId, prompt, attachments: [image] }))).reason).toMatchObject(refusal);
  expect((await client.call('threads.capabilities', { threadId })).images).toMatchObject({ available: false, reason: 'unsupported' });
  // A goal started with an image is refused up front, not paused after its first run fails.
  expect((await rejection(client.call('threads.activity.set', { threadId, goal: { objective: 'Read this' }, attachments: [image] }))).reason).toMatchObject(refusal);
  expect(harness!.core.activity.get(threadId).goal ?? null).toBeNull();
  const turn = await client.call('turns.start', { threadId, prompt, attachments: [file] });
  await waitFor(() => fakeLog().includes('waiting for abort'));
  expect(harness!.core.journal.listMessages(threadId).find(message => message.role === 'user')?.parts).toContainEqual({ type: 'file', name: file.name, mimeType: file.mimeType, data: file.data });
  expect((await rejection(client.call('turns.steer', { threadId, turnId: turn.id, prompt: 'Use this', attachments: [image], clientRequestId: 'pi_text_only' }))).reason).toMatchObject(refusal);
  await client.call('turns.stop', { threadId });
});

test('input steered into a turn is checked against the model that turn runs on', async () => {
  process.env['PI_FAKE_LITERAL'] = '1';
  const { client, threadId } = await startThread(undefined, 'fake-a/smart');
  const accountId = harness!.core.threads.require(threadId).accountId;
  // A queued prompt keeps the model it was sent with while the thread shows another.
  const turn = harness!.core.threads.startTurn(threadId, '[slow] Read this', USER_ORIGIN, {
    choice: { providerId: 'pi-fake', accountId, permissionMode: 'yolo', model: 'fake-b/plain', effort: null },
  });
  await waitFor(() => fakeLog().includes('waiting for abort'));
  expect(harness!.core.journal.getTurn(turn.id)?.execution?.model).toBe('fake-b/plain');
  expect(harness!.core.threads.require(threadId).model).toBe('fake-a/smart');
  const image: ImageAttachment = { kind: 'image', name: 'sample.png', mimeType: 'image/png', data: 'aGVsbG8=' };
  expect((await rejection(client.call('turns.steer', { threadId, turnId: turn.id, prompt: 'Use this', attachments: [image], clientRequestId: 'pi_steer_queued' }))).reason)
    .toMatchObject({ rpc: { message: 'Fake-b / Fake Plain takes no images: send the prompt without them' } });
  const stopped = client.next('turn.finished', finished => finished.id === turn.id, 20_000);
  await client.call('turns.stop', { threadId });
  await stopped;
  // A refresh during a turn can name another pair for the text it runs. Its pi keeps the text-only `base` on
  // `fake-a/team` it started on, whatever the list now names: `team/base` on `fake-a`, which reads images.
  await client.call('threads.update', { threadId, model: 'fake-a/team/base' });
  const second = await client.call('turns.start', { threadId, prompt: '[slow] Read this' });
  await waitFor(() => fakeLog().split('waiting for abort').length > 2);
  process.env['PI_FAKE_NO_TEAM'] = '1';
  await client.call('providers.probe', { providerId: 'pi-fake', accountId, refresh: true });
  expect((await rejection(client.call('turns.steer', { threadId, turnId: second.id, prompt: 'Use this', attachments: [image], clientRequestId: 'pi_steer_refreshed' }))).reason)
    .toMatchObject({ rpc: { message: expect.stringContaining('Fake Base takes no images') } });
  await client.call('turns.stop', { threadId });
});

let harness: TestCore | null = null;
let logFile = '';

afterEach(async () => {
  const open = harness;
  harness = null;
  delete process.env['PI_FAKE_LOG'];
  delete process.env['PI_FAKE_CURRENT'];
  delete process.env['PI_CODING_AGENT_DIR'];
  delete process.env['PI_FAKE_VIRTUAL'];
  delete process.env['PI_FAKE_LITERAL'];
  delete process.env['PI_FAKE_SHADOW'];
  delete process.env['PI_FAKE_NO_TEAM'];
  delete process.env['PI_FAKE_PLAIN_IMAGES'];
  delete process.env['PI_FAKE_SLOW_EXIT'];
  delete process.env['PI_FAKE_SLOW_STATE'];
  delete process.env['PI_FAKE_SILENT'];
  delete process.env['PI_FAKE_END_ON_STATE'];
  if (open !== null) await open.stop();
});

async function startCore(settings?: Partial<Settings>): Promise<CoreClient> {
  const started = await startTestCore(settings === undefined ? {} : { settings });
  harness = started;
  logFile = join(started.dataDir, 'pi-fake.log');
  // `spawnChild` gets `process.env` plus the account environment, so this is
  // what reaches the fake agent.
  process.env['PI_FAKE_LOG'] = logFile;
  return started.connect();
}

/** Ends the running core so the next `startCore` gets a fresh data directory and log. */
async function stopCore(): Promise<void> {
  const open = harness;
  harness = null;
  if (open !== null) await open.stop();
}

function fakeLog(): string {
  return readScriptedLog(logFile);
}

/** Every `argv ...` line the fake wrote, one per agent process it started. */
function argvLines(): string[] {
  return fakeLog()
    .split('\n')
    .filter((line) => line.startsWith('argv '));
}

/** The `BOITE_COMPACTION` each agent process the fake started was given, in launch order. */
function compactionLines(): { tokens: number; background: boolean; ratios: Record<string, number> }[] {
  return fakeLog().split('\n').filter((line) => line.startsWith('compaction ')).map((line) => JSON.parse(line.slice('compaction '.length)));
}

/** How many times the fake was sent one command, so a cached probe is provable. */
function countLines(line: string): number {
  return countLogLines(fakeLog(), line);
}

/**
 * Waits for something without failing on the wait, so the assertion that
 * follows is what names whatever did not happen.
 */
async function settle(predicate: () => boolean): Promise<void> {
  try {
    await waitFor(predicate, 3000);
  } catch {
    // the expectation after this call reports what is missing
  }
}

/**
 * A second fake pi, as small as the one thing it proves: it raises an extension
 * dialog once the run has settled, which is a dialog reaching the client with
 * no prompt in flight. The shared fixture only ever asks inside a run.
 */
function writeLateDialogAgent(dataDir: string): string {
  const path = join(dataDir, 'pi-late-dialog.mjs');
  writeFileSync(
    path,
    [
      "import { appendFileSync, existsSync } from 'node:fs';",
      "const LOG = process.env.PI_FAKE_LOG ?? '';",
      `const READY = ${JSON.stringify(join(dataDir, 'pi-late-dialog-ready'))};`,
      "function log(line) { if (LOG.length > 0) appendFileSync(LOG, line + '\\n', 'utf8'); }",
      "function send(payload) { process.stdout.write(JSON.stringify(payload) + '\\n'); }",
      'const ZERO = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,',
      '  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };',
      'function run() {',
      "  send({ type: 'message_update', usage: ZERO,",
      "    assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'done' } });",
      "  send({ type: 'agent_settled' });",
      '  // The test releases this dialog after turn.finished, so context reads',
      '  // cannot leave a closing turn attached when the request arrives.',
      '  const ready = setInterval(() => {',
      '    if (!existsSync(READY)) return;',
      '    clearInterval(ready);',
      "    send({ type: 'extension_ui_request', id: 'late-1', method: 'confirm',",
      "      title: 'Late', message: 'after the run' });",
      '  }, 10);',
      '}',
      'function handle(message) {',
      "  if (message.type === 'extension_ui_response') {",
      "    log('late-answer ' + message.id + ' cancelled=' + (message.cancelled === true));",
      '    return;',
      '  }',
      "  if (message.type === 'prompt') {",
      "    send({ id: message.id, type: 'response', command: 'prompt', success: true });",
      '    setTimeout(run, 0);',
      '    return;',
      '  }',
      "  if (message.type === 'get_state') {",
      "    send({ id: message.id, type: 'response', command: 'get_state', success: true, data: { isStreaming: false } });",
      '    return;',
      '  }',
      "  if (message.type === 'get_commands') {",
      "    send({ id: message.id, type: 'response', command: 'get_commands', success: true, data: { commands: [] } });",
      '    return;',
      '  }',
      "  send({ id: message.id, type: 'response', command: message.type, success: false, error: 'not implemented' });",
      '}',
      "let buffer = '';",
      "process.stdin.setEncoding('utf8');",
      "process.stdin.on('data', (chunk) => {",
      '  buffer += chunk;',
      '  for (;;) {',
      "    const at = buffer.indexOf('\\n');",
      '    if (at < 0) break;',
      '    const line = buffer.slice(0, at).trim();',
      '    buffer = buffer.slice(at + 1);',
      '    if (line.length === 0) continue;',
      '    handle(JSON.parse(line));',
      '  }',
      '});',
      '',
    ].join('\n'),
    'utf8',
  );
  return path;
}

/** A user descriptor for the fake agent: `protocol: "pi"`, launched as `bun <fixture>`. */
function writeDescriptor(dataDir: string, agent: string = FAKE_AGENT): void {
  writeScriptedProvider(dataDir, agent, {
    id: 'pi-fake',
    schemaVersion: 1,
    name: 'Fake pi',
    shortName: 'PiFake',
    protocol: 'pi',
    roots: ['{isolationDir}'],
    auth: { kind: 'none' },
    models: [
      // Like the shipped descriptor: "the agent keeps its own", plus one entry
      // written down, so a thread can pick a model before anything is probed.
      { id: 'default', name: 'pi default', default: true },
      {
        id: 'anthropic/claude-sonnet-5',
        name: 'Fake pi model',
        effort: {
          levels: [
            { id: 'low', label: 'Low' },
            { id: 'high', label: 'High' },
          ],
          default: 'low',
        },
      },
    ],
    capabilities: {
      approvals: false,
      hooks: false,
      checkpoint: true,
      images: true,
      planMode: false,
      resume: true,
    },
  });
}

async function piAccount(
  client: CoreClient,
  agent: string = FAKE_AGENT,
): Promise<{ dataDir: string; projectId: string; accountId: string }> {
  const dataDir = harness?.dataDir ?? '';
  writeDescriptor(dataDir, agent);
  const loaded = await client.call('providers.reload', {});
  expect(loaded.rejected).toEqual([]);
  expect(loaded.loaded.some((provider) => provider.id === 'pi-fake' && provider.available)).toBe(true);

  const project = await client.call('projects.add', { path: dataDir, name: 'pi' });
  const account = await client.call('accounts.add', {
    providerId: 'pi-fake',
    label: 'Fake',
    useDefaultLocation: true,
  });
  return { dataDir, projectId: project.id, accountId: account.id };
}

async function piThread(client: CoreClient, model?: string, effort?: string): Promise<string> {
  const { projectId, accountId } = await piAccount(client);
  const thread = await client.call('threads.create', {
    projectId,
    providerId: 'pi-fake',
    accountId,
    ...(model === undefined ? {} : { model }),
    ...(effort === undefined ? {} : { effort }),
  });
  // Pin the title for tests that measure the lifetime of the conversation process.
  await client.call('threads.update', { threadId: thread.id, title: 'pi thread' });
  await client.call('threads.subscribe', { threadId: thread.id });
  return thread.id;
}

/** A fresh core with one Pi thread on it, the opening of most tests here. */
async function startThread(
  settings?: Partial<Settings>,
  ...thread: [model?: string, effort?: string]
): Promise<{ client: CoreClient; threadId: string }> {
  const client = await startCore(settings);
  return { client, threadId: await piThread(client, ...thread) };
}

test('pi titles a new thread with a tool-free request on its chosen model', async () => {
  const client = await startCore();
  const { projectId, accountId } = await piAccount(client);
  const { id: threadId } = await client.call('threads.create', { projectId, providerId: 'pi-fake', accountId, model: 'anthropic/claude-sonnet-5' });
  expect((await (await startTurn(client, threadId, 'Add a feature')).finished).status).toBe('done');
  await settle(() => harness!.core.threads.require(threadId).titleSource === 'agent');
  expect(await client.call('threads.get', { threadId })).toMatchObject({ title: 'Name the feature', titleSource: 'agent' });
  const invocation = fakeLog().split('\n').find(line => line.startsWith('one-shot [') && line.includes('--no-tools'))!;
  const args = JSON.parse(invocation.slice('one-shot '.length)) as string[];
  expect(args).toEqual(expect.arrayContaining(['--no-session', '--no-tools', '--no-extensions', '--no-mcp', '--no-context-files', '--no-skills', '--no-prompt-templates']));
  expect(args[args.indexOf('--model') + 1]).toBe('anthropic/claude-sonnet-5');
});

test('a pi one-shot on a model an extension registers falls back to pi\'s own model', async () => {
  process.env['PI_FAKE_EXTENSION_PROVIDER'] = 'fake-a';
  try {
    // Warm, so the conversation's process outlives the turn: a cold one is stopped with the thread's whole tree at
    // the turn's end, and a fallback launched just before that would go with it and be asked again.
    const client = await startCore({ warmProcessMinutes: 5 });
    const { projectId, accountId } = await piAccount(client);
    await client.call('providers.probe', { providerId: 'pi-fake', accountId });
    const { id: threadId } = await client.call('threads.create', { projectId, providerId: 'pi-fake', accountId, model: 'fake-a/smart' });
    expect((await (await startTurn(client, threadId, 'Add a feature')).finished).status).toBe('done');
    await settle(() => harness!.core.threads.require(threadId).titleSource === 'agent');
    const shots = fakeLog().split('\n').filter(line => line.startsWith('one-shot [') && line.includes('--no-tools')).map(line => JSON.parse(line.slice('one-shot '.length)) as string[]);
    expect(shots).toHaveLength(2);
    expect(shots[0]![shots[0]!.indexOf('--model') + 1]).toBe('fake-a/smart');
    // The same request without the model, and still without extensions or tools.
    expect(shots[1]).not.toContain('--model');
    expect(shots[1]).toEqual(expect.arrayContaining(['--no-tools', '--no-extensions', '--no-mcp']));
    const shotCount = () => fakeLog().split('\n').filter(line => line.startsWith('one-shot [')).length;
    const btw = async (requestId: string) => {
      const answered = client.next('thread.btw', event => event.requestId === requestId);
      await client.call('threads.btw', { threadId, question: 'What did we add?', requestId });
      return await answered;
    };
    // pi's own model is that provider when the profile pins it: one refusal, no second start.
    const descriptorFile = join(harness!.dataDir, 'providers', 'pi-fake.json');
    const descriptor = readFileSync(descriptorFile, 'utf8');
    const pinned = JSON.parse(descriptor) as { profiles: Record<string, { launch: { args: string[] } }> };
    for (const profile of Object.values(pinned.profiles)) profile.launch.args.push('--provider', 'fake-a');
    writeFileSync(descriptorFile, JSON.stringify(pinned));
    expect((await client.call('providers.reload', {})).rejected).toEqual([]);
    let before = shotCount();
    expect((await btw('side_pinned')).error).toContain('Unknown provider "fake-a"');
    expect(shotCount()).toBe(before + 1);
    writeFileSync(descriptorFile, descriptor);
    expect((await client.call('providers.reload', {})).rejected).toEqual([]);
    // A live pi that refuses the prompt after warning of a custom model id says why itself, with no second start.
    delete process.env['PI_FAKE_EXTENSION_PROVIDER'];
    process.env['PI_FAKE_ONE_SHOT_REFUSAL'] = '1';
    before = shotCount();
    const refused = await btw('side_refused');
    expect(refused.error).toContain('No API key found for fake-a');
    expect(refused.error).not.toContain('custom model id');
    expect(shotCount()).toBe(before + 1);
  } finally {
    delete process.env['PI_FAKE_EXTENSION_PROVIDER'];
    delete process.env['PI_FAKE_ONE_SHOT_REFUSAL'];
  }
});

test('a pi profile with --api-key is refused with its field and what to use instead, its key never echoed', async () => {
  const client = await startCore();
  await piAccount(client);
  const descriptorFile = join(harness!.dataDir, 'providers', 'pi-fake.json');
  const descriptor = JSON.parse(readFileSync(descriptorFile, 'utf8')) as { profiles: Record<string, { launch: { args: string[] } }> };
  for (const profile of Object.values(descriptor.profiles)) profile.launch.args.push('--model', 'fake-a/smart', '--api-key', 'test-key');
  writeFileSync(descriptorFile, JSON.stringify(descriptor));
  const { rejected } = await client.call('providers.reload', {});
  expect(rejected).toHaveLength(1);
  expect(rejected[0]).toMatchObject({ field: expect.stringMatching(/^profiles\.\w+\.launch\.args\[\d+\]$/), expected: expect.stringContaining('ANTHROPIC_API_KEY') });
  expect(JSON.stringify(rejected)).not.toContain('test-key');
});

test('Boite\'s own flags replace the profile\'s model flags; a title pins its provider only by the profile\'s own flags', () => {
  const entry = (provider: string, id: string): ModelInfo => ({ id: `${provider}/${id}`, name: `${provider.slice(0, 1).toUpperCase()}${provider.slice(1)} / ${id}` } as ModelInfo);
  const catalog = [entry('openai', 'chat'), entry('openai', 'quick'), entry('anthropic', 'title'), entry('anthropic', 'openai/remote')];
  // Boite's own flags name the model: the profile's go, or pi would read an unlisted model under its provider.
  expect(piProfileArgs(['--provider', 'openai', '--model', 'openai/chat', '--verbose'], 'anthropic/title')).toEqual(['--verbose']);
  // A launch left to pi keeps the profile whole.
  expect(piProfileArgs(['--model', 'chat'], 'default')).toEqual(['--model', 'chat']);
  // A title falls back to pi's own model unless the profile's last --provider, or a --model as listed, pins its provider.
  expect(piProfilePins(['--provider', 'anthropic', '--provider', 'openai'], 'openai/quick', catalog)).toBe(true);
  expect(piProfilePins(['--model', 'openai/chat', '--model', 'anthropic/title'], 'openai/quick', catalog)).toBe(false);
  expect(piProfilePins(['--model', 'openai/remote'], 'openai/quick', catalog)).toBe(false);
  expect(piProfilePins([], 'openai/quick', catalog)).toBe(false);
});

test('pi answers /btw from a disposable session copy and leaves the source intact', async () => {
  const { client, threadId } = await startThread();
  // Tool flags the profile declares are the conversation's, never the side question's.
  const descriptorFile = join(harness!.dataDir, 'providers', 'pi-fake.json');
  const descriptor = JSON.parse(readFileSync(descriptorFile, 'utf8')) as { profiles: Record<string, { launch: { args: string[] } }> };
  for (const profile of Object.values(descriptor.profiles)) profile.launch.args.push('--tools', 'bash', '-t', 'edit', '--no-tools', '-nt');
  writeFileSync(descriptorFile, JSON.stringify(descriptor));
  expect((await client.call('providers.reload', {})).rejected).toEqual([]);
  expect((await (await startTurn(client, threadId, 'The release color is amber.')).finished).status).toBe('done');
  expect((await client.call('threads.capabilities', { threadId })).btw).toMatchObject({ available: true });
  const source = piSessionFile(threadId);
  const before = readFileSync(source, 'utf8');
  const answered = client.next('thread.btw', event => event.requestId === 'side_pi_01');
  await client.call('threads.btw', { threadId, question: 'What is the release color?', requestId: 'side_pi_01' });
  expect(await answered).toMatchObject({ answer: expect.stringContaining('The release color is amber.'), error: null });
  const invocation = fakeLog().split('\n').find(line => line.startsWith('one-shot [') && line.includes('"--session"'))!;
  const args = JSON.parse(invocation.slice('one-shot '.length)) as string[];
  const copy = args[args.indexOf('--session') + 1]!;
  // The copy's tool calls need tools defined on Anthropic: read-only ones, never none or all.
  expect(args).not.toContain('--no-tools');
  expect(args.filter(arg => ['--tools', '-t', '-nt'].includes(arg))).toEqual(['--tools']);
  expect(args[args.indexOf('--tools') + 1]).toBe('read,grep,find,ls');
  expect(copy).not.toBe(source);
  expect(existsSync(copy)).toBe(false);
  expect(readFileSync(source, 'utf8')).toBe(before);
  expect(fakeLog()).toContain('What is the release color?');
});

function piSessionFile(threadId: string): string {
  const sessionId = harness!.core.threads.require(threadId).sessionId;
  const dir = join(harness!.dataDir, 'pi-sessions', threadId);
  return join(dir, readdirSync(dir).find(name => name.endsWith(`_${sessionId}.jsonl`))!);
}

test('pi forks and rewinds at a finished turn, keeping only its native ancestors', async () => {
  const { client, threadId } = await startThread();
  const first = await (await startTurn(client, threadId, 'Keep the amber release')).finished;
  expect(first.checkpoint).toMatchObject({ sessionId: expect.any(String), entry: expect.any(String) });
  const source = piSessionFile(threadId);
  const firstMessages = await client.call('threads.get', { threadId });
  const reply = firstMessages.messages.at(-1)!;
  const unusedBranch = JSON.stringify({ type: 'message', id: 'unused', parentId: null, message: { role: 'user', content: 'Unrelated branch' } });
  const initial = readFileSync(source, 'utf8');
  const [header, ...entries] = initial.trimEnd().split('\n');
  // A torn line pi skips on resume must not cost the native copy either.
  writeFileSync(source, `${[header, unusedBranch, '{"type":"message","id":"torn', ...entries].join('\n')}\n`);
  expect((await (await startTurn(client, threadId, 'Discard the cyan release')).finished).status).toBe('done');
  const before = readFileSync(source, 'utf8');
  const capability = await client.call('threads.capabilities', { threadId });
  expect(capability.fork.native.available).toBe(true);
  expect(capability.rewind.native.available).toBe(true);

  const fork = await client.call('threads.fork', { threadId, messageId: reply.id });
  expect(fork.sessionId).toMatch(/^[0-9a-f-]{36}$/);
  expect(fork.sessionId).not.toBe(first.checkpoint!.sessionId);
  await client.call('threads.subscribe', { threadId: fork.id });
  expect((await (await startTurn(client, fork.id, '[read-session]')).finished).status).toBe('done');

  const second = (await client.call('threads.get', { threadId })).messages.filter(message => message.role === 'user')[1]!;
  const rewind = await client.call('threads.rewind', { threadId, messageId: second.id });
  expect(rewind.session).toBe('native');
  expect(rewind.thread.sessionId).not.toBe(first.checkpoint!.sessionId);
  expect((await (await startTurn(client, threadId, '[read-session]')).finished).status).toBe('done');
  expect(readFileSync(source, 'utf8')).toBe(before);
  for (const id of [fork.id, threadId]) {
    const message = (await client.call('threads.get', { threadId: id })).messages.at(-1)!;
    expect(message.parts).toEqual([{ type: 'text', text: expect.stringContaining('Native context: ') }]);
    const text = JSON.stringify(message.parts);
    expect(text).toContain('Keep the amber release');
    expect(text).not.toContain('Discard the cyan release');
    expect(text).not.toContain('Unrelated branch');
  }
});

test('pi takes a thinking level while its turn runs', async () => {
  const client = await startCore({ warmProcessMinutes: 5 });
  const { projectId, accountId } = await piAccount(client);
  await client.call('providers.probe', { providerId: 'pi-fake', accountId });
  const created = await client.call('threads.create', { projectId, providerId: 'pi-fake', accountId, title: 'live level', model: 'fake-a/smart', effort: 'low' });
  const threadId = created.id;
  await client.call('threads.subscribe', { threadId });
  const turn = await client.call('turns.start', { threadId, prompt: '[slow] Deploy' });
  await waitFor(() => fakeLog().includes('waiting for abort'));
  await client.call('threads.update', { threadId, effort: 'high' });
  await waitFor(() => harness!.core.journal.getTurn(turn.id)?.execution?.effort === 'high');
  expect(fakeLog().split('\n').filter(line => line === 'level high')).toHaveLength(1);
  expect(harness!.core.journal.getTurn(turn.id)?.status).toBe('running');
  await client.call('turns.stop', { threadId });
  await waitFor(() => harness!.core.journal.getTurn(turn.id)?.status === 'stopped');
});

test('manual compaction uses the compact RPC response without sending a prompt', async () => {
  const { client, threadId } = await startThread();
  let finished = client.next('turn.finished', (turn) => turn.threadId === threadId);
  await client.call('turns.start', { threadId, prompt: 'remember this' });
  await finished;
  finished = client.next('turn.finished', (turn) => turn.threadId === threadId);
  await client.call('threads.compact', { threadId });
  expect((await finished).status).toBe('done');
  const thread = await client.call('threads.get', { threadId });
  expect(thread.messages.flatMap((m) => m.parts).some((p) => p.type === 'compaction' && p.preTokens === 150000)).toBe(true);
  expect(countLines('prompt')).toBe(1);
  expect(countLines('compact')).toBe(1);
  client.close();
});

test('a Compact with nothing to summarize ends as a quiet notice, not a failed turn', async () => {
  const { client, threadId } = await startThread();
  let finished = client.next('turn.finished', (turn) => turn.threadId === threadId);
  await client.call('turns.start', { threadId, prompt: '[small] hi' });
  await finished;
  finished = client.next('turn.finished', (turn) => turn.threadId === threadId);
  await client.call('threads.compact', { threadId });
  expect((await finished).status).toBe('done');
  const parts = (await client.call('threads.get', { threadId })).messages.flatMap((m) => m.parts);
  expect(parts.find((p) => p.type === 'notice')).toMatchObject({ notice: { kind: 'nothing_to_compact' } });
  expect(parts.some((p) => p.type === 'error' || p.type === 'compaction')).toBe(false);
  client.close();
});

test('a second Compact right after one is a quiet notice too', async () => {
  const { client, threadId } = await startThread();
  let finished = client.next('turn.finished', (turn) => turn.threadId === threadId);
  await client.call('turns.start', { threadId, prompt: 'hi' });
  await finished;
  for (const expected of ['compaction', 'notice'] as const) {
    finished = client.next('turn.finished', (turn) => turn.threadId === threadId);
    await client.call('threads.compact', { threadId });
    expect((await finished).status).toBe('done');
    const last = (await client.call('threads.get', { threadId })).messages.at(-1)!;
    expect(last.parts.map((p) => p.type)).toContain(expected);
  }
  const parts = (await client.call('threads.get', { threadId })).messages.flatMap((m) => m.parts);
  expect(parts.find((p) => p.type === 'notice')).toMatchObject({ notice: { kind: 'nothing_to_compact' }, detail: 'Already compacted' });
  client.close();
});

/** The same thread, on a fake pi the test wrote rather than the shared fixture. */
async function threadOnAgent(client: CoreClient, agent: string): Promise<string> {
  const { projectId, accountId } = await piAccount(client, agent);
  const thread = await client.call('threads.create', {
    projectId,
    providerId: 'pi-fake',
    accountId,
  });
  await client.call('threads.update', { threadId: thread.id, title: 'pi thread' });
  await client.call('threads.subscribe', { threadId: thread.id });
  return thread.id;
}

/** Everything the core logged on this connection, as `<level> <message>` lines. */
function collectLogs(client: CoreClient): string[] {
  const lines: string[] = [];
  client.on('core.log', (entry) => {
    lines.push(`${entry.level} ${entry.message}`);
  });
  return lines;
}

describe('pi driver', () => {
  test('getDriver returns the pi driver', () => {
    expect(getDriver('pi').protocol).toBe('pi');
  });

  test('a plain prompt streams back as one text part, and the session id is kept', async () => {
    const { client, threadId } = await startThread();

    const deltas: string[] = [];
    client.on('message.delta', (event) => {
      if (event.threadId === threadId) deltas.push(event.text);
    });

    const prompt = 'the fake pi agent echoes this back';
    const { finished } = await startTurn(client, threadId, prompt, 20000);

    const done = await finished;
    expect(done.error).toBeNull();
    expect(done.status).toBe('done');
    expect(deltas.length).toBeGreaterThan(0);
    expect(deltas.join('')).toBe(prompt);

    const thread = await client.call('threads.get', { threadId });
    // The driver minted a uuid and launched pi on it; it is the thread's session.
    expect(thread.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(thread.messages[1]?.parts).toEqual([{ type: 'text', text: prompt }]);
    expect(fakeLog()).toContain('prompt\n');
    expect(argvLines()).toHaveLength(1);
    expect(argvLines()[0]).toContain(`sessionId=${thread.sessionId ?? ''}`);
  });

  test('get_commands lists the agent commands once the process is up', async () => {
    const { client, threadId } = await startThread();

    const { finished } = await startTurn(client, threadId, 'hello', 20000);
    expect((await finished).status).toBe('done');

    const thread = await client.call('threads.get', { threadId });
    expect(thread.commands).toEqual([
      { name: 'fake-report', description: 'Write a status report', hint: null },
      { name: 'skill:fake-search', description: 'Search fake docs', hint: null },
    ]);
    expect(fakeLog()).toContain('get_commands\n');
  });

  test('an image attachment rides the prompt command as an images entry', async () => {
    const { client, threadId } = await startThread();

    const PNG =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const finished = client.next('turn.finished', (turn) => turn.threadId === threadId, 20000);
    await client.call('turns.start', {
      threadId,
      prompt: 'what is this',
      attachments: [{ kind: 'image', mimeType: 'image/png', data: PNG, name: 'pixel.png' }],
    });
    const done = await finished;
    expect(done.error).toBeNull();
    expect(done.status).toBe('done');

    // The fake logs the mimeType and the length of the string it got, which
    // proves pi received the base64 data itself, not a reference to it.
    expect(fakeLog()).toContain(`image image/png ${PNG.length}`);
  });

  test('the session directory is the thread s own, under the account s location', async () => {
    const { client, threadId } = await startThread();
    await runTurn(client, threadId, 'first');

    // The account is on the provider's own location, so the transcript lives
    // under the core's data directory and never in the user's real `~/.pi`.
    const expected = join(harness?.dataDir ?? '', 'pi-sessions', threadId);
    expect(argvLines()[0]).toContain(`sessionDir=${expected}`);
    expect(existsSync(expected)).toBe(true);
  });

  test('the model and the effort ride on the command line, as pi takes them', async () => {
    process.env['PI_FAKE_LITERAL'] = '1';
    const { client, threadId } = await startThread(undefined, 'anthropic/claude-sonnet-5', 'high');
    await runTurn(client, threadId, 'first');
    // A model no probe listed goes as its text; the level as `--thinking`, never a `:high` tail pi may read as an id.
    expect(argvLines()[0]).toContain('model=anthropic/claude-sonnet-5 provider= thinking=high');
    // A listed model goes as its exact pair: `fake-a/smart` with `high` is not the text-only `fake-a` + `smart:high`,
    // and `fake-a/team/base` is `base` on `fake-a/team`, the pair the catalog keeps.
    const { accountId } = harness!.core.threads.require(threadId);
    await client.call('providers.probe', { providerId: 'pi-fake', accountId, refresh: true });
    for (const [model, line] of [['fake-a/smart', 'model=fake-a/smart provider=fake-a thinking=high'], ['fake-a/team/base', 'model=fake-a/team/base provider=fake-a/team thinking=high']] as const) {
      const id = await piThread(client, model, 'high');
      await runTurn(client, id, 'first');
      expect(argvLines().find(entry => entry.startsWith(`argv sessionId=${harness!.core.threads.require(id).sessionId} `))).toContain(line);
    }
    // A thread made before a restart runs before the next probe on the list saved before, as image admission does.
    const { projectId } = harness!.core.threads.require(threadId);
    const onAccount = async (model: string, restart = false): Promise<string> => {
      const { id } = await client.call('threads.create', { projectId: projectId!, providerId: 'pi-fake', accountId, model, effort: 'high' });
      await client.call('threads.update', { threadId: id, title: 'pi thread' });
      await client.call('threads.subscribe', { threadId: id });
      if (restart) forgetProbes({ providerId: 'pi-fake', accountId });
      if (restart) expect(probedModelsOf('pi', 'pi-fake', accountId)).toBeNull();
      await runTurn(client, id, 'first');
      return argvLines().find(entry => entry.startsWith(`argv sessionId=${harness!.core.threads.require(id).sessionId} `)) ?? '';
    };
    expect(await onAccount('fake-a/team/base', true)).toContain('model=fake-a/team/base provider=fake-a/team thinking=high');
    // That list holds for the configuration folder pi read it in: another one, which the core's own environment may
    // name after a restart, sets it aside until a probe reads that folder.
    expect(readSavedCatalog(harness!.core, 'pi-fake', accountId)).not.toBeNull();
    process.env['PI_CODING_AGENT_DIR'] = join(harness!.dataDir, 'another-pi');
    expect(readSavedCatalog(harness!.core, 'pi-fake', accountId)).toBeNull();
    delete process.env['PI_CODING_AGENT_DIR'];
    // A relative configuration folder: the probe read another folder's providers, so the model goes as its text.
    const descriptorFile = join(harness!.dataDir, 'providers', 'pi-fake.json');
    const descriptor = JSON.parse(readFileSync(descriptorFile, 'utf8')) as { profiles: Record<string, { env?: Record<string, string> }> };
    for (const profile of Object.values(descriptor.profiles)) profile.env = { ...profile.env, PI_CODING_AGENT_DIR: 'relative-pi' };
    writeFileSync(descriptorFile, JSON.stringify(descriptor));
    expect((await client.call('providers.reload', {})).rejected).toEqual([]);
    await client.call('providers.probe', { providerId: 'pi-fake', accountId, refresh: true });
    // On the probed account itself: `piThread` would rewrite the descriptor and add an unprobed account.
    expect(await onAccount('fake-a/smart')).toContain('model=fake-a/smart provider= thinking=high');
  });

  test('a conversation that must run no tool starts pi with none, and no extension, context file, skill or template', async () => {
    const client = await startCore();
    const parent = harness!.core.threads.require(await piThread(client));
    // An ordinary thread keeps them.
    await runTurn(client, parent.id, 'first');
    const plain = (await client.call('trace.get', { threadId: parent.id })).find(process => process.commandLine?.includes('--session-id'));
    expect(plain?.commandLine).not.toContain('--no-tools');
    const child = harness!.core.delegation.createChild(parent, { id: 'memory', name: 'Memory', providerId: 'pi-fake', accountId: parent.accountId, model: parent.model, effort: null },
      'Memory', () => {}, undefined, false, { contextMode: TOOL_FREE_CONTEXT, permissionMode: 'plan' });
    await client.call('threads.subscribe', { threadId: child });
    await runTurn(client, child, 'Rewrite the memory');
    const launched = (await client.call('trace.get', { threadId: child })).find(process => process.commandLine?.includes('--session-id'));
    for (const flag of ['--no-tools', '--no-extensions', '--no-context-files', '--no-skills', '--no-prompt-templates']) expect(launched?.commandLine).toContain(flag);
  });

  test('a thinking delta becomes a thinking part ahead of the answer', async () => {
    const { client, threadId } = await startThread();

    const { finished } = await startTurn(client, threadId, '[thought]the answer', 20000);
    expect((await finished).status).toBe('done');

    const thread = await client.call('threads.get', { threadId });
    expect(thread.messages[1]?.parts).toEqual([
      { type: 'thinking', text: 'thinking about it', startedAt: expect.any(Number), finishedAt: expect.any(Number) },
      { type: 'text', text: 'the answer' },
    ]);
  });

  test('a tool execution arrives running, then done with its output', async () => {
    const { client, threadId } = await startThread();

    const parts: MessagePart[] = [];
    client.on('message.part', (event) => {
      if (event.threadId === threadId) parts.push(event.part);
    });

    const { finished } = await startTurn(client, threadId, '[tool]', 20000);
    expect((await finished).status).toBe('done');

    const tools = parts.filter((part) => part.type === 'tool');
    expect(tools).toHaveLength(2);
    expect(tools[0]).toMatchObject({ name: 'bash', status: 'running', output: null });
    expect(tools[0]).toMatchObject({ input: { command: 'echo hello' } });
    expect(tools[1]).toMatchObject({ name: 'bash', status: 'done', output: 'ok' });
  });

  test('the turn usage carries the tokens and the price the agent reported', async () => {
    const { client, threadId } = await startThread();

    const { finished } = await startTurn(client, threadId, '[usage]', 20000);

    const done = await finished;
    expect(done.status).toBe('done');
    expect(done.usage).toEqual({
      inputTokens: 8,
      outputTokens: 4,
      cacheReadTokens: 2,
      cacheWriteTokens: 1,
      buckets: 1,
      costUsdEquivalent: 0.03,
    });
  });

  test('stopping a turn aborts it and the agent process is gone', async () => {
    const { client, threadId } = await startThread();

    const started = client.next('process.started', (record) => record.threadId === threadId, 20000);
    const exited = client.next('process.exited', (record) => record.threadId === threadId, 20000);
    const { finished } = await startTurn(client, threadId, '[slow]', 20000);
    await started;
    await waitFor(() => fakeLog().includes('waiting for abort'));

    expect(await client.call('turns.stop', { threadId })).toEqual({ stopped: true });
    expect((await finished).status).toBe('stopped');
    await exited;

    expect(fakeLog()).toContain('abort\n');
    await waitFor(() => harness?.core.procs.liveCount(threadId) === 0);
    const trace = await client.call('trace.get', { threadId });
    expect(trace).toHaveLength(1);
    expect(trace[0]?.exitedAt).not.toBeNull();
  });

  test('an agent that dies fails the turn with its exit code and stderr, and the next turn works', async () => {
    const { client, threadId } = await startThread();

    const { finished: crashed } = await startTurn(client, threadId, '[crash]', 20000);

    const failure = await crashed;
    expect(failure.status).toBe('error');
    expect(failure.error).toContain('exited with code 3');
    expect(failure.error).toContain('boom');

    const { finished: again } = await startTurn(client, threadId, 'still here', 20000);
    const done = await again;
    expect(done.error).toBeNull();
    expect(done.status).toBe('done');
  });

  test('a stderr line that comes in two chunks is quoted whole when the agent dies', async () => {
    const { client, threadId } = await startThread();
    const { finished: crashed } = await startTurn(client, threadId, '[splitcrash]', 20000);
    const failure = await crashed;
    expect(failure.status).toBe('error');
    expect(failure.error).toContain('half of a line');
  });

  test('an extension dialog draws a question and returns the answer', async () => {
    const { client, threadId } = await startThread();
    const requested = client.next('question.asked', (request) => request.threadId === threadId);

    const { finished } = await startTurn(client, threadId, '[ask]', 20000);
    const request = await requested;
    await client.call('questions.answer', { threadId, questionId: request.id, optionIds: ['yes'] });
    const done = await finished;
    expect(done.status).toBe('done');
    const thread = await client.call('threads.get', { threadId });
    const parts = thread.messages[thread.messages.length - 1]?.parts ?? [];
    const text = parts.find((part) => part.type === 'text');
    expect(text?.type === 'text' ? text.text : '').toBe('dialog answered');
  });

  for (const method of ['select', 'input', 'editor']) {
    test(`the ${method} dialog returns the value pi expects`, async () => {
      const { client, threadId } = await startThread();
      const asked = client.next('question.asked', (request) => request.threadId === threadId);
      const { finished } = await startTurn(client, threadId, `[${method}]`);
      const request = await asked;
      const value = method === 'select' ? 'Second choice' : 'replacement text';
      await client.call('questions.answer', { threadId, questionId: request.id,
        optionIds: method === 'select' ? ['1'] : [], ...(method === 'select' ? {} : { text: value }) });
      expect((await finished).status).toBe('done');
      const thread = await client.call('threads.get', { threadId });
      expect(thread.messages.at(-1)?.parts.some((part) => part.type === 'text' && part.text === value)).toBe(true);
    });
  }

  test('a question on a warm session is filed under the turn that asked it', async () => {
    const { client, threadId } = await startThread({ warmProcessMinutes: 5 });

    const turnIds: string[] = [];
    client.on('turn.started', (turn) => {
      if (turn.threadId === threadId) turnIds.push(turn.id);
    });

    await runTurn(client, threadId, 'first');

    const asked = client.next('question.asked', (request) => request.threadId === threadId, 20000);
    const { finished } = await startTurn(client, threadId, '[ask]', 20000);
    const request = await asked;
    await client.call('questions.answer', { threadId, questionId: request.id, optionIds: ['yes'] });
    expect((await finished).status).toBe('done');

    // One process for the two turns, so the event handler still carries the
    // first turn's context: the question belongs to the second one all the same.
    expect(argvLines()).toHaveLength(1);
    expect(turnIds).toHaveLength(2);
    expect(request.turnId).toBe(turnIds[1] ?? '');
  });

  test('a dialog raised outside a turn is refused on its id, not dropped', async () => {
    const client = await startCore({ warmProcessMinutes: 5 });
    const threadId = await threadOnAgent(client, writeLateDialogAgent(harness?.dataDir ?? ''));
    const logs = collectLogs(client);
    const refusal = client.next('core.log', (entry) => entry.message.includes('confirm dialog late-1 is refused'));

    await runTurn(client, threadId, 'first');
    // Raise the late dialog after final stats and turn cleanup have finished.
    writeFileSync(join(harness!.dataDir, 'pi-late-dialog-ready'), 'ready');

    // The process stays warm, so the extension's dialog lands with no turn to
    // draw a card on. Unanswered, it blocks that extension for the life of the
    // process and the agent waits on an id nobody holds.
    await settle(() => fakeLog().includes('late-answer'));
    // The child can write its answer before the socket delivers the warning.
    await refusal;
    expect(fakeLog()).toContain('late-answer late-1 cancelled=true');
    expect(logs.some((line) => line.includes('confirm') && line.includes('late-1'))).toBe(true);
  });

  test('stopping while a dialog waits cancels it and clears the question', async () => {
    const { client, threadId } = await startThread();
    const asked = client.next('question.asked', (request) => request.threadId === threadId);
    const { finished } = await startTurn(client, threadId, '[ask]');
    await asked;
    await client.call('turns.stop', { threadId });
    expect((await finished).status).toBe('stopped');
    expect(await client.call('questions.list', { threadId })).toEqual([]);
  });

  test('a warm thread keeps one agent process for two turns, a cold one starts a second', async () => {
    const warmClient = await startCore({ warmProcessMinutes: 5 });
    const warmThread = await piThread(warmClient);
    const warm = countProcesses(warmClient, warmThread);
    await runTurn(warmClient, warmThread, 'first');
    expect(warm.started).toHaveLength(1);
    expect(warm.exited).toHaveLength(0);
    await runTurn(warmClient, warmThread, 'second');
    expect(warm.started).toHaveLength(1);
    expect(warm.exited).toHaveLength(0);
    // One process, so one argv line for the two turns.
    expect(argvLines()).toHaveLength(1);
    await stopCore();

    const coldClient = await startCore({ warmProcessMinutes: 0 });
    const coldThread = await piThread(coldClient);
    const cold = countProcesses(coldClient, coldThread);
    await runTurn(coldClient, coldThread, 'first');
    await runTurn(coldClient, coldThread, 'second');
    expect(cold.started).toHaveLength(2);
  });

  test('a dropped session is reopened on the id and the directory the first turn used', async () => {
    const { client, threadId } = await startThread({ warmProcessMinutes: 0 });

    await runTurn(client, threadId, 'first');
    const sessionId = (await client.call('threads.get', { threadId })).sessionId ?? '';
    expect(sessionId).not.toBe('');

    // The process went with the turn, so the second one is a new pi launched on
    // the very same id and directory, which is how pi reopens its transcript.
    await runTurn(client, threadId, 'second');
    const lines = argvLines();
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe(lines[0]);
    expect(lines[0]).toContain(`sessionId=${sessionId}`);
    expect((await client.call('threads.get', { threadId })).sessionId).toBe(sessionId);
  });

  test('a probe lists the models pi offers, each with the levels that model supports', async () => {
    const client = await startCore();
    const { accountId } = await piAccount(client);

    const probed = client.next(
      'providers.probed',
      (event) => event.providerId === 'pi-fake' && event.accountId === accountId,
      20000,
    );
    const result = await client.call('providers.probe', { providerId: 'pi-fake', accountId });

    // The id is what `--model` takes, and the name carries the provider.
    expect(result.models.map((model) => model.id)).toEqual([
      'default',
      'fake-a/smart',
      'fake-a/quick',
      'fake-b/plain',
    ]);
    expect(result.models[0]).toEqual({ id: 'default', name: 'pi default', default: false });
    expect(result.models[1]?.name).toBe('Fake-a / Fake Smart');
    expect(result.models.map((model) => model.images)).toEqual([undefined, undefined, undefined, false]);
    // pi reports one model as current; that is the one the picker opens on.
    expect(result.models.find((model) => model.default === true)?.id).toBe('fake-a/smart');

    // The two opt-in levels are there only for the model that maps them, and the
    // session's own level is the default of the model it is on, and of no other.
    expect(result.models[1]?.effort).toEqual({
      levels: [
        { id: 'off', label: 'Off' },
        { id: 'minimal', label: 'Minimal' },
        { id: 'low', label: 'Low' },
        { id: 'medium', label: 'Medium' },
        { id: 'high', label: 'High' },
        { id: 'xhigh', label: 'Extra high' },
        { id: 'max', label: 'Max' },
      ],
      default: 'medium',
    });
    expect(result.models[2]?.effort?.levels.map((level) => level.id)).toEqual([
      'off',
      'minimal',
      'low',
      'medium',
      'high',
    ]);
    // pi keeps its own level for another model, clamped to it: the core has no default to send.
    expect(result.models[2]?.effort?.default).toBeUndefined();
    // A model without reasoning has `off` and nothing else, which is no choice.
    expect(result.models[3]?.effort).toBeUndefined();
    expect(result.probedAt).toBeGreaterThan(0);

    // A second client learns the same list from the event.
    expect((await probed).models.map((model) => model.id)).toEqual([
      'default',
      'fake-a/smart',
      'fake-a/quick',
      'fake-b/plain',
    ]);

    // The answer is cached, and the agent process is gone: a probe leaves nothing.
    await client.call('providers.probe', { providerId: 'pi-fake', accountId });
    expect(countLines('get_available_models')).toBe(1);
    await waitFor(() => harness?.core.procs.liveCount(`probe:pi-fake:${accountId}`) === 0);
    const trace = await client.call('trace.get', { threadId: `probe:pi-fake:${accountId}` });
    expect(trace.length).toBeGreaterThan(0);
    expect(trace.every((row) => row.exitedAt !== null)).toBe(true);
  });

  test('creating a pi thread discovers its model and launches with its effort', async () => {
    const client = await startCore();
    const { projectId, accountId } = await piAccount(client);

    const thread = await client.call('threads.create', {
      projectId,
      providerId: 'pi-fake',
      accountId,
      title: 'after the probe',
      model: 'fake-a/quick',
      effort: 'high',
    });
    expect(thread.model).toBe('fake-a/quick');
    expect(thread.effort).toBe('high');

    await client.call('threads.subscribe', { threadId: thread.id });
    await runTurn(client, thread.id, 'first');
    const turnProcess = argvLines().find(line => line.startsWith(`argv sessionId=${harness!.core.threads.require(thread.id).sessionId} `));
    expect(turnProcess).toContain('model=fake-a/quick provider=fake-a thinking=high');
  });

  test('a 529 that pi retried by itself ends the turn done, with no error card', async () => {
    const { client, threadId } = await startThread();
    const finished = client.next('turn.finished', (turn) => turn.threadId === threadId, 20000);
    const progress = client.next('thread.updated', thread => thread.id === threadId && thread.progress?.phase === 'retrying');
    await client.call('turns.start', { threadId, prompt: '[retry]' });
    const done = await finished;
    expect((await progress).progress?.detail).toBe('1/3');
    expect(done.status).toBe('done');
    expect(done.error).toBeNull();
    const thread = await client.call('threads.get', { threadId });
    const parts = thread.messages.flatMap((message) => message.parts);
    expect(parts.some((part) => part.type === 'error')).toBe(false);
    expect(parts.some((part) => part.type === 'text' && part.text === 'recovered answer')).toBe(true);
    expect(thread.status).toBe('idle');
  });

  test('a 529 pi gave up on after its retries fails the turn with one error card', async () => {
    const { client, threadId } = await startThread();
    const { finished } = await startTurn(client, threadId, '[giveup]', 20000);
    const done = await finished;
    expect(done.status).toBe('error');
    expect(done.error).toBe('529 overloaded after 3 attempts');
    const thread = await client.call('threads.get', { threadId });
    const errors = thread.messages.flatMap((message) => message.parts).filter((part) => part.type === 'error');
    expect(errors).toEqual([{ type: 'error', message: '529 overloaded after 3 attempts' }]);
  });

  test('an extension command that starts no run ends the turn, takes no steer, and the process stays warm', async () => {
    // Each state answer waits, so a steer can come while Boite reads it.
    process.env['PI_FAKE_SLOW_STATE'] = '400';
    const { client, threadId } = await startThread({ warmProcessMinutes: 5 });
    const { finished } = await startTurn(client, threadId, '/fake-report', 10000);
    const done = await finished;
    expect(done.status).toBe('done');
    expect(fakeLog()).toContain('extension command handled');
    expect(harness?.core.procs.liveCount(threadId)).toBe(1);
    // pi took that prompt without a run: a steer before Boite reads its state would open one of its own.
    const settled = client.next('turn.finished', ended => ended.threadId === threadId, 10_000);
    const started = await client.call('turns.start', { threadId, prompt: '/fake-report again' });
    await waitFor(() => fakeLog().split('extension command handled').length === 3);
    expect(await client.call('turns.steer', { threadId, turnId: started.id, prompt: 'Also this', clientRequestId: 'pi_handled' })).toEqual({ accepted: false });
    expect((await settled).status).toBe('done');
    expect(fakeLog()).not.toContain('steer without a run');
    // A normal turn on the same process still streams to its own agent_settled.
    await runTurn(client, threadId, '[tool] after the command');
    expect(argvLines()).toHaveLength(1);
  });

  test('a stop that pi never answers ends the turn stopped at the deadline, and the process is gone', async () => {
    setPiStopDeadlineForTests(300);
    try {
      const { client, threadId } = await startThread();
      const { finished } = await startTurn(client, threadId, '[deaf]', 10000);
      await waitFor(() => fakeLog().includes('waiting forever'));
      await client.call('turns.stop', { threadId });
      expect((await finished).status).toBe('stopped');
      expect(fakeLog()).toContain('abort ignored');
      await waitFor(() => harness?.core.procs.liveCount(threadId) === 0);
    } finally {
      setPiStopDeadlineForTests(null);
    }
  });

  test('a stop while pi never answers the prompt ends the turn stopped at the deadline', async () => {
    setPiStopDeadlineForTests(300);
    try {
      const { client, threadId } = await startThread();
      const { finished } = await startTurn(client, threadId, '[preflight]', 10000);
      await waitFor(() => fakeLog().includes('preflight never ends'));
      await client.call('turns.stop', { threadId });
      expect((await finished).status).toBe('stopped');
      await waitFor(() => harness?.core.procs.liveCount(threadId) === 0);
      expect((await client.call('threads.get', { threadId })).status).not.toBe('running');
    } finally {
      setPiStopDeadlineForTests(null);
    }
  });

  test.each(['noclear', 'hang-clear'])('Stop closes a steered pi when clear_queue is uncertain (%s)', async condition => {
    const { client, threadId } = await startThread();
    const { finished } = await startTurn(client, threadId, `[slow][${condition}] Deploy`, 2000);
    await waitFor(() => fakeLog().includes('waiting for abort'));
    await waitFor(() => harness!.core.journal.listMessages(threadId).some((m) => m.role === 'assistant'));
    expect(await harness!.core.threads.steer(threadId, 'Boite agent coordination. Wait.')).toBe(true);
    await client.call('turns.stop', { threadId });
    expect((await finished).status).toBe('stopped');
    expect(fakeLog()).toContain('clear_queue\n');
    expect(fakeLog()).not.toMatch(/^abort$/m);
    await waitFor(() => harness?.core.procs.liveCount(threadId) === 0);
  });

  test('a stopped pi turn settles while the context read is still unanswered', async () => {
    const { client, threadId } = await startThread();
    const { finished } = await startTurn(client, threadId, '[hang-stats] Deploy', 2000);
    await waitFor(() => fakeLog().includes('get_session_stats'));
    expect(await client.call('turns.stop', { threadId })).toEqual({ stopped: true });
    expect((await finished).status).toBe('stopped');
    await waitFor(() => harness?.core.procs.liveCount(threadId) === 0);
  });

  test('a notify is drawn in the turn and no fire-and-forget method gets an answer', async () => {
    const { client, threadId } = await startThread();
    const logs = collectLogs(client);
    const { finished } = await startTurn(client, threadId, '[notify]', 20000);
    const done = await finished;
    expect(done.status).toBe('done');
    const thread = await client.call('threads.get', { threadId });
    const parts = thread.messages.flatMap((message) => message.parts);
    expect(parts).toContainEqual({ type: 'text', text: 'pi: heads up' });
    expect(parts).toContainEqual({ type: 'error', message: 'it broke' });
    expect(fakeLog()).not.toContain('ui-response');
    expect(logs.some((line) => line.includes('refused'))).toBe(false);
  });

  test('a dialog pi gave up on after its timeout takes its card away while the turn runs', async () => {
    const { client, threadId } = await startThread();
    const asked = client.next('question.asked', (request) => request.threadId === threadId, 20000);
    const withdrawn = client.next('question.answered', (event) => event.threadId === threadId, 20000);
    const { finished } = await startTurn(client, threadId, '[timeout][slow]', 20000);
    const request = await asked;
    const answered = await withdrawn;
    expect(answered.questionId).toBe(request.id);
    expect(answered.answer).toBeNull();
    await waitFor(() => fakeLog().includes('waiting for abort'));
    expect(await client.call('questions.list', { threadId })).toEqual([]);
    expect((await client.call('threads.get', { threadId })).status).toBe('running');
    expect(fakeLog()).not.toContain('ui-response');
    await client.call('turns.stop', { threadId });
    expect((await finished).status).toBe('stopped');
  });

  test('an automatic compaction draws its divider and the turn reports the context pi counts', async () => {
    const { client, threadId } = await startThread();
    const finished = client.next('turn.finished', (turn) => turn.threadId === threadId, 20000);
    const progress = client.next('thread.updated', thread => thread.id === threadId && thread.progress?.phase === 'compacting');
    await client.call('turns.start', { threadId, prompt: '[compacted] go on' });
    expect((await finished).status).toBe('done');
    expect((await progress).progress?.phase).toBe('compacting');
    const thread = await client.call('threads.get', { threadId });
    const parts = thread.messages.flatMap((message) => message.parts);
    expect(parts).toContainEqual({ type: 'compaction', trigger: 'auto', preTokens: 180000, postTokens: 30000 });
    expect(thread.context?.tokens).toBe(4321);
    expect(thread.context?.window).toBe(200000);
  });

  test('with background compaction on, pi loads Boite\'s extension with the thread\'s setting, and a changed setting restarts it at the next turn', async () => {
    const { client, threadId } = await startThread({ warmProcessMinutes: 5, autoCompact: { tokens: 100000, moments: [] }, backgroundCompaction: true });
    const compactionExtensions = () => fakeLog().split('\n')
      .filter(line => line.startsWith('extension ') && line.endsWith('pi-compaction.mjs'))
      .map(line => line.slice('extension '.length));
    await runTurn(client, threadId, 'first');
    await runTurn(client, threadId, 'second');
    // One process for both turns, launched with the extension and the setting it reads.
    expect(argvLines()).toHaveLength(1);
    const extensions = compactionExtensions();
    expect(extensions).toHaveLength(1);
    expect(readFileSync(extensions[0]!, 'utf8')).toContain("from '@earendil-works/pi-coding-agent'");
    expect(compactionLines()).toEqual([{ tokens: 100000, background: true, ratios: { ...BACKGROUND_COMPACT } }]);

    await client.call('settings.set', { autoCompact: { tokens: 200000, moments: [] } });
    await runTurn(client, threadId, 'third');
    expect(argvLines()).toHaveLength(2);
    expect(compactionLines().map(setting => setting.tokens)).toEqual([100000, 200000]);

    // Off: the next process runs without the compaction extension.
    await client.call('settings.set', { backgroundCompaction: false });
    await runTurn(client, threadId, 'fourth');
    expect(argvLines()).toHaveLength(3);
    expect(compactionLines()).toHaveLength(2);
    expect(compactionExtensions()).toHaveLength(2);
  });

  test('the copy Boite\'s extension hands pi draws a background divider, at a turn end or at pi\'s threshold', async () => {
    const { client, threadId } = await startThread();
    await runTurn(client, threadId, '[swapped] [taken] go on');
    const parts = (await client.call('threads.get', { threadId })).messages.flatMap((message) => message.parts).filter(part => part.type === 'compaction');
    expect(parts).toEqual([
      { type: 'compaction', trigger: 'auto', preTokens: 100000, postTokens: null, background: true },
      { type: 'compaction', trigger: 'auto', preTokens: 170000, postTokens: 40000, background: true },
    ]);
  });

  test('a warm process takes a new effort and a new model over RPC instead of restarting', async () => {
    process.env['PI_FAKE_LITERAL'] = '1';
    const client = await startCore({ warmProcessMinutes: 5 });
    const { projectId, accountId } = await piAccount(client);
    await client.call('providers.probe', { providerId: 'pi-fake', accountId });
    const created = await client.call('threads.create', {
      projectId,
      providerId: 'pi-fake',
      accountId,
      title: 'switching',
      model: 'fake-a/smart',
      effort: 'low',
    });
    const threadId = created.id;
    await client.call('threads.subscribe', { threadId });
    await runTurn(client, threadId, 'first');
    // The title's one-shot pi writes the same log: it ends first, so the warm process's commands read in order.
    await waitFor(() => harness!.core.threads.require(threadId).titleSource === 'agent');
    await client.call('threads.update', { threadId, effort: 'high' });
    await runTurn(client, threadId, 'second');
    await client.call('threads.update', { threadId, model: 'fake-a/quick', effort: 'high' });
    await runTurn(client, threadId, 'third');
    const turnProcesses = argvLines().filter((line) => !line.includes('sessionId= '));
    expect(turnProcesses).toHaveLength(1);
    expect(turnProcesses[0]).toContain('model=fake-a/smart provider=fake-a thinking=low');
    expect(fakeLog()).toContain('level high\n');
    expect(fakeLog()).toContain('model fake-a quick\nset_thinking_level\nlevel high\n');
    // pi's listing names the pair of a text two pairs spell: `base` on `fake-a/team`, as at a cold start.
    await client.call('threads.update', { threadId, model: 'fake-a/team/base', effort: 'high' });
    await runTurn(client, threadId, 'fourth');
    expect(argvLines().filter((line) => !line.includes('sessionId= '))).toHaveLength(1);
    expect(fakeLog()).toContain('model fake-a/team base\n');
    // A refresh that puts another pair behind the same id (`fake-a/team` gone, so `team/base` on `fake-a`) moves the
    // warm process to the pair image admission now checks.
    process.env['PI_FAKE_NO_TEAM'] = '1';
    await client.call('providers.probe', { providerId: 'pi-fake', accountId, refresh: true });
    await runTurn(client, threadId, 'fifth');
    expect(argvLines().filter((line) => !line.includes('sessionId= '))).toHaveLength(1);
    expect(fakeLog()).toContain('model fake-a team/base\n');
  });

  test('a pair pi listed only after the warm process started opens a new process on it, in the same session', async () => {
    process.env['PI_FAKE_LITERAL'] = '1';
    process.env['PI_FAKE_NO_TEAM'] = '1';
    const client = await startCore({ warmProcessMinutes: 5 });
    const { projectId, accountId } = await piAccount(client);
    await client.call('providers.probe', { providerId: 'pi-fake', accountId });
    const { id: threadId } = await client.call('threads.create', { projectId, providerId: 'pi-fake', accountId, title: 'refreshed', model: 'fake-a/team/base', effort: 'high' });
    await client.call('threads.subscribe', { threadId });
    await runTurn(client, threadId, 'first');
    // pi's models gain `base` on `fake-a/team`, which the catalog then keeps for that text: the running pi read its
    // models at start and would refuse it.
    delete process.env['PI_FAKE_NO_TEAM'];
    await client.call('providers.probe', { providerId: 'pi-fake', accountId, refresh: true });
    await runTurn(client, threadId, 'second');
    const launched = argvLines().filter((line) => !line.includes('sessionId= '));
    expect(launched).toHaveLength(2);
    expect(launched[0]).toContain('model=fake-a/team/base provider=fake-a thinking=high');
    expect(launched[1]).toContain('model=fake-a/team/base provider=fake-a/team thinking=high');
    expect(launched[1]!.split(' ')[1]).toBe(launched[0]!.split(' ')[1]!);
    expect(fakeLog()).not.toContain('model fake-a/team base\n');
  });

  test('a reopen waits for the old pi to exit, and a stop meanwhile opens no new one', async () => {
    process.env['PI_FAKE_LITERAL'] = '1';
    process.env['PI_FAKE_NO_TEAM'] = '1';
    process.env['PI_FAKE_SLOW_EXIT'] = '1500';
    const client = await startCore({ warmProcessMinutes: 5 });
    const { projectId, accountId } = await piAccount(client);
    await client.call('providers.probe', { providerId: 'pi-fake', accountId });
    const thread = async (title: string): Promise<string> => {
      const { id } = await client.call('threads.create', { projectId, providerId: 'pi-fake', accountId, title, model: 'fake-a/team/base' });
      await client.call('threads.subscribe', { threadId: id });
      await runTurn(client, id, 'first');
      return id;
    };
    const waited = await thread('waited'), stopped = await thread('stopped');
    delete process.env['PI_FAKE_NO_TEAM'];
    await client.call('providers.probe', { providerId: 'pi-fake', accountId, refresh: true });
    const session = harness!.core.threads.require(waited).sessionId;
    // pi's shutdown hooks may still write the session file: the new process opens it once the old one has exited.
    await runTurn(client, waited, 'second');
    expect(harness!.core.threads.require(waited).sessionId).toBe(session);
    // The whole log in the message when the old process's exit is missing.
    expect(fakeLog()).toContain(`exited ${session}\n`);
    const lines = fakeLog().split('\n');
    expect(lines.indexOf(`exited ${session}`)).toBeLessThan(lines.findLastIndex(line => line.startsWith(`argv sessionId=${session} `)));
    const launched = argvLines().length;
    const { finished } = await startTurn(client, stopped, 'second', 20_000);
    const other = harness!.core.threads.require(stopped).sessionId;
    await waitFor(() => fakeLog().includes(`shutting down ${other}`));
    await client.call('turns.stop', { threadId: stopped });
    // The stop does not wait for the old pi's shutdown: it ends the turn and takes that process down at once.
    expect((await finished).status).toBe('stopped');
    expect(fakeLog()).not.toContain(`exited ${other}`);
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(argvLines()).toHaveLength(launched);
    // A turn that waits for that exit stops at once too, and its session, closed before it launched pi, still holds
    // the next one behind the old pi's exit.
    const waiting = await startTurn(client, stopped, 'third', 20_000);
    await new Promise(resolve => setTimeout(resolve, 150));
    const stoppedAt = Date.now();
    await client.call('turns.stop', { threadId: stopped });
    expect((await waiting.finished).status).toBe('stopped');
    expect(Date.now() - stoppedAt).toBeLessThan(500);
    expect(fakeLog()).not.toContain(`exited ${other}`);
    expect(argvLines()).toHaveLength(launched);
    await runTurn(client, stopped, 'fourth');
    const after = fakeLog().split('\n');
    expect(after.indexOf(`exited ${other}`)).toBeGreaterThan(-1);
    expect(after.indexOf(`exited ${other}`)).toBeLessThan(after.findLastIndex(line => line.startsWith(`argv sessionId=${other} `)));
  }, 20_000);

  test('a reopen whose old pi outlives the deadline opens that session only once it has exited', async () => {
    process.env['PI_FAKE_LITERAL'] = '1';
    process.env['PI_FAKE_NO_TEAM'] = '1';
    process.env['PI_FAKE_SLOW_EXIT'] = '2000';
    setPiStopDeadlineForTests(400);
    try {
      const client = await startCore({ warmProcessMinutes: 5 });
      const { projectId, accountId } = await piAccount(client);
      await client.call('providers.probe', { providerId: 'pi-fake', accountId });
      const { id } = await client.call('threads.create', { projectId, providerId: 'pi-fake', accountId, title: 'stuck', model: 'fake-a/team/base' });
      await client.call('threads.subscribe', { threadId: id });
      await runTurn(client, id, 'first');
      const session = harness!.core.threads.require(id).sessionId;
      const first = fakeLog().split('\n').length - 1;
      delete process.env['PI_FAKE_NO_TEAM'];
      await client.call('providers.probe', { providerId: 'pi-fake', accountId, refresh: true });
      // The old pi still runs its shutdown hooks past the deadline: a turn meanwhile fails rather than open its session
      // file beside it, unless a slow machine gave it time to exit first.
      for (const prompt of ['second', 'third']) {
        const { finished } = await startTurn(client, id, prompt, 20_000);
        const ended = await finished;
        if (ended.status !== 'done') expect(ended.error).toContain('did not exit');
      }
      await waitFor(() => fakeLog().includes(`exited ${session}`));
      await runTurn(client, id, 'fourth');
      const lines = fakeLog().split('\n');
      const opened = lines.flatMap((line, index) => index >= first && line.startsWith(`argv sessionId=${session} `) ? [index] : []);
      expect(opened.length).toBeGreaterThan(0);
      expect(Math.min(...opened)).toBeGreaterThan(lines.indexOf(`exited ${session}`));
    } finally {
      setPiStopDeadlineForTests(null);
    }
  }, 20_000);

  test('a plain prompt reaches a text-only pi model when the conversation it carries holds images', async () => {
    const client = await startCore();
    const { projectId, accountId } = await piAccount(client);
    const { id: threadId } = await client.call('threads.create', { projectId, providerId: 'pi-fake', accountId, title: 'history', model: 'fake-a/smart' });
    await client.call('threads.subscribe', { threadId });
    // A real picture, which the carried history keeps as its preview.
    const image: ImageAttachment = { kind: 'image', name: 'dot.png', mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==' };
    const shown = client.next('turn.finished', turn => turn.threadId === threadId, 20_000);
    await client.call('turns.start', { threadId, prompt: 'Read this', attachments: [image] });
    expect(await shown).toMatchObject({ status: 'done', error: null });
    // Another account starts a new session, which gets the conversation, its image included; pi replaces it for a model that reads none.
    const other = await client.call('accounts.add', { providerId: 'pi-fake', label: 'Other', useDefaultLocation: true });
    await client.call('providers.probe', { providerId: 'pi-fake', accountId: other.id });
    await client.call('threads.update', { threadId, accountId: other.id, model: 'fake-b/plain' });
    const asked = client.next('turn.finished', turn => turn.threadId === threadId, 20_000);
    await client.call('turns.start', { threadId, prompt: 'What did it say?' });
    expect(await asked).toMatchObject({ status: 'done', error: null });
    expect(fakeLog().split('\n').filter(line => line.startsWith('image image/png'))).toHaveLength(2);
  });

  test('input steered while the driver checks that the running pi reads images waits for the next turn', async () => {
    process.env['PI_FAKE_SLOW_STATE'] = '600';
    const client = await startCore({ warmProcessMinutes: 5 });
    const { projectId, accountId } = await piAccount(client);
    await client.call('providers.probe', { providerId: 'pi-fake', accountId });
    const { id: threadId } = await client.call('threads.create', { projectId, providerId: 'pi-fake', accountId, title: 'checking', model: 'fake-b/plain' });
    await client.call('threads.subscribe', { threadId });
    await runTurn(client, threadId, 'first');
    process.env['PI_FAKE_PLAIN_IMAGES'] = '1';
    await client.call('providers.probe', { providerId: 'pi-fake', accountId, refresh: true });
    const image: ImageAttachment = { kind: 'image', name: 'sample.png', mimeType: 'image/png', data: 'aGVsbG8=' };
    const asked = fakeLog().split('\n').filter(line => line === 'state asked').length;
    const finished = client.next('turn.finished', turn => turn.threadId === threadId, 20_000);
    const turn = await client.call('turns.start', { threadId, prompt: 'Read this', attachments: [image] });
    await waitFor(() => fakeLog().split('\n').filter(line => line === 'state asked').length > asked);
    // The old process is about to be replaced: what it accepted now would go with it.
    expect(await client.call('turns.steer', { threadId, turnId: turn.id, prompt: 'Also this', clientRequestId: 'pi_checking_steer' })).toEqual({ accepted: false });
    expect(await finished).toMatchObject({ status: 'done', error: null });
    expect(fakeLog()).not.toContain('steering Also this');
  }, 20_000);

  test('an image steer whose turn ends while pi reads the model leaves no unconfirmed delivery behind', async () => {
    process.env['PI_FAKE_SLOW_STATE'] = '2000';
    const { client, threadId } = await startThread(undefined, 'fake-a/smart');
    const turn = await client.call('turns.start', { threadId, prompt: '[slow] Deploy' });
    await waitFor(() => fakeLog().includes('waiting for abort'));
    const asked = fakeLog().split('\n').filter(line => line === 'state asked').length;
    const image: ImageAttachment = { kind: 'image', name: 'sample.png', mimeType: 'image/png', data: 'aGVsbG8=' };
    const steered = client.call('turns.steer', { threadId, turnId: turn.id, prompt: 'Use this', attachments: [image], clientRequestId: 'pi_cut_state' });
    await waitFor(() => fakeLog().split('\n').filter(line => line === 'state asked').length > asked);
    const ended = client.next('turn.finished', done => done.id === turn.id, 20_000);
    await client.call('turns.stop', { threadId });
    await ended;
    expect(await steered).toEqual({ accepted: false });
    expect(harness!.core.journal.db.query('SELECT 1 FROM turn_requests WHERE request_id = ?').all('pi_cut_state')).toEqual([]);
    expect(fakeLog()).not.toContain('steering Use this');
  }, 20_000);

  test('an image steer whose run pi ends while it reads the model is not sent', async () => {
    const ended = join(tmpdir(), `pi-end-on-state-${process.pid}-${Date.now()}`);
    process.env['PI_FAKE_SLOW_STATE'] = '200';
    process.env['PI_FAKE_END_ON_STATE'] = ended;
    try {
      const { client, threadId } = await startThread(undefined, 'fake-a/smart');
      // pi's stats hang after the run, so the turn is over in pi but not yet settled in Boite when the state comes.
      const finished = client.next('turn.finished', done => done.threadId === threadId, 20_000);
      const started = await client.call('turns.start', { threadId, prompt: '[hang-stats] [slow] Deploy' });
      await waitFor(() => fakeLog().includes('waiting for abort'));
      writeFileSync(ended, '');
      const image: ImageAttachment = { kind: 'image', name: 'sample.png', mimeType: 'image/png', data: 'aGVsbG8=' };
      const steered = await client.call('turns.steer', { threadId, turnId: started.id, prompt: 'Use this', attachments: [image], clientRequestId: 'pi_ended_run' });
      expect(steered).toEqual({ accepted: false });
      expect(fakeLog()).not.toContain('steer without a run');
      expect(harness!.core.journal.db.query('SELECT 1 FROM turn_requests WHERE request_id = ?').all('pi_ended_run')).toEqual([]);
      await finished;
    } finally {
      rmSync(ended, { force: true });
    }
  }, 20_000);

  test('an image steer refused because pi gave no state in time leaves no unconfirmed delivery behind', async () => {
    process.env['PI_FAKE_SLOW_STATE'] = '600';
    setPiReadDeadlineForTests(100);
    try {
      const { client, threadId } = await startThread(undefined, 'fake-a/smart');
      const turn = await client.call('turns.start', { threadId, prompt: '[slow] Deploy' });
      await waitFor(() => fakeLog().includes('waiting for abort'));
      const image: ImageAttachment = { kind: 'image', name: 'sample.png', mimeType: 'image/png', data: 'aGVsbG8=' };
      expect(await client.call('turns.steer', { threadId, turnId: turn.id, prompt: 'Use this', attachments: [image], clientRequestId: 'pi_late_state' })).toEqual({ accepted: false });
      expect(harness!.core.journal.db.query('SELECT 1 FROM turn_requests WHERE request_id = ?').all('pi_late_state')).toEqual([]);
      const ended = client.next('turn.finished', done => done.id === turn.id, 20_000);
      await client.call('turns.stop', { threadId });
      await ended;
    } finally {
      setPiReadDeadlineForTests(null);
    }
  }, 20_000);

  test('images reach a pair that gained them after the warm process started through a new process, and wait while a run holds the old one', async () => {
    const client = await startCore({ warmProcessMinutes: 5 });
    const { projectId, accountId } = await piAccount(client);
    await client.call('providers.probe', { providerId: 'pi-fake', accountId });
    const { id: threadId } = await client.call('threads.create', { projectId, providerId: 'pi-fake', accountId, title: 'gained', model: 'fake-b/plain' });
    await client.call('threads.subscribe', { threadId });
    await runTurn(client, threadId, 'first');
    process.env['PI_FAKE_PLAIN_IMAGES'] = '1';
    await client.call('providers.probe', { providerId: 'pi-fake', accountId, refresh: true });
    const image: ImageAttachment = { kind: 'image', name: 'sample.png', mimeType: 'image/png', data: 'aGVsbG8=' };
    // A run cannot change its process: the image waits for the next turn.
    const held = await client.call('turns.start', { threadId, prompt: '[slow] Read this' });
    await waitFor(() => fakeLog().includes('waiting for abort'));
    expect(await client.call('turns.steer', { threadId, turnId: held.id, prompt: 'Use this', attachments: [image], clientRequestId: 'pi_gained_steer' })).toEqual({ accepted: false });
    const ended = client.next('turn.finished', turn => turn.id === held.id, 20_000);
    await client.call('turns.stop', { threadId });
    await ended;
    const finished = client.next('turn.finished', turn => turn.threadId === threadId, 20_000);
    await client.call('turns.start', { threadId, prompt: 'Read this', attachments: [image] });
    expect(await finished).toMatchObject({ status: 'done', error: null });
    const launched = argvLines().filter((line) => !line.includes('sessionId= '));
    expect(launched).toHaveLength(2);
    expect(launched[1]).toContain('model=fake-b/plain provider=fake-b');
    expect(fakeLog()).toContain('image image/png');
  });

  test('an image admitted on a list a later attempt no longer runs fails that attempt instead of reaching a text-only pi', async () => {
    process.env['PI_FAKE_LITERAL'] = '1';
    const client = await startCore({ warmProcessMinutes: 5 });
    const { projectId, accountId } = await piAccount(client);
    // The list an attempt is given (a retry's, after a refresh) keeps `base` on `fake-a/team`, which reads no images,
    // while admission read the one where `fake-a/team/base` is `team/base` on `fake-a`, which does.
    await client.call('providers.probe', { providerId: 'pi-fake', accountId });
    const given = probedModelsOf('pi', 'pi-fake', accountId);
    process.env['PI_FAKE_NO_TEAM'] = '1';
    await client.call('providers.probe', { providerId: 'pi-fake', accountId, refresh: true });
    delete process.env['PI_FAKE_NO_TEAM'];
    const { id: threadId } = await client.call('threads.create', { projectId, providerId: 'pi-fake', accountId, title: 'attempt', model: 'fake-a/team/base' });
    await client.call('threads.subscribe', { threadId });
    const catalog = spyOn(selection, 'piCatalogOf').mockImplementation(() => given);
    try {
      const image: ImageAttachment = { kind: 'image', name: 'sample.png', mimeType: 'image/png', data: 'aGVsbG8=' };
      const finished = client.next('turn.finished', turn => turn.threadId === threadId, 20_000);
      await client.call('turns.start', { threadId, prompt: 'Read this', attachments: [image] });
      expect(await finished).toMatchObject({ status: 'error', error: expect.stringContaining('Fake Base takes no images') });
    } finally {
      catalog.mockRestore();
    }
    expect(argvLines().find(line => line.includes('provider=fake-a/team '))).toBeDefined();
    expect(fakeLog()).not.toContain('image image/png');
  });

  test.each([
    ['get_available_models', 'fake-a/quick'],
    // pi answers `set_model` once its `model_select` hooks ran.
    ['set_model', 'fake-a/quick'],
  ])('a warm switch whose %s pi never answers takes no steer, fails the turn and drops the process', async (command, model) => {
    process.env['PI_FAKE_LITERAL'] = '1';
    const silent = join(tmpdir(), `pi-silent-${process.pid}-${Date.now()}`);
    process.env['PI_FAKE_SILENT'] = silent;
    setPiReadDeadlineForTests(1_000);
    setPiStopDeadlineForTests(1_000);
    try {
      const client = await startCore({ warmProcessMinutes: 5 });
      const { projectId, accountId } = await piAccount(client);
      await client.call('providers.probe', { providerId: 'pi-fake', accountId });
      const { id: threadId } = await client.call('threads.create', { projectId, providerId: 'pi-fake', accountId, title: 'silent', model: 'fake-a/smart' });
      await client.call('threads.subscribe', { threadId });
      await runTurn(client, threadId, 'first');
      writeFileSync(silent, command);
      await client.call('threads.update', { threadId, model });
      const finished = client.next('turn.finished', done => done.threadId === threadId, 20_000);
      const started = await client.call('turns.start', { threadId, prompt: 'second' });
      // pi has no run yet: a steer now would open one of its own beside the prompt.
      await waitFor(() => fakeLog().includes(`${command} unanswered`));
      expect(await client.call('turns.steer', { threadId, turnId: started.id, prompt: 'Also this', clientRequestId: `pi_switch_${command}` })).toEqual({ accepted: false });
      expect(harness!.core.journal.db.query('SELECT 1 FROM turn_requests WHERE request_id = ?').all(`pi_switch_${command}`)).toEqual([]);
      expect(await finished).toMatchObject({ status: 'error', error: expect.stringContaining('timed out') });
      expect(fakeLog()).not.toContain('steer without a run');
      // The process went with the turn: the next one starts a new pi.
      rmSync(silent, { force: true });
      const launched = argvLines().filter(line => !line.includes('sessionId= ')).length;
      await runTurn(client, threadId, 'third');
      expect(argvLines().filter(line => !line.includes('sessionId= '))).toHaveLength(launched + 1);
    } finally {
      setPiReadDeadlineForTests(null);
      setPiStopDeadlineForTests(null);
      rmSync(silent, { force: true });
    }
  }, 20_000);

  test('a warm process pi launched on the text keeps its level when a probe names the pair it already runs', async () => {
    process.env['PI_FAKE_CURRENT'] = 'smart';
    const client = await startCore({ warmProcessMinutes: 5 });
    const { projectId, accountId } = await piAccount(client);
    const { id: threadId } = await client.call('threads.create', { projectId, providerId: 'pi-fake', accountId, title: 'unprobed', model: 'fake-a/smart' });
    await client.call('threads.subscribe', { threadId });
    forgetProbes({ providerId: 'pi-fake', accountId });
    forgetSavedCatalog(harness!.core, accountId);
    const turnProcesses = () => argvLines().filter((line) => !line.includes('sessionId= '));
    await runTurn(client, threadId, 'first');
    expect(turnProcesses()[0]).toContain('model=fake-a/smart provider= thinking=');
    await client.call('providers.probe', { providerId: 'pi-fake', accountId, refresh: true });
    await runTurn(client, threadId, 'second');
    expect(turnProcesses()).toHaveLength(1);
    expect(fakeLog()).not.toContain('model fake-a smart\n');
  });

  test('core shutdown during a turn pi never settles ends it before the journal closes', async () => {
    const { client, threadId } = await startThread();
    const finished: { status: string; error: string | null }[] = [];
    const logs: string[] = [];
    harness!.core.bus.onAny((name, payload) => {
      if (name === 'core.log') logs.push((payload as RpcEvents['core.log']).message);
      if (name !== 'turn.finished') return;
      const turn = payload as RpcEvents['turn.finished'];
      if (turn.threadId === threadId) finished.push({ status: turn.status, error: turn.error });
    });
    const uncaught: string[] = [];
    const onUncaught = (error: unknown): void => {
      uncaught.push(error instanceof Error ? error.message : String(error));
    };
    process.on('uncaughtException', onUncaught);
    process.on('unhandledRejection', onUncaught);
    try {
      await client.call('turns.start', { threadId, prompt: '[deaf]' });
      await waitFor(() => fakeLog().includes('waiting forever'));
      // Nothing may write to the closed journal once the child's close lands.
      await stopCore();
      await new Promise((resolve) => setTimeout(resolve, 500));
    } finally {
      process.off('uncaughtException', onUncaught);
      process.off('unhandledRejection', onUncaught);
    }
    // The drain stops the turn, pi ignores the abort, and the driver shutdown
    // ends it stopped while the bus and the journal are still open.
    expect(finished).toEqual([{ status: 'stopped', error: null }]);
    expect(uncaught).toEqual([]);
    expect(logs.filter((line) => /closed database|database is closed/i.test(line))).toEqual([]);
  }, 20000);

  test('core shutdown before the stop deadline keeps a stopped pi turn stopped', async () => {
    const { client, threadId } = await startThread();
    const statuses: string[] = [];
    harness!.core.bus.onAny((name, payload) => {
      if (name !== 'turn.finished') return;
      const turn = payload as RpcEvents['turn.finished'];
      if (turn.threadId === threadId) statuses.push(turn.status);
    });
    await client.call('turns.start', { threadId, prompt: '[deaf]' });
    await waitFor(() => fakeLog().includes('waiting forever'));
    await client.call('turns.stop', { threadId });
    await waitFor(() => fakeLog().includes('abort ignored'));
    // The 15 s stop deadline has not run: the shutdown is what closes pi.
    await stopCore();
    expect(statuses).toEqual(['stopped']);
  }, 20000);

  test('a launch pi resolved to another case of the id switches to the catalog\'s pair before the first prompt', async () => {
    process.env['PI_FAKE_CASE'] = '1';
    try {
      const client = await startCore();
      const { projectId, accountId } = await piAccount(client);
      await client.call('providers.probe', { providerId: 'pi-fake', accountId });
      const { id: threadId } = await client.call('threads.create', { projectId, providerId: 'pi-fake', accountId, title: 'case', model: 'fake-b/plain' });
      await client.call('threads.subscribe', { threadId });
      await runTurn(client, threadId, 'hello');
      // pi started on `fake-b/Plain`, which reads images; the thread and image admission are on `fake-b/plain`.
      expect(fakeLog()).toContain('model fake-b plain');
    } finally {
      delete process.env['PI_FAKE_CASE'];
    }
  });

  async function runTurn(client: CoreClient, threadId: string, prompt: string): Promise<void> {
    const { finished } = await startTurn(client, threadId, prompt, 20000);
    const done = await finished;
    expect(done.error).toBeNull();
    expect(done.status).toBe('done');
  }
});
