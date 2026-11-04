import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { manifestProblems, pack } from '../bin/pack.ts';
import { definePlugin } from '../src/index.ts';

const dirs: string[] = [];
/** The message a promise rejects with; no promise matcher, which `bun test` resolves a tick late. */
const failure = (promise: Promise<unknown>) => promise.then(() => 'resolved', (error: unknown) => String((error as Error).message));
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function pluginFolder(): string {
  const dir = mkdtempSync(join(tmpdir(), 'boite-plugin-sdk-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'skills'));
  writeFileSync(join(dir, 'main.ts'), 'console.log(process.argv.slice(2).join(" "));\n');
  writeFileSync(join(dir, 'skills', 'greet.md'), '# Greet\n\nSay hello.\n');
  writeFileSync(join(dir, 'boite-plugin.json'), JSON.stringify(definePlugin({
    schema: 2, id: 'greet', name: 'Greet', version: '0.1.0', description: 'Greets.', homepage: 'https://example.com/greet',
    runtime: 'bun', executable: 'greet', permissions: [],
    provides: { commands: [{ name: 'greet', description: 'Prints its arguments.' }], skills: [{ name: 'greet', description: 'How to greet.', body: '' }] },
  })));
  return dir;
}

describe('pack', () => {
  test('bundles one file, writes its digest and the skill bodies into the manifest, and the file runs', async () => {
    const dir = pluginFolder();
    const result = await pack({ entry: 'main.ts', dir, url: 'https://example.com/greet.js' });
    const bytes = readFileSync(join(dir, 'greet.js'));
    expect(result.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    const manifest = JSON.parse(readFileSync(join(dir, 'boite-plugin.json'), 'utf8'));
    expect(manifest.artifacts).toEqual({ any: { url: 'https://example.com/greet.js', sha256: result.sha256 } });
    expect(manifest.provides.skills[0].body).toBe('# Greet\n\nSay hello.\n');
    const run = Bun.spawnSync([process.execPath, join(dir, 'greet.js'), 'greet', 'a', 'b']);
    expect(run.stdout.toString()).toBe('greet a b\n');
    // A second pack keeps the URL and gives the same digest.
    expect((await pack({ entry: 'main.ts', dir })).sha256).toBe(result.sha256);
  });

  test('refuses a native plugin and an http URL', async () => {
    const dir = pluginFolder();
    expect(await failure(pack({ entry: 'main.ts', dir, url: 'http://example.com/greet.js' }))).toContain('--url must be https');
    const path = join(dir, 'boite-plugin.json');
    writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), runtime: 'native' }));
    expect(await failure(pack({ entry: 'main.ts', dir, url: 'https://example.com/greet.js' }))).toContain('runtime must be "bun"');
  });

  test('names each limit a manifest breaks', () => {
    expect(manifestProblems(definePlugin({
      schema: 2, id: 'x', name: 'X', version: '1.0.0', description: 'x', homepage: 'https://example.com',
      provides: {
        commands: [{ name: 'Bad_Name', description: 'x' }, { name: 'ok', description: '' }],
        slashCommands: [{ name: 'go', description: 'go', prompt: '' }],
        prompt: 'p'.repeat(1001),
      },
    }))).toEqual([
      'provides.commands[0].name must be lowercase words joined by hyphens, at most 40 characters, found "Bad_Name"',
      'provides.commands[1].description must be 1 to 200 characters',
      'provides.slashCommands[0].prompt must be 1 to 8192 B',
      'provides.prompt is over 1000 characters',
    ]);
  });
});
