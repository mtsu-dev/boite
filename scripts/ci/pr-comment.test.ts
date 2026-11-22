import { expect, test } from 'bun:test';
import { acceptReport, FOOTER, findPull, jobAttempt, mainTipAt, MARKER, newestRun, noArtifact, ownComment, renderComment, type WorkflowRun } from './pr-comment.ts';
import { bundleReport, SIZES, TRANSFER, transferReport } from './pr-report.test.ts';

const HEAD = 'a'.repeat(40);
const run = (changes: Partial<WorkflowRun> = {}): WorkflowRun => ({
  id: 7, run_attempt: 1, workflow_id: 3, event: 'pull_request', head_sha: HEAD, head_branch: 'ci/x', conclusion: 'success', html_url: 'https://github.com/o/r/actions/runs/7',
  head_repository: { full_name: 'fork-owner/boite', owner: { login: 'fork-owner' } }, pull_requests: [], ...changes,
});
const pull = (number: number, sha: string, base = 'main') => ({ number, head: { sha }, base: { ref: base } });

test('finds the one pull request into main a run tested, from a fork too', async () => {
  const asked: string[] = [];
  const open = [{ number: 4, head: { sha: 'c'.repeat(40) }, base: { ref: 'main' } }, { number: 5, head: { sha: HEAD }, base: { ref: 'main' } }];
  const get = (list: typeof open) => async <T,>(path: string): Promise<T> => {
    asked.push(path);
    return list as T;
  };
  expect(await findPull(run({ pull_requests: [pull(9, HEAD)] }), 'main', get(open))).toBe(9);
  expect(asked).toEqual([]);
  // GitHub names the run's target: a run for the pull request into release is not main's.
  expect(await findPull(run({ pull_requests: [pull(8, HEAD, 'release')] }), 'main', get(open))).toBeUndefined();
  // One branch open against two targets runs once for each, and nothing tells which run is which.
  expect(await findPull(run({ pull_requests: [pull(8, HEAD, 'release'), pull(9, HEAD)] }), 'main', get(open))).toBeUndefined();
  expect(await findPull(run(), 'main', get(open))).toBe(5);
  expect(asked).toEqual(['pulls?state=open&per_page=10&head=fork-owner%3Aci%2Fx']);
  expect(await findPull(run(), 'main', get([...open, { number: 6, head: { sha: HEAD }, base: { ref: 'release' } }]))).toBeUndefined();
  expect(await findPull(run({ head_sha: 'd'.repeat(40) }), 'main', get(open))).toBeUndefined();
});

test("main's tip is the head of its last push run before the run's first attempt", async () => {
  const asked: string[] = [];
  const get = async <T,>(path: string): Promise<T> => {
    asked.push(path);
    return (path.includes('/attempts/') ? { created_at: '2026-11-22T01:05:03Z' } : { workflow_runs: path.includes('2026') ? [{ head_sha: 'b'.repeat(40) }] : [] }) as T;
  };
  expect(await mainTipAt(run({ run_attempt: 3 }), 'main', get)).toBe('b'.repeat(40));
  expect(asked).toEqual(['actions/runs/7/attempts/1', 'actions/runs?branch=main&event=push&created=%3C%3D2026-11-22T01%3A05%3A03Z&per_page=1']);
});

test('a report comes from the attempt its job last ran in, never from one a rerun replaced', async () => {
  // Attempt 2 reran the bundle job only: the transfer job it carried over kept its first start.
  const attempts: Record<number, { started: string; jobs: { name: string; conclusion: string | null; started_at: string | null }[] }> = {
    1: { started: '2026-11-22T01:05:02Z', jobs: [{ name: 'Thread transfer', conclusion: 'success', started_at: '2026-11-22T01:05:10Z' }, { name: 'Bundle size', conclusion: 'failure', started_at: '2026-11-22T01:05:09Z' }, { name: 'Lint', conclusion: 'skipped', started_at: '2026-11-22T01:05:04Z' }] },
    2: { started: '2026-11-22T01:11:56Z', jobs: [{ name: 'Thread transfer', conclusion: 'success', started_at: '2026-11-22T01:05:10Z' }, { name: 'Bundle size', conclusion: 'success', started_at: '2026-11-22T01:12:00Z' }, { name: 'Lint', conclusion: 'skipped', started_at: '2026-11-22T01:05:04Z' }] },
  };
  const get = async <T,>(path: string): Promise<T> => {
    const attempt = attempts[Number(/attempts\/(\d+)/.exec(path)![1])]!;
    return (path.endsWith('/jobs?per_page=100') ? { jobs: attempt.jobs } : { run_started_at: attempt.started }) as T;
  };
  expect(await jobAttempt(run({ run_attempt: 2 }), 'Bundle size', get)).toBe(2);
  expect(await jobAttempt(run({ run_attempt: 2 }), 'Thread transfer', get)).toBe(1);
  expect(await jobAttempt(run({ run_attempt: 2 }), 'Lint', get)).toBe('skipped');
  expect(await jobAttempt(run({ run_attempt: 2 }), 'Missing', get)).toBe('absent');
});

test('only the newest run and attempt of the same pull request writes', async () => {
  const other = (id: number, run_attempt: number, pulls: number[] = [9], head_branch = 'ci/x', full_name = 'fork-owner/boite') =>
    ({ id, run_attempt, head_branch, head_repository: { full_name }, pull_requests: pulls.map((number) => pull(number, HEAD)) });
  const runs = (list: ReturnType<typeof other>[]) => async <T,>(): Promise<T> => ({ workflow_runs: list }) as T;
  expect(await newestRun(run(), 9, runs([other(7, 1), other(6, 2)]))).toBe(true);
  expect(await newestRun(run(), 9, runs([other(7, 2)]))).toBe(false);
  expect(await newestRun(run(), 9, runs([other(7, 1), other(8, 1)]))).toBe(false);
  // A fork's runs name no pull request: its branch is the pull request.
  expect(await newestRun(run(), 9, runs([other(7, 1), other(8, 1, [])]))).toBe(false);
  // The same commit as another pull request, from this branch into release or from another branch or fork, does not silence this one.
  expect(await newestRun(run(), 9, runs([other(7, 1), other(8, 1, [10]), other(9, 1, [9], 'ci/y'), other(10, 1, [9], 'ci/x', 'someone/boite')]))).toBe(true);
});

test("keeps a report only for the run's own pull request and head", () => {
  const text = JSON.stringify(transferReport());
  expect(acceptReport(text, 'transfer', 1210, HEAD).pr).toBe(1210);
  expect(() => acceptReport(text, 'transfer', 1211, HEAD)).toThrow('pull request 1210, expected 1211');
  expect(() => acceptReport(text, 'transfer', 1210, 'b'.repeat(40))).toThrow(`head ${HEAD}, expected ${'b'.repeat(40)}`);
});

test('the comment carries its marker, both commits, the run and the trust line', () => {
  const transfer = { report: transferReport(), tip: 'b'.repeat(40), baseline: TRANSFER, reason: false };
  const bundle = { report: bundleReport(), tip: 'b'.repeat(40), baseSizes: SIZES, ceiling: null, reason: false };
  const body = renderComment('o/r', run(), transfer, bundle);
  expect(body.startsWith(`${MARKER}\n## Thread transfer impact`)).toBe(true);
  expect(body).toContain('#### Codex');
  expect(body).toContain('| uiEntryChunk | 1,000 | 1,000 | 0 (0.00 %) | n/a | ✅ |');
  expect(body).toContain('Baseline: main at `bbbbbbbb` · this PR at `aaaaaaaa` · CI: [✅ passed](https://github.com/o/r/actions/runs/7)');
  expect(body.endsWith(`<sub>${FOOTER}</sub>`)).toBe(true);
  expect(renderComment('o/r', run({ conclusion: 'failure' }), 'skipped', 'skipped')).toContain('was not measured: this pull request changes neither the core nor the UI.');
});

test('a job that ran and left no report says so, never that nothing changed', () => {
  const body = renderComment('o/r', run({ conclusion: 'failure' }), 'missing', 'missing');
  expect(body).toContain('Thread transfer left no report: the job stopped before writing it');
  expect(body).toContain('Bundle size left no report: the job stopped before writing it');
  expect(body).not.toContain('changes neither');
});

test('a branch whose workflow predates the reports gets no comment for them', () => {
  // Its bundle job passes and uploads nothing: that is a workflow without the report, not a job that stopped.
  expect(noArtifact('success')).toBe('absent');
  expect(noArtifact('failure')).toBe('missing');
  expect(noArtifact('cancelled')).toBe('missing');
  const body = renderComment('o/r', run(), 'absent', 'absent');
  expect(body).toContain("this branch's workflow predates the report, merging main brings it in.");
  expect(body).not.toContain('Bundle size');
});

test("a base other than main's tip when the run started compares nothing", () => {
  const off = renderComment('o/r', run(), { report: transferReport(), tip: 'c'.repeat(40), baseline: null, reason: false }, { report: bundleReport(), tip: 'c'.repeat(40), baseSizes: null, ceiling: null, reason: false });
  expect(off).toContain('The report compares with `bbbbbbbb`, but main stood at `cccccccc` when the run started: nothing is compared.');
  expect(off).toContain('Baseline: none · this PR at `aaaaaaaa`');
  expect(off).toContain('| Whole scenario | n/a | 15,378 | n/a | n/a |  |');
  expect(off).toContain('| uiEntryChunk | n/a | 1,000 | n/a | n/a |  |');
  expect(renderComment('o/r', run(), { report: transferReport(), tip: undefined, baseline: null, reason: false }, 'skipped')).toContain("but main's tip is unknown when the run started");
  expect(renderComment('o/r', run(), { report: transferReport(), tip: 'b'.repeat(40), baseline: null, reason: false }, 'skipped')).toContain('Main kept no measurement at `bbbbbbbb`: growth is not judged here.');
});

test("edits only its author's marked comment", () => {
  const comments = [
    { id: 1, body: `${MARKER}\nquoted by a person`, user: { login: 'someone' } },
    { id: 2, body: `${MARKER}\n## Thread transfer impact`, user: { login: 'github-actions[bot]' } },
    { id: 3, body: 'mentions the marker later: <!-- boite:thread-transfer-impact -->', user: { login: 'github-actions[bot]' } },
  ];
  expect(ownComment(comments, 'github-actions[bot]')).toBe(2);
  expect(ownComment(comments, 'nobody')).toBeUndefined();
});
