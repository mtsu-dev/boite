/*
 * The manifest format, field by field. Every refusal names the file, the field
 * and what was expected, because that line is what a plugin author reads.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { ManifestRefused, POOL_PROVIDERS, commandsOf, parseManifest, parseManifestText } from '../src/plugins/manifest.ts';
import { checkRef, normalizeSourceUrl, readSource } from '../src/plugins/source.ts';
import { readPluginSource, sameRepository } from '@boite/contracts';
import { recommendedPlugins, recommendedUpdates } from '../src/plugins.ts';
import { startTestCore, type TestCore } from './harness.ts';

const SHA = 'a'.repeat(64);

function good(): Record<string, unknown> {
  return {
    schema: 1,
    id: 'seat-pool',
    name: 'Seat pool',
    version: '1.4.0',
    description: 'Switches OpenCode logins.',
    homepage: 'https://example.com/seat-pool',
    executable: 'seat-pool',
    artifacts: {
      'win32-x64': { url: 'https://example.com/seat-pool-1.4.0-win32-x64.exe', sha256: SHA },
      'linux-x64': { url: 'https://example.com/seat-pool-1.4.0-linux-x64', sha256: SHA },
    },
    provides: { accountPools: { providers: ['opencode'] } },
  };
}

function refusalOf(raw: unknown): ManifestRefused {
  try {
    parseManifest(raw, 'boite-plugin.json');
  } catch (error) {
    if (error instanceof ManifestRefused) return error;
    throw error;
  }
  throw new Error('the manifest was accepted');
}

function edited(edit: (raw: Record<string, unknown>) => void): Record<string, unknown> {
  const raw = good();
  edit(raw);
  return raw;
}

describe('the plugin manifest', () => {
  test('a good manifest reads back as itself, with the commands Boite may run', () => {
    const manifest = parseManifest(good(), 'boite-plugin.json');
    expect(manifest).toEqual(good() as unknown as typeof manifest);
    expect(commandsOf(manifest)).toEqual([
      'seat-pool list -<pool> -Json',
      'seat-pool list -<pool> -Json -Refresh',
      'seat-pool add -<pool>',
      'seat-pool switch -<pool> -Email <email> -Yes',
      'seat-pool remove -<pool> -Email <email> -Yes',
    ]);
  });

  test('a desktop app reads alone or beside account pools, and the preview says what it is handed', () => {
    const alone = parseManifest(edited((raw) => { raw['id'] = 'bots'; raw['executable'] = 'bots'; raw['provides'] = { desktopApp: {} }; }), 'boite-plugin.json');
    expect(alone.provides).toEqual({ desktopApp: {} });
    expect(commandsOf(alone)).toEqual(['bots', 'environment: BOITE_CORE_URL=<this core> BOITE_TOKEN=<the owner token> BOITE_PLUGIN_ID=bots']);
    const both = parseManifest(edited((raw) => { raw['provides'] = { accountPools: { providers: ['opencode'] }, desktopApp: {} }; }), 'boite-plugin.json');
    expect(both.provides).toEqual({ accountPools: { providers: ['opencode'] }, desktopApp: {} });
    expect(commandsOf(both)).toHaveLength(7);
    expect(commandsOf(both)[0]).toBe('seat-pool');
  });

  const cases: [string, (raw: Record<string, unknown>) => void, string, string][] = [
    ['an unknown top-level field', (raw) => { raw['scripts'] = { postinstall: 'curl' }; }, 'scripts', 'one of schema, id, name'],
    ['another schema', (raw) => { raw['schema'] = 3; }, 'schema', '1 or 2'],
    ['an id with a path in it', (raw) => { raw['id'] = '../escape'; }, 'id', 'lowercase letters'],
    ['an id in capitals', (raw) => { raw['id'] = 'Seat'; }, 'id', 'lowercase letters'],
    ['an empty name', (raw) => { raw['name'] = ' '; }, 'name', 'a string of 1 to 60'],
    ['a name with a newline', (raw) => { raw['name'] = 'Seat\npool'; }, 'name', 'no control characters'],
    ['a version that is not one', (raw) => { raw['version'] = 'latest'; }, 'version', 'a version such as 1.2.0'],
    ['a long description', (raw) => { raw['description'] = 'x'.repeat(301); }, 'description', 'a string of 1 to 300'],
    ['an http homepage', (raw) => { raw['homepage'] = 'http://example.com'; }, 'homepage', 'an https URL'],
    ['an executable with a path', (raw) => { raw['executable'] = '../bin/sh'; }, 'executable', 'a file name'],
    ['an executable with its extension', (raw) => { raw['executable'] = 'seat.exe'; }, 'executable', 'no extension'],
    ['no artifacts', (raw) => { raw['artifacts'] = {}; }, 'artifacts', 'at least one of win32-x64'],
    ['an unknown platform', (raw) => { (raw['artifacts'] as Record<string, unknown>)['freebsd-x64'] = { url: 'https://example.com/a', sha256: SHA }; }, 'artifacts.freebsd-x64', 'one of win32-x64'],
    ['an artifact over http', (raw) => { (raw['artifacts'] as Record<string, unknown>)['linux-x64'] = { url: 'http://example.com/a', sha256: SHA }; }, 'artifacts.linux-x64.url', 'an https URL'],
    ['an artifact carrying a password', (raw) => { (raw['artifacts'] as Record<string, unknown>)['linux-x64'] = { url: 'https://user:pass@example.com/a', sha256: SHA }; }, 'artifacts.linux-x64.url', 'no credentials'],
    ['an uppercase digest', (raw) => { (raw['artifacts'] as Record<string, unknown>)['linux-x64'] = { url: 'https://example.com/a', sha256: SHA.toUpperCase() }; }, 'artifacts.linux-x64.sha256', '64 lowercase hexadecimal'],
    ['an artifact with a script', (raw) => { (raw['artifacts'] as Record<string, unknown>)['linux-x64'] = { url: 'https://example.com/a', sha256: SHA, run: 'sh' }; }, 'artifacts.linux-x64.run', 'one of url, sha256'],
    ['nothing provided', (raw) => { raw['provides'] = {}; }, 'provides', 'at least one of accountPools'],
    ['an unknown feature', (raw) => { raw['provides'] = { hooks: {} }; }, 'provides.hooks', 'one of accountPools'],
    ['an empty pool list', (raw) => { raw['provides'] = { accountPools: { providers: [] } }; }, 'provides.accountPools.providers', 'a non-empty array'],
    ['an unknown provider', (raw) => { raw['provides'] = { accountPools: { providers: ['opencode', 'echo'] } }; }, 'provides.accountPools.providers[1]', 'among antigravity'],
    ['a provider twice', (raw) => { raw['provides'] = { accountPools: { providers: ['pi', 'pi'] } }; }, 'provides.accountPools.providers[1]', 'distinct'],
    ['a desktop app that is not an object', (raw) => { raw['provides'] = { desktopApp: true }; }, 'provides.desktopApp', 'an empty object'],
    ['a desktop app with a field', (raw) => { raw['provides'] = { desktopApp: { args: ['--debug'] } }; }, 'provides.desktopApp.args', 'desktopApp takes no fields'],
  ];
  for (const [label, edit, field, expected] of cases) {
    test(`refuses ${label}, naming ${field}`, () => {
      const refused = refusalOf(edited(edit));
      expect(refused.rejected.file).toBe('boite-plugin.json');
      expect(refused.rejected.field).toBe(field);
      expect(refused.rejected.expected).toContain(expected);
      expect(refused.message).toStartWith(`boite-plugin.json: ${field} must be `);
    });
  }

  test('refuses a file that is not JSON, and one that is not an object', () => {
    expect(() => parseManifestText('{"schema":', 'boite-plugin.json')).toThrow('boite-plugin.json: (file) must be valid JSON');
    expect(refusalOf([good()]).rejected.field).toBe('(root)');
  });

  test('refuses a file past its size, from a dev folder too: 256 KB, and 64 KB for schema 1', () => {
    const padded = (bytes: number) => JSON.stringify(good()).replace('"schema"', `${' '.repeat(bytes)}"schema"`);
    expect(() => parseManifestText(padded(256 * 1024), 'boite-plugin.json', true)).toThrow('(file) must be at most 262144 bytes');
    expect(() => parseManifestText(padded(64 * 1024), 'boite-plugin.json')).toThrow('(file) must be at most 65536 bytes for schema 1');
    expect(parseManifestText(padded(1024), 'boite-plugin.json').id).toBe('seat-pool');
  });

  test('places the fields of a manifest wrapped in installed.json', () => {
    try {
      parseManifest({ ...good(), schema: 0 }, 'installed.json', 'manifest.');
      throw new Error('accepted');
    } catch (error) {
      expect((error as ManifestRefused).rejected.field).toBe('manifest.schema');
    }
  });
});

describe('the recommended list', () => {
  test('is Bots, then Douane', () => {
    expect(recommendedPlugins().map((manifest) => manifest.id)).toEqual(['bots', 'douane']);
  });

  test('Bots is a desktop app, from its v0.1.16 release assets and digests', () => {
    const bots = recommendedPlugins().find((manifest) => manifest.id === 'bots')!;
    const artifacts = bots.artifacts!;
    expect(bots.version).toBe('0.1.16');
    expect(bots.executable).toBe('bots');
    expect(bots.provides).toEqual({ desktopApp: {} });
    expect(artifacts['win32-x64']).toEqual({
      url: 'https://github.com/Skollheim/bots/releases/download/v0.1.16/bots-x86_64-pc-windows-msvc.exe',
      sha256: '2d04730442c180197d289e839ce537000b5b50d03ea73f82340e21d11aecab35',
    });
    expect(artifacts['linux-arm64']?.sha256).toBe('66b3ed9dd2434eded78aff427d4c85936ef497ca54f0084b5aed766c443d17e9');
    expect(Object.keys(artifacts)).toHaveLength(6);
    for (const artifact of Object.values(artifacts)) expect(artifact?.url).toMatch(/^https:\/\/github\.com\/Skollheim\/bots\/releases\/download\/v0\.1\.16\/bots-/);
  });

  test('Bots and Douane find their newer releases on their own repositories', () => {
    expect(recommendedUpdates()).toEqual({
      bots: { url: 'https://github.com/Skollheim/bots', ref: 'main' },
      douane: { url: 'https://github.com/klNuno/douane', ref: 'main' },
    });
  });
});

describe('pool providers', () => {
  let harness: TestCore | undefined;
  afterEach(async () => { await harness?.stop(); harness = undefined; });

  test('are the shipped providers, echo aside', async () => {
    harness = await startTestCore();
    const shipped = harness.core.providers.list().loaded.map((provider) => provider.id).filter((id) => id !== 'echo');
    expect([...POOL_PROVIDERS].sort()).toEqual(shipped.sort());
  });
});

describe('a plugin source', () => {
  test('is an https repository URL, normalized', () => {
    expect(normalizeSourceUrl(' https://github.com/owner/repo/ ')).toBe('https://github.com/owner/repo');
    expect(normalizeSourceUrl('https://github.com/owner/repo.git')).toBe('https://github.com/owner/repo.git');
  });

  test('refuses every other transport, credentials, queries and local paths', () => {
    for (const url of ['http://github.com/owner/repo', 'git@github.com:owner/repo.git', 'ssh://git@github.com/owner/repo', 'file:///C:/repo', 'ext::sh -c touch% /tmp/pwned', 'git://github.com/owner/repo']) {
      expect(() => normalizeSourceUrl(url)).toThrow('plugin url must be an https URL');
    }
    expect(() => normalizeSourceUrl('https://token@github.com/owner/repo')).toThrow('carrying credentials');
    expect(() => normalizeSourceUrl('https://github.com/owner/repo?x=1')).toThrow('no query or fragment');
    expect(() => normalizeSourceUrl(process.cwd())).toThrow('plugin url must be an https URL');
    expect(() => normalizeSourceUrl('')).toThrow('plugin url must be');
  });

  test('reads a repository the way people share it, and the ref its page names', () => {
    const read = (url: string, ref?: string) => readSource(url, ref);
    const exact = (url: string, ref: string) => ({ url, ref, pagePath: false });
    expect(read('owner/repo')).toEqual(exact('https://github.com/owner/repo', 'HEAD'));
    expect(read('github.com/owner/repo')).toEqual(exact('https://github.com/owner/repo', 'HEAD'));
    expect(read('git@github.com:owner/repo.git')).toEqual(exact('https://github.com/owner/repo.git', 'HEAD'));
    expect(read('https://github.com/owner/repo/releases/tag/v1.4.0')).toEqual(exact('https://github.com/owner/repo', 'v1.4.0'));
    expect(read('https://gitlab.com/group/sub/repo/-/releases/v1.0.0')).toEqual(exact('https://gitlab.com/group/sub/repo', 'v1.0.0'));
    expect(read('https://gitlab.com/group/sub/repo/-/tags/release/2')).toEqual(exact('https://gitlab.com/group/sub/repo', 'release/2'));
    expect(read('https://github.com/owner/repo/issues?q=x#top')).toEqual(exact('https://github.com/owner/repo', 'HEAD'));
    // A file or folder page may hold a path after its ref; the inspection ends it at a branch or tag the repository lists (refOfPath).
    const page = (url: string, ref: string) => ({ url, ref, pagePath: true });
    expect(read('https://github.com/owner/repo/tree/release/1.x')).toEqual(page('https://github.com/owner/repo', 'release/1.x'));
    expect(read('https://github.com/owner/repo/blob/main/README.md')).toEqual(page('https://github.com/owner/repo', 'main/README.md'));
    expect(read('https://github.com/owner/repo/blob/main/boite-plugin.json')).toEqual(page('https://github.com/owner/repo', 'main'));
    expect(read('https://gitlab.com/group/sub/repo/-/tree/v2')).toEqual(page('https://gitlab.com/group/sub/repo', 'v2'));
    expect(read('https://codeberg.org/owner/repo/src/tag/v3')).toEqual(page('https://codeberg.org/owner/repo', 'v3'));
    // A ref typed apart wins over the page's, and is fetched exactly.
    expect(read('https://github.com/owner/repo/tree/main', 'v1.0.0')).toEqual(exact('https://github.com/owner/repo', 'v1.0.0'));
    expect(read('https://github.com/owner/repo', 'main/missing')).toEqual(exact('https://github.com/owner/repo', 'main/missing'));
    // The card keeps the page, without its query, so its Preview reads it the same way.
    expect(readPluginSource('https://github.com/owner/repo/blob/main/README.md?plain=1')).toEqual({ ok: true, url: 'https://github.com/owner/repo', ref: 'main/README.md', page: 'https://github.com/owner/repo/blob/main/README.md' });
    expect(readPluginSource('https://github.com/owner/repo/blob/main/README.md', 'v1')).toEqual({ ok: true, url: 'https://github.com/owner/repo', ref: 'v1' });
  });

  test('refuses what git must never run, however it is pasted', () => {
    for (const url of ['http://github.com/owner/repo', 'ssh://git@github.com/owner/repo', 'file:///C:/repo', 'ext::sh -c touch% /tmp/pwned', 'git://github.com/owner/repo', '-oProxyCommand=x/y', process.cwd(), '']) {
      expect(() => readSource(url, undefined)).toThrow('plugin url must be');
    }
    expect(() => readSource('https://token@github.com/owner/repo', undefined)).toThrow('carrying credentials');
    for (const page of ['https://github.com/owner/repo/tree/--upload-pack=x', 'https://github.com/owner/repo/tree/a..b', 'https://github.com/owner/repo/tree/%zz']) {
      expect(() => readSource(page, undefined)).toThrow('plugin ref must be');
    }
  });

  test('knows one repository under its two clone URLs', () => {
    expect(sameRepository('https://GitHub.com/owner/repo.git', 'https://github.com/owner/repo/')).toBe(true);
    expect(sameRepository('https://github.com/owner/repo', 'https://github.com/owner/other')).toBe(false);
  });

  test('takes a local path only when the store allows it, which only tests do', () => {
    expect(normalizeSourceUrl(process.cwd(), true)).toBe(process.cwd());
  });

  test('reads a ref that git cannot take as an option', () => {
    expect(checkRef(undefined)).toBe('HEAD');
    expect(checkRef('')).toBe('HEAD');
    expect(checkRef('v1.4.0')).toBe('v1.4.0');
    expect(checkRef('release/1.x')).toBe('release/1.x');
    for (const ref of ['--upload-pack=touch', '-x', 'a..b', 'main/', 'x.lock', 'a b', 42]) {
      expect(() => checkRef(ref)).toThrow('plugin ref must be');
    }
  });
});
