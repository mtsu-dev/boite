import { afterEach, expect, test } from 'bun:test';
import { PullRequestReviews } from '../src/pull-request-review.ts';
import { REVIEW_DIFF_BUDGET } from '../src/pull-request-diff-budget.ts';
import { connect } from '../src/client.ts';
import { echoThread, startTestCore, type TestCore } from './harness.ts';
import { rejection, thrown } from './settle.ts';
let harness: TestCore | undefined;
afterEach(async () => { await harness?.stop(); harness = undefined; });
const url = 'https://github.com/example/repo/pull/1';

test('reviews combine discussions and inline feedback, reject unsafe URLs and expose bounded file pages', async () => {
  const calls: string[][] = [];
  const service = new PullRequestReviews(async (_thread, args) => {
    calls.push(args);
    if (args[0] === 'pr') return JSON.stringify({ url, title: 'Change', body: 'Description', state: 'OPEN', headRefName: 'feature', baseRefName: 'main',
      comments: [{ author: { login: 'alice' }, body: 'Discussion', url, createdAt: '2026-01-01' }], reviews: [],
      statusCheckRollup: [{ name: 'tests', status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: 'javascript:alert(1)' }] });
    if (args.at(-1)?.includes('/comments?')) return JSON.stringify([{ user: { login: 'bob' }, body: 'Inline', url: 'https://api.github.com/repos/example/repo/pulls/comments/12', html_url: url + '#discussion_r12', path: 'src/a.ts', line: 4, created_at: '2026-01-02' }]);
    return JSON.stringify([{ filename: 'a.ts', status: 'modified', additions: 1, deletions: 1, patch: 'x'.repeat(100001) }, { filename: 'image.png', status: 'added', additions: 0, deletions: 0 }]);
  });
  const review = await service.review('t', url);
  expect(review.comments.map(c => c.body)).toEqual(['Discussion', 'Inline']);
  expect(review.comments[1]).toMatchObject({ path: 'src/a.ts', line: 4, url: url + '#discussion_r12' });
  expect(review.checks[0]).toEqual({ name: 'tests', state: 'FAILURE', url: '' });
  await service.review('t', url); expect(calls.length).toBe(2);
  const files = await service.files('t', url, 2);
  expect(files.truncated).toBe(true); expect(files.files[0]!.patch).toContain('page 2 path "a.ts"'); expect(files.files[1]!.patch).toBeNull();
  expect(calls.at(-1)?.at(-1)).toBe('repos/example/repo/pulls/1/files?per_page=30&page=2');
  const whole = await service.files('t', url, 2, 'a.ts');
  expect(whole.files.map(f => [f.path, f.patch!.length, f.omitted])).toEqual([['a.ts', 100000, 1]]); expect(calls.length).toBe(3);
  expect(() => service.files('t', url, 0)).toThrow('page');
  expect((await rejection(service.files('t', url, 2, 'missing.ts'))).reason).toMatchObject({ message: 'page 2 has no file missing.ts', data: { field: 'path', expected: 'a.ts, image.png' } });
  expect(() => service.review('t', 'https://evil.example/a/b/pull/1')).toThrow('host');
});

test('one huge patch no longer starves the small files of its page', async () => {
  const hunk = (at: number, lines: number) => [`@@ -${at},${lines} +${at},${lines} @@ function f${at}()`, ...Array.from({ length: lines }, (_, i) => `+  const value${i} = compute(${i}); // line ${i} of the hunk at ${at}`)].join('\n');
  const big = [hunk(1, 3), hunk(100, 1500), hunk(2000, 4)].join('\n'), small = (n: number) => hunk(n, 15);
  const values = [{ filename: 'src/big.ts', status: 'modified', additions: 1507, deletions: 0, patch: big },
    { filename: 'bun.lock', status: 'modified', additions: 900, deletions: 850, patch: hunk(1, 900) },
    ...Array.from({ length: 28 }, (_, i) => ({ filename: `src/small-${i}.ts`, status: 'modified', additions: 15, deletions: 0, patch: small(i + 1) }))];
  const service = new PullRequestReviews(async () => JSON.stringify(values));
  const page = await service.files('t', url, 3), [first, lock, ...rest] = page.files;
  expect(page.files.reduce((n, f) => n + (f.patch?.length ?? 0), 0)).toBeLessThanOrEqual(REVIEW_DIFF_BUDGET);
  expect(rest.map(f => f.patch)).toEqual(values.slice(2).map(v => v.patch));
  expect(rest.every(f => f.omitted === undefined)).toBe(true);
  // The big file keeps its two small hunks whole and the head of the long one, then says where the rest is.
  expect(first!.patch).toContain(hunk(1, 3)); expect(first!.patch).toContain(hunk(2000, 4));
  expect(first!.patch).toContain(hunk(100, 1500).split('\n').slice(0, 20).join('\n'));
  expect(first!.patch).toMatch(/more lines of this hunk left out\]/);
  expect(first!.patch!.split('\n').at(-1)).toBe(`[patch cut to fit the review budget: 1 of 3 hunks shortened, ${big.length} characters in all; read it alone, up to 100000 characters, with threads.pullRequestFiles page 3 path "src/big.ts"]`);
  expect(first!.omitted).toBeGreaterThan(big.length / 2);
  expect(lock!.patch).toBe(`[generated or lock file: +900 -850, patch of ${hunk(1, 900).length} characters left out; read it alone, up to 100000 characters, with threads.pullRequestFiles page 3 path "bun.lock"]`);
  expect(page.truncated).toBe(true);
  expect((await service.files('t', url, 3, 'src/big.ts')).files[0]!.patch).toBe(big);
  // Notes are paid for before the split: 30 cut files with the longest paths still fit.
  const long = (i: number) => `${'d'.repeat(1990)}/${i}.ts`;
  const crowded = new PullRequestReviews(async () => JSON.stringify(Array.from({ length: 30 }, (_, i) => ({ filename: i % 2 ? long(i) : `${long(i)}.lock`, status: 'modified', additions: 1, deletions: 1, patch: big }))));
  expect((await crowded.files('t', url, 1)).files.reduce((n, f) => n + f.patch!.length, 0)).toBeLessThanOrEqual(REVIEW_DIFF_BUDGET);
});

test('paired phones cannot turn review reads into arbitrary GitHub queries', async () => {
  harness = await startTestCore();
  const owner = await harness.connect(), { threadId } = await echoThread(harness, owner);
  const { grant } = await owner.call('pairing.grant', {}), phone = await connect(harness.url, '', { grant });
  try {
    expect(await thrown(phone.call('threads.pullRequestReview', { threadId, url }))).toThrow('link this');
    expect(await thrown(phone.call('threads.pullRequestFiles', { threadId, url, page: 1 }))).toThrow('link this');
    expect(await thrown(phone.call('threads.linkPullRequest', { threadId, url }))).toThrow('owner');
  } finally { phone.close(); owner.close(); }
});
