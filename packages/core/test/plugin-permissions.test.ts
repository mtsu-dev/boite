import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_DELEGATION_CONFIG, DEVICE_EVENTS, DEVICE_METHODS, PLUGIN_CLOSED, PLUGIN_MANIFEST_FILE, PLUGIN_PERMISSIONS, PLUGIN_PERMISSION_NAMES,
  accessRefusal, mayHearEvent, pluginClosedReason, type MessagePart, type Todo, type WorkflowRun,
} from '@boite/contracts';
import { connect } from '../src/client.ts';
import type { Connection } from '../src/router.ts';
import { mayResume } from '../src/workflows/resume.ts';
import { carriedGrant } from '../src/plugins/grants.ts';
import { parseManifest } from '../src/plugins/manifest.ts';
import { echoThread, startTestCore, waitFor, type TestCore } from './harness.ts';
import { rejection, thrown } from './settle.ts';
import { messageOf } from '../src/errors.ts';

let harness: TestCore | undefined;
afterEach(async () => { await harness?.stop(); harness = undefined; });

const asPlugin = { client: { name: 'plugin', version: '0' } };
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 'boite test', GIT_AUTHOR_EMAIL: 'test@boite.invalid', GIT_COMMITTER_NAME: 'boite test', GIT_COMMITTER_EMAIL: 'test@boite.invalid' };

function git(cwd: string, ...args: string[]): string {
  const run = Bun.spawnSync({ cmd: ['git', ...args], cwd, env: GIT_ENV, stdout: 'pipe', stderr: 'pipe', windowsHide: true });
  if (!run.success) throw new Error(`git ${args.join(' ')} failed: ${run.stderr.toString()}`);
  return run.stdout.toString().trim();
}

/** A schema 2 plugin that runs nothing, so an install downloads nothing: what it asks for is all the test reads. */
function board(permissions: string[], version = '1.0.0'): Record<string, unknown> {
  return {
    schema: 2, id: 'board-bot', name: 'Board bot', version, description: 'Keeps the board tidy.', homepage: 'https://plugins.example.invalid/board-bot',
    permissions, provides: { prompt: 'Keep the board tidy.' },
  };
}

function repository(content: Record<string, unknown>): string {
  const path = join(harness!.dataDir, 'repos', 'board-bot');
  mkdirSync(path, { recursive: true });
  git(path, 'init', '-q');
  writeFileSync(join(path, PLUGIN_MANIFEST_FILE), JSON.stringify(content));
  git(path, 'add', '-A');
  git(path, 'commit', '-q', '-m', 'plugin');
  return path;
}

describe('the plugin permission table', () => {
  test('files every method and event a paired device reaches into one permission, or closes it with a reason', () => {
    const filed = new Map<string, string[]>();
    for (const name of PLUGIN_PERMISSION_NAMES) {
      for (const entry of [...PLUGIN_PERMISSIONS[name].methods, ...PLUGIN_PERMISSIONS[name].events]) filed.set(entry, [...(filed.get(entry) ?? []), name]);
    }
    // A method a device gains later fails here until it joins a permission or the closed list.
    expect([...DEVICE_METHODS, ...DEVICE_EVENTS].filter((name) => !filed.has(name) && pluginClosedReason(name) === null)).toEqual([]);
    expect([...filed].filter(([, names]) => names.length > 1)).toEqual([]);
    expect([...filed.keys()].filter((name) => pluginClosedReason(name) !== null)).toEqual([]);
    // Nothing past what a device reaches, but the plugin's own ui.reveal.
    expect([...filed.keys()].filter((name) => !DEVICE_METHODS.has(name as never) && !DEVICE_EVENTS.has(name as never))).toEqual(['ui.reveal']);
    expect(PLUGIN_PERMISSION_NAMES.length).toBeLessThanOrEqual(14);
    expect(PLUGIN_CLOSED.filter((entry) => entry.reason.trim().length === 0)).toEqual([]);
  });

  test('a refusal names the permission and says the owner did not grant it, or why the method is never open', () => {
    const caller = { principal: 'plugin' as const, sessionId: null, threadId: null, permissions: ['threads.read' as const] };
    expect(accessRefusal('todos.list', caller)?.message).toBe('todos.list needs the plugin permission todos.read, which the owner did not grant (granted: threads.read)');
    expect(accessRefusal('secrets.list', caller)?.message).toBe('secrets.list is never open to plugins: secrets reach only the agent that asked for one');
    expect(accessRefusal('plugins.setGrants', caller)?.message).toBe("plugins.setGrants is never open to plugins: installing, removing and granting plugins is the owner's");
    expect(accessRefusal('settings.set', caller)?.message).toBe('settings.set is for the owner only; a plugin reaches the methods of its permissions (granted: threads.read)');
    const writer = { ...caller, permissions: ['threads.read', 'threads.write', 'todos.read', 'todos.write'] as const };
    expect(accessRefusal('threads.archive', writer, { threadId: 't', archived: false })?.message).toContain('a plugin only archives');
    expect(accessRefusal('todos.update', writer, { threadId: 't', todoId: 'x', sharedProjectId: 's' })?.message).toContain('sharedProjectId is not for plugins');
    // A granted permission's events reach the plugin; another's do not.
    expect(mayHearEvent('todos.updated', 'plugin', ['todos.read'])).toBe(true);
    expect(mayHearEvent('todos.updated', 'plugin', ['todos.write'])).toBe(false);
    // The admin policy is no domain's: status.read reads usage, not the rules an administrator set.
    const status = { ...caller, permissions: ['status.read'] as const };
    expect(accessRefusal('policy.get', status)?.message).toStartWith('policy.get is never open to plugins: policies hold');
    expect(mayHearEvent('policy.changed', 'plugin', ['status.read'])).toBe(false);
    // A queued composer line goes out as the owner's own, so a plugin sends with turns.start or turns.steer.
    expect(accessRefusal('composer.put', writer)?.message).toStartWith('composer.put is never open to plugins: a queued line goes out as the owner');
  });

  test('an older name in a manifest reads as the permissions it stands for', () => {
    expect(parseManifest(board(['threads.read', 'todos']), PLUGIN_MANIFEST_FILE).permissions).toEqual(['threads.read', 'todos.read', 'todos.write']);
    expect(parseManifest(board(['todos', 'todos.read']), PLUGIN_MANIFEST_FILE).permissions).toEqual(['todos.read', 'todos.write']);
    expect(() => parseManifest(board(['threads.archive']), PLUGIN_MANIFEST_FILE)).toThrow('permissions[0]');
  });

  test('an update keeps the grant and adds nothing it asks for anew; a first install gets what it asks for', () => {
    expect(carriedGrant(null, null, ['threads.read', 'todos.write'])).toEqual(['threads.read', 'todos.write']);
    expect(carriedGrant(['threads.read'], ['threads.read', 'todos.write'], ['threads.read', 'todos.write', 'agents.read'])).toEqual(['threads.read']);
    // Installed before grants existed: what the old version asked for counts as granted.
    expect(carriedGrant(null, ['threads.read'], ['threads.read', 'threads.write'])).toEqual(['threads.read']);
  });
});

describe('what the owner grants a plugin', () => {
  test('an install grants what was ticked, plugins.setGrants changes it with a new token, an update asks again', async () => {
    harness = await startTestCore();
    const owner = await harness.connect();
    harness.core.plugins.allowLocalSources = true;
    const url = repository(board(['threads.read', 'todos']));

    // A grant the manifest does not ask for is refused, naming the entry.
    const refusedPreview = await owner.call('plugins.inspect', { url });
    const bad = await rejection(owner.call('plugins.add', { previewId: refusedPreview.previewId!, grants: ['threads.read', 'agents.read'] }));
    expect(messageOf(bad.reason)).toStartWith('grants[1] must be one of an array of distinct permissions board-bot asks for: threads.read, todos.read, todos.write');

    const preview = await owner.call('plugins.inspect', { url });
    await owner.call('plugins.add', { previewId: preview.previewId!, grants: ['threads.read', 'todos.read'] });
    await waitFor(() => harness!.core.plugins.state('board-bot').status !== 'installing');
    expect(harness.core.plugins.state('board-bot')).toMatchObject({
      status: 'installed', requested: ['threads.read', 'todos.read', 'todos.write'], granted: ['threads.read', 'todos.read'], runsProgram: false,
    });

    // The token reaches the granted set; a refused call says the owner did not grant it.
    const first = harness.core.plugins.tokens.tokenFor('board-bot', harness.core.plugins.grants.effective('board-bot', ['threads.read', 'todos.read', 'todos.write']));
    const plugin = await connect(harness.url, first, asPlugin);
    const { threadId } = await echoThread(harness, owner, 'board');
    expect(Array.isArray(await plugin.call('todos.list', { threadId }))).toBe(true);
    expect(await thrown(plugin.call('todos.add', { threadId, text: 'tidy' })))
      .toThrow('todos.add needs the plugin permission todos.write, which the owner did not grant (granted: threads.read, todos.read)');

    // Granting more reissues the token: the old one and its sockets are gone.
    const granted = await owner.call('plugins.setGrants', { id: 'board-bot', grants: ['threads.read', 'todos.read', 'todos.write'] });
    expect(granted.granted).toEqual(['threads.read', 'todos.read', 'todos.write']);
    expect(harness.core.plugins.tokens.authenticate(first)).toBeNull();
    expect(await thrown(plugin.call('threads.list', {}))).toThrow();
    expect(await thrown(owner.call('plugins.setGrants', { id: 'board-bot', grants: ['agents.write'] }))).toThrow('grants[0] must be one of');

    // An update that asks for more keeps the grant and adds nothing unasked.
    await owner.call('plugins.setGrants', { id: 'board-bot', grants: ['threads.read'] });
    writeFileSync(join(url, PLUGIN_MANIFEST_FILE), JSON.stringify(board(['threads.read', 'todos', 'agents.read'], '1.1.0')));
    git(url, 'commit', '-q', '-am', 'asks for more');
    const update = await owner.call('plugins.inspect', { url });
    expect(harness.core.plugins.state('board-bot').requested).toEqual(['threads.read', 'todos.read', 'todos.write']);
    await owner.call('plugins.add', { previewId: update.previewId! });
    await waitFor(() => harness!.core.plugins.state('board-bot').status !== 'installing');
    expect(harness.core.plugins.state('board-bot')).toMatchObject({ version: '1.1.0', granted: ['threads.read'], requested: ['threads.read', 'todos.read', 'todos.write', 'agents.read'] });

    // Uninstalling forgets the grant; installing again asks from scratch.
    await owner.call('plugins.uninstall', { id: 'board-bot' });
    expect(harness.core.plugins.grants.stored('board-bot')).toBeNull();
    expect(await thrown(owner.call('plugins.setGrants', { id: 'board-bot', grants: [] }))).toThrow();
  }, 90_000);
});

describe('a plugin\'s changes in its name', () => {
  test('a thread it creates, a prompt it sends and a card it adds or moves say which plugin did it', async () => {
    harness = await startTestCore();
    const owner = await harness.connect();
    const { threadId, accountId } = await echoThread(harness, owner, 'owner thread');
    const projectId = harness.core.threads.require(threadId).projectId;
    if (projectId === null) throw new Error('the echo thread has no project');
    const plugin = await connect(harness.url, harness.core.plugins.tokens.tokenFor('maker', ['threads.read', 'threads.write', 'todos.read', 'todos.write']), asPlugin);

    const made = await plugin.call('threads.create', { projectId, providerId: 'echo', accountId, title: 'Made by a plugin' });
    expect(made.createdBy).toEqual({ pluginId: 'maker', pluginName: 'maker' });
    expect((await owner.call('threads.get', { threadId: made.id })).createdBy).toEqual({ pluginId: 'maker', pluginName: 'maker' });
    expect(harness.core.threads.require(threadId).createdBy).toBeUndefined();

    const turn = await plugin.call('turns.start', { threadId: made.id, prompt: 'hello from the plugin [sleep:60000]' });
    await waitFor(() => harness!.core.threads.require(made.id).status === 'running');
    // A line steered into the running turn names the plugin as the prompt that opened it does.
    expect((await plugin.call('turns.steer', { threadId: made.id, turnId: turn.id, prompt: 'and this', clientRequestId: 'steer-plugin-001' })).accepted).toBe(true);
    await owner.call('turns.stop', { threadId: made.id });
    await waitFor(() => harness!.core.threads.require(made.id).status === 'idle');
    const page = await owner.call('threads.get', { threadId: made.id });
    const said = page.messages.filter((message) => message.role === 'user').map((message) => message.parts[0] as Extract<MessagePart, { type: 'text' }>);
    expect(said.map((part) => [part.text, part.byPlugin])).toEqual([
      ['hello from the plugin [sleep:60000]', { pluginId: 'maker', pluginName: 'maker' }],
      ['and this', { pluginId: 'maker', pluginName: 'maker' }],
    ]);

    const card = await plugin.call('todos.add', { threadId, text: 'tidy the board' });
    expect(card.plugin).toEqual({ pluginId: 'maker', pluginName: 'maker' });
    const moved = await owner.call('todos.update', { threadId, todoId: card.id, status: 'claimed' });
    expect(moved.plugin).toBeUndefined();

    await harness.core.logs.flush();
    const logged = (await harness.core.logs.query({ source: 'plugins', limit: 50 })).map((entry) => entry.message);
    expect(logged).toEqual(expect.arrayContaining(['threads.create by plugin maker', 'turns.start by plugin maker', 'turns.steer by plugin maker', 'todos.add by plugin maker']));
    expect(logged).not.toContain('threads.list by plugin maker');
  }, 30_000);
});

describe('a plugin passes a paired device\'s checks', () => {
  /** A git project inside the test's data folder, the way access.test.ts builds one for a device. */
  async function repoThread(owner: Awaited<ReturnType<TestCore['connect']>>): Promise<string> {
    const root = join(harness!.dataDir, 'repo');
    mkdirSync(join(root, '.ssh'), { recursive: true });
    git(root, 'init', '-q');
    writeFileSync(join(root, 'a.txt'), 'one\n');
    git(root, 'add', '.');
    git(root, 'commit', '-qm', 'first');
    for (const name of ['.env', 'id_ed25519', '.ssh/config']) writeFileSync(join(root, name), 'token\n');
    const project = await owner.call('projects.add', { path: root, name: 'repo' });
    const account = (await owner.call('accounts.list', {})).find((entry) => entry.providerId === 'echo');
    return (await owner.call('threads.create', { projectId: project.id, providerId: 'echo', accountId: account?.id ?? '', title: 'repo' })).id;
  }

  test('files.read leaves credential files and boite\'s data folder to the owner, and projects.add does not open them', async () => {
    harness = await startTestCore();
    const owner = await harness.connect();
    const threadId = await repoThread(owner);
    const plugin = await connect(harness.url, harness.core.plugins.tokens.tokenFor('reader', ['files.read', 'projects.write']), asPlugin);
    expect(await plugin.call('files.read', { threadId, path: 'a.txt' })).toMatchObject({ kind: 'text', text: 'one\n' });
    for (const path of ['.env', 'id_ed25519', '.ssh/config', '.git/config']) {
      expect(await thrown(plugin.call('files.read', { threadId, path }))).toThrow('credential files');
    }
    expect(await thrown(plugin.call('git.diff', { threadId, path: '.env' }))).toThrow('credential files');
    const { threadId: inData } = await echoThread(harness, owner);
    expect(await thrown(plugin.call('files.read', { threadId: inData, path: 'journal.db' }))).toThrow('data folder');
    expect(await thrown(plugin.call('projects.add', { path: harness.dataDir }))).toThrow('does not add boite\'s data folder');
    expect(await owner.call('files.read', { threadId, path: '.env' })).toMatchObject({ kind: 'text', text: 'token\n' });
  }, 30_000);

  test('a plugin neither retries nor resumes a workflow, which are the owner\'s', async () => {
    harness = await startTestCore();
    const owner = await harness.connect();
    const { threadId } = await echoThread(harness, owner);
    const thread = harness.core.threads.require(threadId);
    await owner.call('delegation.configure', { threadId, config: { ...DEFAULT_DELEGATION_CONFIG, enabled: true, profiles: [
      { id: 'fast', name: 'Fast', providerId: 'echo', accountId: thread.accountId, model: thread.model!, effort: null },
    ] } });
    const run = await owner.call('workflows.start', { threadId, plan: { name: 'One step', steps: [{ id: 'only', profile: 'fast', task: 'Say ok.' }] }, requestId: 'plugin-retry' });
    await waitFor(() => ['done', 'failed', 'stopped'].includes(harness!.core.workflows.get(threadId, run.id).status), 10_000);
    const plugin = await connect(harness.url, harness.core.plugins.tokens.tokenFor('runner', ['agents.read', 'agents.write']), asPlugin);
    expect(await thrown(plugin.call('workflows.control', { threadId, runId: run.id, action: 'retry', stepId: 'only' }))).toThrow('retrying a workflow step is an owner action');
    const paused = { ...harness.core.workflows.get(threadId, run.id), status: 'paused', pausedBy: 'owner', pausedAt: Date.now() } as WorkflowRun;
    expect(() => mayResume(harness!.core, paused, 'plugin')).toThrow('resuming a workflow is an owner action');
  }, 30_000);

  test('a shared board\'s cards never reach a plugin, by todos.list or todos.updated', async () => {
    harness = await startTestCore();
    const local = { id: 'local', projectId: 'p', text: 'mine', status: 'open', threadId: null, goalThreadId: null, createdAt: 1, updatedAt: 1 } as Todo;
    const shared = { ...local, id: 'shared', shared: { sharedProjectId: 'sp', card: {} } } as unknown as Todo;
    const as = (principal: 'plugin' | 'session'): Connection => ({
      id: 'con_test', subscriptions: new Set(), identity: { principal, sessionId: null, threadId: null, ...(principal === 'plugin' ? { pluginId: 'reader' } : {}) },
      sendEvent: () => undefined, close: () => undefined,
    } as unknown as Connection);
    // Both answers go through visibleTodos: the method's and the event's fan-out in server.ts.
    expect(harness.core.sharedBoard.visibleTodos('', [local, shared], as('plugin')).map((todo) => todo.id)).toEqual(['local']);
    expect(harness.core.sharedBoard.visibleTodos('', [local, shared], as('session')).map((todo) => todo.id)).toEqual(['local', 'shared']);
  }, 30_000);
});
