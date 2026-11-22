/**
 * The pull request comment "Thread transfer impact"
 * (docs/internals/ci.md#pull-request-comment), run by pr-comment.yml once
 * ci.yml finished on a pull request. The job holds write access to pull
 * requests, so it runs the default branch's code only and treats what the
 * pull request's run left as data: each report is downloaded only when its
 * artifact is small, read only when it is a plain file, accepted only in
 * the exact shape of `parseReport` and for the run's own pull request and
 * head commit. A report gives the pull request's own numbers and the main
 * commit it was compared with; that commit counts only when it was main's
 * tip when the run was created, and main's numbers, the ceilings and the
 * body's reasons are read here from main's runs and the pull request.
 *
 * One comment per pull request, found by its marker and author and edited in
 * place. A run the pull request has moved past, or that a newer run or
 * attempt for the same branch replaces, leaves it alone.
 *
 * Run: bun scripts/ci/pr-comment.ts (GITHUB_EVENT_PATH holds the workflow_run event)
 *      GITHUB_REPOSITORY=owner/name bun scripts/ci/pr-comment.ts --run <run id>
 */
import { lstatSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { api, bodyReason, mainArtifact, mainMeasurement, publishedLimit } from './budgets.ts';
import { MAX_REPORT_BYTES, parseReport, renderBundle, renderTransfer, REPORT_FILES, TRANSFER_REASON, transferOverruns, type BundleReport, type BundleSizes, type Report, type Transfer, type TransferReport } from './pr-report.ts';
import { ARTIFACT, WORKFLOW, type Measurement } from './transfer.ts';

export const MARKER = '<!-- boite:thread-transfer-impact -->';
export const FOOTER = 'Updated in place by a trusted workflow. PR artifacts are strictly validated and never executed.';
/** The artifact each report travels in, named `<name>-<attempt>` after the attempt its job ran in. */
export const ARTIFACTS = { transfer: 'thread-transfer-report', bundle: 'bundle-report' } as const;
/** The ci.yml job that leaves each report. */
export const REPORT_JOBS = { transfer: 'Thread transfer', bundle: 'Bundle size' } as const;

/** The fields of a `workflow_run` this job reads. */
export interface WorkflowRun {
  id: number;
  run_attempt: number;
  workflow_id: number;
  event: string;
  head_sha: string;
  head_branch: string | null;
  conclusion: string | null;
  html_url: string;
  head_repository: { full_name: string; owner: { login: string } } | null;
  pull_requests: { number: number; head: { sha: string }; base: { ref: string } }[];
}

type Get = <T>(path: string) => Promise<T>;

/**
 * The pull request into `base` that `run` tested, or undefined when GitHub
 * ties the run to another target or to several pull requests: a branch open
 * against two targets runs once for each, and nothing tells those runs apart.
 * A pull request from a fork is missing from `pull_requests`, so it is looked
 * up by its head branch, and only one whose head is still the run's commit
 * counts.
 */
export async function findPull(run: WorkflowRun, base: string, get: Get): Promise<number | undefined> {
  let pulls = run.pull_requests.filter((pull) => pull.head.sha === run.head_sha);
  if (pulls.length === 0) {
    const owner = run.head_repository?.owner.login;
    if (!owner || !run.head_branch) return undefined;
    const open = await get<{ number: number; head: { sha: string }; base: { ref: string } }[]>(`pulls?state=open&per_page=10&head=${encodeURIComponent(`${owner}:${run.head_branch}`)}`);
    pulls = open.filter((pull) => pull.head.sha === run.head_sha);
  }
  return pulls.length === 1 && pulls[0]!.base.ref === base ? pulls[0]!.number : undefined;
}

/**
 * Whether `run` is the newest run and attempt of its workflow for pull
 * request `pr` at its commit: a rerun's comment is never overwritten by the
 * run it replaced. A run GitHub ties to other pull requests, or from another
 * branch or fork, is not this one's.
 */
export async function newestRun(run: WorkflowRun, pr: number, get: Get): Promise<boolean> {
  const { workflow_runs } = await get<{ workflow_runs: Pick<WorkflowRun, 'id' | 'run_attempt' | 'head_branch' | 'head_repository' | 'pull_requests'>[] }>(`actions/workflows/${run.workflow_id}/runs?head_sha=${run.head_sha}&event=pull_request&per_page=50`);
  return !workflow_runs.some((other) => other.head_branch === run.head_branch && other.head_repository?.full_name === run.head_repository?.full_name
    && (other.pull_requests.length === 0 || other.pull_requests.some((pull) => pull.number === pr))
    && (other.id > run.id || (other.id === run.id && other.run_attempt > run.run_attempt)));
}

/**
 * The commit main stood at when `run` was created: the head of main's last
 * push run by then. A rerun keeps its first attempt's merge commit, so the
 * first attempt's creation counts. A push in the same seconds can leave the
 * two apart: the comment then compares nothing rather than the wrong commit.
 */
export async function mainTipAt(run: Pick<WorkflowRun, 'id'>, branch: string, get: Get): Promise<string | undefined> {
  const { created_at } = await get<{ created_at: string }>(`actions/runs/${run.id}/attempts/1`);
  const { workflow_runs } = await get<{ workflow_runs: { head_sha: string }[] }>(`actions/runs?branch=${encodeURIComponent(branch)}&event=push&created=${encodeURIComponent(`<=${created_at}`)}&per_page=1`);
  return workflow_runs[0]?.head_sha;
}

/** Why a run holds no report: its job was skipped, the run has no such job, or the job left none. */
export type NoReport = 'skipped' | 'absent' | 'missing';

/**
 * The attempt the job `name` last ran in, up to the run's own. A rerun of
 * other jobs carries it over with the start time of its first run, earlier
 * than the attempt's.
 */
export async function jobAttempt(run: Pick<WorkflowRun, 'id' | 'run_attempt'>, name: string, get: Get): Promise<number | NoReport> {
  for (let attempt = run.run_attempt; attempt >= 1; attempt--) {
    const { run_started_at } = await get<{ run_started_at: string }>(`actions/runs/${run.id}/attempts/${attempt}`);
    const { jobs } = await get<{ jobs: { name: string; conclusion: string | null; started_at: string | null }[] }>(`actions/runs/${run.id}/attempts/${attempt}/jobs?per_page=100`);
    const job = jobs.find((entry) => entry.name === name);
    if (!job) return 'absent';
    if (job.conclusion === 'skipped') return 'skipped';
    if (!job.started_at) return 'missing';
    if (Date.parse(job.started_at) >= Date.parse(run_started_at)) return attempt;
  }
  return 'missing';
}

/**
 * Why a job that ran left no report. Its upload runs whatever the job's
 * outcome, so a job that passed without one ran a workflow from before the
 * report: a branch that has not merged main since.
 */
export function noArtifact(conclusion: string | null): NoReport {
  return conclusion === 'success' ? 'absent' : 'missing';
}

/** A report `text` that belongs to pull request `pr` at `head`, or an error saying why not. */
export function acceptReport<K extends Report['kind']>(text: string, kind: K, pr: number, head: string): Extract<Report, { kind: K }> {
  const report = parseReport(text, kind);
  if (report.pr !== pr) throw new Error(`${REPORT_FILES[kind]}: pull request ${report.pr}, expected ${pr}, the run's`);
  if (report.head !== head) throw new Error(`${REPORT_FILES[kind]}: head ${report.head}, expected ${head}, the run's`);
  return report;
}

/**
 * A report with what main and the body say about it. `tip` is main's tip
 * when the run was created; main's numbers are read only when the report
 * was compared with that commit.
 */
export interface TransferView { report: TransferReport; tip: string | undefined; baseline: Transfer | null; reason: boolean }
/** The bundle report the same way, with main's sizes at its base and the published ceiling. */
export interface BundleView { report: BundleReport; tip: string | undefined; baseSizes: BundleSizes | null; ceiling: BundleSizes | null; reason: boolean }

const short = (sha: string) => `\`${sha.slice(0, 8)}\``;
const CONCLUSIONS: Record<string, string> = { success: '✅ passed', failure: '❌ failed', cancelled: '⚪ cancelled', timed_out: '❌ timed out' };
const onTip = (view: { report: Report; tip: string | undefined }) => view.report.base === view.tip;

const NO_TRANSFER: Record<NoReport, string> = {
  skipped: 'Thread transfer was not measured: this pull request changes neither the core nor the UI.',
  absent: "Thread transfer was not measured: this branch's workflow predates the report, merging main brings it in.",
  missing: 'Thread transfer left no report: the job stopped before writing it, its log is in the run below.',
};

/** Why main's column is empty. */
function noBaseline(view: { report: Report; tip: string | undefined }): string {
  if (onTip(view)) return `Main kept no measurement at ${short(view.report.base)}: growth is not judged here.`;
  const tip = view.tip ? `main stood at ${short(view.tip)}` : 'main\'s tip is unknown';
  return `The report compares with ${short(view.report.base)}, but ${tip} when the run started: nothing is compared.`;
}

/** The comment's body. `repo` is `owner/name`, for the link to how the numbers are made. */
export function renderComment(repo: string, run: Pick<WorkflowRun, 'head_sha' | 'conclusion' | 'html_url'>, transfer: TransferView | NoReport, bundle: BundleView | NoReport): string {
  const docs = `https://github.com/${repo}/blob/main/docs/internals/ci.md`;
  const lines = [MARKER, '## Thread transfer impact', ''];
  if (typeof transfer === 'object') {
    const explained = transfer.reason && transferOverruns(transfer.report.metrics, transfer.baseline).length > 0;
    lines.push(
      `What one recorded agent turn costs a phone, replayed through each real driver: bytes on the wire after compression, the same on every run of a commit ([how](${docs}#thread-transfer)).`,
      '',
      renderTransfer({ metrics: transfer.report.metrics, baseline: transfer.baseline }),
      '',
      transfer.baseline
        ? `Ceilings: main plus 1 % for bytes, main for messages. ${explained ? `Growth above them is explained under \`## ${TRANSFER_REASON}\` in the pull request body.` : `Growth above them needs a \`## ${TRANSFER_REASON}\` section in the pull request body.`}`
        : noBaseline(transfer),
      '',
    );
  } else {
    lines.push(NO_TRANSFER[transfer], '');
  }
  if (typeof bundle === 'object') {
    lines.push(`### Bundle size ([how](${docs}#bundle-growth))`, '', renderBundle({ sizes: bundle.report.sizes, baseSizes: bundle.baseSizes, ceiling: bundle.ceiling, reason: bundle.reason }), '');
    if (!bundle.baseSizes) lines.push(noBaseline(bundle), '');
  } else if (bundle === 'missing') {
    lines.push(`### Bundle size ([how](${docs}#bundle-growth))`, '', 'Bundle size left no report: the job stopped before writing it, its log is in the run below.', '');
  }
  const view = typeof transfer === 'object' ? transfer : typeof bundle === 'object' ? bundle : undefined;
  lines.push(
    'This PR\'s numbers come from its own jobs; main\'s numbers and the ceilings come from main\'s runs.',
    '',
    [view && (onTip(view) ? `Baseline: main at ${short(view.report.base)}` : 'Baseline: none'), `this PR at ${short(run.head_sha)}`, `CI: [${CONCLUSIONS[run.conclusion ?? ''] ?? run.conclusion ?? 'unknown'}](${run.html_url})`].filter(Boolean).join(' · '),
    '',
    `<sub>${FOOTER}</sub>`,
  );
  return lines.join('\n');
}

/** The comment to edit: the newest by `author` holding the marker. */
export function ownComment(comments: { id: number; body?: string | null; user: { login: string } | null }[], author: string): number | undefined {
  return comments.findLast((comment) => comment.user?.login === author && comment.body?.startsWith(MARKER))?.id;
}

/** The report of `kind` from the attempt its job last ran in, or why there is none. */
async function download(run: WorkflowRun, kind: 'transfer' | 'bundle'): Promise<string | NoReport> {
  const attempt = await jobAttempt(run, REPORT_JOBS[kind], api);
  if (typeof attempt !== 'number') return attempt;
  const name = `${ARTIFACTS[kind]}-${attempt}`;
  const { artifacts } = await api<{ artifacts: { name: string; expired: boolean; size_in_bytes: number }[] }>(`actions/runs/${run.id}/artifacts?per_page=100&name=${name}`);
  const artifact = artifacts.find((entry) => entry.name === name && !entry.expired);
  if (!artifact) return noArtifact(await jobConclusion(run, attempt, REPORT_JOBS[kind]));
  if (artifact.size_in_bytes > MAX_REPORT_BYTES) throw new Error(`${name}: ${artifact.size_in_bytes} bytes, expected at most ${MAX_REPORT_BYTES}`);
  const dir = mkdtempSync(join(process.env.RUNNER_TEMP ?? tmpdir(), `${name}-`));
  const got = Bun.spawnSync(['gh', 'run', 'download', String(run.id), '--name', name, '--dir', dir, '--repo', process.env.GITHUB_REPOSITORY!], { stdout: 'inherit', stderr: 'inherit' });
  if (got.exitCode !== 0) throw new Error(`gh run download ${run.id} --name ${name}: exit ${got.exitCode}`);
  const path = join(dir, REPORT_FILES[kind]);
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.size > MAX_REPORT_BYTES) throw new Error(`${name}: ${REPORT_FILES[kind]} is ${stat ? `not a plain file of at most ${MAX_REPORT_BYTES} bytes` : 'missing'}`);
  return readFileSync(path, 'utf8');
}

async function jobConclusion(run: WorkflowRun, attempt: number, name: string): Promise<string | null> {
  const { jobs } = await api<{ jobs: { name: string; conclusion: string | null }[] }>(`actions/runs/${run.id}/attempts/${attempt}/jobs?per_page=100`);
  return jobs.find((entry) => entry.name === name)?.conclusion ?? null;
}

const isNoReport = (value: unknown): value is NoReport => value === 'skipped' || value === 'absent' || value === 'missing';

/** Main's transfer numbers at `sha`, from thread-transfer.yml's push run. */
async function mainTransfer(sha: string): Promise<Transfer | null> {
  const dir = await mainArtifact(sha, WORKFLOW, ARTIFACT);
  if (!dir) return null;
  const measured = JSON.parse(readFileSync(join(dir, `${ARTIFACT}.json`), 'utf8')) as Measurement;
  return measured.commit === sha ? measured.metrics : null;
}

/**
 * `--run <id>` comments for a run by hand, as the signed-in `gh` user: the
 * check of a change to this file before it reaches the default branch.
 */
async function main(args: string[]): Promise<void> {
  const local = args[0] === '--run' && /^\d+$/.test(args[1] ?? '') ? Number(args[1]) : undefined;
  if (args.length && local === undefined) throw new Error('usage: bun scripts/ci/pr-comment.ts [--run <run id>]');
  const event = local === undefined ? (JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH!, 'utf8')) as { workflow_run: WorkflowRun; repository: { default_branch: string } }) : undefined;
  const run = event?.workflow_run ?? await api<WorkflowRun>(`actions/runs/${local}`);
  const defaultBranch = event?.repository.default_branch ?? (await api<{ default_branch: string }>('')).default_branch;
  const author = local === undefined ? 'github-actions[bot]' : (JSON.parse(Bun.spawnSync(['gh', 'api', 'user']).stdout.toString()) as { login: string }).login;
  if (run.event !== 'pull_request') return console.log(`run ${run.id} came from ${run.event}, not a pull request`);
  const pr = await findPull(run, defaultBranch, api);
  if (pr === undefined) return console.log(`run ${run.id}: no single open pull request into ${defaultBranch} has ${run.head_sha} as its head`);
  const transferText = await download(run, 'transfer');
  const bundleText = await download(run, 'bundle');
  const transferReport = isNoReport(transferText) ? transferText : acceptReport(transferText, 'transfer', pr, run.head_sha);
  const bundleReport = isNoReport(bundleText) ? bundleText : acceptReport(bundleText, 'bundle', pr, run.head_sha);

  const pull = await api<{ body: string | null }>(`pulls/${pr}`);
  const tip = typeof transferReport === 'object' || typeof bundleReport === 'object' ? await mainTipAt(run, defaultBranch, api) : undefined;
  const transfer: TransferView | NoReport = isNoReport(transferReport) ? transferReport : {
    report: transferReport,
    tip,
    baseline: tip && transferReport.base === tip ? await mainTransfer(tip) : null,
    reason: bodyReason(pull.body, TRANSFER_REASON) !== undefined,
  };
  const bundle: BundleView | NoReport = isNoReport(bundleReport) ? bundleReport : {
    report: bundleReport,
    tip,
    baseSizes: tip && bundleReport.base === tip ? (await mainMeasurement(tip)) ?? null : null,
    ceiling: (await publishedLimit())?.sizes ?? null,
    reason: bodyReason(pull.body) !== undefined,
  };

  const comments: { id: number; body?: string | null; user: { login: string } | null }[] = [];
  for (let page = 1; ; page++) {
    const batch = await api<typeof comments>(`issues/${pr}/comments?per_page=100&page=${page}`);
    comments.push(...batch);
    if (batch.length < 100) break;
  }
  const existing = ownComment(comments, author);
  // Both jobs skipped and no comment yet: nothing was measured, nothing to say.
  const silent = (view: object | NoReport) => view === 'skipped' || view === 'absent';
  if (silent(transfer) && silent(bundle) && existing === undefined) return console.log(`#${pr}: no report in run ${run.id}`);
  const body = renderComment(process.env.GITHUB_REPOSITORY!, run, transfer, bundle);
  // Checked last, just before writing: a push, a closed pull request, a new target or a rerun since the run started leaves the comment alone.
  const current = await api<{ state: string; head: { sha: string }; base: { ref: string } }>(`pulls/${pr}`);
  if (current.state !== 'open' || current.base.ref !== defaultBranch) return console.log(`#${pr} is ${current.state} into ${current.base.ref}: no comment`);
  if (current.head.sha !== run.head_sha) return console.log(`#${pr} moved to ${current.head.sha}: its own run will comment`);
  if (!await newestRun(run, pr, api)) return console.log(`#${pr}: a newer run or attempt of ${run.head_sha} will comment`);
  if (existing === undefined) await api(`issues/${pr}/comments`, { method: 'POST', body: { body } });
  else await api(`issues/comments/${existing}`, { method: 'PATCH', body: { body } });
  console.log(`#${pr}: comment ${existing === undefined ? 'created' : `${existing} updated`}`);
}

if (import.meta.main) await main(process.argv.slice(2));
