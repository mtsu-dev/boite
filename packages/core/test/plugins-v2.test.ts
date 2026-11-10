import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AGENT_ENV, accessRefusal, mayHearEvent } from '@boite/contracts';
import { agentGuide } from '../src/agent-guide.ts';
import { runCli, USAGE } from '../src/cli.ts';
import { parse } from '../src/cli-args.ts';
import { BUILTIN_COMMANDS } from '../src/cli-commands.ts';
import { ManifestRefused, commandsOf, parseManifest } from '../src/plugins/manifest.ts';
import { expandSlashPrompt, pluginGuideLines } from '../src/plugins/extensions.ts';
import { pluginLaunch } from '../src/plugins/launch.ts';
import { connect } from '../src/client.ts';
import { echoThread, removeDir, startTestCore, waitFor, type TestCore } from './harness.ts';
import { rejection, thrown } from './settle.ts';
import { messageOf } from '../src/errors.ts';

const CLIENT = pathToFileURL(join(import.meta.dir, '../src/client.ts')).href;

function v2(overrides: Record<string, unknown> = {}, provides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: 2, id: 'hello', name: 'Hello', version: '1.0.0', description: 'Says hello.', homepage: 'https://example.com/hello',
    runtime: 'bun', executable: 'hello',
    artifacts: { any: { url: 'https://example.com/hello.js', sha256: 'a'.repeat(64) } },
    permissions: ['threads.read'],
    provides: { commands: [{ name: 'hello-threads', description: 'Lists recent threads.', usage: '[--json]' }], ...provides },
    ...overrides,
  };
}

function refusedField(raw: unknown): string {
  try { parseManifest(raw, 'boite-plugin.json'); } catch (error) {
    if (error instanceof ManifestRefused) return error.rejected.field;
    throw error;
  }
  throw new Error('the manifest was accepted');
}

describe('manifest schema 2', () => {
  test('a bun plugin ships one file for every machine; schema 1 still reads', () => {
    const manifest = parseManifest(v2(), 'boite-plugin.json');
    expect(manifest.runtime).toBe('bun');
    expect(manifest.permissions).toEqual(['threads.read']);
    const lines = commandsOf(manifest);
    expect(lines.some((line) => line.startsWith('bun hello.js hello-threads [--json]'))).toBe(true);
    expect(lines.some((line) => line.includes("<hello's token: threads.read>") && line.includes('BOITE_PLUGIN_DATA'))).toBe(true);
    const v1 = parseManifest({ schema: 1, id: 'old', name: 'Old', version: '1.0.0', description: 'd', homepage: 'https://example.com', executable: 'old',
      artifacts: { 'linux-x64': { url: 'https://example.com/old', sha256: 'b'.repeat(64) } }, provides: { desktopApp: {} } }, 'f');
    expect(commandsOf(v1).some((line) => line.includes('<the owner token>'))).toBe(true);
  });

  test('a plugin of skills, a prompt and slash commands runs nothing and downloads nothing', () => {
    const manifest = parseManifest({ schema: 2, id: 'notes', name: 'Notes', version: '1.0.0', description: 'd', homepage: 'https://example.com',
      provides: { skills: [{ name: 'review', description: 'Review a diff.', body: '# Review\n\nRead the diff.' }], prompt: 'Prefer short answers.', slashCommands: [{ name: 'review', description: 'Review', prompt: 'Review this:' }] } }, 'f');
    expect(manifest.executable).toBeUndefined();
    expect(manifest.artifacts).toBeUndefined();
    expect(commandsOf(manifest)).toEqual([]);
  });

  test('each refusal names its field', () => {
    expect(refusedField(v2({}, { commands: [{ name: 'browser', description: 'x' }] }))).toBe('provides.commands[0].name');
    expect(refusedField(v2({ artifacts: { 'linux-x64': { url: 'https://example.com/a', sha256: 'a'.repeat(64) } } }))).toBe('artifacts');
    expect(refusedField(v2({ permissions: ['everything'] }))).toBe('permissions[0]');
    expect(refusedField(v2({ runtime: null }))).toBe('runtime');
    expect(refusedField(v2({}, { prompt: 'x'.repeat(1001) }))).toBe('provides.prompt');
    expect(refusedField(v2({}, { commands: [{ name: 'Hello', description: 'x' }] }))).toBe('provides.commands[0].name');
    expect(refusedField({ ...v2(), provides: { skills: [{ name: 's', description: 'd', body: 'b' }] } })).toBe('executable');
    // Schema 1 keeps its own fields: a schema 2 key there is a newer manifest misread.
    expect(refusedField({ ...v2(), schema: 1 })).toBe('runtime');
  });

  test('the built-in command words are exactly those the CLI answers, and help names the plugin route', () => {
    // Read from the sources: a handler added to either file without its word here would let a plugin shadow it.
    const cli = readFileSync(join(import.meta.dir, '../src/cli.ts'), 'utf8');
    const table = cli.slice(cli.indexOf('const commands: Record<string, () => Promise<void | number>> = {'));
    const keys = [...table.slice(0, table.indexOf('\n  };\n')).matchAll(/^ {4}'?([a-z][a-z-]*)'?: /gm)].map((match) => match[1]);
    const control = [...readFileSync(join(import.meta.dir, '../src/control-cli.ts'), 'utf8').matchAll(/^ {4}case '([a-z-]+)':/gm)].map((match) => match[1]);
    expect(keys.length).toBeGreaterThan(20);
    expect([...BUILTIN_COMMANDS].sort()).toEqual([...new Set([...keys, ...control, 'help', 'mcp', 'agent', 'agents'])].sort() as string[]);
    // A built-in missing from the list would be offered to plugins and never reached; the reverse would refuse a free name.
    for (const word of BUILTIN_COMMANDS) {
      if (word === 'help' || word === 'agent' || word === 'agents') continue;
      expect(parse([word]).positional[0]).toBe(word);
    }
    expect(USAGE).toContain('plugin dev <folder>');
    expect(USAGE).toContain('<plugin-command> [args]');
    // Every word after a plugin command's name is the plugin's, Boite's global flags included.
    expect(parse(['hello-threads', '--json', '--thread', 'x', '--', '-v']).positional).toEqual(['hello-threads', '--json', '--thread', 'x', '--', '-v']);
  });

  test('a bun file runs on the core\'s own Bun, as Bun once compiled; a native one as itself', async () => {
    const data = mkdtempSync(join(tmpdir(), 'boite-launch-'));
    try {
      const config = `--config=${join(data, 'plugin-runtime', 'bunfig.toml')}`;
      expect(pluginLaunch('/p/hello.js', ['a'], { X: '1' }, data, false)).toEqual({ cmd: process.execPath, args: [config, '--no-env-file', '/p/hello.js', 'a'], env: { X: '1' } });
      expect(pluginLaunch('/p/hello.js', ['a'], { X: '1' }, data, true)).toEqual({ cmd: process.execPath, args: [config, '--no-env-file', '--preload', join(data, 'plugin-runtime', 'preload.js'), '/p/hello.js', 'a'], env: { X: '1', BUN_BE_BUN: '1' } });
      expect(readFileSync(join(data, 'plugin-runtime', 'preload.js'), 'utf8')).toBe('delete process.env.BUN_BE_BUN;\n');
      expect(pluginLaunch('/p/native', ['a'], undefined, data, true)).toEqual({ cmd: '/p/native', args: ['a'], env: undefined });
    } finally {
      await removeDir(data);
    }
  });
});

describe('the plugin principal', () => {
  test('reaches the methods and events of its permissions, and nothing else', () => {
    const caller = { principal: 'plugin' as const, sessionId: null, threadId: null, permissions: ['threads.read' as const] };
    expect(accessRefusal('threads.list', caller)).toBeNull();
    expect(accessRefusal('turns.start', caller)?.message).toBe('turns.start needs the plugin permission threads.write, which the owner did not grant (granted: threads.read)');
    expect(accessRefusal('plugins.dev', caller)?.message).toContain('is never open to plugins');
    expect(mayHearEvent('thread.updated', 'plugin', ['threads.read'])).toBe(true);
    expect(mayHearEvent('todos.updated', 'plugin', ['threads.read'])).toBe(false);
  });
});

/** A dev plugin folder: a bun command that reports what it was given, then reads threads and todos with its own token. */
function devPlugin(root: string, extra: Record<string, unknown> = {}): string {
  const dir = join(root, 'hello');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'boite-plugin.json'), JSON.stringify({
    schema: 2, id: 'hello', name: 'Hello', version: '0.1.0', description: 'Says hello.', homepage: 'https://example.com/hello',
    runtime: 'bun', executable: 'hello', permissions: ['threads.read'],
    provides: {
      commands: [{ name: 'hello-threads', description: 'Lists recent threads.', usage: '[--json]' }],
      skills: [{ name: 'hello-guide', description: 'How to greet.', body: '# Greet\n\nSay hello.' }],
      prompt: 'Greet the user once.',
      slashCommands: [{ name: 'hello-review', description: 'Review with a greeting', prompt: 'Say hello, then review' }],
      ...extra,
    },
  }));
  writeFileSync(join(dir, 'hello.js'), `
import { connect } from ${JSON.stringify(CLIENT)};
const args = process.argv.slice(2);
const report = { args, cwd: process.cwd(), caller: process.env.BOITE_CALLER_THREAD_ID ?? null, data: process.env.BOITE_PLUGIN_DATA ?? null,
  plugin: process.env.BOITE_PLUGIN_ID, agentToken: process.env.BOITE_AGENT_TOKEN ?? null, ownerToken: process.env.BOITE_TOKEN === process.env.OWNER_TOKEN_FOR_TEST };
const client = await connect(process.env.BOITE_CORE_URL, process.env.BOITE_TOKEN, { client: { name: 'plugin', version: '0' } });
report.threads = (await client.call('threads.list', {})).length;
report.todos = await client.call('todos.list', { projectId: 'p' }).then(() => 'allowed', (error) => error.message);
client.close();
console.log(JSON.stringify(report));
console.error('to stderr');
process.exit(args.includes('--fail') ? 3 : 0);
`);
  return dir;
}

describe('plugins v2 end to end', () => {
  let harness: TestCore | undefined;
  const root = mkdtempSync(join(tmpdir(), 'boite-plugins-v2-'));

  test('a dev plugin adds an agent command, a skill, a prompt and a slash command', async () => {
    harness = await startTestCore();
    try {
      process.env['OWNER_TOKEN_FOR_TEST'] = harness.token;
      const owner = await harness.connect();
      const dir = devPlugin(root);
      const state = await owner.call('plugins.dev', { path: dir });
      expect(state).toMatchObject({ id: 'hello', origin: 'dev', status: 'installed', devPath: dir, permissions: ['threads.read'],
        adds: { commands: ['hello-threads'], skills: ['hello-guide'], slashCommands: ['hello-review'], prompt: true } });

      // An agent runs it as `boite hello-threads`, in its own directory, as its own thread.
      const { threadId } = await echoThread(harness, owner);
      const work = join(root, 'work'); mkdirSync(work, { recursive: true });
      let out = ''; let err = '';
      const code = await runCli(['hello-threads', '--json', 'two words', '--fail'], {
        cwd: work, out: (text) => { out += text; }, err: (text) => { err += text; },
        env: { [AGENT_ENV.threadId]: threadId, [AGENT_ENV.coreUrl]: harness.url, [AGENT_ENV.token]: harness.core.agents.tokenFor(threadId) },
      });
      expect(err).toBe('to stderr\n');
      expect(code).toBe(3);
      const report = JSON.parse(out);
      // macOS reports the temporary folder under /private/var, its real path.
      expect(realpathSync(report.cwd)).toBe(realpathSync(work));
      expect(report).toMatchObject({ args: ['hello-threads', '--json', 'two words', '--fail'], caller: threadId, plugin: 'hello', agentToken: null, ownerToken: false, threads: 1 });
      expect(report.todos).toBe('todos.list needs the plugin permission todos.read, which the owner did not grant (granted: threads.read)');
      expect(report.data).toBe(join(harness.dataDir, 'plugin-data', 'hello'));
      expect(existsSync(report.data)).toBe(true);

      // An unknown command names the ones there are.
      err = '';
      const unknown = await runCli(['nope-cmd'], { cwd: work, out() {}, err: (text) => { err += text; },
        env: { [AGENT_ENV.threadId]: threadId, [AGENT_ENV.coreUrl]: harness.url, [AGENT_ENV.token]: harness.core.agents.tokenFor(threadId) } });
      expect(unknown).toBe(2);
      expect(err).toContain('unknown command nope-cmd: boite nope-cmd is no boite command and no installed plugin provides it; plugin commands: hello-threads');

      // The guide lists the command, writes the skill and carries the prompt.
      const lines = pluginGuideLines(harness.core.plugins.installedPlugins());
      const guide = agentGuide(true, false, [], false, false, false, lines);
      expect(guide).toContain('`boite hello-threads [--json]`: Lists recent threads.');
      expect(guide).toContain('From the Hello plugin: Greet the user once.');
      const skill = join(harness.dataDir, 'plugins', 'hello', 'skills', 'hello-guide', 'SKILL.md');
      expect(guide).toContain(`File: ${skill}`);
      expect(readFileSync(skill, 'utf8')).toContain('Say hello.');

      // The composer's menu and the expansion of what is sent.
      const commands = await owner.call('brain.commands', {});
      expect(commands).toContainEqual({ name: 'hello-review', description: 'Review with a greeting', hint: null });
      expect(expandSlashPrompt(harness.core, '/hello-review the diff')).toBe('Say hello, then review the diff');
      expect(expandSlashPrompt(harness.core, '/hello-review the diff', [{ name: 'hello-review', description: null, hint: null }])).toBe('/hello-review the diff');

      // An edit to the folder applies on the next use; removing it leaves the folder.
      const manifest = JSON.parse(readFileSync(join(dir, 'boite-plugin.json'), 'utf8'));
      manifest.provides.prompt = 'Greet twice.';
      writeFileSync(join(dir, 'boite-plugin.json'), JSON.stringify(manifest));
      expect(pluginGuideLines(harness.core.plugins.installedPlugins())).toContain('From the Hello plugin: Greet twice.');
      out = '';
      const removed = await runCli(['--core', harness.url, 'plugin', 'dev', '--remove', 'hello'], { cwd: work, out: (text) => { out += text; }, err: (text) => { out += text; }, env: { BOITE_TOKEN: harness.token } });
      expect({ removed, out }).toMatchObject({ removed: 0 });
      expect(out).toContain('removed hello');
      expect(existsSync(join(dir, 'hello.js'))).toBe(true);
      expect(harness.core.plugins.installedPlugins()).toEqual([]);
    } finally {
      delete process.env['OWNER_TOKEN_FOR_TEST'];
      await harness?.stop();
      await removeDir(root);
    }
  }, 30_000);

  test('a narrowed or removed plugin loses its token, the sockets it opened included', async () => {
    harness = await startTestCore();
    const dir2 = mkdtempSync(join(tmpdir(), 'boite-plugins-v2-'));
    const asPlugin = { client: { name: 'plugin', version: '0' } };
    try {
      const owner = await harness.connect();
      const dir = devPlugin(dir2);
      await owner.call('plugins.dev', { path: dir });
      const first = harness.core.plugins.tokens.tokenFor('hello', ['threads.read']);
      const open = await connect(harness.url, first, asPlugin);
      expect(Array.isArray(await open.call('threads.list', {}))).toBe(true);
      expect(await thrown(open.call('plugins.list', {}))).toThrow('plugins.list is never open to plugins: installing, removing and granting plugins is the owner\'s');

      // A reload declaring less: the old token opens nothing, not even the socket already open.
      const manifest = JSON.parse(readFileSync(join(dir, 'boite-plugin.json'), 'utf8'));
      writeFileSync(join(dir, 'boite-plugin.json'), JSON.stringify({ ...manifest, permissions: [] }));
      await owner.call('plugins.dev', { path: dir });
      expect(await thrown(open.call('threads.list', {}))).toThrow('the client is closed');
      expect(await thrown(connect(harness.url, first, asPlugin))).toThrow();

      // The same permissions again keep the token; an uninstall revokes it and closes its sockets.
      writeFileSync(join(dir, 'boite-plugin.json'), JSON.stringify(manifest));
      await owner.call('plugins.dev', { path: dir });
      const second = harness.core.plugins.tokens.tokenFor('hello', ['threads.read']);
      const reopened = await connect(harness.url, second, asPlugin);
      await owner.call('plugins.dev', { path: dir });
      expect(Array.isArray(await reopened.call('threads.list', {}))).toBe(true);
      await owner.call('plugins.uninstall', { id: 'hello' });
      expect(await thrown(reopened.call('threads.list', {}))).toThrow('the client is closed');
      expect(await thrown(connect(harness.url, second, asPlugin))).toThrow();
    } finally {
      await harness?.stop();
      await removeDir(dir2);
    }
  }, 30_000);

  test('a dev folder edited after plugins.dev keeps the access that load approved, until the owner loads it again', async () => {
    harness = await startTestCore();
    const dir2 = mkdtempSync(join(tmpdir(), 'boite-plugins-v2-'));
    const asPlugin = { client: { name: 'plugin', version: '0' } };
    try {
      const owner = await harness.connect();
      const dir = devPlugin(dir2);
      await owner.call('plugins.dev', { path: dir });
      const { threadId } = await echoThread(harness, owner);
      const agent = await connect(harness.url, harness.core.agents.tokenFor(threadId));
      const work = join(dir2, 'work'); mkdirSync(work);
      const run = () => agent.call('plugins.command', { threadId, name: 'hello-threads', args: [], cwd: work });
      expect(JSON.parse((await run()).stdout).todos).toContain('needs the plugin permission todos');
      const approved = harness.core.plugins.tokens.tokenFor('hello', ['threads.read']);
      const open = await connect(harness.url, approved, asPlugin);

      // Someone who can write the folder, an agent say, widens the permissions: nothing runs with them.
      const file = join(dir, 'boite-plugin.json');
      const manifest = JSON.parse(readFileSync(file, 'utf8'));
      writeFileSync(file, JSON.stringify({ ...manifest, permissions: ['threads.read', 'todos'] }));
      expect(await thrown(run())).toThrow();
      expect((await owner.call('plugins.list', {})).find((row) => row.id === 'hello')).toMatchObject({
        status: 'error', error: expect.stringContaining('changed its permissions from [threads.read] to [threads.read, todos.read, todos.write] since boite plugin dev loaded it'),
      });
      expect(await thrown(open.call('threads.list', {}))).toThrow('the client is closed');

      // The owner's reload approves the new list.
      await owner.call('plugins.dev', { path: dir });
      expect(JSON.parse((await run()).stdout).todos).not.toContain('needs the plugin permission');
      agent.close();
    } finally {
      await harness?.stop();
      await removeDir(dir2);
    }
  }, 30_000);

  test('a schema 1 dev folder that adds a desktop app waits for the owner, so the app never gets the owner token unasked', async () => {
    harness = await startTestCore();
    const dir2 = mkdtempSync(join(tmpdir(), 'boite-plugins-v2-'));
    try {
      const owner = await harness.connect();
      const dir = join(dir2, 'pool'); mkdirSync(dir);
      const file = join(dir, 'boite-plugin.json');
      const manifest = { schema: 1, id: 'pool', name: 'Pool', version: '0.1.0', description: 'Switches logins.', homepage: 'https://example.com/pool',
        executable: 'pool', provides: { accountPools: { providers: ['opencode'] } } };
      writeFileSync(file, JSON.stringify(manifest));
      writeFileSync(join(dir, process.platform === 'win32' ? 'pool.exe' : 'pool'), '');
      await owner.call('plugins.dev', { path: dir });
      writeFileSync(file, JSON.stringify({ ...manifest, provides: { ...manifest.provides, desktopApp: {} } }));
      expect((await owner.call('plugins.list', {})).find((row) => row.id === 'pool')).toMatchObject({
        status: 'error', error: expect.stringContaining('changed what Boite starts for it from [opencode pool] to [desktop app, opencode pool]'),
      });
    } finally {
      await harness?.stop();
      await removeDir(dir2);
    }
  }, 30_000);

  test('two loads naming one command: the second is refused, even after a refused reload, and a dropped gateway stops', async () => {
    harness = await startTestCore();
    const dir2 = mkdtempSync(join(tmpdir(), 'boite-plugins-v2-'));
    try {
      const a = devPlugin(join(dir2, 'a'));
      const b = devPlugin(join(dir2, 'b'));
      const manifest = JSON.parse(readFileSync(join(b, 'boite-plugin.json'), 'utf8'));
      writeFileSync(join(b, 'boite-plugin.json'), JSON.stringify({ ...manifest, id: 'other', provides: { commands: manifest.provides.commands } }));
      const plugins = harness.core.plugins;
      const [command] = manifest.provides.commands;
      const renamed = (dir: string, id: string) => writeFileSync(join(dir, 'boite-plugin.json'), JSON.stringify({ ...manifest, id, provides: { commands: [{ ...command, name: 'zzz' }] } }));
      const a2 = devPlugin(join(dir2, 'a2'));
      renamed(a2, 'hello');
      const d = devPlugin(join(dir2, 'd'));
      renamed(d, 'third');
      // While a load runs, a reload of the same id the lane refuses leaves that load's claim in place,
      const first = plugins.dev({ path: a });
      expect(messageOf((await rejection(plugins.dev({ path: a2 }))).reason)).toContain('Wait for the current plugin operation');
      expect(messageOf((await rejection(plugins.dev({ path: b }))).reason)).toContain('hello has hello-threads');
      await first;
      // and takes nothing with it: the name it asked for stays free.
      await plugins.dev({ path: d });
      expect(plugins.installedPlugins().map((plugin) => plugin.id).sort()).toEqual(['hello', 'third']);

      // A reload that adds a gateway starts it; one whose manifest drops it stops it.
      const calls: string[] = [];
      const forget = plugins.gateways.forget.bind(plugins.gateways);
      plugins.gateways.control = async (id, _dir, action) => { calls.push(`${action} ${id}`); };
      plugins.gateways.forget = (id) => { calls.push(`forget ${id}`); return forget(id); };
      const plain = readFileSync(join(a, 'boite-plugin.json'), 'utf8');
      writeFileSync(join(a, 'boite-plugin.json'), JSON.stringify({ ...JSON.parse(plain), provides: { ...JSON.parse(plain).provides, gateway: {} } }));
      await plugins.dev({ path: a });
      writeFileSync(join(a, 'boite-plugin.json'), plain);
      await plugins.dev({ path: a });
      expect(calls).toEqual(['restart hello', 'forget hello']);
    } finally {
      await harness?.stop();
      await removeDir(dir2);
    }
  }, 30_000);

  test('a schema 2 account pool runs with the plugin\'s environment, never an agent\'s', async () => {
    harness = await startTestCore();
    const dir = mkdtempSync(join(tmpdir(), 'boite-plugins-v2-'));
    process.env['BOITE_AGENT_TOKEN'] = 'leaked-agent-token';
    try {
      writeFileSync(join(dir, 'boite-plugin.json'), JSON.stringify({
        schema: 2, id: 'pool', name: 'Pool', version: '0.1.0', description: 'd', homepage: 'https://example.com/pool',
        runtime: 'bun', executable: 'pool', provides: { accountPools: { providers: ['codex'] } },
      }));
      writeFileSync(join(dir, 'pool.js'), `const env = process.env;
console.log(JSON.stringify({ accounts: [{ email: [env.BOITE_PLUGIN_ID, env.BOITE_AGENT_TOKEN ?? 'none', String(env.BOITE_TOKEN?.startsWith('plg_'))].join('|') }] }));`);
      const owner = await harness.connect();
      await owner.call('plugins.dev', { path: dir });
      const pools = await owner.call('plugins.accounts', { id: 'pool' });
      expect(pools[0]?.accounts[0]?.email).toBe('pool|none|true');
    } finally {
      delete process.env['BOITE_AGENT_TOKEN'];
      await harness?.stop();
      await removeDir(dir);
    }
  }, 30_000);

  test('a text-only plugin installs from its manifest alone', async () => {
    harness = await startTestCore();
    try {
      const sha = createHash('sha256').update('').digest('hex');
      expect(sha).toHaveLength(64);
      harness.core.plugins.recommended = [parseManifest({ schema: 2, id: 'notes', name: 'Notes', version: '1.0.0', description: 'd', homepage: 'https://example.com',
        provides: { prompt: 'Prefer short answers.' } }, 'f')];
      const owner = await harness.connect();
      await owner.call('plugins.install', { id: 'notes' });
      for (let i = 0; i < 100 && harness.core.plugins.state('notes').status !== 'installed'; i += 1) await Bun.sleep(20);
      expect(harness.core.plugins.state('notes')).toMatchObject({ status: 'installed', version: '1.0.0', artifact: null, adds: { prompt: true } });
      expect(pluginGuideLines(harness.core.plugins.installedPlugins())).toEqual(['From the Notes plugin: Prefer short answers.']);
    } finally {
      await harness?.stop();
    }
  });

  test('an agent\'s plugin add puts a preview card in its thread and fetches nothing', async () => {
    harness = await startTestCore();
    try {
      const owner = await harness.connect();
      const { threadId } = await echoThread(harness, owner);
      await owner.call('turns.start', { threadId, prompt: 'hello' });
      await waitFor(() => !['queued', 'running', 'waiting'].includes(harness!.core.threads.require(threadId).status));
      const agent = { [AGENT_ENV.threadId]: threadId, [AGENT_ENV.coreUrl]: harness.url, [AGENT_ENV.token]: harness.core.agents.tokenFor(threadId) };
      let out = ''; let err = '';
      const io = { cwd: root, out: (text: string) => { out += text; }, err: (text: string) => { err += text; }, env: agent };
      const inspected: unknown[] = [];
      const inspect = harness.core.plugins.inspect.bind(harness.core.plugins);
      harness.core.plugins.inspect = (params) => { inspected.push(params); return inspect(params); };
      const code = await runCli(['plugin', 'add', 'https://github.com/example/standup/releases/tag/v1.2.0', '--why', 'Adds a standup command'], io);
      expect({ code, err }).toEqual({ code: 0, err: '' });
      expect(out).toContain('card: Preview opens Settings > Plugins with https://github.com/example/standup at v1.2.0 read');
      const [card] = await owner.call('questions.list', { threadId });
      expect(card).toMatchObject({ text: 'Adds a standup command', setting: { kind: 'open', page: 'plugins', plugin: { url: 'https://github.com/example/standup', ref: 'v1.2.0' } } });
      expect(inspected).toEqual([]);

      // No reason, or an http source: refused before any card.
      expect(await runCli(['plugin', 'add', 'example/standup'], { ...io, err() {} })).toBe(2);
      err = '';
      expect(await runCli(['plugin', 'add', 'http://example.com/standup', '--why', 'x'], io)).not.toBe(0);
      expect(err).toContain('plugin url must be an https URL');
      expect((await owner.call('questions.list', { threadId })).length).toBe(1);
    } finally {
      await harness?.stop();
    }
  });
});

describe('threads.archive through the threads.write permission', () => {
  let harness: TestCore | undefined;

  test('archives an idle unpinned thread as done in the plugin\'s name, and nothing else', async () => {
    harness = await startTestCore();
    const asPlugin = { client: { name: 'plugin', version: '0' } };
    try {
      const owner = await harness.connect();
      const idle = await echoThread(harness, owner, 'idle');
      const running = await echoThread(harness, owner, 'running');
      const pinned = await echoThread(harness, owner, 'pinned');
      await owner.call('threads.pin', { threadId: pinned.threadId });

      // Without the permission the method stays closed.
      const reader = await connect(harness.url, harness.core.plugins.tokens.tokenFor('reader', ['threads.read']), asPlugin);
      expect(await thrown(reader.call('threads.archive', { threadId: idle.threadId })))
        .toThrow('threads.archive needs the plugin permission threads.write, which the owner did not grant (granted: threads.read)');

      const plugin = await connect(harness.url, harness.core.plugins.tokens.tokenFor('archiver', ['threads.write']), asPlugin);
      // A running thread is refused even when the plugin leaves onlyIfIdle out.
      await owner.call('turns.start', { threadId: running.threadId, prompt: '[sleep:60000] running' });
      await waitFor(() => harness!.core.threads.require(running.threadId).status === 'running');
      expect(await thrown(plugin.call('threads.archive', { threadId: running.threadId, onlyIfIdle: false })))
        .toThrow('a turn is still running; expected an idle conversation family');
      expect(harness.core.threads.require(running.threadId).archived).toBe(false);
      // A pinned thread is refused, naming the field.
      const pinRefusal = await rejection(plugin.call('threads.archive', { threadId: pinned.threadId }));
      expect(messageOf(pinRefusal.reason)).toStartWith('pinned:');
      expect(pinRefusal.reason).toMatchObject({ rpc: { data: { field: 'pinned', expected: false } } });
      expect(harness.core.threads.require(pinned.threadId).archived).toBe(false);

      // An idle thread is marked done, and its row says which plugin did it.
      const archived = await plugin.call('threads.archive', { threadId: idle.threadId });
      expect(archived.archived).toBe(true);
      expect(archived.doneAt).toBeTypeOf('number');
      expect(archived.archiveReason).toMatchObject({ type: 'plugin', pluginId: 'archiver', pluginName: 'archiver' });
      expect((await owner.call('threads.get', { threadId: idle.threadId })).archiveReason).toMatchObject({ type: 'plugin', pluginId: 'archiver' });

      // A thread the owner put away stays the owner's: answered unchanged, no record.
      const byOwner = await echoThread(harness, owner, 'by owner');
      await owner.call('threads.archive', { threadId: byOwner.threadId });
      const again = await plugin.call('threads.archive', { threadId: byOwner.threadId });
      expect(again.archived).toBe(true);
      expect(again.doneAt ?? null).toBeNull();
      expect(again.archiveReason).toBeUndefined();

      // Restoring stays the owner's; the owner's restore drops the plugin's record.
      expect(await thrown(plugin.call('threads.archive', { threadId: idle.threadId, archived: false })))
        .toThrow('threads.archive: a plugin only archives');
      expect(harness.core.threads.require(idle.threadId).archived).toBe(true);
      const restored = await owner.call('threads.archive', { threadId: idle.threadId, archived: false });
      expect(restored.archived).toBe(false);
      expect(restored.archiveReason).toBeUndefined();
      await owner.call('turns.stop', { threadId: running.threadId });
    } finally {
      await harness?.stop();
    }
  }, 30_000);
});
