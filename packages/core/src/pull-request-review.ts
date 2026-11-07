import { pullRequestAddress, type PullRequestReview, type PullRequestFiles, type PullRequestComment } from '@boite/contracts';
import { refused } from './errors.ts';
import { budgetPatches, REVIEW_FILE_LIMIT } from './pull-request-diff-budget.ts';

type Row = Record<string, unknown>;
const row = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown, max = 500): string => typeof value === 'string' ? value.slice(0, max) : '';
const safeUrl = (value: unknown): string => { try { const u = new URL(String(value)); return u.protocol === 'https:' && !u.username && !u.password ? u.href : ''; } catch { return ''; } };
function json(raw: string): unknown { if (raw.length > 4 * 1024 * 1024) throw refused('GitHub review response exceeds 4 MB'); return JSON.parse(raw); }
function comment(value: unknown): PullRequestComment {
  const c = row(value), author = row(c.author ?? c.user);
  return { author: text(author.login), body: text(c.body, 12000), url: safeUrl(c.html_url ?? c.url), at: text(c.createdAt ?? c.submittedAt ?? c.created_at, 100),
    ...(c.path ? { path: text(c.path, 2000), line: Number.isSafeInteger(c.line) ? Number(c.line) : undefined } : {}), ...(c.state ? { state: text(c.state) } : {}) };
}

/** Read-only GitHub calls. The caller checks the thread's explicit links first. */
export class PullRequestReviews {
  private cache = new Map<string, { until: number; value: Promise<unknown> }>();
  constructor(private run: (threadId: string, args: string[]) => Promise<string>) {}
  private cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const cached = this.cache.get(key);
    if (cached && cached.until > Date.now()) return cached.value as Promise<T>;
    if (this.cache.size > 100) this.cache.delete(this.cache.keys().next().value!);
    const value = load(); this.cache.set(key, { until: Date.now() + 10000, value });
    void value.catch(() => { if (this.cache.get(key)?.value === value) this.cache.delete(key); });
    return value;
  }
  private address(url: string) {
    const a = pullRequestAddress(url), host = (process.env.GH_HOST ?? 'github.com').toLowerCase();
    if (a.host !== host) throw refused(`pull request host must be ${host}`);
    return a;
  }
  review(threadId: string, url: string): Promise<PullRequestReview> {
    const a = this.address(url);
    return this.cached(`${threadId}:${a.url}:review`, async () => {
      const [raw, inlineRaw] = await Promise.all([
        this.run(threadId, ['pr', 'view', a.url, '--json', 'url,title,body,state,headRefName,baseRefName,comments,reviews,statusCheckRollup']),
        this.run(threadId, ['api', '--hostname', a.host, `repos/${a.repository}/pulls/${a.number}/comments?per_page=100`]),
      ]);
      const item = row(json(raw)), inline = list(json(inlineRaw));
      if (pullRequestAddress(String(item.url)).url.toLowerCase() !== a.url.toLowerCase()) throw refused('GitHub returned another pull request');
      const comments = [...list(item.comments), ...inline], reviews = list(item.reviews), checks = list(item.statusCheckRollup);
      return { url: a.url, title: text(item.title), body: text(item.body, 40000), state: text(item.state), head: text(item.headRefName), base: text(item.baseRefName), checkedAt: Date.now(),
        comments: comments.slice(-150).map(comment).sort((x, y) => x.at.localeCompare(y.at)), reviews: reviews.slice(-100).map(comment),
        checks: checks.slice(0, 100).map(value => { const c = row(value); return { name: text(c.name ?? c.context), state: text(c.conclusion || c.status || c.state), url: safeUrl(c.detailsUrl ?? c.targetUrl) }; }),
        truncated: comments.length > 150 || reviews.length >= 100 || checks.length >= 100 || inline.length >= 100 || list(item.comments).length >= 100 || text(item.body, 40001).length > 40000 || [...comments, ...reviews].some(c => text(row(c).body, 12001).length > 12000) };
    });
  }
  /** A page of files whose patches share one budget, or with `path`, that file of the page alone with up to REVIEW_FILE_LIMIT characters of its patch. */
  files(threadId: string, url: string, page: number, path?: string): Promise<PullRequestFiles> {
    const a = this.address(url);
    if (!Number.isSafeInteger(page) || page < 1 || page > 100) throw refused('pull request files page must be between 1 and 100');
    if (path !== undefined && (typeof path !== 'string' || !path || path.length > 2000)) throw refused('pull request file path must be a file path of the page', { field: 'path', expected: 'a path of 1 to 2000 characters' });
    return this.cached(`${threadId}:${a.url}:files:${page}`, async () => {
      const values = json(await this.run(threadId, ['api', '--hostname', a.host, `repos/${a.repository}/pulls/${a.number}/files?per_page=30&page=${page}`]));
      if (!Array.isArray(values)) throw refused('GitHub files must be an array');
      return values;
    }).then(values => filesPage(values, page, path));
  }
}

function filesPage(values: unknown[], page: number, path: string | undefined): PullRequestFiles {
  const hasMore = values.length === 30 && page < 100, all = values.slice(0, 30).map(value => { const f = row(value); return { path: text(f.filename, 2000), previousPath: f.previous_filename ? text(f.previous_filename, 2000) : undefined,
    status: text(f.status, 50), additions: Math.max(0, Number(f.additions) || 0), deletions: Math.max(0, Number(f.deletions) || 0), patch: typeof f.patch === 'string' ? f.patch : null }; });
  if (path !== undefined) {
    const file = all.find(f => f.path === path);
    if (!file) throw refused(`page ${page} has no file ${path}`, { field: 'path', expected: all.map(f => f.path).join(', ') || 'a page with files' });
    const omitted = Math.max(0, (file.patch?.length ?? 0) - REVIEW_FILE_LIMIT);
    return { page, hasMore, truncated: omitted > 0 || (page === 100 && values.length === 30), files: [{ ...file, patch: file.patch?.slice(0, REVIEW_FILE_LIMIT) ?? null, ...(omitted ? { omitted } : {}) }] };
  }
  const patches = budgetPatches(all, page);
  return { page, hasMore, truncated: (page === 100 && values.length === 30) || patches.some(p => p.omitted > 0),
    files: all.map((f, i) => ({ ...f, patch: patches[i]!.patch, ...(patches[i]!.omitted ? { omitted: patches[i]!.omitted } : {}) })) };
}
