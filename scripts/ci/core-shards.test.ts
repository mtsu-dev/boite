import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { coreFiles, coreShards, fileDurations, jobKey, mergeDurations, parseShard, readCoreDurations } from './core-shards.ts';
import { CORE_ALL } from './changes.ts';

test('a core job log gives each file the seconds the runner printed, Windows paths included', () => {
  const log = [
    '2026-11-17T10:00:00.0000000Z === account-fallback.test.ts (exit 0, 1.84 s) ===',
    '2026-11-17T10:00:01.0000000Z === browser\\core-failures.test.ts (exit 1, 12.50 s) ===',
    // A quarantine retry reruns a few tests: the first attempt is the file's time.
    '2026-11-17T10:00:02.0000000Z === browser\\core-failures.test.ts, retry (exit 0, 2.00 s) ===',
    '2026-11-17T10:00:03.0000000Z === hung.test.ts (exit 143, 300.01 s, ended after 300000 ms without finishing) ===',
    // The format before the runner printed seconds gives nothing.
    '2026-11-16T10:00:03.0000000Z === old.test.ts (exit 0) ===',
  ].join('\r\n');
  expect(fileDurations(log)).toEqual({ 'account-fallback.test.ts': 1.8, 'browser/core-failures.test.ts': 12.5, 'hung.test.ts': 300 });
  expect(mergeDurations([{ key: 'linux-x64', seconds: { 'a.test.ts': 4 } }, { key: 'linux-x64', seconds: { 'a.test.ts': 6 } }, { key: 'win32-x64', seconds: { 'a.test.ts': 9 } }]))
    .toEqual({ 'linux-x64': { 'a.test.ts': 5 }, 'win32-x64': { 'a.test.ts': 9 } });
});

test('a shard lists its files longest first, with the unrecorded ones last', () => {
  const durations = { refreshed: '', runs: [], seconds: { 'linux-x64': { 'a.test.ts': 1, 'b.test.ts': 9, 'c.test.ts': 4, 'd.test.ts': 3 } } };
  const shards = coreShards(['a.test.ts', 'b.test.ts', 'c.test.ts', 'd.test.ts', 'new.test.ts'], 2, 'linux-x64', durations);
  // new.test.ts counts as the median, 3.5 s, to place it, then runs after the recorded files.
  expect(shards.map((shard) => shard.files)).toEqual([['b.test.ts', 'a.test.ts'], ['c.test.ts', 'd.test.ts', 'new.test.ts']]);
  // A runner with no record borrows the first one, so all its jobs agree.
  expect(coreShards(['a.test.ts', 'b.test.ts'], 2, 'freebsd-x64', durations)).toEqual(coreShards(['a.test.ts', 'b.test.ts'], 2, 'linux-x64', durations));
});

test('--shard takes <index>/<count> and nothing else', () => {
  expect(parseShard('2/3')).toEqual({ index: 2, count: 3 });
  for (const value of ['0/2', '3/2', '1', 'a/b', '1/0', undefined]) expect(() => parseShard(value)).toThrow('--shard: expected <index>/<count>');
});

test('every sharded core job reads a record of its own runner', () => {
  expect(jobKey('Core tests (Windows x64) 1/2')).toBe('win32-x64');
  expect(jobKey('Core tests (macOS arm64)')).toBe('darwin-arm64');
  expect(jobKey('Core tests (macOS x64) 2/2')).toBe('darwin-x64');
  expect(jobKey('E2E 1/5')).toBeUndefined();
  const { seconds } = readCoreDurations();
  for (const runner of CORE_ALL.filter((runner) => runner.shards)) expect(Object.keys(seconds)).toContain(jobKey(`Core tests (${runner.name})`)!);
});

test('the recorded times split the current core files into two shards within 5 % on each sharded runner', () => {
  const files = coreFiles();
  for (const runner of CORE_ALL.filter((runner) => runner.shards)) {
    const shards = coreShards(files, runner.shards!, jobKey(`Core tests (${runner.name})`)!);
    expect(shards.flatMap((shard) => shard.files).sort()).toEqual(files);
    const times = shards.map((shard) => shard.seconds);
    expect(Math.max(...times) / Math.min(...times)).toBeLessThan(1.05);
  }
});

// Each file has 300 s on every runner (BOITE_TEST_FILE_DEADLINE_MS in
// packages/core/bin/test.ts), and a slower run than the recorded one cut
// browser.test.ts there on the Intel Mac after 278 s: a file recorded past
// 240 s is split before a run ends it.
test('no recorded core file comes within a fifth of the file deadline on any runner', () => {
  expect(readFileSync(join(import.meta.dir, '../../packages/core/bin/test.ts'), 'utf8')).toContain('BOITE_TEST_FILE_DEADLINE_MS ?? 300_000');
  const { seconds } = readCoreDurations();
  expect(Object.keys(seconds)).toContain('darwin-x64');
  const files = coreFiles();
  for (const [key, record] of Object.entries(seconds)) {
    for (const [file, value] of Object.entries(record)) if (files.includes(file)) expect(value, `${key} ${file}`).toBeLessThan(240);
  }
});
