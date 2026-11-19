import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assignShards } from './shards.mts';
import { fileDurations } from './ui-shards.ts';

test('a UI job log gives each file the milliseconds Vitest printed, failed files included', () => {
  const log = [
    '2026-11-17T00:56:41.3267302Z  \x1b[32m✓\x1b[39m src/lib/client.test.ts \x1b[2m(51 tests)\x1b[22m\x1b[33m 9119ms\x1b[39m',
    '2026-11-17T00:56:41.4291968Z  ❯ src/lib/store.test.ts (68 tests | 1 failed) 23456ms',
    '2026-11-17T00:56:42.0369021Z stderr | src/lib/store.test.ts > a drawer hidden before its shells are listed stays shut after a reload',
  ].join('\r\n');
  expect(fileDurations(log)).toEqual({ 'src/lib/client.test.ts': 9.1, 'src/lib/store.test.ts': 23.5 });
});

test('the recorded times split the current UI files into two shards within 5 %', () => {
  const root = join(import.meta.dir, '../../packages/ui');
  const files = [...new Bun.Glob('src/**/*.test.ts').scanSync({ cwd: root })].map((file) => file.replaceAll('\\', '/')).sort();
  const { seconds } = JSON.parse(readFileSync(join(import.meta.dir, 'ui-durations.json'), 'utf8')) as { seconds: Record<string, number> };
  const shards = assignShards(files, seconds, 2);
  expect(shards.flatMap((shard) => shard.files).sort()).toEqual(files);
  const times = shards.map((shard) => shard.seconds);
  expect(Math.max(...times) / Math.min(...times)).toBeLessThan(1.05);
});
