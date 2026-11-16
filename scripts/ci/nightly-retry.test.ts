import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decide, DRY_RUN_TITLE, type FailedJob, INFRA_PATTERNS, MAX_ATTEMPTS } from './nightly-retry.ts';

// The annotation GitHub wrote on Desktop / macOS x64 in runs 42471603379,
// 42806494714, 43208852652 and 43926328921, and a Gradle failure carrying the
// 429 the Android app hit in 43926328921 (2026-11-16).
const notAcquired: FailedJob = {
  name: 'Desktop / macOS x64',
  annotations: ['The job was not acquired by Runner of type hosted even after multiple attempts'],
  log: '',
};
const maven429: FailedJob = {
  name: 'Android app / Native Android app',
  annotations: ['Process completed with exit code 1.'],
  log: [
    '> Could not resolve all files for configuration \':app:debugRuntimeClasspath\'.',
    '   > Could not GET \'https://repo.maven.apache.org/maven2/androidx/core/core/1.13.1/core-1.13.1.pom\'. Received status code 429 from server: Too Many Requests',
    'BUILD FAILED in 1m 12s',
  ].join('\n'),
};
const realFailure: FailedJob = {
  name: 'Desktop / Windows x64',
  annotations: ['Process completed with exit code 1.'],
  log: 'error: expect(received).toBe(expected)\n(fail) installer keeps the data directory',
};

test('a job no runner was acquired for is rerun', () => {
  expect(decide({ runAttempt: 1, dryRun: false, jobs: [notAcquired] })).toMatchObject({ rerun: true });
});

test('a job a dependency registry rate limited is rerun', () => {
  expect(decide({ runAttempt: 1, dryRun: false, jobs: [maven429] })).toMatchObject({ rerun: true });
  // Both causes in one run, as in 43926328921's first attempt.
  expect(decide({ runAttempt: 1, dryRun: false, jobs: [notAcquired, maven429] })).toMatchObject({ rerun: true });
});

test('one real step failure among them stops the rerun and names that job', () => {
  expect(decide({ runAttempt: 1, dryRun: false, jobs: [notAcquired, realFailure, maven429] }))
    .toMatchObject({ rerun: false, reason: expect.stringContaining('Desktop / Windows x64') });
});

test('the attempt at the bound is not rerun', () => {
  expect(decide({ runAttempt: MAX_ATTEMPTS - 1, dryRun: false, jobs: [notAcquired] })).toMatchObject({ rerun: true });
  expect(decide({ runAttempt: MAX_ATTEMPTS, dryRun: false, jobs: [notAcquired] }))
    .toMatchObject({ rerun: false, reason: expect.stringContaining(`attempt ${MAX_ATTEMPTS}`) });
});

test('a dry run is never rerun, and a run with no failed job either', () => {
  expect(decide({ runAttempt: 1, dryRun: true, jobs: [notAcquired] })).toMatchObject({ rerun: false, reason: expect.stringContaining('dry run') });
  expect(decide({ runAttempt: 1, dryRun: false, jobs: [] })).toMatchObject({ rerun: false });
});

test('every pattern recognises the message it was written for', () => {
  expect(INFRA_PATTERNS.map(({ pattern }) => [notAcquired, maven429].some((job) => [...job.annotations, job.log ?? ''].some((text) => pattern.test(text)))))
    .toEqual(INFRA_PATTERNS.map(() => true));
});

test('the nightly titles a dry run so the retry can tell it apart', () => {
  // workflow_run carries no inputs: the run's title is what says dry run.
  const workflow = Bun.YAML.parse(readFileSync(join(import.meta.dir, '../../.github/workflows/nightly.yml'), 'utf8')) as { 'run-name'?: string };
  const title = /inputs\.dry-run && '([^']+)' \|\| '([^']+)'/.exec(workflow['run-name'] ?? '');
  expect(title).not.toBeNull();
  expect(DRY_RUN_TITLE.test(title![1]!)).toBe(true);
  expect(DRY_RUN_TITLE.test(title![2]!)).toBe(false);
});
