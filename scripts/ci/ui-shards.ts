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

const ROOT = join(import.meta.dir, '..', '..');
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

function gh(args: string[]): string {
  const result = Bun.spawnSync(['gh', ...args], { stdout: 'pipe', stderr: 'pipe', cwd: ROOT, windowsHide: true });
  if (result.exitCode !== 0) throw new Error(`gh ${args.join(' ')}: ${result.stderr.toString().trim()}`);
  return result.stdout.toString();
}

/** The logs of a run's UI test jobs; they must have passed, or a file cut short skews its time. */
function runLogs(run: string): string[] {
  const view = JSON.parse(gh(['run', 'view', run, '--json', 'jobs'])) as { jobs: { databaseId: number; name: string; conclusion: string }[] };
  const jobs = view.jobs.filter((job) => /UI tests/.test(job.name) && job.conclusion !== 'skipped');
  if (jobs.length === 0) throw new Error(`run ${run}: no UI test job ran`);
  const failed = jobs.filter((job) => job.conclusion !== 'success');
  if (failed.length) throw new Error(`run ${run}: ${failed.map((job) => `${job.name} ${job.conclusion}`).join(', ')}; refresh from a green run`);
  const repo = process.env.GITHUB_REPOSITORY || gh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']).trim();
  return jobs.map((job) => gh(['api', `repos/${repo}/actions/jobs/${job.databaseId}/logs`]));
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
