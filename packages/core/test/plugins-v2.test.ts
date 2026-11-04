import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
import { echoThread, removeDir, startTestCore, type TestCore } from './harness.ts';
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
    expect(accessRefusal('turns.start', caller)?.message).toBe('turns.start needs the plugin permission threads.write; the plugin declared threads.read');
    expect(accessRefusal('plugins.dev', caller)?.message).toContain('is not open to plugins');
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
      expect(report).toMatchObject({ args: ['hello-threads', '--json', 'two words', '--fail'], cwd: work, caller: threadId, plugin: 'hello', agentToken: null, ownerToken: false, threads: 1 });
      expect(report.todos).toBe('todos.list needs the plugin permission todos; the plugin declared threads.read');
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
      expect(await thrown(open.call('plugins.list', {}))).toThrow('plugins.list is not open to plugins');

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

      // A reload whose manifest no longer provides a gateway stops the one that ran.
      const forgotten: string[] = [];
      const forget = plugins.gateways.forget.bind(plugins.gateways);
      plugins.gateways.forget = (id) => { forgotten.push(id); return forget(id); };
      await plugins.dev({ path: a });
      expect(forgotten).toEqual(['hello']);
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
});
