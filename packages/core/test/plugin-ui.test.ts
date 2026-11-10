import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { DEVICE_EVENTS, DEVICE_METHODS, PLUGIN_MANIFEST_FILE, PLUGIN_PERMISSIONS, PLUGIN_UI_LIMITS } from '@boite/contracts';
import { ManifestRefused, parseManifest, platformKey } from '../src/plugins/manifest.ts';
import { removeDir, startTestCore, waitFor, type TestCore } from './harness.ts';
import { thrown } from './settle.ts';

let harness: TestCore | undefined;
let fetchSpy: { mockRestore(): void } | undefined;
afterEach(async () => {
  fetchSpy?.mockRestore(); fetchSpy = undefined;
  await harness?.stop(); harness = undefined;
});

const FIXTURE_GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'boite test', GIT_AUTHOR_EMAIL: 'test@boite.invalid',
  GIT_COMMITTER_NAME: 'boite test', GIT_COMMITTER_EMAIL: 'test@boite.invalid',
};
function git(cwd: string, ...args: string[]): string {
  const run = Bun.spawnSync({ cmd: ['git', ...args], cwd, env: FIXTURE_GIT_ENV, stdout: 'pipe', stderr: 'pipe', windowsHide: true });
  if (!run.success) throw new Error(`git ${args.join(' ')} failed: ${run.stderr.toString()}`);
  return run.stdout.toString().trim();
}
const sha256 = (text: string | Uint8Array): string => createHash('sha256').update(text).digest('hex');

/** A schema 2 plugin that only brings an interface. */
function uiPlugin(overrides: Record<string, unknown> = {}, ui: Record<string, unknown> = { script: 'ui/index.js', style: 'ui/style.css' }): Record<string, unknown> {
  return {
    schema: 2, id: 'panel', name: 'Panel', version: '1.0.0', description: 'Adds a panel tab.', homepage: 'https://example.com/panel',
    permissions: ['ui'], provides: { ui }, ...overrides,
  };
}

function refusedField(raw: unknown): string {
  try { parseManifest(raw, PLUGIN_MANIFEST_FILE); } catch (error) {
    if (error instanceof ManifestRefused) return error.rejected.field;
    throw error;
  }
  throw new Error('the manifest was accepted');
}

/** A plugin repository with one commit holding the manifest and `files`. */
function repository(content: Record<string, unknown>, files: Record<string, string>): { path: string; commit: string } {
  const path = join(harness!.dataDir, 'repos', String(content['id']));
  mkdirSync(path, { recursive: true });
  git(path, 'init', '-q');
  return { path, commit: commitFiles(path, { [PLUGIN_MANIFEST_FILE]: JSON.stringify(content, null, 2), ...files }) };
}
function commitFiles(path: string, files: Record<string, string>): string {
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(path, name, '..'), { recursive: true });
    writeFileSync(join(path, name), text);
  }
  git(path, 'add', '-A');
  git(path, 'commit', '-q', '-m', 'plugin');
  return git(path, 'rev-parse', 'HEAD');
}

describe('provides.ui in the manifest', () => {
  test('an interface alone runs no executable, needs the ui permission and names files inside the repository', () => {
    const manifest = parseManifest(uiPlugin(), PLUGIN_MANIFEST_FILE);
    expect(manifest.provides.ui).toEqual({ script: 'ui/index.js', style: 'ui/style.css' });
    expect(manifest.executable).toBeUndefined();
    expect(parseManifest(uiPlugin({}, { style: 'theme.css' }), PLUGIN_MANIFEST_FILE).provides.ui).toEqual({ style: 'theme.css' });
    // The token gains nothing from it: the code runs in the app, not as the plugin's process.
    expect(PLUGIN_PERMISSIONS.ui).toEqual({ methods: [], events: [] });

    expect(refusedField(uiPlugin({ permissions: [] }))).toBe('permissions');
    expect(refusedField(uiPlugin({ permissions: undefined }))).toBe('permissions');
    expect(refusedField(uiPlugin({}, {}))).toBe('provides.ui');
    expect(refusedField(uiPlugin({}, { script: 'ui/index.js', extra: 'x' }))).toBe('provides.ui.extra');
    for (const script of ['../index.js', 'ui/../../index.js', '/etc/index.js', './index.js', 'ui//index.js', 'ui/index.ts', 'ui\\index.js', 7]) {
      expect(refusedField(uiPlugin({}, { script }))).toBe('provides.ui.script');
    }
    expect(refusedField(uiPlugin({}, { style: 'ui/style.js' }))).toBe('provides.ui.style');
    // An interface runs no executable: it cannot bring one along on its own.
    expect(refusedField(uiPlugin({ runtime: 'bun', executable: 'panel' }))).toBe('executable');
  });

  test('ui is the only permission a client draws as dangerous, and a paired device reads the interfaces', () => {
    expect(DEVICE_METHODS.has('plugins.ui')).toBe(true);
    expect(DEVICE_EVENTS.has('plugins.uiUpdated')).toBe(true);
    // Installing one stays the owner's.
    expect(DEVICE_METHODS.has('plugins.add')).toBe(false);
  });
});

describe('a plugin interface from a git URL', () => {
  const GIT_URL_TEST_MS = 90_000;

  test('the files are read at the previewed commit, served by plugins.ui, replaced by an update and gone with the plugin', async () => {
    harness = await startTestCore();
    harness.core.plugins.allowLocalSources = true;
    const client = await harness.connect();
    const announced: string[] = [];
    client.on('plugins.uiUpdated', (event) => { announced.push(event.digest); });
    expect(await client.call('plugins.ui', {})).toEqual([]);

    const repo = repository(uiPlugin(), { 'ui/index.js': 'export default (boite) => boite.ui.addButton({});\n', 'ui/style.css': '.x { color: red; }\n' });
    const preview = await client.call('plugins.inspect', { url: repo.path });
    expect(preview.rejected).toBeNull();
    expect(preview.artifact).toBeNull();
    // A commit after the preview changes nothing: the install brings what the owner read.
    commitFiles(repo.path, { 'ui/index.js': 'export default () => { throw new Error("later"); };\n' });
    await client.call('plugins.add', { previewId: preview.previewId! });
    await waitFor(() => harness!.core.plugins.state('panel').status === 'installed');
    expect(harness.core.plugins.state('panel').adds?.ui).toBe(true);

    const [bundle, ...rest] = await client.call('plugins.ui', {});
    expect(rest).toEqual([]);
    expect(bundle).toMatchObject({ id: 'panel', name: 'Panel', version: '1.0.0', permissions: ['ui'], settings: {}, error: null,
      script: 'export default (boite) => boite.ui.addButton({});\n', style: '.x { color: red; }\n' });
    const dir = join(harness.dataDir, 'plugins', 'panel');
    const record = JSON.parse(readFileSync(join(dir, 'installed.json'), 'utf8')) as { ui: { script: string; style: string } };
    expect(record.ui).toEqual({ script: sha256(bundle!.script!), style: sha256(bundle!.style!) });
    expect(readdirSync(join(dir, 'ui')).sort()).toEqual([`${record.ui.script}.js`, `${record.ui.style}.css`].sort());
    await waitFor(() => announced.length > 0);

    // A file altered on disk is not loaded: the bundle says why, with no code.
    writeFileSync(join(dir, 'ui', `${record.ui.script}.js`), 'alert(1)');
    const [altered] = await client.call('plugins.ui', {});
    expect(altered).toMatchObject({ script: null, style: null, error: expect.stringContaining('Reinstall panel') });

    // Reinstalling from the record reads the files again at the recorded commit, not the branch's newer one.
    await client.call('plugins.install', { id: 'panel' });
    await waitFor(() => harness!.core.plugins.state('panel').status === 'installed');
    expect((await client.call('plugins.ui', {}))[0]).toMatchObject({ error: null, script: bundle!.script });

    // An update brings the new files; the old ones go once the new record commits.
    const before = announced.length;
    commitFiles(repo.path, { [PLUGIN_MANIFEST_FILE]: JSON.stringify(uiPlugin({ version: '1.1.0' }, { script: 'ui/index.js' })), 'ui/index.js': 'export default () => {};\n' });
    const update = await client.call('plugins.inspect', { url: repo.path });
    expect(update.replaces).toBe('1.0.0');
    await client.call('plugins.add', { previewId: update.previewId! });
    await waitFor(() => harness!.core.plugins.state('panel').version === '1.1.0');
    const [updated] = await client.call('plugins.ui', {});
    expect(updated).toMatchObject({ version: '1.1.0', script: 'export default () => {};\n', style: null, error: null });
    expect(updated!.digest).not.toBe(bundle!.digest);
    expect(readdirSync(join(dir, 'ui'))).toEqual([`${sha256(updated!.script!)}.js`]);
    await waitFor(() => announced.length > before);

    const removed = announced.length;
    await client.call('plugins.uninstall', { id: 'panel' });
    expect(await client.call('plugins.ui', {})).toEqual([]);
    expect(existsSync(dir)).toBe(false);
    await waitFor(() => announced.length > removed);
  }, GIT_URL_TEST_MS);

  test('a missing or oversized file is refused at the preview, naming its field', async () => {
    harness = await startTestCore();
    harness.core.plugins.allowLocalSources = true;
    const client = await harness.connect();
    const missing = repository(uiPlugin(), { 'ui/style.css': 'a {}' });
    const preview = await client.call('plugins.inspect', { url: missing.path });
    expect(preview.previewId).toBeNull();
    expect(preview.rejected).toMatchObject({ field: 'provides.ui.script', message: expect.stringContaining('found "no file at ui/index.js"') });

    const large = repository(uiPlugin({ id: 'large' }, { style: 'big.css' }), { 'big.css': 'a'.repeat(PLUGIN_UI_LIMITS.style + 1) });
    const big = await client.call('plugins.inspect', { url: large.path });
    expect(big.rejected).toMatchObject({ field: 'provides.ui.style', message: expect.stringContaining(`found "${PLUGIN_UI_LIMITS.style + 1} bytes at big.css"`) });
    expect(readdirSync(join(harness.dataDir, 'plugins'))).toEqual([]);
  }, GIT_URL_TEST_MS);

  test('a plugin that downloads a program writes its interface beside it, in the same install', async () => {
    harness = await startTestCore();
    harness.core.plugins.allowLocalSources = true;
    const client = await harness.connect();
    const program = new TextEncoder().encode('console.log("hi")');
    const url = 'https://plugins.example.invalid/hello.js';
    fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (input: string | URL | Request) => {
      const asked = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      return asked === url ? new Response(program, { headers: { 'content-length': String(program.length) } }) : new Response('no', { status: 404 });
    }) as typeof fetch);
    const repo = repository(uiPlugin({
      id: 'hello', runtime: 'bun', executable: 'hello', permissions: ['threads.read', 'ui'],
      artifacts: { any: { url, sha256: sha256(program) } },
      provides: { commands: [{ name: 'hello-threads', description: 'Lists threads.' }], ui: { script: 'ui/index.js' } },
    }), { 'ui/index.js': 'export default () => {};\n' });
    const preview = await client.call('plugins.inspect', { url: repo.path });
    expect(preview.rejected).toBeNull();
    expect(preview.artifact?.url).toBe(url);
    await client.call('plugins.add', { previewId: preview.previewId! });
    await waitFor(() => harness!.core.plugins.state('hello').status !== 'installing');
    expect(harness.core.plugins.state('hello')).toMatchObject({ status: 'installed', error: null });
    expect(await client.call('plugins.ui', {})).toMatchObject([{ id: 'hello', script: 'export default () => {};\n', permissions: ['threads.read', 'ui'] }]);
    expect(platformKey()).toBeTruthy();
  }, GIT_URL_TEST_MS);

  test('a recommended entry cannot bring an interface: it ships no files', async () => {
    harness = await startTestCore();
    harness.core.plugins.recommended = [parseManifest(uiPlugin({ id: 'listed' }), 'recommended.json[0]')];
    const client = await harness.connect();
    await client.call('plugins.install', { id: 'listed' });
    await waitFor(() => harness!.core.plugins.state('listed').status !== 'installing');
    expect(harness.core.plugins.state('listed')).toMatchObject({ status: 'error', version: null, error: expect.stringContaining('provides an interface') });
    expect(await client.call('plugins.ui', {})).toEqual([]);
  });
});

describe('a dev plugin interface', () => {
  test('is read from its folder on every request, and a missing file refuses the load', async () => {
    const root = mkdtempSync(join(tmpdir(), 'boite-plugin-ui-'));
    try {
      harness = await startTestCore();
      const client = await harness.connect();
      const folder = join(root, 'panel');
      mkdirSync(join(folder, 'ui'), { recursive: true });
      writeFileSync(join(folder, PLUGIN_MANIFEST_FILE), JSON.stringify(uiPlugin({}, { script: 'ui/index.js' })));
      expect(await thrown(client.call('plugins.dev', { path: folder }))).toThrow('ui/index.js is missing');

      writeFileSync(join(folder, 'ui', 'index.js'), 'export default () => 1;\n');
      await client.call('plugins.dev', { path: folder });
      const [first] = await client.call('plugins.ui', {});
      expect(first).toMatchObject({ id: 'panel', script: 'export default () => 1;\n', error: null });

      writeFileSync(join(folder, 'ui', 'index.js'), 'export default () => 2;\n');
      const [second] = await client.call('plugins.ui', {});
      expect(second!.script).toBe('export default () => 2;\n');
      expect(second!.digest).not.toBe(first!.digest);

      // Deleted after the load: the bundle carries the reason, not stale code.
      await removeDir(join(folder, 'ui'));
      expect((await client.call('plugins.ui', {}))[0]).toMatchObject({ script: null, error: expect.stringContaining('is missing') });
      // Nothing of it is written under the data directory.
      expect(existsSync(join(harness.dataDir, 'plugins', 'panel', 'ui'))).toBe(false);
    } finally {
      await removeDir(root);
    }
  });
});

test('the example plugin passes the manifest reader and its interface files are within limits', async () => {
  const { readDevUi } = await import('../src/plugins/ui.ts');
  const dir = join(import.meta.dir, '..', '..', '..', 'examples', 'plugins', 'hello');
  const file = join(dir, PLUGIN_MANIFEST_FILE);
  const manifest = parseManifest(JSON.parse(readFileSync(file, 'utf8')), file);
  expect(manifest.permissions).toContain('ui');
  const texts = readDevUi(dir, manifest);
  expect(texts.script).toContain('export default');
  expect(texts.style?.length).toBeGreaterThan(0);
});
