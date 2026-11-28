/**
 * Thread transfer: what one recorded agent turn costs a phone, in bytes, for
 * Claude, Codex and OpenCode (bench/transfer/measure.ts,
 * docs/internals/ci.md#thread-transfer). The numbers are the same for a
 * commit on every run, so they can fail a pull request:
 *
 * - main's push runs thread-transfer.yml, which keeps them as the
 *   `thread-transfer` artifact;
 * - a pull request that changes the core or the UI is compared with the main
 *   commit its merge ref sits on (comparisonBase in budgets.ts), measured
 *   again here when main kept no artifact for it. A byte count above main
 *   plus 1 %, or one message more than main, needs a `## Thread transfer`
 *   section in the pull request body.
 *
 * Run: bun scripts/ci/transfer.ts measure <out.json>
 *      bun scripts/ci/transfer.ts check <head.json> <report.json> (in a pull request's CI)
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { api, bodyReason, comparisonBase, mainArtifact, run } from './budgets.ts';
import { renderTransfer, TRANSFER_REASON, transferOverruns, writeReport, type Transfer } from './pr-report.ts';

/** What `measure` writes and the `thread-transfer` artifact holds. */
export interface Measurement {
  commit: string;
  metrics: Transfer;
}

export const ARTIFACT = 'thread-transfer';
export const WORKFLOW = '.github/workflows/thread-transfer.yml';
/** Runs a measurement takes: two that differ mean the bench is not deterministic, which fails the job. */
const RUNS = 2;

/** The verdict on `metrics` against main's `baseline`: the summary and each failure. */
export function judge(metrics: Transfer, baseline: Transfer | null, baseSource: string, reason: string | undefined): { report: string; errors: string[] } {
  const overruns = transferOverruns(metrics, baseline);
  const errors = overruns.length && !reason
    ? [`${overruns.join('; ')}. Shrink what the change sends, or say what grows and why under a "## ${TRANSFER_REASON}" heading in the pull request body, then rerun this job.`]
    : [];
  const notes = [
    baseline ? `Base: ${baseSource}.` : `Base: ${baseSource}, no measurement: growth not checked.`,
    ...(overruns.length && reason ? ['', `Above a ceiling, explained in the body: ${reason.split('\n')[0]!.replace(/[<>&]/g, (c) => `&#${c.charCodeAt(0)};`)}`] : []),
  ];
  return { report: [renderTransfer({ metrics, baseline }), '', ...notes].join('\n'), errors };
}

/** Every agent `RUNS` times on this checkout, failing when two runs differ. */
async function measureHere(): Promise<Transfer> {
  const { measureAll } = await import('../../bench/transfer/measure.ts');
  const runs: Transfer[] = [];
  for (let index = 0; index < RUNS; index++) runs.push(await measureAll());
  const first = JSON.stringify(runs[0]);
  const other = runs.find((metrics) => JSON.stringify(metrics) !== first);
  if (other) throw new Error(`Thread transfer: two runs of the same commit differ, the bench is no longer deterministic:\n${first}\n${JSON.stringify(other)}`);
  return runs[0]!;
}

/** Main's numbers at `sha`: its artifact, or a measurement of a worktree of it; null before the bench existed there. */
async function baselineAt(sha: string): Promise<{ metrics: Transfer | null; source: string }> {
  const short = sha.slice(0, 8);
  const dir = await mainArtifact(sha, WORKFLOW, ARTIFACT);
  if (dir) {
    const measured = JSON.parse(readFileSync(join(dir, `${ARTIFACT}.json`), 'utf8')) as Measurement;
    if (measured.commit === sha) return { metrics: measured.metrics, source: `\`${short}\` (main ${ARTIFACT} artifact)` };
  }
  const tree = join(process.env.RUNNER_TEMP ?? tmpdir(), `transfer-base-${short}`);
  run(['git', 'fetch', '--no-tags', '--depth=1', 'origin', sha]);
  run(['git', 'worktree', 'add', '--detach', tree, sha]);
  if (!existsSync(join(tree, 'scripts', 'ci', 'transfer.ts'))) return { metrics: null, source: `\`${short}\` (before the bench existed)` };
  // Another Bun may compress another way: main's numbers come from the Bun main pins.
  const pinned = (JSON.parse(readFileSync(join(tree, 'package.json'), 'utf8')) as { packageManager?: string }).packageManager ?? '';
  if (!/^bun@\d+\.\d+\.\d+$/.test(pinned)) return { metrics: null, source: `\`${short}\` (main kept no artifact and pins "${pinned}", expected bun@<major>.<minor>.<patch>)` };
  const bun = pinned === `bun@${Bun.version}` ? ['bun'] : ['bun', 'x', pinned];
  run([...bun, 'install', '--frozen-lockfile'], tree);
  const out = join(tree, '.artifacts', `${ARTIFACT}.json`);
  run([...bun, 'scripts/ci/transfer.ts', 'measure', out], tree);
  return { metrics: (JSON.parse(readFileSync(out, 'utf8')) as Measurement).metrics, source: `\`${short}\` (measured here with ${pinned}: main kept no artifact)` };
}

async function check(headFile: string, reportFile: string): Promise<void> {
  const metrics = (JSON.parse(readFileSync(headFile, 'utf8')) as Measurement).metrics;
  const pullBase = process.env.BASE_SHA ?? '';
  if (!/^[0-9a-f]{40}$/.test(pullBase)) throw new Error(`BASE_SHA: "${pullBase}", expected the pull request's 40-character base commit`);
  const headCommit = Bun.spawnSync(['git', 'cat-file', '-p', 'HEAD'], { stderr: 'inherit' });
  if (headCommit.exitCode !== 0) throw new Error('git cat-file -p HEAD failed');
  const baseSha = comparisonBase(headCommit.stdout.toString(), pullBase);
  const base = await baselineAt(baseSha);
  const number = Number(process.env.PR_NUMBER);
  const pull = await api<{ body: string | null }>(`pulls/${number}`);
  const reason = bodyReason(pull.body, TRANSFER_REASON);
  writeReport(reportFile, { kind: 'transfer', version: 1, pr: number, head: process.env.HEAD_SHA ?? '', base: baseSha, metrics });
  const verdict = judge(metrics, base.metrics, base.source, reason);
  console.log(verdict.report);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## ${TRANSFER_REASON}\n\n${verdict.report}\n`);
  if (verdict.errors.length) throw new Error(`${TRANSFER_REASON}:\n${verdict.errors.join('\n')}`);
}

if (import.meta.main) {
  const [command, path, report] = process.argv.slice(2);
  if (command === 'measure' && path) {
    const metrics = await measureHere();
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, `${JSON.stringify({ commit: process.env.GITHUB_SHA ?? '', metrics } satisfies Measurement, null, 2)}\n`);
    console.log(renderTransfer({ metrics, baseline: null }));
  } else if (command === 'check' && path && report) {
    await check(path, report);
  } else {
    throw new Error('usage: bun scripts/ci/transfer.ts measure <out.json> | check <head.json> <report.json>');
  }
}

