// What `threads.pullRequestFiles` hands a reader for a real pull request.
// The GitHub API is mocked: each squash commit given (default: this repo's
// #614, #621 and #524) is turned into the files API pages GitHub would serve
// (30 files a page, the patch from the first `@@`, none for a binary file),
// and every page is read through PullRequestReviews. No network, no login.
//
//   bun bench/pr-review-context.ts [commit ...]
//   BENCH_REVIEW_MODULE=<path to another pull-request-review.ts> bun bench/pr-review-context.ts
//
// Prints, per pull request, the JSON bytes of all pages, of the largest page,
// the patch characters of the largest page and how many files of the PR come
// back with less than their whole patch.
import { resolve } from 'node:path';

const commits = process.argv.slice(2).length ? process.argv.slice(2) : ['38d5ca2f7', '9ea83fda5', '060cb4528'];
const modulePath = resolve(process.env.BENCH_REVIEW_MODULE ?? `${import.meta.dir}/../packages/core/src/pull-request-review.ts`);
const { PullRequestReviews } = await import(modulePath) as typeof import('../packages/core/src/pull-request-review.ts');

function git(args: string[]): string {
  const run = Bun.spawnSync(['git', ...args], { cwd: import.meta.dir, stdout: 'pipe', stderr: 'pipe' });
  if (run.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${run.stderr.toString()}`);
  return run.stdout.toString();
}

interface ApiFile { filename: string; previous_filename?: string; status: string; additions: number; deletions: number; patch?: string }

function apiFiles(commit: string): ApiFile[] {
  const diff = git(['diff', '--find-renames', '--no-color', '--no-ext-diff', `${commit}^`, commit]);
  return diff.split(/^(?=diff --git )/m).filter(Boolean).map(section => {
    const lines = section.replace(/\n$/, '').split('\n'), at = lines.findIndex(line => line.startsWith('@@'));
    const header = at < 0 ? lines : lines.slice(0, at), body = at < 0 ? [] : lines.slice(at);
    const pick = (prefix: string) => header.find(line => line.startsWith(prefix))?.slice(prefix.length);
    const to = pick('rename to ') ?? pick('+++ b/') ?? / b\/(.+)$/.exec(lines[0]!)![1]!, from = pick('rename from ') ?? pick('--- a/');
    const status = header.some(l => l.startsWith('new file')) ? 'added' : header.some(l => l.startsWith('deleted file')) ? 'removed' : pick('rename from ') ? 'renamed' : 'modified';
    return { filename: status === 'removed' ? from! : to, ...(status === 'renamed' ? { previous_filename: from } : {}), status,
      additions: body.filter(l => l.startsWith('+')).length, deletions: body.filter(l => l.startsWith('-')).length, ...(body.length ? { patch: body.join('\n') } : {}) };
  });
}

const url = 'https://github.com/example/repo/pull/1';
for (const commit of commits) {
  const files = apiFiles(commit), title = git(['log', '-1', '--format=%s', commit]).trim();
  const service = new PullRequestReviews(async (_thread, args) => {
    const page = Number(/[?&]page=(\d+)/.exec(args.at(-1)!)![1]);
    return JSON.stringify(files.slice((page - 1) * 30, page * 30));
  });
  let bytes = 0, largest = 0, largestPatch = 0, cut = 0, pages = 0;
  for (let page = 1; ; page++) {
    const result = await service.files('bench', url, page), size = Buffer.byteLength(JSON.stringify(result));
    bytes += size; pages++;
    if (size > largest) { largest = size; largestPatch = result.files.reduce((n, f) => n + (f.patch?.length ?? 0), 0); }
    cut += result.files.filter((f, i) => f.patch !== (files[(page - 1) * 30 + i]?.patch ?? null)).length;
    if (!result.hasMore) break;
  }
  const raw = files.reduce((n, f) => n + (f.patch?.length ?? 0), 0);
  console.log(`${commit} ${title}`);
  console.log(`  ${files.length} files, ${pages} pages, ${raw} patch chars from git; all pages ${bytes} B, largest page ${largest} B (${largestPatch} patch chars), files not whole ${cut}`);
}
