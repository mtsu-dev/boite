/**
 * Reruns the failed jobs of a failed `boite (de nuit)` run when GitHub, not the
 * code, failed them: no hosted runner was acquired for the job, or a dependency
 * registry rate limited a download. The nightly has no other retry, so each of
 * 2026-11-08, 11-10 and 11-12 lost its build to macOS x64 never getting a
 * runner, and 2026-11-16's dispatch needed three attempts.
 *
 * Every job of the attempt that did not succeed or skip is judged. A job no
 * runner picked up ends `cancelled`, with GitHub's annotation as its only
 * trace: that annotation makes it infrastructure, nothing else does for a
 * cancelled job. A failed job is infrastructure when that annotation is there
 * or when its failed step's log holds a dependency download refused with 429
 * (INFRA_PATTERNS). One job judged otherwise keeps the whole run failed:
 * rerun-failed-jobs would run it again too. A dry run is never rerun, nor an
 * event older than the run's current attempt, nor attempt MAX_ATTEMPTS, and
 * the run is read once more just before the rerun call (confirmRerun).
 *
 * Env: GITHUB_REPOSITORY, GH_TOKEN, GITHUB_EVENT_PATH (a workflow_run event).
 */
import { appendFileSync, readFileSync } from 'node:fs';

/** A job of the attempt; `log` is its failed step's log (failedStepLog). */
export type Job = { name: string; conclusion: string | null; annotations: string[]; log?: string };
/** A step as the jobs API lists it. */
export type Step = { name: string; conclusion: string | null; started_at: string | null; completed_at: string | null };
/** `runAttempt` is the event's attempt, `currentAttempt` the run's when the retry reads it. */
export type RetryInput = { runAttempt: number; currentAttempt: number; dryRun: boolean; jobs: Job[] };
export type RetryDecision = { rerun: boolean; reason: string };

/** The only cause a cancelled job may have: GitHub never placed it. */
export const NOT_ACQUIRED = /The job was not acquired by Runner of type hosted/i;

/**
 * Each message that means a job never got to fail on its own. `annotation` is
 * read in the job's annotations; every other entry is a dependency download a
 * registry refused, read in the failed step's log only, so a test that names a
 * 429 or a request retried earlier in the job is not mistaken for one.
 */
export const INFRA_PATTERNS: { tool: string; cause: string; pattern: RegExp }[] = [
  { tool: 'annotation', cause: 'no hosted runner was acquired', pattern: NOT_ACQUIRED },
  // Could not GET 'https://repo.maven.apache.org/...pom'. Received status code 429 from server: Too Many Requests
  { tool: 'gradle', cause: 'a Maven registry answered 429', pattern: /Could not (?:GET|HEAD|download) '?https?:\/\/\S+.*\b(?:status code 429|Too Many Requests)\b/i },
  // npm error 429 Too Many Requests - GET https://registry.npmjs.org/...
  { tool: 'npm', cause: 'the npm registry answered 429', pattern: /\bnpm (?:ERR!|error) (?:code E429|429 Too Many Requests)\b/i },
  // error: GET https://registry.npmjs.org/... - 429
  { tool: 'bun', cause: 'a registry answered 429 to bun install', pattern: /\berror: (?:GET|HEAD) https?:\/\/\S+ - 429\b/ },
  // failed to get successful HTTP response from `https://index.crates.io/...` (...), got 429
  { tool: 'cargo', cause: 'a crates registry answered 429', pattern: /failed to get successful HTTP response from `https?:\/\/[^`]+`.*\bgot 429\b/ },
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

/** A job the retry judges: anything but a success or a skip (`failure`, `timed_out`, `cancelled`). */
export const judged = (conclusion: string | null) => conclusion !== 'success' && conclusion !== 'skipped' && conclusion !== 'neutral';

const second = (iso: string) => Math.floor(Date.parse(iso) / 1000);

/**
 * The log lines of the job's failed steps, without their timestamps. Each line
 * of a job log starts with one, but a step's started_at and completed_at only
 * bound it to the second, which it can share with the step before and after.
 * The log's own marks split those seconds: in the first one the step begins
 * at its last `##[group]Run` line, in the last one it ends at its first
 * `##[error]` line (the runner's "Process completed with exit code"). A shared
 * second without that mark is left out rather than guessed. '' when no step
 * failed, as for a job no runner ran.
 */
export function failedStepLog(log: string, steps: Step[]): string {
  const windows = steps.filter((step) => step.conclusion !== null && judged(step.conclusion) && step.started_at && step.completed_at)
    .map((step) => [second(step.started_at!), second(step.completed_at!)] as const);
  const lines = log.replace(/^\uFEFF/, '').split('\n').flatMap((line) => {
    const stamp = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.\d+)?Z (.*)$/.exec(line);
    return stamp ? [{ at: second(`${stamp[1]}Z`), text: stamp[2]! }] : [];
  });
  const kept = new Set<number>();
  for (const [from, to] of windows) {
    const marker = lines.findLastIndex((line) => line.at === from && line.text.startsWith('##[group]Run '));
    const start = marker !== -1 ? marker : lines.findIndex((line) => line.at > from);
    if (start === -1) continue;
    const error = lines.findIndex((line, index) => index >= start && line.at === to && line.text.startsWith('##[error]'));
    const end = error !== -1 ? error : lines.findLastIndex((line) => line.at < to);
    for (let index = start; index <= end; index++) kept.add(index);
  }
  return [...kept].sort((x, y) => x - y).map((index) => lines[index]!.text).join('\n');
}

/** The cause of a judged job's end when it was GitHub's or a registry's, else undefined. */
export function infraCause(job: Job): string | undefined {
  if (job.annotations.some((text) => NOT_ACQUIRED.test(text))) return INFRA_PATTERNS[0]!.cause;
  if (job.conclusion === 'cancelled') return undefined;
  return INFRA_PATTERNS.slice(1).find(({ pattern }) => pattern.test(job.log ?? ''))?.cause;
}

export function decide({ runAttempt, currentAttempt, dryRun, jobs }: RetryInput): RetryDecision {
  if (dryRun) return { rerun: false, reason: 'a dry run is never rerun' };
  if (runAttempt < currentAttempt) return { rerun: false, reason: `attempt ${runAttempt} is stale: the run is at attempt ${currentAttempt}` };
  if (runAttempt >= MAX_ATTEMPTS) return { rerun: false, reason: `attempt ${runAttempt} is the last one rerun automatically (bound ${MAX_ATTEMPTS})` };
  const ended = jobs.filter((job) => judged(job.conclusion));
  if (ended.length === 0) return { rerun: false, reason: 'no failed job to judge' };
  const real = ended.filter((job) => infraCause(job) === undefined);
  if (real.length > 0) return { rerun: false, reason: `ended on a step or a cancel, not on infrastructure: ${real.map((job) => `${job.name} (${job.conclusion})`).join(', ')}` };
  const causes = ended.map((job) => `${job.name} (${infraCause(job)})`).join(', ');
  return { rerun: true, reason: `failed on infrastructure only: ${causes}; rerunning its failed jobs` };
}

/**
 * The run as read just before the rerun call: the logs take a while, and a
 * manual rerun started or even finished meanwhile must not get one more.
 */
export function confirmRerun(attempt: number, now: { run_attempt: number; status: string; conclusion: string | null }): RetryDecision {
  if (now.run_attempt !== attempt) return { rerun: false, reason: `the run moved to attempt ${now.run_attempt} while attempt ${attempt} was judged` };
  if (now.status !== 'completed' || now.conclusion !== 'failure') return { rerun: false, reason: `the run is now ${now.status} ${now.conclusion ?? ''}`.trimEnd() + `, not a completed failure` };
  return { rerun: true, reason: `attempt ${attempt} is still the run's last, failed` };
}

type ApiJob = { id: number; name: string; conclusion: string | null; steps?: Step[] };
type WorkflowRun = { id: number; run_attempt: number; status: string; head_branch: string | null; display_title: string; conclusion: string | null; html_url: string };

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

/** The job's whole log, or '' when it has none (no runner ran it). */
async function jobLog(repo: string, id: number): Promise<string> {
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
  return await log.text();
}

if (import.meta.main) {
  const { GITHUB_REPOSITORY: repo, GH_TOKEN: token, GITHUB_EVENT_PATH: eventPath } = process.env;
  if (!repo || !token || !eventPath) throw new Error('expected GITHUB_REPOSITORY, GH_TOKEN and GITHUB_EVENT_PATH');
  const run = (JSON.parse(readFileSync(eventPath, 'utf8')) as { workflow_run?: WorkflowRun }).workflow_run;
  if (!run) throw new Error(`${eventPath} holds no workflow_run`);
  // Only main publishes: a run anywhere else is a dry run whatever its title.
  const dryRun = run.head_branch !== 'main' || DRY_RUN_TITLE.test(run.display_title);
  let decision: RetryDecision;
  if (run.conclusion !== 'failure') {
    decision = { rerun: false, reason: `the run ended ${run.conclusion ?? 'without a conclusion'}, not failure` };
  } else if (dryRun || run.run_attempt >= MAX_ATTEMPTS) {
    decision = decide({ runAttempt: run.run_attempt, currentAttempt: run.run_attempt, dryRun, jobs: [] });
  } else {
    // A rerun started since this event makes it stale: read the run as it is now.
    const current = await (await api(`/repos/${repo}/actions/runs/${run.id}`)).json() as WorkflowRun;
    const page = current.run_attempt > run.run_attempt
      ? { total_count: 0, jobs: [] as ApiJob[] }
      : await (await api(`/repos/${repo}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`)).json() as { total_count: number; jobs: ApiJob[] };
    if (page.total_count > page.jobs.length) throw new Error(`${run.html_url} has ${page.total_count} jobs, more than one page of ${page.jobs.length}`);
    const jobs = await Promise.all(page.jobs.map(async (job): Promise<Job> => {
      if (!judged(job.conclusion)) return { name: job.name, conclusion: job.conclusion, annotations: [] };
      const annotations = await (await api(`/repos/${repo}/check-runs/${job.id}/annotations?per_page=100`)).json() as { message: string }[];
      const messages = annotations.map((annotation) => annotation.message);
      // A cancelled job is judged on its annotations alone, and one no runner ran has no log.
      const log = job.conclusion === 'cancelled' ? '' : failedStepLog(await jobLog(repo, job.id), job.steps ?? []);
      return { name: job.name, conclusion: job.conclusion, annotations: messages, log };
    }));
    decision = decide({ runAttempt: run.run_attempt, currentAttempt: current.run_attempt, dryRun, jobs });
  }
  if (decision.rerun) {
    const now = await (await api(`/repos/${repo}/actions/runs/${run.id}`)).json() as WorkflowRun;
    const confirmed = confirmRerun(run.run_attempt, now);
    if (!confirmed.rerun) decision = { rerun: false, reason: `${decision.reason}; dropped: ${confirmed.reason}` };
  }
  const message = `${run.html_url} attempt ${run.run_attempt}: ${decision.reason}`;
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n`);
  console.log(message);
  if (decision.rerun) await api(`/repos/${repo}/actions/runs/${run.id}/rerun-failed-jobs`, { method: 'POST' });
}
