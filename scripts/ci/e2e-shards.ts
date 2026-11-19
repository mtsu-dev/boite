/**
 * Splits the browser and core E2E files into CI shards of about equal length.
 * `bun test --shard` cuts by file count, and the heavy files landed together:
 * the third shard ran 501 to 519 s of tests where the first ran 285 to 317 s.
 * Here each file is given its recorded seconds (`e2e-durations.json`; a file
 * with no record gets the median) and files go longest first to the lightest
 * shard.
 *
 * Run: bun scripts/ci/e2e-shards.ts <shard> <count>      prints that shard's files
 *      bun scripts/ci/e2e-shards.ts refresh <run id|log>... records a green run's times
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { assignShards } from './shards.mts';
import { readShardJobLogs } from './shard-logs.ts';

export { assignShards, type Shard } from './shards.mts';

const ROOT = join(import.meta.dir, '..', '..');
const DURATIONS = join(import.meta.dir, 'e2e-durations.json');
/** It runs against the installer in the desktop job. */
const NATIVE = 'tests/e2e/shell.test.ts';

export type Durations = { refreshed: string; runs: string[]; seconds: Record<string, number> };

/** Every E2E file but the native shell one, relative, with forward slashes, sorted. */
export function e2eFiles(root = ROOT): string[] {
  const walk = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return entry.name === 'node_modules' || entry.name.startsWith('.') ? [] : walk(path);
      return entry.name.endsWith('.test.ts') ? [relative(root, path).replaceAll('\\', '/')] : [];
    });
  return walk(join(root, 'tests', 'e2e')).filter((file) => file !== NATIVE).sort();
}

const STAMP = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z) (.*)$/;

/**
 * Seconds per file from one E2E job's log: `bun test` opens a `##[group]` per
 * file when the file starts, so a file lasts until the next one opens, the
 * last one until the `Ran N tests` summary.
 */
export function fileDurations(log: string): Record<string, number> {
  const seconds: Record<string, number> = {};
  let open: { file: string; at: number } | undefined;
  for (const raw of log.split(/\r?\n/)) {
    const line = raw.replace(/\x1b\[[0-9;]*m/g, '');
    const stamped = STAMP.exec(line);
    if (!stamped) continue;
    const at = Date.parse(stamped[1]!);
    const text = stamped[2]!;
    const group = /^##\[group\](tests[\\/]e2e[\\/].+\.test\.ts):$/.exec(text);
    const summary = /^Ran \d+ tests? across \d+ files?\./.test(text);
    if (!group && !summary) continue;
    if (open) seconds[open.file] = Math.round((at - open.at) / 100) / 10;
    open = group ? { file: group[1]!.replaceAll('\\', '/'), at } : undefined;
  }
  return seconds;
}

/** The mean of each file over the logs it appears in. */
export function mergeDurations(logs: Record<string, number>[]): Record<string, number> {
  const all: Record<string, number[]> = {};
  for (const log of logs) for (const [file, value] of Object.entries(log)) (all[file] ??= []).push(value);
  return Object.fromEntries(Object.keys(all).sort().map((file) => {
    const values = all[file]!;
    return [file, Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 10) / 10];
  }));
}

function runLogs(run: string): string[] {
  return readShardJobLogs(run, 'E2E shard', job => /^E2E \d+\/\d+$/.test(job.name), true).map(({ log }) => log);
}

export function readDurations(path = DURATIONS): Durations {
  return JSON.parse(readFileSync(path, 'utf8')) as Durations;
}

if (import.meta.main) {
  const [command, ...rest] = process.argv.slice(2);
  if (command === 'refresh') {
    if (rest.length === 0) throw new Error('refresh: name at least one green ci.yml run id or saved E2E job log');
    const logs = rest.flatMap((source) => existsSync(source) ? [readFileSync(source, 'utf8')] : runLogs(source));
    const seconds = mergeDurations(logs.map(fileDurations));
    if (Object.keys(seconds).length === 0) throw new Error('refresh: no E2E file timings in those logs');
    const durations: Durations = { refreshed: new Date().toISOString().slice(0, 10), runs: rest.map((source) => existsSync(source) ? 'log' : source), seconds };
    writeFileSync(DURATIONS, `${JSON.stringify(durations, null, 2)}\n`);
    const files = e2eFiles();
    const missing = files.filter((file) => seconds[file] === undefined);
    console.log(`Recorded ${Object.keys(seconds).length} files${missing.length ? `; no time for ${missing.join(', ')}` : ''}`);
    for (const [index, shard] of assignShards(files, seconds, 5).entries()) console.log(`shard ${index + 1}/5: ${shard.files.length} files, ${Math.round(shard.seconds)} s`);
  } else {
    const index = Number(command);
    const count = Number(rest[0]);
    if (!Number.isInteger(index) || !Number.isInteger(count) || index < 1 || index > count) {
      throw new Error(`usage: bun scripts/ci/e2e-shards.ts <shard> <count>, got ${process.argv.slice(2).join(' ') || 'nothing'}`);
    }
    const files = e2eFiles();
    if (files.length === 0) throw new Error('No browser or core E2E files found under tests/e2e');
    const shards = assignShards(files, readDurations().seconds, count);
    const shard = shards[index - 1]!;
    console.error(`E2E shard ${index}/${count}: ${shard.files.length} files, ${Math.round(shard.seconds)} s recorded (shards: ${shards.map((s) => Math.round(s.seconds)).join(', ')} s)`);
    // Absolute paths: `bun test` reads a bare relative path as a name filter.
    for (const file of shard.files) console.log(resolve(ROOT, file));
  }
}
