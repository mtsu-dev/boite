/**
 * Splits the UI test files into CI shards of about equal length. Vitest's own
 * `--shard` cuts by file count in hash order, and the slow files landed
 * together: 1218 s of tests against 825 s on the files of one run (2026-11-17).
 * The sequencer in packages/ui/vitest.config.ts gives each file its recorded
 * seconds (`ui-durations.json`) and cuts with assignShards.
 *
 * Run: bun scripts/ci/ui-shards.ts refresh <run id|log>...   records a green run's times
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assignShards } from './shards.mts';
import { readShardJobLogs } from './shard-logs.ts';

const DURATIONS = join(import.meta.dir, 'ui-durations.json');

/**
 * Seconds per file from a UI job's log: Vitest ends each file with
 * `✓ src/lib/client.test.ts (51 tests) 9119ms`, `❯` when a test failed.
 */
export function fileDurations(log: string): Record<string, number> {
  const seconds: Record<string, number> = {};
  for (const raw of log.split(/\r?\n/)) {
    const line = raw.replace(/\x1b\[[0-9;]*m/g, '');
    const match = / [✓❯↓] (src\/\S+\.test\.ts) \(\d+ tests?[^)]*\)(?: \d+ skipped)? (\d+)ms\s*$/.exec(line);
    if (match) seconds[match[1]!] = Math.round(Number(match[2]) / 100) / 10;
  }
  return seconds;
}

function runLogs(run: string): string[] {
  return readShardJobLogs(run, 'UI test', job => /UI tests/.test(job.name) && job.conclusion !== 'skipped').map(({ log }) => log);
}

if (import.meta.main) {
  const [command, ...rest] = process.argv.slice(2);
  if (command !== 'refresh' || rest.length === 0) throw new Error('usage: bun scripts/ci/ui-shards.ts refresh <green ci.yml run id or saved UI job log>...');
  // One record per run, its shards' logs together, then the mean over the runs.
  const all: Record<string, number[]> = {};
  for (const source of rest) {
    const logs = existsSync(source) ? [readFileSync(source, 'utf8')] : runLogs(source);
    const run = Object.assign({}, ...logs.map(fileDurations)) as Record<string, number>;
    for (const [file, value] of Object.entries(run)) (all[file] ??= []).push(value);
  }
  const seconds = Object.fromEntries(Object.keys(all).sort().map((file) => [file, Math.round(all[file]!.reduce((sum, value) => sum + value, 0) / all[file]!.length * 10) / 10]));
  if (Object.keys(seconds).length === 0) throw new Error('refresh: no UI file timings in those logs');
  writeFileSync(DURATIONS, `${JSON.stringify({ refreshed: new Date().toISOString().slice(0, 10), runs: rest.map((source) => existsSync(source) ? 'log' : source), seconds }, null, 2)}\n`);
  const shards = assignShards(Object.keys(seconds), seconds, 2);
  console.log(`Recorded ${Object.keys(seconds).length} files; 2 shards: ${shards.map((shard) => `${shard.files.length} files, ${Math.round(shard.seconds)} s`).join(' | ')}`);
}
