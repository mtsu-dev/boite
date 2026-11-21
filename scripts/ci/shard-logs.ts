import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..', '..');
type Job = { databaseId: number; name: string; conclusion: string };

function gh(args: string[]): string {
  const result = Bun.spawnSync(['gh', ...args], { stdout: 'pipe', stderr: 'pipe', cwd: ROOT, windowsHide: true });
  if (result.exitCode !== 0) throw new Error(`gh ${args.join(' ')}: ${result.stderr.toString().trim()}`);
  return result.stdout.toString();
}

/** Only complete jobs count towards file timings. */
export function readShardJobLogs(run: string, suite: string, matches: (job: Job) => boolean, allowEscapeSequences = false) {
  const view = JSON.parse(gh(['run', 'view', run, '--json', 'jobs'])) as { jobs: Job[] };
  const jobs = view.jobs.filter(matches);
  if (!jobs.length) throw new Error(`run ${run}: no ${suite} job ran`);
  const failed = jobs.filter(job => job.conclusion !== 'success');
  if (failed.length) throw new Error(`run ${run}: ${failed.map(job => `${job.name} ${job.conclusion}`).join(', ')}; refresh from a green run`);
  const repo = process.env.GITHUB_REPOSITORY || gh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']).trim();
  const flags = allowEscapeSequences ? ['--allow-escape-sequences'] : [];
  return jobs.map(({ name, databaseId }) => ({ name, log: gh(['api', ...flags, `repos/${repo}/actions/jobs/${databaseId}/logs`]) }));
}
