/**
 * Reruns the failed jobs of a failed `boite (de nuit)` run when GitHub, not the
 * code, failed them: no hosted runner was acquired for the job, or a dependency
 * registry rate limited it. The nightly has no other retry, so each of
 * 2026-11-08, 11-10 and 11-12 lost its build to macOS x64 never getting a
 * runner, and 2026-11-16's dispatch needed three attempts.
 *
 * A job counts as infrastructure only when one of INFRA_PATTERNS matches its
 * check-run annotations or the tail of its log. One failed job without such a
 * match keeps the whole run failed: rerun-failed-jobs would also run it again.
 * A dry run is never rerun, and neither is attempt MAX_ATTEMPTS or later.
 *
 * Env: GITHUB_REPOSITORY, GH_TOKEN, GITHUB_EVENT_PATH (a workflow_run event).
 */
import { appendFileSync, readFileSync } from 'node:fs';

/** A failed job of the run, as the retry reads it. */
export type FailedJob = { name: string; annotations: string[]; log?: string };
export type RetryInput = { runAttempt: number; dryRun: boolean; jobs: FailedJob[] };
export type RetryDecision = { rerun: boolean; reason: string };

/**
 * Each message that means the job never got to fail on its own. They are read
 * in the annotations and in the log alike: the runner message is an annotation
 * only (the job has no log), a registry's 429 is in the log behind a generic
 * "exit code 1" annotation.
 */
export const INFRA_PATTERNS: { cause: string; pattern: RegExp }[] = [
  { cause: 'no hosted runner was acquired', pattern: /The job was not acquired by Runner of type hosted/i },
  { cause: 'a registry answered 429', pattern: /\bstatus code 429\b/i },
  { cause: 'a registry answered Too Many Requests', pattern: /\bToo Many Requests\b/i },
];

/**
 * Attempts 1 and 2 may be rerun, attempt 3 is the last. 2026-11-16's dispatch
 * got its macOS runner on attempt 3. Each attempt GitHub fails to place costs
 * 15 minutes of queue before its annotation, so two reruns bound the extra wait
 * near 30 minutes plus the rerun jobs. Past that, the outage is long enough
 * that the next night's schedule, which takes any unpublished commit again,
 * is as good a retry, and a human sees the failure.
 */
export const MAX_ATTEMPTS = 3;

/** The nightly's run-name for a dry run matches this; a scheduled or publishing run's does not. */
export const DRY_RUN_TITLE = /\bdry run\b/i;

/** How much of a job's log is read: a registry's refusal ends the build, so it sits in the tail. */
export const LOG_TAIL_LINES = 400;

/** The cause of a job's failure when it was GitHub's or a registry's, else undefined. */
export function infraCause(job: FailedJob): string | undefined {
  const texts = [...job.annotations, job.log ?? ''];
  return INFRA_PATTERNS.find(({ pattern }) => texts.some((text) => pattern.test(text)))?.cause;
}

export function decide({ runAttempt, dryRun, jobs }: RetryInput): RetryDecision {
  if (dryRun) return { rerun: false, reason: 'a dry run is never rerun' };
  if (runAttempt >= MAX_ATTEMPTS) return { rerun: false, reason: `attempt ${runAttempt} is the last one rerun automatically (bound ${MAX_ATTEMPTS})` };
  if (jobs.length === 0) return { rerun: false, reason: 'no failed job to judge' };
  const real = jobs.filter((job) => infraCause(job) === undefined);
  if (real.length > 0) return { rerun: false, reason: `failed on a step, not on infrastructure: ${real.map((job) => job.name).join(', ')}` };
  const causes = jobs.map((job) => `${job.name} (${infraCause(job)})`).join(', ');
  return { rerun: true, reason: `failed on infrastructure only: ${causes}; rerunning its failed jobs` };
}

type Job = { id: number; name: string; conclusion: string | null };
type WorkflowRun = { id: number; run_attempt: number; head_branch: string | null; display_title: string; conclusion: string | null; html_url: string };

/** A failed job of the latest attempt: GitHub's `failure` or `timed_out`, never a cancelled or skipped one. */
const failed = (job: Job) => job.conclusion === 'failure' || job.conclusion === 'timed_out';

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  const { GITHUB_API_URL: base = 'https://api.github.com', GH_TOKEN: token } = process.env;
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${path} answered ${response.status}: ${await response.text()}`);
  return response;
}

/** The last LOG_TAIL_LINES lines, or '' when the job has no log (no runner ran it). */
async function logTail(repo: string, id: number): Promise<string> {
  const { GITHUB_API_URL: base = 'https://api.github.com', GH_TOKEN: token } = process.env;
  // The answer redirects to signed storage, which must not receive the token.
  const answer = await fetch(`${base}/repos/${repo}/actions/jobs/${id}/logs`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' },
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
  });
  if (answer.status === 404 || answer.status === 410) return '';
  const location = answer.headers.get('location');
  if (!location) throw new Error(`GET job ${id} logs answered ${answer.status} without a location: ${await answer.text()}`);
  const log = await fetch(location, { signal: AbortSignal.timeout(60_000) });
  if (!log.ok) throw new Error(`job ${id}'s log download answered ${log.status}`);
  return (await log.text()).split('\n').slice(-LOG_TAIL_LINES).join('\n');
}

if (import.meta.main) {
  const { GITHUB_REPOSITORY: repo, GH_TOKEN: token, GITHUB_EVENT_PATH: eventPath } = process.env;
  if (!repo || !token || !eventPath) throw new Error('expected GITHUB_REPOSITORY, GH_TOKEN and GITHUB_EVENT_PATH');
  const run = (JSON.parse(readFileSync(eventPath, 'utf8')) as { workflow_run?: WorkflowRun }).workflow_run;
  if (!run) throw new Error(`${eventPath} holds no workflow_run`);
  // Only main publishes: a run anywhere else is a dry run whatever its title.
  const dryRun = run.head_branch !== 'main' || DRY_RUN_TITLE.test(run.display_title);
  const judged = run.conclusion === 'failure' && !dryRun && run.run_attempt < MAX_ATTEMPTS;
  const page = judged
    ? await (await api(`/repos/${repo}/actions/runs/${run.id}/jobs?filter=latest&per_page=100`)).json() as { total_count: number; jobs: Job[] }
    : { total_count: 0, jobs: [] };
  if (page.total_count > page.jobs.length) throw new Error(`${run.html_url} has ${page.total_count} jobs, more than one page of ${page.jobs.length}`);
  const jobs = judged
    ? await Promise.all(page.jobs.filter(failed).map(async (job): Promise<FailedJob> => {
      const annotations = await (await api(`/repos/${repo}/check-runs/${job.id}/annotations?per_page=100`)).json() as { message: string }[];
      return { name: job.name, annotations: annotations.map((annotation) => annotation.message), log: await logTail(repo, job.id) };
    }))
    : [];
  const decision = run.conclusion === 'failure'
    ? decide({ runAttempt: run.run_attempt, dryRun, jobs })
    : { rerun: false, reason: `the run ended ${run.conclusion ?? 'without a conclusion'}, not failure` };
  const message = `${run.html_url} attempt ${run.run_attempt}: ${decision.reason}`;
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n`);
  console.log(message);
  if (decision.rerun) await api(`/repos/${repo}/actions/runs/${run.id}/rerun-failed-jobs`, { method: 'POST' });
}
