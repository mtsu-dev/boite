import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { accessRefusal, mayHearEvent, type RpcEvents } from '@boite/contracts';
import { ManifestRefused, parseManifest } from '../src/plugins/manifest.ts';
import { connect } from '../src/client.ts';
import { removeDir, startTestCore, waitFor, type TestCore } from './harness.ts';
import { thrown } from './settle.ts';
import { expandSlashPrompt } from '../src/plugins/extensions.ts';

const SETTINGS = [
  { key: 'loud', type: 'switch', label: 'Loud', default: false },
  { key: 'times', type: 'number', label: 'Times', description: 'How many greetings.', default: 2, min: 1, max: 5 },
  { key: 'volume', type: 'slider', label: 'Volume', default: 40, min: 0, max: 100, step: 10 },
  { key: 'name', type: 'text', label: 'Name', default: '' },
  { key: 'tone', type: 'select', label: 'Tone', default: 'warm', options: [{ value: 'warm', label: 'Warm' }, { value: 'dry', label: 'Dry' }] },
];

function manifest(settings: unknown, schema = 2): Record<string, unknown> {
  return {
    schema, id: 'hello', name: 'Hello', version: '1.0.0', description: 'Says hello.', homepage: 'https://example.com/hello',
    provides: { prompt: 'Greet the user.' }, settings,
  };
}

/** The field a refusal names, with what it expected. */
function refused(settings: unknown, schema = 2): { field: string; expected: string } {
  try { parseManifest(manifest(settings, schema), 'boite-plugin.json'); } catch (error) {
    if (error instanceof ManifestRefused) return { field: error.rejected.field, expected: error.rejected.expected };
    throw error;
  }
  throw new Error('the manifest was accepted');
}

describe('manifest settings', () => {
  test('the five types read back as declared, in order', () => {
    expect(parseManifest(manifest(SETTINGS), 'f').settings).toEqual(SETTINGS as never);
  });

  test('each refusal names the field and what it expected', () => {
    const one = (patch: Record<string, unknown>) => [{ ...SETTINGS[1], ...patch }];
    expect(refused({})).toMatchObject({ field: 'settings' });
    expect(refused(Array.from({ length: 31 }, (_, i) => ({ ...SETTINGS[0], key: `k${i}` })))).toMatchObject({ field: 'settings' });
    expect(refused([{ ...SETTINGS[0], type: 'color' }])).toMatchObject({ field: 'settings[0].type', expected: 'one of switch, number, slider, text, select' });
    expect(refused([SETTINGS[0], { ...SETTINGS[3], key: 'loud' }])).toMatchObject({ field: 'settings[1].key', expected: 'a key no other setting takes' });
    expect(refused([{ ...SETTINGS[0], key: '1st' }])).toMatchObject({ field: 'settings[0].key' });
    expect(refused([{ ...SETTINGS[0], options: [] }])).toMatchObject({ field: 'settings[0].options' });
    expect(refused([{ ...SETTINGS[0], default: 'yes' }])).toMatchObject({ field: 'settings[0].default', expected: 'true or false' });
    expect(refused(one({ default: 9 }))).toMatchObject({ field: 'settings[0].default', expected: 'a number, at least 1, at most 5' });
    expect(refused(one({ max: 1 }))).toMatchObject({ field: 'settings[0].max', expected: 'a number above min (1)' });
    expect(refused(one({ step: 0 }))).toMatchObject({ field: 'settings[0].step', expected: 'a number above 0' });
    expect(refused([{ ...SETTINGS[2], max: undefined }])).toMatchObject({ field: 'settings[0].max', expected: 'a number (a slider needs min and max)' });
    expect(refused([{ ...SETTINGS[2], default: 45 }])).toMatchObject({ field: 'settings[0].default' });
    expect(refused([{ ...SETTINGS[4], default: 'cold' }])).toMatchObject({ field: 'settings[0].default', expected: 'one of warm, dry' });
    expect(refused([{ ...SETTINGS[4], options: [{ value: 'warm', label: 'A' }, { value: 'warm', label: 'B' }] }])).toMatchObject({ field: 'settings[0].options[1].value' });
    expect(refused([{ ...SETTINGS[3], label: 'x'.repeat(61) }])).toMatchObject({ field: 'settings[0].label' });
    expect(refused([{ ...SETTINGS[3], default: 'two\nlines' }])).toMatchObject({ field: 'settings[0].default' });
    // Schema 1 has no settings: a schema 2 field there is a newer manifest misread.
    expect(refused(SETTINGS, 1)).toMatchObject({ field: 'settings' });
  });
});

describe('the plugin principal and its settings', () => {
  test('reads and hears its own settings with no permission, never another plugin\'s, and sets nothing', () => {
    const caller = { principal: 'plugin' as const, sessionId: null, threadId: null, permissions: [], pluginId: 'hello' };
    expect(accessRefusal('plugins.settings.get', caller, { id: 'hello' })).toBeNull();
    expect(accessRefusal('plugins.settings.get', caller, { id: 'other' })?.message).toBe("plugins.settings.get reads only the calling plugin's own settings: id must be hello, not other");
    expect(accessRefusal('plugins.settings.set', caller, { id: 'hello', values: {} })?.message).toContain('is not open to plugins');
    expect(accessRefusal('plugins.setEnabled', caller, { id: 'hello', enabled: false })?.message).toContain('is not open to plugins');
    expect(mayHearEvent('plugin.settings.changed', 'plugin', [])).toBe(true);
    expect(mayHearEvent('plugins.updated', 'plugin', [])).toBe(false);
  });
});

/** A dev plugin of a slash command, a prompt and an agent command, declaring `SETTINGS`. */
function devPlugin(root: string, id = 'hello', command = 'hello-threads'): string {
  const dir = join(root, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'boite-plugin.json'), JSON.stringify({
    schema: 2, id, name: 'Hello', version: '0.1.0', description: 'Says hello.', homepage: 'https://example.com/hello',
    runtime: 'bun', executable: id, permissions: ['threads.read'], settings: SETTINGS,
    provides: {
      commands: [{ name: command, description: 'Lists recent threads.' }],
      prompt: 'Greet the user once.',
      slashCommands: [{ name: `${id}-review`, description: 'Review with a greeting', prompt: 'Say hello, then review' }],
    },
  }));
  writeFileSync(join(dir, `${id}.js`), 'console.log("hi");\n');
  return dir;
}

const asPlugin = { client: { name: 'plugin', version: '0' } };

describe('plugin settings and turning a plugin off, end to end', () => {
  let harness: TestCore | undefined;

  test('the owner sets declared values only; the plugin reads them and hears its own change', async () => {
    harness = await startTestCore();
    const root = mkdtempSync(join(tmpdir(), 'boite-plugin-settings-'));
    try {
      const owner = await harness.connect();
      await owner.call('plugins.dev', { path: devPlugin(root) });
      const listed = (await owner.call('plugins.list', {})).find((row) => row.id === 'hello')!;
      expect(listed.settings).toEqual(SETTINGS as never);
      expect(listed.settingValues).toEqual({ loud: false, times: 2, volume: 40, name: '', tone: 'warm' });

      const token = harness.core.plugins.tokens.tokenFor('hello', ['threads.read']);
      const plugin = await connect(harness.url, token, asPlugin);
      const heard: RpcEvents['plugin.settings.changed'][] = [];
      plugin.on('plugin.settings.changed', (payload) => heard.push(payload));
      expect(await plugin.call('plugins.settings.get', { id: 'hello' })).toEqual({ loud: false, times: 2, volume: 40, name: '', tone: 'warm' });
      expect(await thrown(plugin.call('plugins.settings.set', { id: 'hello', values: { loud: true } }))).toThrow('is not open to plugins');

      // A key not declared or a value out of range changes nothing, and says which.
      expect(await thrown(owner.call('plugins.settings.set', { id: 'hello', values: { loud: true, color: 'red' } }))).toThrow('hello declares no setting color; expected one of loud, times, volume, name, tone');
      expect(await thrown(owner.call('plugins.settings.set', { id: 'hello', values: { volume: 45 } }))).toThrow('hello setting volume must be a number, at least 0, at most 100, a multiple of 10 from 0, got 45');
      expect(await owner.call('plugins.settings.get', { id: 'hello' })).toMatchObject({ loud: false });

      // Another plugin's change is not this plugin's to hear.
      harness.core.bus.emit('plugin.settings.changed', { id: 'other', values: { secret: 'x' } });
      const state = await owner.call('plugins.settings.set', { id: 'hello', values: { loud: true, tone: 'dry' } });
      expect(state.settingValues).toEqual({ loud: true, times: 2, volume: 40, name: '', tone: 'dry' });
      await waitFor(() => heard.length > 0);
      expect(heard).toEqual([{ id: 'hello', values: { loud: true, times: 2, volume: 40, name: '', tone: 'dry' } }]);
      expect(await plugin.call('plugins.settings.get', { id: 'hello' })).toMatchObject({ loud: true, tone: 'dry' });
      plugin.close();

      // An uninstall takes the values with it.
      await owner.call('plugins.uninstall', { id: 'hello' });
      await owner.call('plugins.dev', { path: join(root, 'hello') });
      expect(await owner.call('plugins.settings.get', { id: 'hello' })).toMatchObject({ loud: false, tone: 'warm' });
    } finally {
      await harness?.stop();
      await removeDir(root);
    }
  }, 30_000);

  test('off stops what it runs, revokes its token and drops what it adds; on brings it all back', async () => {
    harness = await startTestCore();
    const root = mkdtempSync(join(tmpdir(), 'boite-plugin-settings-'));
    try {
      const owner = await harness.connect();
      const dir = devPlugin(root);
      await owner.call('plugins.dev', { path: dir });
      const plugins = harness.core.plugins;
      const killed: string[] = [];
      plugins.apps.kill = async (id) => { killed.push(`app ${id}`); };
      plugins.gateways.kill = async (id) => { killed.push(`gateway ${id}`); };
      const token = plugins.tokens.tokenFor('hello', ['threads.read']);
      const open = await connect(harness.url, token, asPlugin);

      const off = await owner.call('plugins.setEnabled', { id: 'hello', enabled: false });
      expect(off).toMatchObject({ id: 'hello', status: 'installed', enabled: false });
      expect(killed).toEqual(['app hello', 'gateway hello']);
      expect(await thrown(open.call('threads.list', {}))).toThrow('the client is closed');
      expect(await thrown(connect(harness.url, token, asPlugin))).toThrow();
      expect(plugins.installedPlugins()).toEqual([]);
      expect((await owner.call('brain.commands', {})).some((command) => command.name === 'hello-review')).toBe(false);
      expect(expandSlashPrompt(harness.core, '/hello-review the diff')).toBe('/hello-review the diff');
      expect(await thrown(owner.call('plugins.command', { name: 'hello-threads', args: [], cwd: root }))).toThrow('no installed plugin provides it');
      // Its names stay taken: turning it on again must not find them claimed.
      expect(await thrown(owner.call('plugins.dev', { path: devPlugin(join(root, 'b'), 'other', 'hello-threads') }))).toThrow('hello has hello-threads');
      // Off is remembered by the core, not by the client that asked.
      expect((await owner.call('plugins.list', {})).find((row) => row.id === 'hello')?.enabled).toBe(false);

      const on = await owner.call('plugins.setEnabled', { id: 'hello', enabled: true });
      expect(on.enabled).toBe(true);
      expect(plugins.installedPlugins().map((plugin) => plugin.id)).toEqual(['hello']);
      expect(expandSlashPrompt(harness.core, '/hello-review the diff')).toBe('Say hello, then review the diff');
    } finally {
      await harness?.stop();
      await removeDir(root);
    }
  }, 30_000);

  test('off kills a plugin command still running and waits for it to exit', async () => {
    harness = await startTestCore();
    const root = mkdtempSync(join(tmpdir(), 'boite-plugin-settings-'));
    try {
      const owner = await harness.connect();
      const dir = devPlugin(root);
      // Says it started, then runs until killed.
      writeFileSync(join(dir, 'hello.js'), 'require("node:fs").writeFileSync("started", ""); setInterval(() => {}, 1000);\n');
      await owner.call('plugins.dev', { path: dir });
      const run = owner.call('plugins.command', { name: 'hello-threads', args: [], cwd: root }).catch((error: Error) => error);
      await waitFor(() => existsSync(join(root, 'started')), 15_000);
      expect(harness.core.procs.liveCount('plugin:hello:cmd:1')).toBe(1);

      await owner.call('plugins.setEnabled', { id: 'hello', enabled: false });
      expect(harness.core.procs.liveCount('plugin:hello:cmd:1')).toBe(0);
      const result = await Promise.race([run, Bun.sleep(2_000).then(() => 'still running' as const)]);
      expect(result).not.toBe('still running');
      expect((result as { exitCode: number }).exitCode).not.toBe(0);
    } finally {
      await harness?.stop();
      await removeDir(root);
    }
  }, 30_000);

  test('turning off is the owner\'s, for an installed plugin only, and an uninstall forgets it', async () => {
    harness = await startTestCore();
    const root = mkdtempSync(join(tmpdir(), 'boite-plugin-settings-'));
    try {
      const owner = await harness.connect();
      expect(await thrown(owner.call('plugins.setEnabled', { id: 'nope', enabled: false }))).toThrow('unknown plugin nope');
      const dir = devPlugin(root);
      await owner.call('plugins.dev', { path: dir });
      expect(await thrown(owner.call('plugins.setEnabled', { id: 'hello', enabled: 'no' as never }))).toThrow('enabled must be true or false');
      await owner.call('plugins.setEnabled', { id: 'hello', enabled: false });
      await owner.call('plugins.uninstall', { id: 'hello' });
      await owner.call('plugins.dev', { path: dir });
      expect((await owner.call('plugins.list', {})).find((row) => row.id === 'hello')?.enabled).toBe(true);
    } finally {
      await harness?.stop();
      await removeDir(root);
    }
  }, 30_000);
});
