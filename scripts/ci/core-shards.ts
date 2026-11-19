/**
 * Splits the core test files into CI shards of about equal length, the way
 * e2e-shards.ts splits the E2E files: each file gets its recorded seconds on
 * the runner's platform and architecture (`core-durations.json`; a file with no
 * record gets the median) and files go longest first to the lightest shard.
 * `packages/core/bin/test.ts --shard <i>/<n>` runs one shard.
 *
 * Run: bun scripts/ci/core-shards.ts <shard> <count> [<runner key>]   prints that shard's files
 *      bun scripts/ci/core-shards.ts refresh <run id|log>...       records a green run's times
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assignShards, type Shard } from './shards.mts';
import { readShardJobLogs } from './shard-logs.ts';

const ROOT = join(import.meta.dir, '..', '..');
const TESTS = join(ROOT, 'packages', 'core', 'test');
const DURATIONS = join(import.meta.dir, 'core-durations.json');

/** Seconds per file, by runner key: `linux-x64`, `win32-x64`, `darwin-arm64`. */
export type CoreDurations = { refreshed: string; runs: string[]; seconds: Record<string, Record<string, number>> };

/** The runner key of this process: Node's platform and architecture. */
export const runnerKey = (platform: string = process.platform, arch: string = process.arch) => `${platform}-${arch}`;

/** The key of a core job by its check name, `Core tests (Windows x64) 1/2` -> `win32-x64`. */
export function jobKey(name: string): string | undefined {
  const match = /^Core tests \((Linux|Windows|macOS) (x64|arm64)\)/.exec(name);
  if (!match) return undefined;
  return runnerKey({ Linux: 'linux', Windows: 'win32', macOS: 'darwin' }[match[1]!]!, match[2]!);
}

/** Every core test file, relative to packages/core/test with forward slashes, sorted as the runner sorts them. */
export function coreFiles(root = TESTS): string[] {
  return [...new Bun.Glob('**/*.test.ts').scanSync({ cwd: root })].map((file) => file.replaceAll('\\', '/')).sort();
}

export function readCoreDurations(path = DURATIONS): CoreDurations {
  return JSON.parse(readFileSync(path, 'utf8')) as CoreDurations;
}

/**
 * The shards of these files for a runner, each listed longest first: a slow
 * file that started last would hold the shard alone while the other workers
 * idle. A runner with no record of its own borrows the first one recorded.
 */
export function coreShards(files: string[], count: number, key: string, durations = readCoreDurations()): Shard[] {
  const seconds = durations.seconds[key] ?? Object.values(durations.seconds)[0] ?? {};
  const shards = assignShards(files, seconds, count);
  // An unrecorded file, new since the last refresh, runs after the recorded ones.
  const known = (file: string) => seconds[file] ?? -1;
  for (const shard of shards) shard.files.sort((a, b) => known(b) - known(a) || (a < b ? -1 : a > b ? 1 : 0));
  return shards;
}

/** Parses `<index>/<count>`, refusing anything else. */
export function parseShard(value: string | undefined): { index: number; count: number } {
  const match = /^(\d+)\/(\d+)$/.exec(value ?? '');
  const index = Number(match?.[1]);
  const count = Number(match?.[2]);
  if (!match || index < 1 || count < 1 || index > count) throw new Error(`--shard: expected <index>/<count> with 1 <= index <= count, received ${value}`);
  return { index, count };
}

/** Seconds per file from a core job log: the runner ends each file with `=== <file> (exit <code>, <seconds> s) ===`. */
export function fileDurations(log: string): Record<string, number> {
  const seconds: Record<string, number> = {};
  for (const match of log.matchAll(/=== (\S+\.test\.ts)(, retry)? \(exit -?\d+, ([\d.]+) s(?:,[^)]*)?\) ===/g)) {
    // A retry runs a few tests again; the first attempt is the file's time.
    if (match[2]) continue;
    seconds[match[1]!.replaceAll('\\', '/')] = Math.round(Number(match[3]) * 10) / 10;
  }
  return seconds;
}

/** The mean of each file over the logs it appears in, per runner key. */
export function mergeDurations(logs: { key: string; seconds: Record<string, number> }[]): Record<string, Record<string, number>> {
  const all: Record<string, Record<string, number[]>> = {};
  for (const { key, seconds } of logs) {
    for (const [file, value] of Object.entries(seconds)) ((all[key] ??= {})[file] ??= []).push(value);
  }
  return Object.fromEntries(Object.keys(all).sort().map((key) => [key, Object.fromEntries(Object.keys(all[key]!).sort().map((file) => {
    const values = all[key]![file]!;
    return [file, Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 10) / 10];
  }))]));
}

function runLogs(run: string): { key: string; log: string }[] {
  return readShardJobLogs(run, 'core', job => Boolean(jobKey(job.name)) && job.conclusion !== 'skipped')
    .map(({ name, log }) => ({ key: jobKey(name)!, log }));
}

if (import.meta.main) {
  const [command, ...rest] = process.argv.slice(2);
  if (command === 'refresh') {
    // A saved log is named after its runner key: linux-x64.log, win32-x64-2.log.
    if (rest.length === 0) throw new Error('refresh: name at least one green ci.yml run id or saved core job log named <runner key>[-n].log');
    const logs = rest.flatMap((source) => existsSync(source)
      ? [{ key: /([a-z0-9]+-(?:x64|arm64))[^/\\]*\.log$/.exec(source)?.[1] ?? runnerKey(), log: readFileSync(source, 'utf8') }]
      : runLogs(source));
    const seconds = mergeDurations(logs.map(({ key, log }) => ({ key, seconds: fileDurations(log) })));
    if (Object.keys(seconds).length === 0) throw new Error('refresh: no core file timings in those logs');
    const previous = existsSync(DURATIONS) ? readCoreDurations().seconds : {};
    // Runners absent from these runs keep their earlier record.
    const durations: CoreDurations = {
      refreshed: new Date().toISOString().slice(0, 10),
      runs: rest.map((source) => existsSync(source) ? 'log' : source),
      seconds: Object.fromEntries(Object.entries({ ...previous, ...seconds }).sort(([a], [b]) => a < b ? -1 : 1)),
    };
    writeFileSync(DURATIONS, `${JSON.stringify(durations, null, 2)}\n`);
    const files = coreFiles();
    for (const key of Object.keys(seconds).sort()) {
      const missing = files.filter((file) => seconds[key]![file] === undefined);
      const split = coreShards(files, 2, key, durations).map((shard) => `${shard.files.length} files, ${Math.round(shard.seconds)} s`).join(' | ');
      console.log(`${key}: ${Object.keys(seconds[key]!).length} files recorded${missing.length ? `, ${missing.length} without a time` : ''}; 2 shards: ${split}`);
    }
  } else {
    const { index, count } = parseShard(`${command}/${rest[0]}`);
    const shards = coreShards(coreFiles(), count, rest[1] ?? runnerKey());
    console.error(`Core shard ${index}/${count}: ${shards[index - 1]!.files.length} files, ${Math.round(shards[index - 1]!.seconds)} s recorded (shards: ${shards.map((shard) => Math.round(shard.seconds)).join(', ')} s)`);
    for (const file of shards[index - 1]!.files) console.log(file);
  }
}
