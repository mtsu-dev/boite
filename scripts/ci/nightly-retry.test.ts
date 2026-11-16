import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { confirmRerun, decide, DRY_RUN_TITLE, failedStepLog, INFRA_PATTERNS, type Job, MAX_ATTEMPTS, type Step } from './nightly-retry.ts';

// Desktop / macOS x64 as the API returned it for run 42806494714 (job
// 129797415964, 2026-11-10): no runner picked it up, GitHub ended it
// `cancelled` and wrote the reason only as an annotation; the job has no log.
const notAcquired: Job = {
  name: 'Desktop / macOS x64',
  conclusion: 'cancelled',
  annotations: [
    'The job was not acquired by Runner of type hosted even after multiple attempts',
    'Due to capacity constraints, jobs targeting macOS arm64 runners may experience longer queue times.',
  ],
  log: '',
};
// Android app / Native Android app in run 43926328921 attempt 1 (job
// 133507065887, 2026-11-16): lines of its failed step, Build the APK.
const maven429: Job = {
  name: 'Android app / Native Android app',
  conclusion: 'failure',
  annotations: ['Process completed with exit code 1.'],
  log: [
    'FAILURE: Build failed with an exception.',
    '> Could not resolve all artifacts for configuration \'classpath\'.',
    '         > Could not get resource \'https://plugins.gradle.org/m2/org/jetbrains/kotlin/kotlin-stdlib/2.0.21/kotlin-stdlib-2.0.21.pom\'.',
    '            > Could not GET \'https://repo.maven.apache.org/maven2/org/jetbrains/kotlin/kotlin-stdlib/2.0.21/kotlin-stdlib-2.0.21.pom\'. Received status code 429 from server: Too Many Requests',
  ].join('\n'),
};
const realFailure: Job = {
  name: 'Desktop / Windows x64',
  conclusion: 'failure',
  annotations: ['Process completed with exit code 1.'],
  log: 'error: expect(received).toBe(expected)\n(fail) installer keeps the data directory',
};
const green: Job = { name: 'CI passed', conclusion: 'success', annotations: [], log: '' };
const skipped: Job = { name: 'Reserve tag', conclusion: 'skipped', annotations: [], log: '' };
const first = { runAttempt: 1, currentAttempt: 1, dryRun: false };

test('a job no runner was acquired for is rerun, though GitHub ends it cancelled', () => {
  expect(decide({ ...first, jobs: [green, notAcquired, skipped] })).toMatchObject({ rerun: true });
});

test('a cancel without that annotation is no reason to rerun', () => {
  const cancelled: Job = { name: 'Desktop / Linux x64', conclusion: 'cancelled', annotations: ['The operation was canceled.'], log: '' };
  expect(decide({ ...first, jobs: [green, cancelled] })).toMatchObject({ rerun: false, reason: expect.stringContaining('Desktop / Linux x64') });
  expect(decide({ ...first, jobs: [notAcquired, cancelled] })).toMatchObject({ rerun: false });
});

test('a job a dependency registry rate limited is rerun', () => {
  expect(decide({ ...first, jobs: [green, maven429] })).toMatchObject({ rerun: true });
  // Both causes in one run, as in 43926328921's first attempt.
  expect(decide({ ...first, jobs: [notAcquired, maven429, skipped] })).toMatchObject({ rerun: true });
});

test('one real step failure among them stops the rerun and names that job', () => {
  expect(decide({ ...first, jobs: [notAcquired, realFailure, maven429] }))
    .toMatchObject({ rerun: false, reason: expect.stringContaining('Desktop / Windows x64') });
});

test('a 429 that is not a dependency download is a real failure', () => {
  const mixed: Job = { ...realFailure, log: '(pass) handles Too Many Requests\n(pass) retries on status code 429\nerror: expect(received).toBe(expected)\n(fail) installer keeps the data directory' };
  expect(decide({ ...first, jobs: [mixed] })).toMatchObject({ rerun: false });
  // A cancelled job's log never makes it infrastructure: only the runner annotation does.
  expect(decide({ ...first, jobs: [{ ...maven429, conclusion: 'cancelled', annotations: [] }] })).toMatchObject({ rerun: false });
});

test('only the failed step of a job is read', () => {
  const steps: Step[] = [
    { name: 'Run bun install --frozen-lockfile', conclusion: 'success', started_at: '2026-11-16T18:13:34Z', completed_at: '2026-11-16T18:13:35Z' },
    { name: 'Build the APK', conclusion: 'failure', started_at: '2026-11-16T18:13:36Z', completed_at: '2026-11-16T18:15:41Z' },
    { name: 'Post Run actions/checkout', conclusion: 'success', started_at: '2026-11-16T18:15:47Z', completed_at: '2026-11-16T18:15:47Z' },
  ];
  const log = [
    '﻿2026-11-16T18:13:34.7109624Z error: GET https://registry.npmjs.org/left-pad - 429',
    '2026-11-16T18:13:36.5472914Z ##[group]Run set -euo pipefail',
    '2026-11-16T18:15:41.2099244Z             > Could not GET \'https://repo.maven.apache.org/x.pom\'. Received status code 429 from server: Too Many Requests',
    '2026-11-16T18:15:41.5546725Z ##[error]Process completed with exit code 1.',
    '2026-11-16T18:15:47.1000000Z Post job cleanup.',
  ].join('\n');
  expect(failedStepLog(log, steps).split('\n')).toEqual([
    '##[group]Run set -euo pipefail',
    '            > Could not GET \'https://repo.maven.apache.org/x.pom\'. Received status code 429 from server: Too Many Requests',
    '##[error]Process completed with exit code 1.',
  ]);
  // A 429 retried in a step that passed, then a real failure later: not infrastructure.
  const late = log.replace(/\n2026-11-16T18:15:41.*/, '\n2026-11-16T18:15:41.2099244Z error: expect(received).toBe(expected)');
  expect(decide({ ...first, jobs: [{ ...realFailure, log: failedStepLog(late, steps) }] })).toMatchObject({ rerun: false });
  expect(failedStepLog(log, [])).toBe('');
});

test('a step sharing a second with the failed one does not leak into it', () => {
  // Steps are timed to the second: the log's own markers split that second.
  const steps: Step[] = [
    { name: 'Run bun install --frozen-lockfile', conclusion: 'success', started_at: '2026-11-16T18:20:10Z', completed_at: '2026-11-16T18:20:12Z' },
    { name: 'Run bun test', conclusion: 'failure', started_at: '2026-11-16T18:20:12Z', completed_at: '2026-11-16T18:20:30Z' },
    { name: 'Post Run actions/checkout', conclusion: 'success', started_at: '2026-11-16T18:20:30Z', completed_at: '2026-11-16T18:20:31Z' },
  ];
  const log = [
    '2026-11-16T18:20:10.0000000Z ##[group]Run bun install --frozen-lockfile',
    '2026-11-16T18:20:12.1000000Z error: GET https://registry.npmjs.org/left-pad - 429',
    '2026-11-16T18:20:12.2000000Z ##[group]Run bun test',
    '2026-11-16T18:20:29.0000000Z error: expect(received).toBe(expected)',
    '2026-11-16T18:20:30.1000000Z ##[error]Process completed with exit code 1.',
    '2026-11-16T18:20:30.2000000Z Post job cleanup.',
    '2026-11-16T18:20:30.3000000Z npm error 429 Too Many Requests - GET https://registry.npmjs.org/left-pad',
  ].join('\n');
  expect(failedStepLog(log, steps).split('\n')).toEqual([
    '##[group]Run bun test',
    'error: expect(received).toBe(expected)',
    '##[error]Process completed with exit code 1.',
  ]);
  expect(decide({ ...first, jobs: [{ ...realFailure, log: failedStepLog(log, steps) }] })).toMatchObject({ rerun: false });
  // With no marker to split a shared second, its lines are left out rather than guessed.
  const unmarked = log.replace('##[group]Run bun test', 'tests start').replace('##[error]Process completed with exit code 1.', 'done');
  expect(failedStepLog(unmarked, steps)).toBe('error: expect(received).toBe(expected)');
});

test('the rerun is sent only while the run still stands as the failed attempt judged', () => {
  expect(confirmRerun(2, { run_attempt: 2, status: 'completed', conclusion: 'failure' })).toMatchObject({ rerun: true });
  // A manual rerun started, or already finished, while the logs were read.
  expect(confirmRerun(2, { run_attempt: 3, status: 'in_progress', conclusion: null })).toMatchObject({ rerun: false, reason: expect.stringContaining('attempt 3') });
  expect(confirmRerun(2, { run_attempt: 3, status: 'completed', conclusion: 'failure' })).toMatchObject({ rerun: false });
  expect(confirmRerun(2, { run_attempt: 2, status: 'queued', conclusion: null })).toMatchObject({ rerun: false });
  expect(confirmRerun(2, { run_attempt: 2, status: 'completed', conclusion: 'success' })).toMatchObject({ rerun: false });
});

test('the attempt at the bound is not rerun', () => {
  const at = (attempt: number) => ({ runAttempt: attempt, currentAttempt: attempt, dryRun: false, jobs: [notAcquired] });
  expect(decide(at(MAX_ATTEMPTS - 1))).toMatchObject({ rerun: true });
  expect(decide(at(MAX_ATTEMPTS))).toMatchObject({ rerun: false, reason: expect.stringContaining(`attempt ${MAX_ATTEMPTS}`) });
});

test('an event older than the run\'s current attempt is not rerun', () => {
  expect(decide({ runAttempt: 2, currentAttempt: 3, dryRun: false, jobs: [notAcquired] }))
    .toMatchObject({ rerun: false, reason: expect.stringContaining('attempt 3') });
  expect(decide({ runAttempt: 1, currentAttempt: 2, dryRun: false, jobs: [notAcquired] })).toMatchObject({ rerun: false });
});

test('a dry run is never rerun, and a run with no failed job either', () => {
  expect(decide({ ...first, dryRun: true, jobs: [notAcquired] })).toMatchObject({ rerun: false, reason: expect.stringContaining('dry run') });
  expect(decide({ ...first, jobs: [green, skipped] })).toMatchObject({ rerun: false });
});

test('every pattern recognises the message it was written for', () => {
  const samples: Record<string, string> = {
    annotation: notAcquired.annotations[0]!,
    gradle: maven429.log!,
    npm: 'npm error 429 Too Many Requests - GET https://registry.npmjs.org/left-pad',
    bun: 'error: GET https://registry.npmjs.org/left-pad - 429',
    cargo: 'failed to get successful HTTP response from `https://index.crates.io/config.json` (151.101.1.137), got 429',
  };
  for (const { tool, pattern } of INFRA_PATTERNS) expect([tool, pattern.test(samples[tool] ?? '')]).toEqual([tool, true]);
});

test('the nightly titles a dry run so the retry can tell it apart', () => {
  // workflow_run carries no inputs: the run's title is what says dry run.
  const workflow = Bun.YAML.parse(readFileSync(join(import.meta.dir, '../../.github/workflows/nightly.yml'), 'utf8')) as { 'run-name'?: string };
  const title = /inputs\.dry-run && '([^']+)' \|\| '([^']+)'/.exec(workflow['run-name'] ?? '');
  expect(title).not.toBeNull();
  expect(DRY_RUN_TITLE.test(title![1]!)).toBe(true);
  expect(DRY_RUN_TITLE.test(title![2]!)).toBe(false);
});
